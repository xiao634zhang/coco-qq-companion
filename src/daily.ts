import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {atomicJson,readJson,text,shanghai} from './store.ts';
import {functionTool} from './tool-result.ts';
import {aiHotNews} from './news.ts';
import type {Companion} from './companion.ts';
import {schedule,nextOccurrence,scheduleLabel,type Schedule} from './schedule.ts';

export type DailyKind='message'|'news'|'web'|'android'|'game';
export interface DailyJob {id:string;ownerQQ:string;title:string;time:string;schedule?:Schedule;kind:DailyKind;goal:string;minutes:number;enabled:boolean;nextRunAt:number;createdAt:number;lastRun?:{at:number;status:string;detail:string;taskId?:string}}
export function nextDaily(time:string,now=Date.now()){
 const day=shanghai(now).day;let at=Date.parse(`${day}T${time}:00+08:00`);if(at<=now)at+=86400000;return at;
}
export const DAILY_TOOLS=[
 functionTool('companion_schedule_save','按管理员明确要求保存或修改一次性、每周、间隔或每日安排；id用于修改已存在任务。北京时间周日=0。两小时后可用once at为当前时间加两小时的带时区ISO字符串。只有保存成功才承诺。',{id:{type:'string'},title:{type:'string'},schedule:{type:'object',properties:{type:{type:'string',enum:['daily','weekly','interval','once']},time:{type:'string'},days:{type:'array',items:{type:'integer'}},minutes:{type:'integer'},at:{type:'string'}}},kind:{type:'string',enum:['message','news','web','android','game']},goal:{type:'string'},minutes:{type:'integer'}},['title','schedule','kind','goal']),
 functionTool('companion_daily_list','列出已经实际保存的每日任务。'),
 functionTool('companion_daily_save','管理员明确要求每天定时执行时，保存或更新北京时间每日任务。news=AIHOT热门十条（不消耗模型额度）；message=原文提醒；web/android/game=调用已有任务能力。成功后才承诺已安排。',{id:{type:'string'},title:{type:'string'},time:{type:'string',description:'北京时间 HH:mm，24小时制'},kind:{type:'string',enum:['message','news','web','android','game']},goal:{type:'string'},minutes:{type:'integer',minimum:1,maximum:30}},['title','time','kind','goal']),
 functionTool('companion_daily_remove','管理员明确要求取消某条每日任务时，按实际列表 ID 删除。',{id:{type:'string'}},['id']),
];
export class Daily {
 app:Companion;running=false;news=aiHotNews;
 constructor(app:Companion){this.app=app;}
 all(){return readJson<DailyJob[]>(join(this.app.store.data,'daily-jobs.json'),[]);}
 write(jobs:DailyJob[]){atomicJson(join(this.app.store.data,'daily-jobs.json'),jobs);}
 save(input:any,now=Date.now()){
  if(!input||typeof input!=='object')throw Error('每日任务参数无效');
  const timing=schedule(input.schedule,input.time,now);
  if(!['message','news','web','android','game'].includes(input.kind))throw Error('每日任务类型无效');
  const title=text(input.title,100),goal=text(input.goal,2000);if(!title||!goal)throw Error('标题和内容不能为空');
  const ownerQQ=this.app.store.config().ownerQQ;if(!/^\d{5,12}$/.test(ownerQQ))throw Error('请先设置管理员 QQ');
  const minutes=input.minutes??10;if(!Number.isInteger(minutes)||minutes<1||minutes>30)throw Error('任务时长为1–30分钟');
  const jobs=this.all(),old=input.id?jobs.find(j=>j.id===input.id):jobs.find(j=>j.ownerQQ===ownerQQ&&j.title===title);
  if(input.id&&!old)throw Error('每日任务不存在');
  if(!old&&jobs.length>=30)throw Error('每日任务最多30条');
  const job:DailyJob={...old,id:old?.id??randomUUID(),ownerQQ,title,time:'time' in timing?timing.time:'',schedule:timing,kind:input.kind,goal,minutes,enabled:input.enabled??true,nextRunAt:nextOccurrence(timing,now),createdAt:old?.createdAt??now};
  if(typeof job.enabled!=='boolean')throw Error('开关无效');
  this.write([job,...jobs.filter(j=>j.id!==job.id)]);
  return {saved:true,job,message:`已保存：北京时间 ${scheduleLabel(timing)} ${title}，下次 ${new Date(job.nextRunAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}。电脑和服务需运行、QQ 需在线；错过不补发。`};
 }
 remove(id:string){const jobs=this.all();if(!jobs.some(j=>j.id===id))throw Error('每日任务不存在');this.write(jobs.filter(j=>j.id!==id));return {removed:true,message:'每日任务已取消'};}
 recover(){const jobs=this.all();let changed=false;for(const j of jobs)if(j.lastRun?.status==='processing'){j.lastRun={at:j.lastRun.at,status:'interrupted',detail:'进程重启，本次不重发'};changed=true;}if(changed)this.write(jobs);}
 result(id:string,run:number,status:string,detail:string,taskId?:string){const jobs=this.all(),j=jobs.find(j=>j.id===id);if(j?.lastRun?.at!==run)return;j.lastRun={at:run,status,detail:detail.slice(0,1000),taskId};this.write(jobs);this.app.store.append('daily-events.jsonl',{jobId:id,at:new Date(run).toISOString(),status,detail,taskId});}
 async tick(now=Date.now()){
  if(this.app.modules?.settings().enabled.schedules===false)return;
  if(this.running||this.app.stopping)return;this.running=true;
  try{for(const snapshot of this.all()){
   if(!snapshot.enabled||snapshot.nextRunAt>now)continue;
   const jobs=this.all(),job=jobs.find(j=>j.id===snapshot.id);if(!job||!job.enabled||job.nextRunAt>now)continue;
   const occurrence=job.nextRunAt;job.nextRunAt=nextOccurrence(job.schedule??{type:'daily',time:job.time},now);job.lastRun={at:occurrence,status:'processing',detail:'已领取本次任务，重启不重发'};this.write(jobs);
   try{
    if(now-occurrence>5*60000)throw Error('错过执行时间，本次不补发');
    if(job.ownerQQ!==this.app.store.config().ownerQQ)throw Error('管理员已改变，请重新保存此任务');
    if(this.app.store.state().paused)throw Error('伙伴已暂停');
    if(!this.app.qq.online||!this.app.qq.connected)throw Error('QQ 离线');
    if(job.kind==='news'||job.kind==='message'){
     const value=job.kind==='news'?(await this.news()).text:`定时提醒：${job.goal}`;
     if(this.app.stopping||this.app.store.state().paused||!this.all().some(j=>j.id===job.id&&j.enabled))throw Error('执行期间任务被取消或伙伴已暂停');
     const sent=await this.app.deliver(`daily:${job.id}:${occurrence}`,value,true,undefined,()=>job.ownerQQ===this.app.store.config().ownerQQ&&this.all().some(j=>j.id===job.id&&j.enabled&&j.lastRun?.at===occurrence));
     this.result(job.id,occurrence,sent?.kind??'failed',sent?.kind==='sent'?'已推送':sent?.error??'发送未确认');
    }else{
     const result=this.app.tasks.start({scope:job.kind,goal:job.goal,minutes:job.minutes},'qq');
     this.result(job.id,occurrence,result.status==='queued'?'queued':'started',result.status==='queued'?'已进入任务池排队，完成后由活动汇报':'已启动，完成后由活动汇报',result.id);
    }
   }catch(e){this.result(job.id,occurrence,'skipped',String(e).replace(/^Error: /,''));}
  }}finally{this.running=false;}
 }
 statusText(){return this.all().map(j=>`${j.id}\n${j.enabled?'开':'关'} · ${scheduleLabel(j.schedule??{type:'daily',time:j.time})} · ${j.title}\n下次：${j.nextRunAt===Number.MAX_SAFE_INTEGER?'已执行':new Date(j.nextRunAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}\n${j.lastRun?.detail??'尚未执行'}`).join('\n\n')||'暂无定时任务';}
}
