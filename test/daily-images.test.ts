import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {EventEmitter} from 'node:events';
import {Store} from '../src/store.ts';
import {Companion} from '../src/companion.ts';
import {OneBot} from '../src/onebot.ts';
import {nextDaily,Daily} from '../src/daily.ts';
import {aiHotNews} from '../src/news.ts';
import {toolResult} from '../src/tool-result.ts';
import {backup,restore} from '../src/backup.ts';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {installStickerPack,packEntries} from '../src/sticker-library.ts';

const png=await sharp({create:{width:2,height:2,channels:4,background:'#88ccaa'}}).png().toBuffer();
function fixture(t:any){
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-18T01:59:00Z')});
 const root=mkdtempSync(join(tmpdir(),'qq-companion-test-')),store=new Store(root),config=store.config();config.ownerQQ='100000001';config.model='test';store.saveConfig(config);
 const fake=()=>Object.assign(new EventEmitter(),{extraTools:[],ready:true,generation:1,stop(){},interrupt:async()=>{},limits:async()=>({ordinaryUsageAllowed:true}),thread:async()=> 't',turn:async()=> '[TASK_DONE] 完成'});
 const sent:{text:string;image?:Buffer}[]=[],qq=Object.assign(new EventEmitter(),{connected:true,online:true,stop(){},send:async(text:string,image?:Buffer)=>{sent.push({text,image});return {kind:'sent',messageId:'1'};}});
 const app=new Companion(store,fake() as any,qq as any,fake() as any);app.account={type:'chatgpt'};app.tasks.schedule=()=>{};
 app.deliver=async(_id,value,_record,image,guard)=>{if(guard&&!guard())return;sent.push({text:value,image});return {kind:'sent',messageId:'1'};};
 t.after(()=>{app.stop();const path=resolve(root);assert(path.startsWith(resolve(tmpdir())+sep));rmSync(path,{recursive:true,force:true});});return {app,store,qq,sent};
}
test('北京时间每日时间跨午夜，保存后能重启读取且不提前执行',async t=>{const{app,store,sent}=fixture(t);const j=app.daily.save({title:'喝水',time:'10:00',kind:'message',goal:'喝水'}).job;assert.equal(j.nextRunAt,Date.parse('2026-10-18T02:00:00Z'));await app.daily.tick();assert.equal(sent.length,0);assert.equal(new Daily(app).all()[0].id,j.id);assert.equal(nextDaily('00:01',Date.parse('2026-10-18T16:00:00Z')),Date.parse('2026-10-18T16:01:00Z'));assert.equal(store.state().paused,false);});
test('每日新闻实际获取并只发送一次，同日重启不重复',async t=>{const{app,sent}=fixture(t);app.daily.save({title:'新闻',time:'10:00',kind:'news',goal:'十条AI新闻'});let requests=0;app.daily.news=async()=>{requests++;return {items:[],text:'真实新闻'};};t.mock.timers.setTime(Date.parse('2026-10-18T02:00:10Z'));await Promise.all([app.daily.tick(),app.daily.tick()]);await app.daily.tick();assert.equal(requests,1);assert.equal(sent.length,1);assert.equal(app.daily.all()[0].lastRun?.status,'sent');const restarted=new Daily(app);await restarted.tick();assert.equal(sent.length,1);assert.equal(app.ledger.view().today.totalTokens,0);});
test('每日任务错过、暂停和QQ离线均记录原因，不补发',async t=>{const{app,sent,qq}=fixture(t);for(const time of ['10:00','10:01','10:02'])app.daily.save({title:time,time,kind:'message',goal:'提醒'});t.mock.timers.setTime(Date.parse('2026-10-18T02:01:00Z'));app.store.updateState({paused:true});await app.daily.tick();app.store.updateState({paused:false});qq.online=false;t.mock.timers.setTime(Date.parse('2026-10-18T02:02:00Z'));await app.daily.tick();qq.online=true;t.mock.timers.setTime(Date.parse('2026-10-19T02:10:00Z'));await app.daily.tick();assert.equal(sent.length,0);assert(app.daily.all().every(j=>j.lastRun?.status==='skipped'));});
test('正在领取的每日任务崩溃恢复时不重发，保留次日安排',t=>{const{app}=fixture(t);app.daily.save({title:'提醒',time:'10:00',kind:'message',goal:'提醒'});const jobs=app.daily.all();jobs[0].lastRun={at:1,status:'processing',detail:'x'};app.daily.write(jobs);app.daily.recover();assert.equal(app.daily.all()[0].lastRun?.status,'interrupted');assert.equal(app.daily.all()[0].nextRunAt,jobs[0].nextRunAt);});
test('每日任务保存校验、修改、关闭、删除和固定管理员',async t=>{const{app,store,sent}=fixture(t);assert.throws(()=>app.daily.save({time:'25:00',kind:'message'}),/时间/);const j=app.daily.save({title:'新闻',time:'10:00',kind:'news',goal:'十条'}).job;app.daily.save({...j,enabled:false});t.mock.timers.setTime(j.nextRunAt);await app.daily.tick();assert.equal(sent.length,0);app.daily.save({...j,enabled:true});const config=store.config();config.ownerQQ='123456';store.saveConfig(config);t.mock.timers.setTime(app.daily.all()[0].nextRunAt);await app.daily.tick();assert.match(app.daily.all()[0].lastRun!.detail,/管理员/);assert.equal(sent.length,0);app.daily.remove(j.id);assert.equal(app.daily.all().length,0);});
test('每日网页任务由既有活动引擎执行，额度封锁不能绕过',async t=>{const{app}=fixture(t);app.daily.save({title:'查资讯',time:'10:00',kind:'web',goal:'查资料'});app.tasks.abilities.save({web:true});app.store.updateState({blocked:{kind:'quota',reason:'额度不足',resetAt:null}});t.mock.timers.setTime(Date.parse('2026-10-18T02:00:00Z'));await app.daily.tick();assert.equal(app.tasks.current(),null);assert.match(app.daily.all()[0].lastRun!.detail,/额度不足/);});
test('新闻读取中取消任务后不会发出',async t=>{const{app,sent}=fixture(t);const j=app.daily.save({title:'新闻',time:'10:00',kind:'news',goal:'十条'}).job;app.daily.news=async()=>{app.daily.remove(j.id);return {items:[],text:'新闻'};};t.mock.timers.setTime(j.nextRunAt);await app.daily.tick();assert.equal(sent.length,0);});
test('OneBot 用真实图片消息段发送，固定管理员，保留文字且不解析 CQ',async t=>{const{store}=fixture(t);const qq=new OneBot(()=>store.config(),()=>{});qq.connected=true;qq.online=true;let body:any;qq.api=async(_action,value)=>{body=value;return {status:'ok',data:{message_id:'42'}};};assert.equal((await qq.send('[CQ:at,qq=all]',png)).kind,'sent');assert.equal(body.user_id,100000001);assert.equal(body.message[0].data.text,'[CQ:at,qq=all]');assert.equal(body.message[1].type,'image');assert.equal(body.message[1].data.file,'base64://'+png.toString('base64'));assert.equal((await qq.send('x',Buffer.from('invalid'))).kind,'failed');});
test('图片发送超时不重试，避免重复发图',async t=>{const{store}=fixture(t);const qq=new OneBot(()=>store.config(),()=>{});qq.connected=true;qq.online=true;let calls=0;qq.api=async()=>{calls++;throw Error('timeout');};assert.equal((await qq.send('截图',png)).kind,'uncertain');assert.equal(calls,1);});
test('截图仅发送实际已有图片，不能指定任意路径或串到其他任务',async t=>{const{app,store,sent}=fixture(t);await assert.rejects(()=>app.screenshots.send('latest'),/尚无/);writeFileSync(join(store.data,'latest-task.png'),png);await app.screenshots.send();assert(sent[0].image?.equals(png));await assert.rejects(()=>app.screenshots.send('file:///C:/secret'),/无效/);await assert.rejects(()=>app.screenshots.send('latest','../secret'),/无效/);await assert.rejects(()=>app.screenshots.send('latest','another-task'),/尚无/);});
test('管理员补充要求打完发图时，完成后发送该任务的真实截图',async t=>{const{app,sent}=fixture(t);app.tasks.abilities.save({web:true});app.tasks.start({scope:'web',goal:'测试'},'qq');app.tasks.noteFromChat('打完把截图发我');const task=app.tasks.current()!;app.tasks.activeId=task.id;app.tasks.abilities.execute=async()=>toolResult('截图',png);await app.tasks.tool('web_screenshot',{});const done=app.tasks.current()!;done.status='completed';app.tasks.save(done);await app.tasks.notify(done.id);assert.equal(sent.length,2);assert(sent[1].image?.equals(png));await app.tasks.notify(done.id);assert.equal(sent.length,2);});
test('每日工具仅管理员会话可写，主动聊天不能创建或发送图',t=>{const{app}=fixture(t);assert.throws(()=>app.tool('companion_daily_save',{title:'x',time:'10:00',kind:'message',goal:'x'}),/管理员/);assert.throws(()=>app.tool('companion_screenshot_send',{source:'latest'}),/管理员/);app.tasks.allowStart=true;assert(app.tool('companion_daily_save',{title:'x',time:'10:00',kind:'message',goal:'x'}));assert.equal(app.daily.all().length,1);});
test('AIHOT 热榜使用官方JSON和原顺序，校验链接，失败不编造',async()=>{let url='',headers:any;const fake=async(u:any,init:any)=>{url=String(u);headers=init.headers;return new Response(JSON.stringify({items:[{title:'真实热点',links:{aihot:'https://aihot.news/items/example'}}]}));};const result=await aiHotNews(fake as any);assert.equal(url,'https://aihot.news/api/v1/hot-topics');assert.match(headers['User-Agent'],/aihot-api\/2/);assert(result.text.includes('真实热点'));await assert.rejects(()=>aiHotNews((async()=>new Response('',{status:503})) as any),/不可用/);await assert.rejects(()=>aiHotNews((async()=>new Response(JSON.stringify({items:[{title:'x',links:{aihot:'http://127.0.0.1/'}}]}))) as any),/链接无效/);});

