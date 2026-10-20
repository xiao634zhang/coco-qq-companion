import {join} from 'node:path';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import {atomicJson,readJson,text} from './store.ts';
import {functionTool} from './tool-result.ts';
import {imageFormat} from './onebot.ts';
import type {Companion} from './companion.ts';

interface Sticker {id:string;name:string;tags:string[];format:string;sha256:string;enabled:boolean;createdAt:string;source?:string;pack?:string}
export const STICKER_TOOLS=[
 functionTool('companion_sticker_list','查找本地表情包的实际ID、名称和标签；query为空返回全部。',{query:{type:'string'}}),
 functionTool('companion_sticker_send','向管理员QQ发送图库里真实存在的表情包。管理员索要或聊天情境合适时可以偶尔用一张，不连续刷屏。先查图库，按实际ID发送。',{id:{type:'string'}},['id']),
];
const PRESETS=[
 {id:'coco-happy',name:'好耶',tags:['开心','高兴','好耶'],mouth:'M88 132 Q128 178 168 132',eyes:'M82 100 Q95 82 108 100 M148 100 Q161 82 174 100',color:'#ffda88'},
 {id:'coco-hug',name:'抱抱',tags:['抱抱','安慰','心疼'],mouth:'M106 138 Q128 152 150 138',eyes:'M85 100 L105 100 M151 100 L171 100',color:'#ffc7c9'},
 {id:'coco-speechless',name:'无语',tags:['无语','吐槽','沉默'],mouth:'M111 144 L145 144',eyes:'M85 102 L107 102 M149 102 L171 102',color:'#c7d2ea'},
 {id:'coco-ok',name:'收到',tags:['收到','好的','确认'],mouth:'M108 136 Q128 153 148 136',eyes:'M89 96 L103 109 M103 96 L89 109 M155 96 L169 109 M169 96 L155 109',color:'#b7e5ce'},
 {id:'coco-sleep',name:'晚安',tags:['晚安','困了','睡觉'],mouth:'M119 143 Q128 152 137 143',eyes:'M85 100 Q96 111 107 100 M149 100 Q160 111 171 100',color:'#bfc1ec'},
 {id:'coco-angry',name:'哼',tags:['哼','生气','傲娇'],mouth:'M109 150 Q128 132 147 150',eyes:'M85 92 L108 103 M148 103 L171 92',color:'#ffb49c'},
];
export class Stickers {
 app:Companion;usedThisTurn=false;initializing?:Promise<void>;
 context?:{source:string;requested:boolean};
 constructor(app:Companion){this.app=app;}
 get dir(){return join(this.app.store.data,'stickers');}
 settings(){return {...{automatic:true,cooldownMinutes:5,dailyMax:20},...readJson<any>(join(this.app.store.data,'sticker-settings.json'),{})};}
 save(input:any){const old=this.settings(),next={...old};if(typeof input.automatic==='boolean')next.automatic=input.automatic;for(const [key,min,max] of [['cooldownMinutes',1,120],['dailyMax',1,100]] as const){if(input[key]!==undefined){if(!Number.isInteger(input[key])||input[key]<min||input[key]>max)throw Error('表情频率设置超出范围');next[key]=input[key];}}atomicJson(join(this.app.store.data,'sticker-settings.json'),next);return next;}
 history(){return readJson<{id:string;at:number;automatic:boolean}[]>(join(this.app.store.data,'sticker-history.json'),[]);}
 begin(source:string,value:string){this.usedThisTurn=false;this.context={source,requested:/(发|来|给|要|看).{0,10}(表情|贴纸)|(表情包|贴纸).{0,8}(发|来|给)/.test(value)};}
 reason(id?:string,now=Date.now()){
  const c=this.settings(),h=this.history(),auto=h.filter(x=>x.automatic),day=new Date(now+8*3600000).toISOString().slice(0,10);
  if(!c.automatic)return '自主表情已关闭';
  if(auto.filter(x=>new Date(x.at+8*3600000).toISOString().slice(0,10)===day).length>=c.dailyMax)return '今日自主表情已达上限';
  if(h.length&&now-h[h.length-1].at<c.cooldownMinutes*60000)return '表情冷却中，继续自然文字聊天';
  if(id&&h.slice(-3).some(x=>x.id===id))return '换一张表情，避免重复最近三张';
  return '';
 }
 prompt(){if(this.context?.source!=='qq')return '\n本轮不是QQ私聊，不调用表情发送工具。';const reason=this.context.requested?'':this.reason();return `\n表情表达：${reason||'可自主使用'}。你可以像日常聊天一样在好笑、害羞、鼓励、安慰或告别时主动配一张，无需等对方要求；只在有表达价值时用，不必每轮发，不用解释自己在调用表情工具。认真讨论和强烈悲伤时以倾听和文字回应为先。每轮最多一张。图库真实ID：${JSON.stringify(this.list().filter(s=>!this.history().slice(-3).some(h=>h.id===s.id)).map(s=>({id:s.id,name:s.name})))}。明确索要时可查询完整图库；发送结果以工具返回为准。`;}
 all(){return readJson<Sticker[]>(join(this.dir,'index.json'),[]);}
 write(rows:Sticker[]){mkdirSync(this.dir,{recursive:true});atomicJson(join(this.dir,'index.json'),rows);}
 async init(){if(this.initializing)return this.initializing;this.initializing=this.createPresets().catch(e=>{this.initializing=undefined;throw e;});return this.initializing;}
 async createPresets(){
  for(const p of PRESETS){if(this.all().some(s=>s.id===p.id))continue;
   const extra=p.id==='coco-hug'?'<path d="M35 182 Q85 140 115 185 M221 182 Q171 140 141 185"/>':p.id==='coco-sleep'?'<path d="M188 42 H218 L188 67 H218"/>':'';
   const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="40" fill="#f5f2e9"/><path d="M58 70 L54 24 L104 51 Q128 42 152 51 L202 24 L198 70 Q224 106 210 160 Q198 207 128 211 Q58 207 46 160 Q32 106 58 70Z" fill="${p.color}" stroke="#354f49" stroke-width="6" stroke-linejoin="round"/><g fill="none" stroke="#354f49" stroke-width="7" stroke-linecap="round"><path d="${p.eyes}"/><path d="${p.mouth}"/>${extra}</g><ellipse cx="73" cy="129" rx="16" ry="8" fill="#ed8b8b" opacity=".55"/><ellipse cx="183" cy="129" rx="16" ry="8" fill="#ed8b8b" opacity=".55"/></svg>`;
   await this.import({name:p.name,tags:p.tags,data:(await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64')},p.id);
  }
 }
 async import(input:any,presetId?:string){
  const name=text(input?.name,60);if(!name)throw Error('请填写表情名称');
  if(typeof input.data!=='string'||input.data.length>12*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.data))throw Error('表情图片数据无效');
  const bytes=Buffer.from(input.data,'base64'),format=imageFormat(bytes);if(!format||bytes.length>8*1024*1024)throw Error('支持8 MB以内的 PNG、JPG、GIF、WebP');
  const metadata=await sharp(bytes,{limitInputPixels:40_000_000}).metadata();if(metadata.format!==format||!metadata.width||!metadata.height)throw Error('图片格式无效');
  const tags=Array.isArray(input.tags)?input.tags.slice(0,12).map((s:unknown)=>text(s,30)).filter(Boolean):[];
  const rows=this.all(),sha256=createHash('sha256').update(bytes).digest('hex'),existing=rows.find(s=>s.sha256===sha256);
  if(existing&&!presetId){existing.name=name;existing.tags=tags;existing.enabled=true;this.write(rows);return existing;}
  if(rows.filter(s=>s.enabled).length>=200)throw Error('图库最多200张表情');
  const record:Sticker={id:presetId??randomUUID(),name,tags,format,sha256,enabled:true,createdAt:new Date().toISOString(),...(input.source?{source:text(input.source,1000),pack:text(input.pack,60)}:{})};
  mkdirSync(this.dir,{recursive:true});writeFileSync(join(this.dir,record.id+'.'+format),bytes);this.write([...rows,record]);return record;
 }
 list(query=''){const q=text(query,100).toLowerCase();return this.all().filter(s=>s.enabled&&(!q||[s.name,...s.tags].join(' ').toLowerCase().includes(q))).map(({id,name,tags,format,source,pack})=>({id,name,tags,format,source,pack}));}
 file(id:string){if(!/^[a-zA-Z0-9-]{1,100}$/.test(id))throw Error('表情ID无效');const item=this.all().find(s=>s.id===id&&s.enabled);if(!item||!['png','jpeg','gif','webp'].includes(item.format))throw Error('表情不存在或已移出图库');const path=join(this.dir,item.id+'.'+item.format);if(!existsSync(path))throw Error('表情文件不存在');return {item,path};}
 remove(id:string){const rows=this.all(),item=rows.find(s=>s.id===id&&s.enabled);if(!item)throw Error('表情不存在');item.enabled=false;this.write(rows);return {message:'已移出表情图库，本地文件仍保留'};}
 async send(id:string,automatic=false){
  if(this.app.store.state().paused||this.app.stopping)throw Error('伙伴已暂停或停止');
  if(!this.app.qq.online||!this.app.qq.connected)throw Error('QQ 尚未在线');
  const {item,path}=this.file(id),bytes=readFileSync(path);
  if(automatic){const reason=this.reason(id);if(reason)throw Error(reason);}
  // Persist before transmission: an uncertain result must also consume the cooldown.
  atomicJson(join(this.app.store.data,'sticker-history.json'),[...this.history(),{id,at:Date.now(),automatic}].slice(-500));
  const result=await this.app.deliver('sticker:'+randomUUID(),'',false,bytes);
  if(result?.kind!=='sent')throw Error(result?.error||'表情发送未确认，不自动重发');
  this.app.store.message('assistant',`[表情包：${item.name}]`,'sticker');
  return {sent:true,name:item.name,messageId:result.messageId};
 }
}
