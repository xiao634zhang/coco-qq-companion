import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {EventEmitter} from 'node:events';
import {Store,atomicJson} from '../src/store.ts';
import {Extensions,splitReply} from '../src/extensions.ts';
import {Companion} from '../src/companion.ts';
import {Media,parseMediaOutput} from '../src/media.ts';
import {backup,restore} from '../src/backup.ts';
import sharp from 'sharp';
import {qzoneTarget} from '../src/integrations.ts';
function setup(t:any){const root=mkdtempSync(join(tmpdir(),'coco-ext-')),store=new Store(root);const fake=()=>Object.assign(new EventEmitter(),{extraTools:[],generation:1,limits:async()=>({ordinaryUsageAllowed:true,rateLimits:{primary:{usedPercent:10,resetsAt:1999999999}}}),thread:async()=> 'thread',turn:async()=> '群聊回复',interrupt:async()=>{},stop:()=>{}});const qq:any=Object.assign(new EventEmitter(),{selfId:'999999',online:true,connected:true,stop:()=>{},send:async()=>({kind:'sent'}),api:async()=>({status:'ok',data:{message_id:1}})});const c=store.config();c.ownerQQ='100000001';c.model='test';store.saveConfig(c);const app=new Companion(store,fake() as any,qq as any,fake() as any,fake() as any);app.account={type:'chatgpt'};t.after(async()=>{app.stop();await app.tasks.abilities.close();const p=resolve(root);assert(p.startsWith(resolve(tmpdir())+sep));rmSync(p,{recursive:true,force:true});});return {app,store,qq};}
test('经历持久化去重，开发任务不记录，日记满额仍保存经历',t=>{const {app,store}=setup(t);for(let i=0;i<3;i++)store.diary('日记'+i);const task={id:'a',goal:'露营',summary:'读到帐篷说明 https://example.com/camp',status:'completed',category:'runtime.web'};app.extensions.remember(task);app.extensions.remember(task);app.extensions.remember({...task,id:'b',category:'development.tools'});assert.equal(app.extensions.experiences().length,1);assert.deepEqual(app.extensions.experiences()[0].links,['https://example.com/camp']);assert.equal(new Extensions(store).experiences('露营').length,1);assert.equal(store.diaries().length,3);});
test('分条保留所有文本并限制条数，设置校验群号包名音色',t=>{const{app}=setup(t);assert.deepEqual(splitReply('一\n二\n三\n四',3),['一','二','三\n四']);assert.throws(()=>app.extensions.save({groups:['abc']}));assert.throws(()=>app.extensions.save({apps:['a;rm']}));assert.throws(()=>app.extensions.save({voice:'$(cmd)'}));const c=app.extensions.save({groups:['123456'],voice:'sapi',maxParts:2});assert.deepEqual(c.groups,['123456']);});
test('群聊仅响应启用群的@，不注入私聊记忆且不注册控制工具',async t=>{const{app,store,qq}=setup(t);const requests:any[]=[];qq.api=async(a:string,b:any)=>{requests.push({a,b});return {status:'ok',data:{message_id:1}};};app.extensions.save({groups:['123456']});store.saveMemory({facts:['私聊秘密'],preferences:[],summary:''});let prompt='',tools=true;(app.codex as any).turn=async(_id:string,p:string,_m:string,_e:string,t:boolean)=>{prompt=p;tools=t;return '你好';};const event:any={post_type:'message',message_type:'group',group_id:'123456',user_id:'654321',self_id:'999999',message_id:'g1',message:[{type:'at',data:{qq:'999999'}},{type:'text',data:{text:'你好'}}]};app.receive({...event,group_id:'777777'});app.receive({...event,message:[{type:'text',data:{text:'你好'}}]});assert.equal(app.queueCount,0);app.receive(event);await app.tail;assert.equal(requests.length,1);assert.equal(requests[0].a,'send_group_msg');assert(!prompt.includes('私聊秘密'));assert.equal(tools,false);app.receive(event);await app.tail;assert.equal(requests.length,1);});
test('空间写操作保留频率状态，未知结果不自动重试，音乐拒绝未授权写动作',async t=>{const{app,qq}=setup(t);let calls=0;qq.api=async()=>{calls++;return {status:'failed',retcode:1404};};await assert.rejects(()=>app.integrations.qzone({action:'comment',tid:'real-tid',content:'好看'}),/未成功/);await assert.rejects(()=>app.integrations.qzone({action:'comment',tid:'real-tid',content:'好看'}),/上限/);assert.equal(calls,1);await assert.rejects(()=>app.integrations.music({action:'ncm_room_say',args:{text:'hi'}}),/无效/);});
test('宏每步都核对任务状态，暂停后停止后续动作',async t=>{const{app}=setup(t);const lane=app.tasks.lanes.device;const task:any={id:'macro-task',goal:'测试',scope:'android',status:'running',source:'local',category:'development.tools',createdAt:Date.now(),deadline:Date.now()+60000,maxActions:10,actions:0,steps:0,summary:'',reason:'',model:'test',effort:''};app.tasks.save(task);lane.activeId=task.id;app.limits={ordinaryUsageAllowed:true,rateLimits:{primary:{usedPercent:10,resetsAt:1999999999}}};app.ledger.sync(app.limits);const settings=app.tasks.abilities.settings();atomicJson(join(app.store.data,'abilities.json'),{...settings,android:true});let called=0;app.tasks.abilities.execute=async()=>{called++;app.store.updateState({paused:true});return {contentItems:[]};};await assert.rejects(()=>lane.tool('android_macro',{name:'暂停测试',actions:[{type:'key',key:'back'},{type:'key',key:'enter'}]}),/停止|挂起/);assert.equal(called,1);assert.equal(lane.all()[0].actions,1);});
test('媒体路径不能越界，扩展经历和宏纳入备份恢复',t=>{const{app,store}=setup(t);const media=new Media(store);assert.throws(()=>media.file('../config.json'));assert.throws(()=>media.import('evil.exe','dGVzdA=='));app.extensions.save({humanize:false});atomicJson(join(store.data,'phone-macros.json'),{a:[{type:'key',key:'back'}]});app.extensions.remember({id:'x',goal:'读书',summary:'内容',status:'completed',category:'runtime.web'});const name=backup(store);app.extensions.save({humanize:true});restore(store,name);assert.equal(app.extensions.settings().humanize,false);assert.equal(app.extensions.experiences().length,1);assert(readFileSync(join(store.root,'backups',name,'manifest.json'),'utf8').includes('phone-macros.json'));});
test('QQ网关返回URL同时带WAV base64时，使用音频数据而非误判本地文件不存在',async t=>{const{app}=setup(t);let called=false;app.media.transcribe=async(id,model)=>{called=true;assert(id.endsWith('.wav'));assert.equal(model,'small');assert.equal(readFileSync(app.media.file(id)).toString(),'RIFF-test-wave');return {text:'你好'};};const result=await app.media.incoming('voice-id',{api:async()=>({status:'ok',data:{file:'https://example.com/download',base64:Buffer.from('RIFF-test-wave').toString('base64')}})},'small');assert.equal(result.text,'你好');assert(called);assert.equal(app.extensions.save({voice:'kokoro:zf_001'}).voice,'kokoro:zf_001');});
test('神经音色库的启动提示不破坏JSON结果；语音工具每轮一次且仅响应QQ管理员',async t=>{assert.deepEqual(parseMediaOutput('Warning: en_callable is None\n{"saved":true}\n'),{saved:true});const{app}=setup(t);assert.throws(()=>app.tool('companion_voice_send',{text:'你好'}),/仅QQ管理员/);app.tasks.allowStart=true;app.tasks.chatSource='qq';app.media.speak=async()=>({id:'test.mp3',bytes:Buffer.from('voice')});assert.deepEqual(await app.tool('companion_voice_send',{text:'你好'}),{sent:true});assert.throws(()=>app.tool('companion_voice_send',{text:'再来'}),/每轮最多/);});

