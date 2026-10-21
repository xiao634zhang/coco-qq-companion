import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.ts';
import {Files,validFileURL} from '../src/files.ts';
import {quotedMessage,cacheQQMessage,cachedQQMessage} from '../src/incoming.ts';
import {minimumDue,proactiveEligible} from '../src/scheduler.ts';
function fixture(t:any){const root=mkdtempSync(join(tmpdir(),'coco-files-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return new Store(root);}
test('引用原文、图片和文件传入当前消息，嵌套引用不递归展开',async()=>{
 let n=0;const q=await quotedMessage({post_type:'message',message:[{type:'reply',data:{id:'42'}}]}, {api:async(a,p)=>{n++;assert.equal(a,'get_msg');assert.equal(p.message_id,'42');return {status:'ok',data:{sender:{user_id:'12345'},message:[{type:'reply',data:{id:'41'}},{type:'text',data:{text:'原始信息'}},{type:'image',data:{file:'img'}},{type:'file',data:{name:'a.txt'}}]}};}},'12345','54321');
 assert.match(q.text,/原始信息/);assert.equal(q.images.length,1);assert.equal(q.files.length,1);assert.equal(n,1);
 const failed=await quotedMessage({post_type:'message',message:[{type:'reply',data:{id:'42'}}]},{api:async()=>({status:'failed'})},'12345','54321');assert.match(failed.text,/无法取得/);
});
test('网关丢失原文时从持久缓存读取，自己发出的回复也可引用',async t=>{const store=fixture(t);cacheQQMessage(store,{post_type:'message',message_id:1,user_id:'12345',message:'先前的原文'});const r=await quotedMessage({post_type:'message',message:[{type:'reply',data:{id:'1'}}]},{api:async()=>{throw Error('网关重启');}},'12345','54321',id=>cachedQQMessage(store,id,'54321'));assert.match(r.text,/先前的原文/);store.delivery('sent',{status:'sent',messageId:'2',text:'coco旧回复'});assert.equal(cachedQQMessage(store,'2','54321').message,'coco旧回复');});
test('附件读取UTF8、UTF16和GB中文，超长注明截断，执行文件不运行',async t=>{
 const f=new Files(fixture(t));assert.equal((await f.read('../hello.md',Buffer.from('你好，文件内容'))).text,'你好，文件内容');
 assert.equal((await f.read('a.txt',Buffer.concat([Buffer.from([255,254]),Buffer.from('你好','utf16le')]))).text,'你好');
 assert.equal((await f.read('a.txt',Buffer.from([0xc4,0xe3,0xba,0xc3]))).text,'你好');
 assert.equal((await f.read('long.txt',Buffer.from('字'.repeat(31000)))).truncated,true);
 await assert.rejects(()=>f.read('bad.exe',Buffer.from('anything')),/支持/);
 await assert.rejects(()=>f.read('big.txt',Buffer.alloc(21*1024*1024)),/20MB/);
});
test('QQ文件按ID向网关获取链接，下载正文，拒绝内网和恶意跳转来源',async t=>{
 const f=new Files(fixture(t));const qq={api:async(a:string,p:any)=>{assert.equal(a,'get_private_file_url');assert.equal(p.file_id,'f1');return {status:'ok',data:{url:'https://file.qq.com/a'}};}};
 const result=await f.incoming({data:{id:'f1',name:'note.txt'}},qq,'12345',async()=>new Response('文件真实正文') as any);assert.equal(result.text,'文件真实正文');
 const offline=await f.incoming({data:{name:'offline.txt',url:'https://file.qq.com/offline'}},{api:async()=>{throw Error('不应再次查询ID');}},'12345',async()=>new Response('离线文件正文') as any);assert.equal(offline.text,'离线文件正文');
 for(const u of ['http://127.0.0.1/ftn_handler/x','http://10.1.2.3/ftn_handler/x','https://evil.invalid/a','file:///a'])assert.equal(validFileURL(new URL(u)),false);
 assert(validFileURL(new URL('http://123.4.5.6/ftn_handler/a')));
 assert(validFileURL(new URL('http://123.4.5.6/asn.com/qqdownloadftnv5?fname=example.docx')));
 assert(!validFileURL(new URL('http://127.0.0.1/asn.com/qqdownloadftnv5')));
});
test('网关把文件降级成占位符时优先同一消息ID的完整缓存',async()=>{
 const cached={user_id:'12345',message:[{type:'file',data:{id:'f1',name:'example.docx'}}]};
 for(const message of ['[文件]',[{type:'text',data:{text:'[文件]'}}]]){
  const r=await quotedMessage({post_type:'message',message:[{type:'reply',data:{id:'1'}}]},{api:async()=>({status:'ok',data:{user_id:'12345',message}})},'12345','54321',()=>cached);
  assert.equal(r.files.length,1);assert.match(r.text,/example.docx/);
 }
});
test('每天两次保底按北京时间12点20点安排，保留暂停额度间隔和午夜限制',t=>{
 const store=fixture(t),c=store.config();c.ownerQQ='12345';c.proactive.dailyMin=2;
 const at=(s:string)=>Date.parse('2026-10-21T'+s+'+08:00'),s={...store.state(),lastUserAt:at('11:59:00')};
 assert(!minimumDue(c,s,at('11:59:00')));assert(minimumDue(c,s,at('12:00:00')));
 assert(proactiveEligible(c,s,true,false,at('12:00:00'),true));
 const one={...s,proactiveDay:'2026-10-21',proactiveCount:1,lastProactiveAt:at('12:00:00')};
 assert(!minimumDue(c,one,at('19:59:00')));assert(minimumDue(c,one,at('20:00:00')));
 assert(!proactiveEligible(c,{...one,paused:true},true,false,at('20:00:00'),true));
 assert(!proactiveEligible(c,one,true,false,at('00:01:00'),true));
 assert(!minimumDue(c,{...one,proactiveCount:2},at('23:00:00')));
});
