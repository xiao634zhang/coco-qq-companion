export type Schedule={type:'daily';time:string}|{type:'weekly';time:string;days:number[]}|{type:'interval';minutes:number;anchor:number}|{type:'once';at:number};
export function schedule(input:any,time?:string,now=Date.now()):Schedule{
  const s=input??{type:'daily',time};
  if(s.type==='daily'||s.type==='weekly'){
    if(typeof s.time!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s.time))throw Error('时间为北京时间 HH:mm');
    if(s.type==='weekly'){if(!Array.isArray(s.days)||!s.days.length||s.days.some((d:any)=>!Number.isInteger(d)||d<0||d>6))throw Error('星期为0（周日）至6（周六）');return {type:'weekly',time:s.time,days:[...new Set<number>(s.days)]};}
    return {type:'daily',time:s.time};
  }
  if(s.type==='interval'){if(!Number.isInteger(s.minutes)||s.minutes<1||s.minutes>525600)throw Error('间隔为1至525600分钟');return {type:'interval',minutes:s.minutes,anchor:Number.isFinite(s.anchor)?s.anchor:now};}
  if(s.type==='once'){const at=typeof s.at==='number'?s.at:typeof s.at==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(s.at)?Date.parse(s.at):NaN;if(!Number.isFinite(at)||!Number.isFinite(new Date(at).getTime())||at<=now)throw Error('一次性时间须为未来时间，并包含时区');return {type:'once',at};}
  throw Error('定时类型无效');
}
export function nextOccurrence(s:Schedule,now=Date.now()){
  if(s.type==='once')return s.at>now?s.at:Number.MAX_SAFE_INTEGER;
  if(s.type==='interval')return s.anchor+(Math.max(0,Math.floor((now-s.anchor)/(s.minutes*60000)))+1)*s.minutes*60000;
  const local=new Date(now+8*3600000),day=local.toISOString().slice(0,10);
  for(let i=0;i<8;i++){const at=Date.parse(`${day}T${s.time}:00+08:00`)+i*86400000;if(at>now&&(s.type==='daily'||s.days.includes(new Date(at+8*3600000).getUTCDay())))return at;}
  throw Error('无法计算下次执行时间');
}
export function scheduleLabel(s:Schedule){return s.type==='daily'?`每天 ${s.time}`:s.type==='weekly'?`每周 ${s.days.map(d=>'日一二三四五六'[d]).join('、')} ${s.time}`:s.type==='interval'?`每 ${s.minutes} 分钟`:new Date(s.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});}
