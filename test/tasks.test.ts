import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {EventEmitter} from 'node:events';
import {Store,atomicJson} from '../src/store.ts';
import {Companion} from '../src/companion.ts';
import {Codex} from '../src/codex.ts';
import {publicIP,publicURL,publicProxy} from '../src/web-browser.ts';
import {toolResult} from '../src/tool-result.ts';

const limits={ordinaryUsageAllowed:true,rateLimits:{primary:{usedPercent:10,resetsAt:1999999999,windowDurationMins:10080}}};
function setup(t:any){
 const root=mkdtempSync(join(tmpdir(),'qq-task-test-')),store=new Store(root),c=store.config();c.model='test-model';store.saveConfig(c);
 const fake=Object.assign(new EventEmitter(),{ready:true,generation:1,extraTools:[],interrupt:async()=>{},thread:async()=> 'task-thread',turn:async()=> '[TASK_DONE] 完成',limits:async()=>limits,stop:()=>{}});
 const qq=Object.assign(new EventEmitter(),{connected:true,online:true,stop:()=>{},send:async()=>({kind:'sent'})});
 const app=new Companion(store,fake as any,qq as any,Object.assign(new EventEmitter(),{...fake}) as any);app.account={type:'chatgpt'};app.limits=limits;app.tasks.schedule=()=>{};
 app.tasks.abilities.save({web:true});
 t.after(async()=>{app.tasks.close();await app.tasks.abilities.close();const target=resolve(root),base=resolve(tmpdir())+sep;assert(target.startsWith(base));rmSync(target,{recursive:true,force:true});});
 return {app,store,fake};
}
test('公开地址过滤覆盖本机、IPv4 映射、内网和元数据地址',async()=>{
 for(const ip of ['127.0.0.1','0.0.0.0','10.1.2.3','172.16.0.1','192.168.0.2','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1'])assert.equal(publicIP(ip),false,ip);
 for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(publicIP(ip),true,ip);
 for(const url of ['file:///C:/secret','http://127.0.0.1:3210','https://u:p@example.com','http://2130706433','http://[::1]','https://example.com:3210'])await assert.rejects(()=>publicURL(url));
});
test('代理对私网 HTTP 目标返回拒绝，不访问本机管理接口',async()=>{const p=await publicProxy();try{const r=await fetch(p.url+'/http://127.0.0.1:3210/api/status');assert.equal(r.status,403);}finally{p.close();}});
test('新能力默认关闭，输入和任务范围受限',t=>{const{app}=setup(t);assert.throws(()=>app.tasks.start({scope:'android',goal:'x'}),/启用/);assert.throws(()=>app.tasks.start({scope:'shell',goal:'x'}),/范围/);assert.throws(()=>app.tasks.start({scope:'web',goal:'x',minutes:31}),/1–30/);assert.throws(()=>app.tasks.abilities.save({maxActions:1000}));assert.throws(()=>app.tasks.abilities.save({game:true}),/安卓/);});
test('任务停止在桥接层阻止后续工具操作',async t=>{const{app}=setup(t);app.tasks.start({scope:'web',goal:'测试'});app.tasks.activeId=app.tasks.current()!.id;let calls=0;app.tasks.abilities.execute=async()=>{calls++;return toolResult('x');};app.tasks.stop();await assert.rejects(()=>app.tasks.tool('web_read',{}),/停止/);assert.equal(calls,0);});
test('任务挂起恢复保留原截止时间，到期拒绝续跑',t=>{const{app}=setup(t);app.tasks.start({scope:'web',goal:'测试'});const deadline=app.tasks.current()!.deadline;app.tasks.suspend();assert.equal(app.tasks.current()!.status,'suspended');app.tasks.resume();assert.equal(app.tasks.current()!.deadline,deadline);app.tasks.suspend();const task=app.tasks.current()!;task.deadline=Date.now()-1;app.tasks.save(task);assert.throws(()=>app.tasks.resume(),/过期/);assert.equal(app.tasks.current()!.status,'stopped');});
test('QQ补充消息不会挂起活动，并保存补充要求和原截止时间',async t=>{const{app,store}=setup(t);const c=store.config();c.ownerQQ='100000001';store.saveConfig(c);app.tasks.start({scope:'web',goal:'测试'});const deadline=app.tasks.current()!.deadline;app.receive({post_type:'message',message_type:'private',sub_type:'friend',user_id:'100000001',self_id:'999999',message_id:'followup',message:[{type:'text',data:{text:'打完把截图发我'}}]});assert.equal(app.tasks.current()!.status,'running');await app.tail;assert.equal(app.tasks.current()!.status,'running');assert.equal(app.tasks.current()!.deadline,deadline);assert.deepEqual(app.tasks.current()!.followups,['打完把截图发我']);});
test('普通聊天不会自动恢复管理员手动挂起的活动',async t=>{const{app}=setup(t);app.tasks.start({scope:'web',goal:'测试'});app.tasks.suspend();await app.chat('你好');assert.equal(app.tasks.current()!.status,'suspended');});
test('聊天期间明确停止后不会自动恢复活动',async t=>{const{app,fake}=setup(t);app.tasks.start({scope:'web',goal:'测试'});fake.turn=async()=>{app.tasks.stop();return '已停止';};await app.chat('你好');assert.equal(app.tasks.current()!.status,'stopped');});
test('并行活动保留原截止时间，聊天遇到额度不足会停止活动',async t=>{const{app,fake}=setup(t);app.tasks.start({scope:'web',goal:'测试'});const deadline=app.tasks.current()!.deadline;await app.chat('你好');assert.equal(app.tasks.current()!.deadline,deadline);fake.turn=async()=>{fake.limits=async()=>({...limits,ordinaryUsageAllowed:false});return '好的';};await app.chat('你好');assert.equal(app.tasks.current()!.status,'stopped');});

