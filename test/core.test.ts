import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import { Store, shanghai } from '../src/store.ts';
import { Companion } from '../src/companion.ts';
import { Codex, RpcError, type Model } from '../src/codex.ts';
import { OneBot, localEndpoint, privateText } from '../src/onebot.ts';
import { proactiveEligible, nextCheck } from '../src/scheduler.ts';
import { createHttp, validateConfig } from '../src/server.ts';
import { backup, backupList, restore } from '../src/backup.ts';

test('HTTP 独立令牌与共用令牌兼容，管理 API 不泄漏令牌',async t=>{
  const {store,app}=setup(t), c=store.config();
  c.snow.accessToken='ws-secret';c.snow.httpAccessToken='http-secret';store.saveConfig(c);
  const previous=globalThis.fetch,seen:string[]=[];
  globalThis.fetch=(async(_url:any,init:any)=>{seen.push(init.headers.Authorization);return new Response('{"status":"ok"}');}) as typeof fetch;
  t.after(()=>{globalThis.fetch=previous;});
  const qq=new OneBot(()=>store.config(),()=>{});await qq.api('get_status');
  store.saveConfig(validateConfig(c,{snow:{httpAccessToken:null}}));await qq.api('get_status');
  assert.deepEqual(seen,['Bearer http-secret','Bearer ws-secret']);
  store.saveConfig(c);store.log('secret-check',c.snow.httpAccessToken);
  assert(!JSON.stringify(store.lines('events.jsonl')).includes('http-secret'));
  globalThis.fetch=previous;
  const server=createHttp(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise<void>(r=>server.close(()=>r())));
  const response=await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/config`,{headers:{Authorization:'Bearer '+store.token()}});
  const body=await response.json() as any;assert.equal(body.snow.httpTokenConfigured,true);
  assert.equal(body.snow.accessToken,'');assert.equal(body.snow.httpAccessToken,'');
});

const models: Model[] = [{id:'a',model:'a',displayName:'A',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low',description:'low'}]}, {id:'b',model:'b',displayName:'B',defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high',description:'high'}]}];
class FakeCodex extends EventEmitter {
  ready=true;generation=1;toolHandler:unknown;calls=0;rejectModel=false;reply='你好，今天怎么样？';error:Error|null=null;
  async start(){this.ready=true;}
  stop(){this.ready=false;this.generation++;}
  async account(){return {type:'chatgpt',planType:'test'};}
  async models(){return structuredClone(models);}
  async limits(){return {ordinaryUsageAllowed:true,rateLimits:{primary:{usedPercent:12,resetsAt:2000000000}}};}
  async thread(model:string){if(this.rejectModel&&model==='b')throw new Error('not entitled');return 'thread-test';}
  async resume(){return {};}
  async turn(){this.calls++;if(this.error)throw this.error;return this.reply;}
  async compact(){return '';}
  async interrupt(){}
}
class FakeQQ extends EventEmitter {
  online=true;connected=true;selfId='999999';sent:string[]=[];kind:'sent'|'uncertain'|'failed'='sent';
  async send(value:string){this.sent.push(value);return {kind:this.kind,messageId:'123'};}
  start(){this.online=true;this.connected=true;}
  stop(){this.online=false;this.connected=false;}
}
function setup(t:any){
  const root=mkdtempSync(join(tmpdir(),'qq-companion-test-'));
  const store=new Store(root), c=store.config();c.ownerQQ='100000001';c.model='a';c.effort='low';store.saveConfig(c);
  const fake=new FakeCodex(),qq=new FakeQQ(),app=new Companion(store,fake as unknown as Codex,qq as unknown as OneBot,new FakeCodex() as unknown as Codex);
  app.account={type:'chatgpt'};app.models=structuredClone(models);
  t.after(()=>{app.stop();const base=resolve(tmpdir())+sep,target=resolve(root);if(!target.startsWith(base)||!target.includes('qq-companion-test-'))throw new Error('unsafe cleanup');rmSync(target,{recursive:true,force:true});});
  return {root,store,fake,qq,app};
}
const event={post_type:'message',message_type:'private',sub_type:'friend',user_id:'100000001',self_id:'999999',message_id:'m1',message:[{type:'text',data:{text:'你好'}}]};

test('连续文字合成一次完整输入，重复消息不重复加入，所有消息终态一致',async t=>{
 const{app,store,qq}=setup(t);app.chatMergeMs=15;app.extensions.save({humanize:false,typing:false});
 const inputs:string[]=[];app.chat=async(value:string)=>{inputs.push(value);return '一起回答';};
 const send=(id:string,value:string)=>app.receive({...event,message_id:id,message:[{type:'text',data:{text:value}}]});
 send('burst1','我想去露营');send('burst2','周末去');send('burst2','周末去');send('burst3','帮我想想带什么');
 await app.tail;assert.deepEqual(inputs,['我想去露营\n周末去\n帮我想想带什么']);assert.deepEqual(qq.sent,['一起回答']);
 for(const id of ['burst1','burst2','burst3'])assert.equal(store.deliveries()['qq:999999:100000001:'+id].status,'sent');
});
test('忙碌期间积压文字共用一项队列，指令分隔前后消息',async t=>{
 const{app,store}=setup(t);app.chatMergeMs=10;
 const inputs:string[]=[],replies:string[]=[];app.chat=async value=>{inputs.push(value);return '收到';};
 app.deliver=async(id,value)=>{replies.push(value);store.delivery(id,{status:'sent'});return {kind:'sent'} as any;};
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);void app.enqueue(()=>gate);
 const send=(id:string,value:string)=>app.receive({...event,message_id:id,message:[{type:'text',data:{text:value}}]});
 send('one','第一组');send('two','补充');assert.equal(app.queueCount,2);
 send('command','/状态');send('three','第二组');send('four','再补充');release();await app.tail;
 assert.deepEqual(inputs,['第一组\n补充','第二组\n再补充']);assert.equal(replies.length,3);
});
test('合并输入失败后整组标记失败，暂停仍立即生效',async t=>{
 const{app,store}=setup(t);app.chatMergeMs=10;app.chat=async()=>{throw Error('test model failure');};
 const send=(id:string,value:string)=>app.receive({...event,message_id:id,message:[{type:'text',data:{text:value}}]});
 send('fail1','第一句');send('fail2','第二句');await app.tail;
 for(const id of ['fail1','fail2'])assert.equal(store.deliveries()['qq:999999:100000001:'+id].status,'failed');
 app.deliver=async(id)=>{store.delivery(id,{status:'sent'});return {kind:'sent'} as any;};
 send('pause1','还有一句');send('pause2','/暂停');assert.equal(store.state().paused,true);await app.tail;
 assert.equal(store.deliveries()['qq:999999:100000001:pause1'].status,'failed');
});

test('北京时间午夜日界与活动时段',t=>{const{store}=setup(t);const now=Date.parse('2026-10-18T16:00:00Z');assert.deepEqual(shanghai(now),{day:'2026-10-19',hour:0,time:'2026-10-19 00:00:00 北京时间'});const s={...store.state(),lastUserAt:now-3600000};assert.equal(proactiveEligible(store.config(),s,true,false,now),false);assert.equal(proactiveEligible(store.config(),s,true,false,now+8*3600000),true);});
test('随机调度严格落在 30–90 分钟且重启不补发',t=>{const{store}=setup(t);assert.equal(nextCheck(store.config(),1000,()=>0),1801000);assert.equal(nextCheck(store.config(),1000,()=>1),5401000);});
test('主动聊天的每日次数、间隔、闲置和忙碌限制',t=>{const{store}=setup(t),now=Date.parse('2026-10-18T04:00:00Z'),c=store.config();const s={...store.state(),lastUserAt:now-3600000};assert(proactiveEligible(c,s,true,false,now));for(const patch of [{paused:true},{blocked:{kind:'quota' as const,reason:'x',resetAt:null}},{lastUserAt:now-100},{lastProactiveAt:now-100},{proactiveDay:shanghai(now).day,proactiveCount:8}])assert(!proactiveEligible(c,{...s,...patch},true,false,now));assert(!proactiveEligible(c,s,false,false,now));assert(!proactiveEligible(c,s,true,true,now));assert(proactiveEligible(c,{...s,proactiveDay:'2026-10-17',proactiveCount:8},true,false,now));});
test('长期记忆、日记和会话跨进程持久化',t=>{const{root,store}=setup(t);store.saveMemory({facts:['养猫'],preferences:['茶'],summary:'一起聊过音乐'});store.diary('今天一起听歌','开心');store.updateState({threadId:'persisted'});const loaded=new Store(root);assert.equal(loaded.memory().facts[0],'养猫');assert.equal(loaded.diaries()[0].text,'今天一起听歌');assert.equal(loaded.state().threadId,'persisted');});
test('日记每天最多三条；模型工具不能调用配置与文件',t=>{const{app,store}=setup(t);for(let i=0;i<3;i++)app.tool('companion_diary_write',{text:'具体的小事'+i});assert.throws(()=>app.tool('companion_diary_write',{text:'第四条'}),/三条/);assert.throws(()=>app.tool('write_file',{path:'C:/file'}),/未开放/);assert.throws(()=>app.tool('companion_memory_append',{category:'config',text:'x'}),/类别/);assert.equal(store.config().model,'a');});
test('记忆工具去重并拒绝凭据',t=>{const{app,store}=setup(t);app.tool('companion_memory_append',{category:'facts',text:'养猫'});app.tool('companion_memory_append',{category:'facts',text:'养猫'});assert.equal(store.memory().facts.length,1);assert.throws(()=>app.tool('companion_memory_append',{category:'facts',text:'密码：1234'}),/凭据/);});
test('暂停立即生效，暂停后拒绝记忆写入',t=>{const{app,store}=setup(t);app.pause();assert.equal(store.state().paused,true);assert.throws(()=>app.tool('companion_diary_write',{text:'x'}),/暂停/);});
test('额度用尽不会付费回退，不能凭恢复时间推断可用',t=>{const{app,store}=setup(t);app.limits={ordinaryUsageAllowed:false,rateLimits:{primary:{usedPercent:100,resetsAt:1}}};app.applyLimits();assert.equal(store.state().blocked?.kind,'quota');assert.throws(()=>app.checkReady(),/额度/);app.limits={rateLimits:{primary:{usedPercent:0}}};app.applyLimits();assert.equal(store.state().blocked?.kind,'quota');app.limits={ordinaryUsageAllowed:true,rateLimits:{primary:{usedPercent:0}}};app.applyLimits();assert.equal(store.state().blocked,null);});
test('额度 API 缺失时显示未知，不能清除现有额度封锁',async t=>{const{app,fake,store}=setup(t);store.updateState({blocked:{kind:'quota',reason:'quota',resetAt:null}});fake.limits=async()=>{throw new Error('unsupported')};await app.refresh();assert.equal(app.limits,null);assert.equal(store.state().blocked?.kind,'quota');});
test('拒绝 API Key 模式；识别登录失效和额度错误',t=>{const{app,store}=setup(t);app.account={type:'apiKey'};assert.throws(()=>app.checkReady(),/订阅登录/);app.onModelError(new RpcError('Unauthorized',{code:401}));assert.equal(store.state().blocked?.kind,'auth');app.onModelError(new RpcError('usage_limit_reached'));assert.equal(store.state().blocked?.kind,'quota');});
test('成功切换具体模型和强度，保留长期数据',async t=>{const{app,store}=setup(t);store.saveMemory({facts:['养猫'],preferences:[],summary:''});store.diary('小事');await app.switchModel('b','high');assert.equal(store.config().model,'b');assert.equal(store.config().effort,'high');assert.equal(store.memory().facts[0],'养猫');assert.equal(store.diaries().length,1);});
test('无权限模型或不支持的强度不会覆盖当前配置',async t=>{const{app,fake,store}=setup(t);fake.rejectModel=true;await assert.rejects(app.switchModel('b'),/entitled/);await assert.rejects(app.switchModel('a','ultra'),/不支持/);await assert.rejects(app.switchModel('fake'),/不在/);assert.equal(store.config().model,'a');});
test('重置会话保留长期记忆和日记',t=>{const{app,store}=setup(t);store.saveMemory({facts:['猫'],preferences:[],summary:''});store.diary('小事');store.updateState({threadId:'old'});app.reset();assert.equal(store.state().threadId,null);assert.equal(store.memory().facts[0],'猫');assert.equal(store.diaries().length,1);});
test('陌生用户、群聊、自身消息和临时会话全部忽略',async t=>{const{app,fake}=setup(t);for(const patch of [{user_id:'111111'},{message_type:'group'},{self_id:'100000001'},{sub_type:'group'},{message_id:undefined}])app.receive({...event,...patch});await app.tail;assert.equal(fake.calls,0);});
test('相同消息只处理一次，重启后也不重发',async t=>{const{app,qq,store}=setup(t);app.receive(event);app.receive(event);await app.tail;assert.equal(qq.sent.length,1);assert.equal(Object.values(store.deliveries())[0].status,'sent');store.recover();app.receive(event);await app.tail;assert.equal(qq.sent.length,1);});
test('发送结果未知时不重放，恢复标记区分未完成与不确定',t=>{const{store}=setup(t);store.delivery('a',{status:'sending'});store.delivery('b',{status:'processing'});store.delivery('c',{status:'sent'});store.recover();assert.equal(store.deliveries().a.status,'uncertain');assert.equal(store.deliveries().b.status,'interrupted');assert.equal(store.deliveries().c.status,'sent');});
test('QQ 发送网络超时只尝试一次',async t=>{const{store}=setup(t),q=new OneBot(()=>store.config(),()=>{});let calls=0;q.online=q.connected=true;q.selfId='999999';q.api=async()=>{calls++;throw new Error('timeout')};assert.equal((await q.send('hello')).kind,'uncertain');assert.equal(calls,1);});
test('私聊只提取文字，不执行 CQ 控制串',()=>{assert.equal(privateText({...event,message:[{type:'text',data:{text:'你好'}},{type:'image',data:{file:'x'}}]}),'你好[image消息，当前版本仅支持文字]');assert(!privateText({...event,message:'[CQ:image,file=secret]'}).includes('secret'));});
test('只连接本机 OneBot，拒绝跨站地址与 URL 凭据',()=>{assert.equal(localEndpoint('http://127.0.0.1:3000','http:').port,'3000');for(const v of ['http://example.com','http://127.0.0.1.evil.com','https://127.0.0.1','http://u:p@localhost','http://localhost/a','http://localhost?x=1'])assert.throws(()=>localEndpoint(v,'http:'));});
test('验证配置输入不允许降低限流或注入模型字段',t=>{const{store}=setup(t);assert.throws(()=>validateConfig(store.config(),{proactive:{dailyMax:100}}),/范围/);assert.throws(()=>validateConfig(store.config(),{ownerQQ:'x'}),/QQ/);assert.equal(validateConfig(store.config(),{model:'b',proactive:{dailyMax:3}}).model,'a');});
test('串行队列保证消息顺序且异常不会堵住后续消息',async t=>{const{app}=setup(t);const seen:number[]=[];const a=app.enqueue(async()=>{await new Promise(r=>setTimeout(r,20));seen.push(1);throw new Error('expected')});const b=app.enqueue(async()=>{seen.push(2);return 2});await assert.rejects(a);assert.equal(await b,2);assert.deepEqual(seen,[1,2]);assert.equal(app.busy,false);assert.equal(app.queueCount,0);});
test('日志隐藏管理令牌与 SnowLuma 令牌',t=>{const{store}=setup(t);const c=store.config();c.snow.accessToken='private-snow-secret';store.saveConfig(c);store.log('test',store.token()+' '+c.snow.accessToken+' Bearer sensitive');const log=JSON.stringify(store.lines('events.jsonl'));assert(!log.includes(store.token()));assert(!log.includes('private-snow-secret'));assert(!log.includes('Bearer sensitive'));});
test('备份恢复保留记忆、重建会话并自动备份现状',t=>{const{store}=setup(t);store.saveMemory({facts:['旧记忆'],preferences:[],summary:''});const name=backup(store);assert(backupList(store).includes(name));store.saveMemory({facts:['新记忆'],preferences:[],summary:''});const result=restore(store,name);assert.notEqual(result.previous,name);assert.equal(store.memory().facts[0],'旧记忆');assert.equal(store.state().paused,true);assert.equal(store.state().threadId,null);assert.throws(()=>restore(store,'../escape'));});
test('HTTP 管理 API 需要令牌并拒绝跨站 Origin / Host',async t=>{const{app,store,root}=setup(t);mkdirSync(join(root,'public'));writeFileSync(join(root,'public/index.html'),'<h1>Local</h1>');const server=createHttp(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));const port=(server.address() as any).port,base=`http://127.0.0.1:${port}`;assert.equal((await fetch(base+'/api/status')).status,401);const headers={Authorization:'Bearer '+store.token()};assert.equal((await fetch(base+'/api/status',{headers})).status,200);assert.equal((await fetch(base+'/api/status',{headers:{...headers,Origin:'http://evil.example'}})).status,403);const badHost=await new Promise<number>(done=>{const r=httpRequest(base+'/api/status',{headers:{...headers,Host:'evil.example'}},res=>{res.resume();done(res.statusCode!)});r.end()});assert.equal(badHost,403);const html=await fetch(base);assert.equal(html.headers.get('x-content-type-options'),'nosniff');assert.match(html.headers.get('content-security-policy')!,/frame-ancestors 'none'/);});
test('主动生成后管理员已发新消息时不发送',async t=>{const{app,fake,qq,store}=setup(t);store.updateState({lastUserAt:Date.now()-3600000});app.nextCheckAt=0;fake.turn=async()=>{store.updateState({lastUserAt:Date.now()});return '想聊聊'};await app.tick();assert.equal(qq.sent.length,0);});
test('模型选择保持安静时不消耗主动次数',async t=>{const{app,fake,qq,store}=setup(t);store.updateState({lastUserAt:Date.now()-3600000});app.nextCheckAt=0;fake.reply='[SILENT]';await app.tick();assert.equal(qq.sent.length,0);assert.equal(store.state().proactiveCount,0);});
test('意外退出留下的半行 JSONL 在恢复时修复，下一次追加仍可读取',t=>{const{store}=setup(t);store.message('user','已保存');const path=join(store.data,'chat.jsonl');writeFileSync(path,JSON.stringify(store.messages()[0])+'\n'+ '{"incomplete":','utf8');store.recover();store.message('assistant','下一轮');assert.equal(store.messages().length,2);assert.equal(store.messages()[1].text,'下一轮');});
