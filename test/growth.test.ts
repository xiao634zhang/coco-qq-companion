import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.ts';
import {Recall} from '../src/recall.ts';
import {schedule,nextOccurrence} from '../src/schedule.ts';
import {Modules} from '../src/modules.ts';
import {Minecraft} from '../src/minecraft.ts';
import {Journeys} from '../src/journeys.ts';
import {Avatar} from '../src/avatar.ts';
import {zipSync,strToU8} from 'fflate';
import {EventEmitter} from 'node:events';
import {VoiceConversation} from '../src/voice.ts';
import {Codex} from '../src/codex.ts';
import {Daily} from '../src/daily.ts';
function fixture(t:any){const root=mkdtempSync(join(tmpdir(),'coco-growth-')),store=new Store(root);t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,store};}
test('每周、跨午夜、间隔与一次性使用北京时间计算下一次',()=>{
 const now=Date.parse('2026-10-23T21:00:00+08:00');
 assert.equal(nextOccurrence(schedule({type:'weekly',time:'21:00',days:[5]},undefined,now),now),Date.parse('2026-10-30T21:00:00+08:00'));
 assert.equal(nextOccurrence(schedule({type:'daily',time:'00:00'},undefined,now),now),Date.parse('2026-10-24T00:00:00+08:00'));
 assert.equal(nextOccurrence(schedule({type:'interval',minutes:120},undefined,now),now),now+7200000);
 assert.equal(nextOccurrence({type:'once',at:now},now),Number.MAX_SAFE_INTEGER);
 assert.throws(()=>schedule({type:'once',at:'2026-10-24T09:00'},undefined,now));
 assert.throws(()=>schedule({type:'weekly',time:'21:00',days:[7]},undefined,now));
});
test('一次性提醒只领取一次，关闭定时模块后不执行',async t=>{
 const {store}=fixture(t),config=store.config();config.ownerQQ='100000001';store.saveConfig(config);let sent=0,enabled=true;
 const app:any={store,modules:{settings:()=>({enabled:{schedules:enabled}})},qq:{online:true,connected:true},deliver:async()=>{sent++;return {kind:'sent'}}},d=new Daily(app),now=Date.parse('2026-10-20T10:00:00+08:00');
 d.save({title:'休息',goal:'喝水',kind:'message',schedule:{type:'once',at:now+60000}},now);enabled=false;await d.tick(now+60000);assert.equal(sent,0);enabled=true;await d.tick(now+60000);await d.tick(now+120000);assert.equal(sent,1);assert.equal(d.all()[0].nextRunAt,Number.MAX_SAFE_INTEGER);
});
test('记忆来源跨重启保留、纠错保留元数据、遗忘不重新索引',async t=>{
 const {store}=fixture(t);store.saveMemory({facts:['住在月球基地'],preferences:[],summary:''});const r=new Recall(store,async values=>values.map(v=>v.includes('月球')?[1,0]:[0,1]));
 const before=r.sync(),e=before.find(x=>x.kind==='fact')!;assert.equal(e.source,'memory:facts');assert(e.at);
 r.save({id:e.id,text:'住在火星基地',kind:'fact'});assert.deepEqual(store.memory().facts,['住在火星基地']);
 const result=await r.search('在哪居住');assert.equal(result.mode,'semantic');assert.equal(result.items[0].id,e.id);
 const again=new Recall(store);assert.equal(again.all()[0].previous,'住在月球基地');again.forget(e.id);assert.deepEqual(again.sync(),[]);assert.deepEqual(store.memory().facts,[]);
});
test('遗忘聊天清理原文和向量缓存，其他条目保留',t=>{const {store}=fixture(t),r=new Recall(store);store.message('user','一次独特的户外经历');const e=r.sync()[0];r.forget(e.id);assert.equal(store.messages(10).length,0);assert.equal(r.sync().length,0);assert(existsSync(join(store.data,'recall-vectors.json')));});
test('检索进行中遗忘不会重新写回旧向量或返回已删除内容',async t=>{const {store}=fixture(t);store.message('user','需要遗忘的这次经历');let release!:()=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>release=r);let calls=0;const recall=new Recall(store,async values=>{if(calls++===0){started();await gate;}return values.map(()=>[1,0]);});const pending=recall.search('这次经历');await ready;recall.forget(recall.all()[0].id);release();const result=await pending;assert.equal(result.items.length,0);assert.equal(JSON.stringify(recall.all()).includes('需要遗忘'),false);});
test('模块停用真实阻止调用，工作流更新递增版本，MCP状态不泄露令牌',async t=>{
 const {store}=fixture(t),m=new Modules(store);m.save({id:'web',enabled:false});assert.throws(()=>m.assert('web'));
 m.workflow({name:'看热点',goal:'读取科技热点',scope:'web'});const w=m.settings().workflows[0];m.workflow({...w,goal:'读取两条科技热点'});assert.equal(m.settings().workflows[0].version,2);
 await m.saveMcp({name:'test',url:'http://127.0.0.1:19876/mcp',token:'test-token-local',allowedTools:['read'],enabled:true});assert(!JSON.stringify(m.status()).includes('test-token-local'));
 await assert.rejects(()=>m.call(m.settings().mcp[0].id,'write',{}));await m.close();
});
test('收藏按URL去重并拒绝脚本链接',t=>{const {store}=fixture(t),j=new Journeys(store);j.favorite({title:'露营',url:'https://example.org/camp',summary:'整理帐篷'});j.favorite({title:'更新',url:'https://example.org/camp',summary:'露营感想'});assert.equal(j.favorites().length,1);assert.throws(()=>j.favorite({title:'bad',url:'javascript:alert(1)',summary:'bad'}));});
test('Minecraft未连接时动作失败，配置校验不启动网络',async t=>{const {store}=fixture(t),m=new Minecraft(store);await assert.rejects(()=>m.run({action:'goto',x:0,y:64,z:0}));assert.throws(()=>m.save({host:'bad/host',username:'coco',auth:'offline'}));m.save({host:'127.0.0.1',port:25565,username:'coco',auth:'offline',version:''});assert.equal(m.status().phase,'disconnected');m.disconnect();});
test('语音只流式播出最终回答，不播思考与评论',t=>{const {root}=fixture(t),c=new Codex(root,'fake',()=>{}),heard:string[]=[];c.on('final-delta',s=>heard.push(s));c.active={threadId:'t',items:new Map()} as any;c.receive({method:'item/started',params:{threadId:'t',item:{id:'a',type:'agentMessage',phase:'commentary'}}});c.receive({method:'item/agentMessage/delta',params:{threadId:'t',itemId:'a',delta:'过程评论'}});c.receive({method:'item/started',params:{threadId:'t',item:{id:'b',type:'agentMessage',phase:'final_answer'}}});c.receive({method:'item/agentMessage/delta',params:{threadId:'t',itemId:'b',delta:'最终回答'}});assert.deepEqual(heard,['最终回答']);c.active=undefined;});
test('语音分句合成在模型结束前开始，并正常清理监听器',async()=>{
 const codex=Object.assign(new EventEmitter(),{interrupt:async()=>{}}),spoken:string[]=[];let finish!:()=>void;const gate=new Promise<void>(r=>finish=r),res=Object.assign(new EventEmitter(),{writeHead:()=>{},write:()=>true,end:()=>{}});
 const app:any={modules:{assert:()=>{}},busy:false,queueCount:0,codex,extensions:{settings:()=>({voice:'kokoro:zf_001'})},media:{speak:async(s:string)=>{spoken.push(s);return {id:'test.mp3'}}},store:{message:()=>{},config:()=>({model:'test'})},enqueue:async(fn:any)=>fn(),chat:async()=>{codex.emit('final-delta','今天的天气很适合出去散步。');await gate;return '今天的天气很适合出去散步。'}};
 const voice=new VoiceConversation(app),running=voice.stream({text:'你好'},res as any);await new Promise(r=>setImmediate(r));assert.equal(spoken.length,1);finish();await running;assert.equal(codex.listenerCount('final-delta'),0);assert.equal(voice.active,false);
});
test('Live2D ZIP只导入模型资源，拒绝目录穿越与缺少Core',t=>{const {store,root}=fixture(t),a=new Avatar(store);const zip=zipSync({'model/model.model3.json':strToU8('{}'),'../escaped.txt':strToU8('bad'),'model/file.js':strToU8('bad')});const result=a.import({name:'model.zip',data:Buffer.from(zip).toString('base64')});assert.equal(result.models!.length,1);assert(!existsSync(join(root,'.runtime','escaped.txt')));assert.throws(()=>a.file('../config.json'));assert.throws(()=>a.save({mode:'live2d',model:result.models![0],scale:0.7}));});