test('QQ图片通过网关取得真实字节并压缩，拒绝错误域名、超限和伪造图片',async t=>{
 const{app}=setup(t),png=await sharp({create:{width:4,height:4,channels:3,background:'red'}}).png().toBuffer();
 const segments=[{type:'image',data:{file:'gateway-image'}}];
 const images=await app.media.incomingImages(segments,{api:async()=>({status:'ok',data:{base64:png.toString('base64')}})});
 assert.equal(images.length,1);assert(images[0].startsWith('data:image/jpeg;base64,'));
 await assert.rejects(()=>app.media.incomingImages(Array(5).fill(segments[0]),{api:async()=>{throw Error('must not call')}}),/最多/);
 let fetched=false;await assert.rejects(()=>app.media.incomingImages(segments,{api:async()=>({status:'ok',data:{url:'https://example.com/private'}})},(async()=>{fetched=true;return new Response()}) as any),/地址无效/);assert.equal(fetched,false);
 await assert.rejects(()=>app.media.incomingImages(segments,{api:async()=>({status:'ok',data:{base64:Buffer.from('not an image').toString('base64')}})}),/格式/);
 await assert.rejects(()=>app.media.incomingImages(segments,{api:async()=>({status:'ok',data:{url:'https://multimedia.nt.qq.com.cn/image'}})},(async()=>new Response('too big',{headers:{'content-length':String(9*1024*1024)}})) as any),/超过/);
});
test('管理员图片实际作为模型附件，下载失败不让模型猜图，陌生用户不触发下载',async t=>{
 const{app,qq}=setup(t);app.extensions.save({humanize:false,typing:false});let reads=0,sends=0;const inputs:any[]=[];qq.send=async()=>{sends++;return {kind:'sent'};};
 app.media.incomingImages=async()=>{reads++;return ['data:image/jpeg;base64,test'];};
 (app.codex as any).turn=async(...args:any[])=>{inputs.push(args);return '图片里有食物';};
 const event:any={post_type:'message',message_type:'private',sub_type:'friend',user_id:'100000001',self_id:'999999',message_id:'photo',message:[{type:'text',data:{text:'看看午饭'}},{type:'image',data:{file:'image'}}]};
 app.receive({...event,user_id:'777777'});assert.equal(reads,0);app.receive(event);await app.tail;
 assert.equal(reads,1);assert.deepEqual(inputs[0][7],['data:image/jpeg;base64,test']);assert(inputs[0][1].includes('看看午饭'));assert(!inputs[0][1].includes('[image消息'));
 app.deliver=async()=>({kind:'sent'} as any);app.media.incomingImages=async()=>{throw Error('download failed');};app.receive({...event,message_id:'bad-photo'});await app.tail;assert.equal(inputs.length,1);assert.equal(sends,1);
});
test('说说列表失败只读降级，核对作者和类型，点赞携带真实发表时间',async t=>{
 const{app,qq}=setup(t),calls:any[]=[];qq.api=async(action:string,payload:any)=>{calls.push({action,payload});if(action==='get_qzone_msg_list')return {status:'failed',retcode:100};if(action==='get_qzone_feeds')return {status:'ok',data:{feeds:[{uin:'999999',appid:311,key:'wrong',time:1},{uin:'100000001',appid:311,key:'real-tid',time:1700000000,html:'<p>好天气</p>'},{uin:'100000001',appid:6600,key:'advert',time:1}]}};return {status:'ok',data:null};};
 const result=await app.integrations.qzone({action:'posts'});const item=result.contentItems[0];assert.equal(item.type,'inputText');if(item.type!=='inputText')throw Error('missing text result');const posts=JSON.parse(item.text);assert.equal(posts.msglist.length,1);assert.equal(posts.msglist[0].tid,'real-tid');assert.equal(posts.partial,true);
 await app.integrations.qzone({action:'like',tid:'real-tid'});assert.deepEqual(calls.at(-1),{action:'like_qzone',payload:{tid:'real-tid',target_uin:100000001,abstime:1700000000}});
});
test('空间链接精确定位并拒绝冲突目标，空动态不能误赞其他账号',async t=>{
 assert.deepEqual(qzoneTarget('https://user.qzone.qq.com/100000001/mood/real-tid'),{qq:'100000001',tid:'real-tid'});
 assert.throws(()=>qzoneTarget('https://user.qzone.qq.com.evil.test/100000001/mood/x'));
 const{app,qq}=setup(t);let writes=0;qq.api=async(action:string)=>{if(action==='get_qzone_msg_list')return {status:'failed'};if(action==='get_qzone_feeds')return {status:'ok',data:{feeds:[{uin:999999,appid:311,key:'wrong'}]}};writes++;return {status:'ok'};};
 await assert.rejects(()=>app.integrations.qzone({action:'posts'}),/尚未执行点赞/);assert.equal(writes,0);
 await assert.rejects(()=>app.integrations.qzone({action:'like',qq:'999999',url:'https://user.qzone.qq.com/100000001/mood/real-tid'}),/不一致/);assert.equal(writes,0);
});
test('空间业务失败或超时不会重试写操作，也不误报成功',async t=>{
 const{app,qq}=setup(t);let calls=0;qq.api=async()=>{calls++;return {status:'ok',data:{code:-3000}};};
 await assert.rejects(()=>app.integrations.qzone({action:'like',tid:'real-tid'}),/未成功/);assert.equal(calls,1);
 await assert.rejects(()=>app.integrations.qzone({action:'like',tid:'real-tid'}),/上限/);assert.equal(calls,1);
});
