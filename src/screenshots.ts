import {readFileSync,existsSync,statSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {functionTool} from './tool-result.ts';
import type {Companion} from './companion.ts';
export const SCREENSHOT_TOOLS=[functionTool('companion_screenshot_send','管理员要看截图时，向管理员 QQ 发送真实截图。latest=已有任务最近截图；android=模拟器当前任意App画面（不局限2048）；web=coco专用浏览器当前页面。CLI阅读没有网页画面，不能把旧图当成CLI当前页面。',{source:{type:'string',enum:['latest','android','web']}},['source'])];
export class Screenshots {
 app:Companion;
 constructor(app:Companion){this.app=app;}
 saveTask(id:string,bytes:Buffer){if(!/^[a-zA-Z0-9-]{1,100}$/.test(id))throw Error('任务 ID 无效');const base=join(this.app.store.data,'task-shots');mkdirSync(base,{recursive:true});const path=join(base,id+'.png');writeFileSync(path,bytes);return path;}
 async send(source='latest',taskId?:string){
  if(this.app.store.state().paused||this.app.stopping)throw Error('伙伴已暂停或停止');
  if(!this.app.qq.connected||!this.app.qq.online)throw Error('QQ 尚未在线');
  let path=join(this.app.store.data,'latest-task.png');
  if(taskId){if(!/^[a-zA-Z0-9-]{1,100}$/.test(taskId))throw Error('任务 ID 无效');path=join(this.app.store.data,'task-shots',taskId+'.png');}
  if(source==='android'){
   if(!this.app.tasks.abilities.settings().android)throw Error('请先启用安卓能力');
   const result=await this.app.tasks.abilities.phone.call('phone_screenshot',{});
   if(!result.image)throw Error('未取得模拟器截图');
   this.app.tasks.abilities.snapshot(result.image);path=this.saveTask('manual-'+randomUUID(),result.image);
  }else if(source==='web'){
   const abilities=this.app.tasks.abilities;
   if(!abilities.settings().web)throw Error('请先启用网页能力');
   if(!abilities.browser.page||abilities.browser.page.isClosed())throw Error('coco 的专用浏览器尚无打开的网页；小红书和知乎 CLI 的文字阅读不等于已打开网页');
   const bytes=await abilities.browser.screenshot();abilities.snapshot(bytes);path=this.saveTask('manual-'+randomUUID(),bytes);
  }else if(source!=='latest')throw Error('截图来源无效');
  if(!existsSync(path))throw Error('尚无这次任务的截图，请先让 coco 观察模拟器或网页');
  if(statSync(path).size>8*1024*1024)throw Error('截图超过8 MB');
  const bytes=readFileSync(path),at=statSync(path).mtime.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});
  const result=await this.app.deliver('screenshot:'+randomUUID(),`coco 的${source==='android'?'模拟器当前 App':source==='web'?'专用浏览器当前网页':'任务最近一次'}截图\n截图时间：${at}（北京时间）`,false,bytes);
  if(result?.kind!=='sent')throw Error(result?.error||'截图发送未确认，不自动重发');
  return {sent:true,message:'真实截图已发到管理员 QQ',messageId:result.messageId,capturedAt:at};
 }
}