test('连续QQ补充消息排队回复时活动始终保持运行',async t=>{const{app,store}=setup(t);const c=store.config();c.ownerQQ='100000001';store.saveConfig(c);app.deliver=async()=>({kind:'sent'} as any);app.tasks.start({scope:'web',goal:'测试'});const id=app.tasks.current()!.id;for(const[i,message]of ['玩完告诉我分数','先别重开'].entries())app.receive({post_type:'message',message_type:'private',sub_type:'friend',user_id:'100000001',self_id:'999999',message_id:String(i),message:[{type:'text',data:{text:message}}]});await app.tail;assert.equal(app.tasks.current()!.id,id);assert.equal(app.tasks.current()!.status,'running');assert.deepEqual(app.tasks.current()!.followups,['玩完告诉我分数','先别重开']);});
test('动作上限与额度保护都能阻止工具执行',async t=>{const{app}=setup(t);app.tasks.start({scope:'web',goal:'测试'});let task=app.tasks.current()!;app.tasks.activeId=task.id;task.actions=task.maxActions;app.tasks.save(task);await assert.rejects(()=>app.tasks.tool('web_read',{}),/上限/);app.tasks.guard=app.tasks.guard;app.tasks.stop();app.tasks.start({scope:'web',goal:'再次测试'});app.tasks.activeId=app.tasks.current()!.id;app.store.updateState({blocked:{kind:'quota',reason:'quota',resetAt:null}});await assert.rejects(()=>app.tasks.tool('web_read',{}),/额度/);});
test('重启保留任务记录并停止原活动，不补跑',t=>{const{app}=setup(t);app.tasks.start({scope:'web',goal:'测试'});app.tasks.recover();assert.equal(app.tasks.current()!.status,'stopped');assert.match(app.tasks.current()!.reason,/重启/);});
test('操作前重复观察不与操作后暂未刷新的画面累计误停',async t=>{const{app}=setup(t);app.tasks.start({scope:'web',goal:'测试'});app.tasks.activeId=app.tasks.current()!.id;app.tasks.abilities.execute=async()=>toolResult('same');await app.tasks.tool('web_read',{});await app.tasks.tool('web_read',{});await app.tasks.tool('web_read',{});await app.tasks.tool('web_scroll',{direction:'down'});await app.tasks.tool('web_read',{});assert.equal(app.tasks.current()!.status,'running');assert.equal(app.tasks.noProgress,1);});
test('三次操作后仍无变化时保留无进展保护',async t=>{const{app}=setup(t);app.tasks.start({scope:'web',goal:'测试'});app.tasks.activeId=app.tasks.current()!.id;app.tasks.abilities.execute=async()=>toolResult('same');await app.tasks.tool('web_read',{});for(let i=0;i<2;i++){await app.tasks.tool('web_scroll',{direction:'down'});await app.tasks.tool('web_read',{});}app.tasks.toolsThisStep=0;await app.tasks.tool('web_scroll',{direction:'down'});await assert.rejects(()=>app.tasks.tool('web_read',{}),/无进展/);assert.equal(app.tasks.current()!.status,'stopped');});
test('只有管理员交代任务的聊天回合能创建活动，主动回合不能创建',t=>{const{app}=setup(t);assert.throws(()=>app.tool('companion_task_start',{scope:'web',goal:'测试'}),/不允许/);app.tasks.allowStart=true;const r=app.tool('companion_task_start',{scope:'web',goal:'测试'});assert(r);assert.equal(app.tasks.current()!.status,'running');});
test('任务步骤不修改聊天工具并只保存一次结果',async t=>{const{app}=setup(t);app.tasks.start({scope:'web',goal:'测试'});await app.tasks.step(app.tasks.current()!.id);assert.equal(app.tasks.current()!.status,'completed');assert(app.codex.extraTools.some(x=>x.name==='companion_task_start'));const count=app.store.messages().length;await app.tasks.notify(app.tasks.current()!.id);assert.equal(app.store.messages().length,count);});
test('取消后的在途工具结果不会继续推进任务',async t=>{const{app}=setup(t);app.tasks.start({scope:'web',goal:'测试'});app.tasks.activeId=app.tasks.current()!.id;let release:any;app.tasks.abilities.execute=()=>new Promise(r=>{release=r;});const pending=app.tasks.tool('web_read',{});app.tasks.stop();release(toolResult('late'));await assert.rejects(pending,/取消/);assert.equal(app.tasks.current()!.status,'stopped');});
test('动态工具图片结果直接回传 inputImage，不序列化成文字',async()=>{const c=new Codex(process.cwd(),'codex',()=>{}),sent:any[]=[];c.proc={stdin:{destroyed:false,write:(v:string)=>sent.push(JSON.parse(v))},kill:()=>{}} as any;c.active={threadId:'t',tools:true} as any;c.toolHandler=()=>toolResult({x:1},Buffer.from('image'));await c.serverRequest({id:1,method:'item/tool/call',params:{threadId:'t',tool:'probe',arguments:{}}});assert.equal(sent[0].result.contentItems[1].type,'inputImage');assert(sent[0].result.contentItems[1].imageUrl.startsWith('data:image/png;base64,'));c.active=undefined;c.stop();});
test('内置网页操作也计入动作上限，停止后只中断活动模型',t=>{const{app,fake}=setup(t);app.tasks.start({scope:'web',goal:'测试'});const task=app.tasks.current()!;task.threadId='task-thread';task.maxActions=1;app.tasks.save(task);app.tasks.activeId=task.id;app.tasks.executing=true;let interrupted=0,chatInterrupted=0;fake.interrupt=async()=>{chatInterrupted++;};app.taskCodex.interrupt=async()=>{interrupted++;};app.taskCodex.emit('web-action',{threadId:'task-thread',action:{type:'search'}});assert.equal(app.tasks.current()!.actions,1);assert.equal(app.tasks.current()!.status,'stopped');assert(interrupted>0);assert.equal(chatInterrupted,0);});

