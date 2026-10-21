import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join,extname,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {Store} from './store.ts';
const run=promisify(execFile);
const TEXT=new Set(['.txt','.md','.csv','.json','.jsonl','.log','.yaml','.yml','.xml','.html','.css','.js','.ts','.py','.sql','.ini','.toml']);
export function validFileURL(u:URL){
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return false;
 if(['qq.com','qq.com.cn','qpic.cn','gtimg.cn'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))return true;
 // QQ offline files can use a public IPv4 FTN endpoint supplied by the gateway.
 const parts=u.hostname.split('.').map(Number);if(parts.length!==4||parts.some(x=>!Number.isInteger(x)||x<0||x>255)||!u.pathname.startsWith('/ftn_handler/'))return false;
 const [a,b]=parts;return a>0&&a<224&&a!==10&&a!==127&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&b===168)&&!(a===100&&b>=64&&b<=127)&&!(a===198&&(b===18||b===19));
}
export class Files{
 store:Store;constructor(store:Store){this.store=store;}
 async read(name:string,bytes:Buffer){
  const ext=extname(name).toLowerCase();if(!TEXT.has(ext)&&!['.pdf','.docx','.xlsx'].includes(ext))throw Error('支持TXT、Markdown、CSV、JSON、代码、PDF、DOCX、XLSX');
  if(!bytes.length||bytes.length>20*1024*1024)throw Error('文件大小须为1字节至20MB');
  const dir=join(this.store.data,'files');mkdirSync(dir,{recursive:true});const id=randomUUID()+ext,path=join(dir,id);writeFileSync(path,bytes);
  let value='';
  if(TEXT.has(ext)){
   if(bytes[0]===255&&bytes[1]===254)value=bytes.subarray(2).toString('utf16le');
   else{value=bytes.toString('utf8');if(value.includes('\ufffd'))value=new TextDecoder('gb18030').decode(bytes);}
   if(value.includes('\0'))throw Error('文件不像可读文本');
  }else{
   const python=join(this.store.root,'.runtime/media-python/Scripts/python.exe');if(!existsSync(python))throw Error('文档环境未安装，请运行setup-media.cmd');
   const r=await run(python,['-X','utf8',join(this.store.root,'scripts/document-worker.py'),path],{windowsHide:true,timeout:60000,maxBuffer:2*1024*1024,env:{...process.env,PYTHONUTF8:'1'}});
   value=JSON.parse(r.stdout.trim()).text;
  }
  if(!value.trim())throw Error('没有提取到正文；扫描PDF请发送页面图片');
  const truncated=value.length>30000;return {id,name:basename(name),text:value.slice(0,30000),truncated};
 }
 async incoming(segment:any,qq:{api:(action:string,args:any)=>Promise<any>},owner:string,fetcher:typeof fetch=fetch){
  const d=segment.data??{},name=String(d.name??d.file_name??'附件.txt');
  if(Number(d.size)>20*1024*1024)throw Error('附件超过20MB');
  let url=typeof d.url==='string'?d.url:'';
  if(!url){const id=String(d.file_id??d.id??d.file??'');if(!id||id.length>1000)throw Error('QQ未提供文件ID，请重新发送文件');
   const r=await qq.api('get_private_file_url',{user_id:Number(owner),file_id:id,file_hash:String(d.file_hash??'')});
   if(r.status!=='ok'||!r.data?.url)throw Error('QQ未返回文件下载地址，请重新发送文件');url=r.data.url;
  }
  const u=new URL(url);if(!validFileURL(u))throw Error('QQ附件下载地址无效');
  const response=await fetcher(u,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok||!response.body)throw Error('QQ附件下载失败');
  const chunks:Buffer[]=[];let size=0;
  try{for await(const chunk of response.body as any){size+=chunk.byteLength;if(size>20*1024*1024)throw Error('附件超过20MB');chunks.push(Buffer.from(chunk));}}catch(e){throw e;}
  return this.read(name,Buffer.concat(chunks));
 }
}
