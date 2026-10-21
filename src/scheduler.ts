import type { Config, State } from './store.ts';
import { shanghai } from './store.ts';

export function nextCheck(config: Config, now = Date.now(), random = Math.random) {
  const p = config.proactive;
  return now + (p.minMinutes + random() * (p.maxMinutes - p.minMinutes)) * 60000;
}
export function minimumDue(config:Config,state:State,now=Date.now()){
 const p=config.proactive,n=p.dailyMin??0,d=shanghai(now),count=state.proactiveDay===d.day?state.proactiveCount:0;
 if(!n||count>=n)return false;
 const minutes=new Date(now+8*3600000).getUTCHours()*60+new Date(now+8*3600000).getUTCMinutes();
 return minutes>=(p.startHour+(p.endHour-p.startHour)*(count+.5)/n)*60;
}
export function proactiveEligible(config: Config, state: State, online: boolean, busy: boolean, now = Date.now(),minimum=false) {
  const p = config.proactive, date = shanghai(now);
  if (!p.enabled || !config.ownerQQ || state.paused || state.blocked || !online || busy) return false;
  if (date.hour < p.startHour || date.hour >= p.endHour) return false;
  if (!minimum&&(!state.lastUserAt || now - state.lastUserAt < p.idleMinutes * 60000)) return false;
  if (state.lastProactiveAt && now - state.lastProactiveAt < p.gapMinutes * 60000) return false;
  return state.proactiveDay !== date.day || state.proactiveCount < p.dailyMax;
}
