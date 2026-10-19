import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve, sep } from 'node:path';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {imageFormat} from './onebot.ts';
import type { Store } from './store.ts';
const exec=promisify(execFile);
export class Media {
  store:Store;constructor(store:Store){this.store=store;for(const p of ['data/media','.runtime/tmp','.runtime/cache','.runtime/huggingface'])mkdirSync(join(store.root,p),{recursive:true});}
  async run(args:string[]){const bin=join(this.store.root,'.runtime/media-python/Scripts/python.exe');if(!existsSync(bin))throw Error('语音环境未安装，请运行 setup-media.cmd');const r=await exec(bin,[join(this.store.root,'scripts/media-worker.py'),...args],{windowsHide:true,timeout:300000,maxBuffer:16*1024*1024,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',TEMP:join(this.store.root,'.runtime/tmp'),TMP:join(this.store.root,'.runtime/tmp'),HF_HOME:join(this.store.root,'.runtime/huggingface'),XDG_CACHE_HOME:join(this.store.root,'.runtime/cache'),TORCH_HOME:join(this.store.root,'.runtime/torch')}});return parseMediaOutput(r.stdout);}
  file(id:string){if(!/^[a-f0-9-]+\.(mp3|wav|ogg|silk|amr|mp4|webm|m4a)$/.test(id))throw Error('媒体ID无效');const path=resolve(this.store.data,'media',id);if(!path.startsWith(resolve(this.store.data,'media')+sep)||!existsSync(path))throw Error('媒体不存在');return path;}
  import(name:string,data:string){const ext=name.toLowerCase().split('.').at(-1);if(!['mp3','wav','ogg','silk','amr','mp4','webm','m4a'].includes(ext??''))throw Error('音视频格式未支持');const bytes=Buffer.from(data,'base64');if(!bytes.length||bytes.length>30*1024*1024)throw Error('媒体大小须为1字节至30MB');const id=randomUUID()+'.'+ext;writeFileSync(join(this.store.data,'media',id),bytes);return {id};}
  async transcribe(id:string,model:string){return this.run(['transcribe',this.file(id),model,join(this.store.root,'.runtime/whisper-models')]);}
  async frames(id:string){return this.run(['frames',this.file(id),join(this.store.data,'media',id+'-frames')]);}
  async speak(value:string,voice:string){const id=randomUUID()+'.mp3';await this.run(['speak',value.slice(0,2000),voice,join(this.store.data,'media',id)]);return {id,bytes:readFileSync(this.file(id))};}
  async incoming(file:string,qq:{api:(action:string,body:any)=>Promise<any>},model:string){const r=await qq.api('get_record',{file,out_format:'wav'});if(r.status!=='ok')throw Error('QQ网关未返回可用语音文件');if(typeof r.data?.base64==='string'&&r.data.base64){const imported=this.import('voice.wav',r.data.base64.replace(/^base64:\/\//,''));return this.transcribe(imported.id,model);}const p=r.data?.file;if(typeof p!=='string'||!existsSync(p)||statSync(p).size>30*1024*1024)throw Error('QQ语音文件不存在或过大');const imported=this.import('voice.wav',readFileSync(p).toString('base64'));return this.transcribe(imported.id,model);}
  async incomingImages(segments:any[],qq:{api:(action:string,body:any)=>Promise<any>},fetcher:typeof fetch=fetch){
    if(segments.length>4)throw Error('一条消息最多识别4张图片，请分开发送');
    const images:string[]=[];
    for(const segment of segments){
      const r=await qq.api('get_image',{file:segment.data?.file});if(r.status!=='ok')throw Error('QQ网关未返回图片，请重新发送原图');
      let bytes:Buffer;
      if(typeof r.data?.base64==='string')bytes=Buffer.from(r.data.base64.replace(/^base64:\/\//,''),'base64');
      else {
        const p=r.data?.file;
        if(typeof p==='string'&&existsSync(p)){if(statSync(p).size>8*1024*1024)throw Error('图片超过8MB');bytes=readFileSync(p);}
        else{
          const u=new URL(r.data?.url??'');
          if(u.protocol!=='https:'||u.username||u.password||u.port||!['qpic.cn','qq.com','qq.com.cn','gtimg.cn'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))throw Error('QQ图片下载地址无效');
          const response=await fetcher(u,{redirect:'error',signal:AbortSignal.timeout(20000)});
          if(!response.ok||!response.body)throw Error('QQ图片下载失败，请重新发送原图');
          if(Number(response.headers.get('content-length'))>8*1024*1024)throw Error('图片超过8MB');
          const reader=response.body.getReader(),chunks:Buffer[]=[];let size=0;
          try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8*1024*1024)throw Error('图片超过8MB');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
          bytes=Buffer.concat(chunks);
        }
      }
      if(!bytes.length||bytes.length>8*1024*1024||!imageFormat(bytes))throw Error('图片格式不支持或文件损坏');
      const image=await sharp(bytes,{limitInputPixels:40000000,animated:false}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
      images.push('data:image/jpeg;base64,'+image.toString('base64'));
    }
    return images;
  }
}
export function parseMediaOutput(source:string){const last=source.trim().split(/\r?\n/).at(-1);if(!last)throw Error('媒体服务未返回结果');return JSON.parse(last);}
