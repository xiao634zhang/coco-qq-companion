import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {Store,readJson,atomicJson,text} from './store.ts';
import type {Companion} from './companion.ts';
export class Journeys {
 store:Store;constructor(store:Store){this.store=store;}
 favorites(){return readJson<any[]>(join(this.store.data,'favorites.json'),[]);}
 favorite(input:any){const items=this.favorites();if(input.remove){atomicJson(join(this.store.data,'favorites.json'),items.filter(e=>e.id!==input.id));return {removed:true};}const u=new URL(text(input.url,2000));if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('收藏链接无效');const old=items.find(e=>e.url===u.href),e={id:old?.id??randomUUID(),at:old?.at??new Date().toISOString(),title:text(input.title,200),url:u.href,summary:text(input.summary,3000),reflection:text(input.reflection??'',2000)};if(!old&&items.length>=1000)throw Error('收藏已达1000条');atomicJson(join(this.store.data,'favorites.json'),[e,...items.filter(x=>x.id!==e.id)]);return e;}
 progress(app:Companion){return app.tasks.all().slice(0,30).map(t=>{const events=this.store.lines<any>('task-events.jsonl').filter(e=>e.taskId===t.id),last=events.at(-1),action=[...events].reverse().find(e=>e.event==='action');return {...t,lastAction:action?.detail?.name??'',lastEvent:last?.event??'',updatedAt:last?.at??new Date(t.createdAt).toISOString(),blockedReason:t.status==='suspended'||t.status==='failed'?t.reason:'',nextStep:t.status==='suspended'?'处理登录或网络后，选择继续；已过期则从检查点新建':t.status==='queued'?'等待同资源通道空闲':t.status==='running'?'等待当前观察或动作返回':'已结束',hasScreenshot:existsSync(join(this.store.data,'task-shots',t.id+'.png'))};});}
 resume(app:Companion,input:any){const task=app.tasks.all().find(t=>t.id===input.id);if(!task||!['stopped','failed','suspended'].includes(task.status))throw Error('只能恢复已结束或挂起的任务');if(task.status==='suspended'&&task.deadline>Date.now())return app.tasks.resume(task.scope);return app.tasks.start({scope:task.scope,minutes:input.minutes??task.durationMinutes??10,goal:`${task.goal}\n从管理员批准的检查点继续。先观察当前实际页面，再决定动作；不要假设旧操作已生效。之前进展：${task.summary||'暂无摘要'}\n中断原因：${task.reason}`},task.source);}
}
