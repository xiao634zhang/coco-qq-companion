import {privateText,type PrivateEvent} from './onebot.ts';
import {atomicJson,readJson,type Store} from './store.ts';
import {join} from 'node:path';

export function cacheQQMessage(store:Store,event:PrivateEvent){
 const path=join(store.data,'qq-message-cache.json'),rows=readJson<any[]>(path,[]),id=String(event.message_id);
 if(id==='undefined')return;const message=JSON.stringify(event.message??event.raw_message??'');if(message.length>100000)return;
 atomicJson(path,[...rows.filter(x=>String(x.message_id)!==id),{message_id:id,user_id:String(event.user_id),message_type:'private',message:JSON.parse(message)}].slice(-500));
}
export function cachedQQMessage(store:Store,id:string,bot:string){
 const hit=readJson<any[]>(join(store.data,'qq-message-cache.json'),[]).find(x=>x.message_id===id);if(hit)return hit;
 const sent=Object.values(store.deliveries()).find(x=>x.messageId===id&&x.status==='sent');return sent?.text?{user_id:bot,message_type:'private',message:sent.text}:undefined;
}

export async function quotedMessage(event:PrivateEvent,qq:{api:(action:string,args:any)=>Promise<any>},owner:string,bot:string,fallback?:(id:string)=>any){
 const refs=Array.isArray(event.message)?event.message.filter(s=>s.type==='reply'):[];
 if(!refs.length)return {text:'',images:[],files:[]};
 const parts:string[]=[],images:any[]=[],files:any[]=[];
 for(const ref of refs.slice(0,2)){
  try{
   const id=String(ref.data?.id??'');if(!/^-?\d{1,30}$/.test(id))throw Error('引用ID无效');
   let m:any;try{const r=await qq.api('get_msg',{message_id:id});if(r.status==='ok')m=r.data;}catch{}
   const cached=fallback?.(id);
   // get_msg may flatten an attachment into the literal "[文件]".
   // Prefer the received structured event for that exact message ID.
   const cachedMedia=Array.isArray(cached?.message)&&cached.message.some((s:any)=>['file','image','record'].includes(s.type));
   const freshMedia=Array.isArray(m?.message)&&m.message.some((s:any)=>['file','image','record'].includes(s.type));
   if(cached&&(!m||!Array.isArray(m.message)&&Array.isArray(cached.message)||cachedMedia&&!freshMedia))m=cached;
   m??=cached;if(!m)throw Error('原消息已过期或网关未缓存');
   const sender=String(m.sender?.user_id??m.user_id??'');
   if(m.group_id||m.message_type==='group'||![owner,bot].includes(sender))throw Error('原消息不属于当前私聊');
   parts.push(`[引用原消息 · ${sender===owner?'你':'coco'}]\n${privateText(m).slice(0,8000)}\n[引用结束]`);
   if(Array.isArray(m.message)){images.push(...m.message.filter((s:any)=>s.type==='image'));files.push(...m.message.filter((s:any)=>s.type==='file'));}
  }catch{parts.push('[引用原消息暂时无法取得，请说明这一点，需要时请对方重新转发原文]');}
 }
 return {text:parts.join('\n'),images,files};
}