test('聊天回复尚未结束时活动仍执行工具，两条通道不交换工具',async t=>{
 const{app,fake}=setup(t);app.tasks.start({scope:'web',goal:'并行测试'});
 let releaseChat!:(v:string)=>void,chatStarted!:()=>void;const started=new Promise<void>(r=>chatStarted=r);
 fake.turn=async()=>{chatStarted();return new Promise<string>(r=>releaseChat=r);};
 const chat=app.enqueue(()=>app.chat('游戏继续，我今天有点累'));await started;
 let actions=0;app.tasks.abilities.execute=async()=>{actions++;return toolResult('实际内容');};
 app.taskCodex.turn=async()=>{assert(app.busy);assert.equal(app.tasks.current()!.status,'running');await app.taskCodex.toolHandler('web_read',{});return '[TASK_DONE] 实际完成';};
 try{await app.tasks.step(app.tasks.current()!.id);assert.equal(actions,1);assert(app.busy);assert.equal(app.tasks.current()!.status,'completed');assert(app.codex.extraTools.some(t=>t.name==='companion_task_start'));assert(!app.codex.extraTools.some(t=>t.name==='web_read'));assert.equal(app.taskCodex.includeCompanionTools,false);assert.throws(()=>app.tool('web_read',{}),/独立任务/);}finally{releaseChat('累了就歇会儿');await chat;}
});
test('达到额度保护时同时中断聊天和游戏',t=>{const{app,fake,store}=setup(t);const c=store.config();c.budget.enabled=true;store.saveConfig(c);app.tasks.start({scope:'web',goal:'并行测试'});app.tasks.executing=true;let chat=0,game=0;fake.interrupt=async()=>{chat++;};app.taskCodex.interrupt=async()=>{game++;};app.ledger.begin(limits,'runtime.game');app.taskCodex.emit('limits',{rateLimits:{primary:{usedPercent:31,resetsAt:1999999999,windowDurationMins:10080}}});assert(chat>0);assert(game>0);assert.equal(app.tasks.current()!.status,'stopped');});
test('网页搜索仅在指定的任务会话启用，聊天会话默认关闭',async()=>{
 const c=new Codex(process.cwd(),'codex',()=>{});const requests:any[]=[];c.start=async()=>{};c.request=async(_method,p)=>{requests.push(p);return {thread:{id:'t'}};};
 await c.thread('model','role',true,false,true);await c.thread('model','role');assert.equal(requests[0].config.web_search,'live');assert.equal(requests[1].config.web_search,'disabled');
});