test('模拟器截图直接捕获当前任意App，不依赖2048或模型视觉验证',async t=>{const{app,sent}=fixture(t);app.tasks.abilities.save({android:true});let calls=0;app.tasks.abilities.phone.call=async(name)=>{assert.equal(name,'phone_screenshot');calls++;return {image:png,text:'任意App截图'};};app.tasks.abilities.vision=()=>{throw Error('不应要求模型看图');};await app.screenshots.send('android');assert.equal(calls,1);assert(sent[0].image?.equals(png));assert.match(sent[0].text,/当前 App/);});
test('网页截图必须来自实际打开的coco浏览器，不拿旧图冒充CLI画面',async t=>{const{app,store,sent}=fixture(t);app.tasks.abilities.save({web:true});writeFileSync(join(store.data,'latest-task.png'),png);await assert.rejects(()=>app.screenshots.send('web'),/尚无打开/);assert.equal(sent.length,0);app.tasks.abilities.browser.page={isClosed:()=>false} as any;app.tasks.abilities.browser.screenshot=async()=>png;await app.screenshots.send('web');assert(sent[0].image?.equals(png));assert.match(sent[0].text,/当前网页/);app.tasks.abilities.browser.page=undefined;});
test('图库内置六张可用表情，可查询、发送及移出后不重建',async t=>{const{app,sent}=fixture(t);await app.stickers.init();assert.equal(app.stickers.list().length,6);const item=app.stickers.list('安慰')[0];assert.equal(item.name,'抱抱');await app.stickers.send(item.id);assert(sent[0].image!.length>0);app.stickers.remove(item.id);await app.stickers.init();assert.equal(app.stickers.list().length,5);await assert.rejects(()=>app.stickers.send(item.id),/不存在/);});
test('常用图库按固定来源下载，重复安装不覆盖用户移除的图片，失败可补装',async t=>{
 const {app}=fixture(t);let calls=0;
 const result=await installStickerPack(app.stickers,'panda',async url=>{assert.equal(new URL(url).hostname,'raw.githubusercontent.com');calls++;if(calls===2)throw Error('网络错误');return png;});
 assert.equal(result.installed,23);assert.equal(result.failures.length,1);
 const id=packEntries('panda')[0].id;app.stickers.remove(id);
 const retry=await installStickerPack(app.stickers,'panda',async()=>png);assert.equal(retry.installed,1);assert.equal(retry.existing,23);assert(!app.stickers.list().some(x=>x.id===id));
 assert(app.stickers.list().every(x=>x.source?.startsWith('https://raw.githubusercontent.com/zhaoolee/ChineseBQB/')));
 await assert.rejects(()=>installStickerPack(app.stickers,'https://evil.invalid'),/未知/);
});
test('导入GIF保持原始字节，重复导入更新同一项，WebP也可发送',async t=>{const{app,sent}=fixture(t);const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');const item=await app.stickers.import({name:'动态表情',tags:['开心'],data:gif.toString('base64')});assert.equal(item.format,'gif');await app.stickers.send(item.id);assert(sent[0].image?.equals(gif));const same=await app.stickers.import({name:'换名',data:gif.toString('base64')});assert.equal(same.id,item.id);assert.equal(app.stickers.list().length,1);const webp=await sharp(png).webp().toBuffer();const w=await app.stickers.import({name:'WebP',data:webp.toString('base64')});assert.equal(w.format,'webp');await app.stickers.send(w.id);assert(sent[1].image?.equals(webp));});
test('伪装图片、非法ID和超大表情被拒绝',async t=>{const{app}=fixture(t);await assert.rejects(()=>app.stickers.import({name:'脚本',data:Buffer.from('<script>alert(1)</script>').toString('base64')}),/支持/);await assert.rejects(()=>app.stickers.import({name:'错误PNG',data:Buffer.concat([png.subarray(0,8),Buffer.from('bad')]).toString('base64')}));assert.throws(()=>app.stickers.file('../secret'),/无效/);await assert.rejects(()=>app.stickers.import({name:'大图',data:'A'.repeat(12*1024*1024+1)}),/无效/);});
test('表情工具按真实ID发送，每轮不刷屏且主动聊天不可发送',async t=>{const{app}=fixture(t);await app.stickers.init();await assert.rejects(async()=>app.tool('companion_sticker_send',{id:'coco-happy'}),/管理员/);app.tasks.allowStart=true;await app.tool('companion_sticker_send',{id:'coco-happy'});assert.throws(()=>app.tool('companion_sticker_send',{id:'coco-ok'}),/本轮/);});
test('自主表情无需索要，冷却和最近三张限制跨重启保留，明确索要可发送',async t=>{
 const {app,store,sent}=fixture(t);await app.stickers.init();app.tasks.allowStart=true;
 app.stickers.begin('qq','今天考试终于过了！');assert.match(app.stickers.prompt(),/可以像日常聊天/);
 await app.tool('companion_sticker_send',{id:'coco-ok'});assert.equal(sent.length,1);
 app.stickers.begin('qq','好开心');await assert.rejects(async()=>app.tool('companion_sticker_send',{id:'coco-happy'}),/冷却/);
 const restored=new (app.stickers.constructor as any)(app);assert.match(restored.reason(),/冷却/);
 t.mock.timers.setTime(Date.now()+6*60000);assert.match(restored.reason('coco-ok'),/最近三张/);
 app.stickers.save({automatic:false});app.stickers.begin('qq','给我发表情包');await app.tool('companion_sticker_send',{id:'coco-hug'});assert.equal(sent.length,2);
 const saved=backup(store);app.stickers.save({automatic:true});restore(store,saved);assert.equal(app.stickers.settings().automatic,false);
});
test('自主表情北京时间每日限额和不确定发送均占用记录，非QQ会话不发',async t=>{
 const {app}=fixture(t);await app.stickers.init();app.tasks.allowStart=true;app.stickers.save({dailyMax:1});
 app.deliver=async()=>({kind:'uncertain',error:'timeout'});
 app.stickers.begin('qq','哈哈哈');await assert.rejects(async()=>app.tool('companion_sticker_send',{id:'coco-happy'}),/timeout/);assert.match(app.stickers.reason(),/上限/);
 t.mock.timers.setTime(Date.parse('2026-10-18T16:01:00Z'));assert.equal(app.stickers.reason(),'');
 app.stickers.begin('local','发表情包');assert.throws(()=>app.tool('companion_sticker_send',{id:'coco-ok'}),/QQ私聊/);
 assert.throws(()=>app.stickers.save({cooldownMinutes:0}),/范围/);
});
test('表情图库和图片二进制一起备份恢复，保持内容一致',async t=>{const{app,store}=fixture(t);const item=await app.stickers.import({name:'测试图',data:png.toString('base64')});const saved=backup(store);app.stickers.remove(item.id);restore(store,saved);assert.equal(app.stickers.list().length,1);assert(readFileSync(app.stickers.file(item.id).path).equals(png));});
test('OneBot原样发送GIF和WebP字节',async t=>{const{store}=fixture(t);const qq=new OneBot(()=>store.config(),()=>{});qq.connected=true;qq.online=true;const bodies:any[]=[];qq.api=async(_a,body)=>{bodies.push(body);return {status:'ok',data:{message_id:1}};};const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'),webp=await sharp(png).webp().toBuffer();for(const bytes of [gif,webp])assert.equal((await qq.send('表情',bytes)).kind,'sent');assert.equal(bodies[0].message[1].data.file,'base64://'+gif.toString('base64'));assert.equal(bodies[1].message[1].data.file,'base64://'+webp.toString('base64'));});
test('表情直接发送图片消息，不附带表情名称或空文本段',async t=>{const{store}=fixture(t);const qq=new OneBot(()=>store.config(),()=>{});qq.connected=true;qq.online=true;let body:any;qq.api=async(_a,b)=>{body=b;return {status:'ok',data:{message_id:1}};};await qq.send('',png);assert.equal(body.message.length,1);assert.equal(body.message[0].type,'image');});
