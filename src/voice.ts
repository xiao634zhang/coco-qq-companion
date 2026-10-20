import type {ServerResponse} from 'node:http';
import type {Companion} from './companion.ts';
export class VoiceConversation {
 app:Companion;epoch=0;active=false;generating=false;activeEpoch=0;generatingEpoch=0;
 constructor(app:Companion){this.app=app;}
 interrupt(){this.epoch++;if(this.generating&&this.generatingEpoch===this.activeEpoch)void this.app.codex.interrupt().catch(()=>{});this.active=false;return {interrupted:true};}
 async stream(input:any,res:ServerResponse){
  this.app.modules.assert('voice');if(this.active)throw Error('语音回合进行中，请先打断');
  if(this.app.busy||this.app.queueCount)throw Error('聊天正在处理，请稍后再说');
  const epoch=++this.epoch;this.activeEpoch=epoch;this.active=true;let closed=false,pending='',streamed='',sent=0;let audioQueue=Promise.resolve();
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive'});
  const emit=(event:string,data:any)=>{if(!closed&&epoch===this.epoch)res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);};
  const close=()=>{closed=true;if(this.active&&epoch===this.epoch)this.interrupt();};res.on('close',close);
  const speak=(value:string)=>{if(!value.trim())return;const index=sent++;audioQueue=audioQueue.then(async()=>{if(closed||epoch!==this.epoch)return;try{const result=await this.app.media.speak(value,this.app.extensions.settings().voice);if(!closed&&epoch===this.epoch)emit('audio',{id:result.id,index,text:value});}catch(e){emit('audio-error',{error:String(e)});}});};
  const onDelta=(value:string)=>{if(closed||epoch!==this.epoch)return;streamed+=value;pending+=value;emit('text',{delta:value});let m:RegExpMatchArray|null;while((m=pending.match(/^([\s\S]{8,180}?[。！？!?\n]|[\s\S]{180})/))){speak(m[0]);pending=pending.slice(m[0].length);}};
  try{
   let value=input.text;
   if(typeof value!=='string'){emit('state',{phase:'transcribing'});const media=this.app.media.import('microphone.wav',input.audio);const result=await this.app.media.transcribe(media.id,this.app.extensions.settings().whisperModel);value=result.text;}
   if(typeof value!=='string'||!value.trim()||value.length>8000)throw Error('没有识别到有效讲话');
   if(epoch!==this.epoch||closed)return;emit('transcript',{text:value});
   await this.app.enqueue(async()=>{if(epoch!==this.epoch||closed)return;this.generating=true;this.generatingEpoch=epoch;this.app.codex.on('final-delta',onDelta);try{emit('state',{phase:'thinking'});const reply=await this.app.chat(value,'voice');if(epoch!==this.epoch||closed)return;if(!streamed){emit('text',{delta:reply});speak(reply);}else if(reply.startsWith(streamed)){speak(pending+reply.slice(streamed.length));}else{speak(pending);emit('correction',{text:reply});}this.app.store.message('assistant',reply,'voice',this.app.store.config().model);emit('reply',{text:reply});}finally{if(this.generatingEpoch===epoch)this.generating=false;this.app.codex.off('final-delta',onDelta);}});
   await audioQueue;emit('done',{});
  }catch(e){emit('error',{error:String(e).replace(/^Error: /,'')});}
  finally{this.app.codex.off('final-delta',onDelta);res.off('close',close);if(this.activeEpoch===epoch)this.active=false;if(!closed)res.end();}
 }
}
