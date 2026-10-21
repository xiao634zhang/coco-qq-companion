import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { EventEmitter } from 'node:events';
import { Store,shanghai } from '../src/store.ts';
import { Companion } from '../src/companion.ts';
import { Codex } from '../src/codex.ts';
import { OneBot } from '../src/onebot.ts';

function fixture(t:any) {
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-18T04:00:00Z')});
  const root=mkdtempSync(join(tmpdir(),'qq-companion-test-')),store=new Store(root);
  const c=store.config();c.ownerQQ='100000001';c.model='test';store.saveConfig(c);
  let turns=0;
  const codex=Object.assign(new EventEmitter(),{ready:true,generation:1,thread:async()=> 'thread',turn:async()=>{turns++;return '今天有什么小事想跟我说吗？'},stop:()=>{},resume:async()=>{},interrupt:async()=>{},account:async()=>({type:'chatgpt'}),models:async()=>[],limits:async()=>({ordinaryUsageAllowed:true,rateLimits:{}})});
  const sent:string[]=[];
  const qq=Object.assign(new EventEmitter(),{online:true,connected:true,selfId:'999999',send:async(value:string)=>{sent.push(value);return {kind:'sent',messageId:'ok'}},stop:()=>{}});
  const app=new Companion(store,codex as unknown as Codex,qq as unknown as OneBot,Object.assign(new EventEmitter(),{...codex}) as unknown as Codex);app.account={type:'chatgpt'};app.lastMetadata=Date.now();
  store.updateState({lastUserAt:Date.now()-3600000});app.nextCheckAt=0;
  t.after(()=>{app.stop();const path=resolve(root);if(!path.startsWith(resolve(tmpdir())+sep)||!path.includes('qq-companion-test-'))throw new Error('unsafe cleanup');rmSync(path,{recursive:true,force:true});});
  return {app,store,codex,qq,sent,turns:()=>turns};
}
test('重启恢复只连接已通过验证的QQ配置',async t=>{
  const {app,store,qq}=fixture(t);let starts=0;
  (qq as any).start=()=>{starts++};
  writeFileSync(join(store.data,'verification.json'),JSON.stringify({passed:true}));
  await app.start();assert.equal(starts,1);
});
test('首次启动未验证时不自动连接QQ',async t=>{
  const {app,qq}=fixture(t);let starts=0;
  (qq as any).start=()=>{starts++};
  await app.start();assert.equal(starts,0);
});
test('真实主动链路计次，未满一小时时不再调用模型',async t=>{const{app,store,sent,turns}=fixture(t);await app.tick();assert.equal(turns(),1);assert.equal(sent.length,1);assert.equal(store.state().proactiveCount,1);app.nextCheckAt=0;await app.tick();assert.equal(turns(),1);});
test('主动消息发送不确定也占次数，防止重复主动尝试',async t=>{const{app,store,qq}=fixture(t);qq.send=async()=>({kind:'uncertain',messageId:''});await app.tick();assert.equal(store.state().proactiveCount,1);assert.equal(Object.values(store.deliveries())[0].status,'uncertain');});
test('模型生成期间新用户消息抑制主动发送',async t=>{const{app,store,codex,sent}=fixture(t);codex.turn=async()=>{store.updateState({lastUserAt:Date.now()});return '今天好吗'};await app.tick();assert.equal(sent.length,0);assert.equal(store.state().proactiveCount,0);});
test('静默选择不会发 QQ，夜间不会调用模型',async t=>{const{app,codex,sent,turns}=fixture(t);codex.turn=async()=> '[SILENT]';await app.tick();assert.equal(sent.length,0);t.mock.timers.setTime(Date.parse('2026-10-18T16:00:00Z'));app.nextCheckAt=0;await app.tick();assert.equal(turns(),0);});
test('保底到点绕过随机检查与闲置限制，模型静默也可完成两次联系',async t=>{const{app,store,codex,sent}=fixture(t);const c=store.config();c.proactive.dailyMin=2;store.saveConfig(c);store.updateState({lastUserAt:Date.now()});app.nextCheckAt=Date.now()+86400000;codex.turn=async()=> '[SILENT]';await app.tick();assert.equal(sent.length,1);t.mock.timers.setTime(Date.parse('2026-10-18T12:00:00Z'));await app.tick();assert.equal(sent.length,2);assert.equal(store.state().proactiveCount,2);await app.tick();assert.equal(sent.length,2);});
test('QQ引用与附件完整进入聊天输入，重复消息不重复下载',async t=>{
 const {app,store,qq}=fixture(t);app.extensions.save({humanize:false,typing:false});
 let input='',calls=0;(qq as any).api=async(action:string)=>{assert.equal(action,'get_msg');return {status:'ok',data:{sender:{user_id:store.config().ownerQQ},message:[{type:'text',data:{text:'这是原来的计划'}},{type:'file',data:{id:'file1',name:'计划.txt'}}]}};};
 app.files.incoming=async()=>{calls++;return {id:'example.txt',name:'计划.txt',text:'下周五交付',truncated:false};};
 app.chat=async value=>{input=value;return '读到了';};
 const event={post_type:'message',message_type:'private',sub_type:'friend',self_id:qq.selfId,user_id:store.config().ownerQQ,message_id:123,message:[{type:'reply',data:{id:'122'}},{type:'text',data:{text:'你看这个'}}]};
 app.receive(event);await app.tail;assert.match(input,/这是原来的计划/);assert.match(input,/下周五交付/);assert.match(input,/你看这个/);app.receive(event);await app.tail;assert.equal(calls,1);
});
test('重置清除旧聊天上下文，长期记忆仍注入',t=>{const{app,store}=fixture(t);store.message('user','旧会话标记');store.saveMemory({facts:['长期事实'],preferences:[],summary:''});app.reset();assert(!app.context().includes('旧会话标记'));assert(app.context().includes('长期事实'));store.message('user','新消息');assert(app.context().includes('新消息'));});
test('摘要失败不丢失已经成功生成的回复',async t=>{const{app,store,codex}=fixture(t);store.updateState({turnsSinceCompact:23});let n=0;codex.turn=async()=>{if(++n===1)return '成功回复';throw new Error('summary unavailable')};assert.equal(await app.chat('hello'),'成功回复');assert.equal(store.state().compactPending,true);});
