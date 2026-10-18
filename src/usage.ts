import { join } from 'node:path';
import { Store, readJson, atomicJson, shanghai } from './store.ts';
import type { Limits, LimitWindow } from './codex.ts';

export type UsageCategory = 'runtime.chat' | 'runtime.proactive' | 'runtime.summary' | 'runtime.compact' | 'runtime.model-check' | 'runtime.web' | 'runtime.android' | 'runtime.game' | 'development.verify' | 'development.tools';
export interface TokenCounts { inputTokens: number; cachedInputTokens: number; cacheWriteInputTokens: number; outputTokens: number; reasoningOutputTokens: number; totalTokens: number }
const ZERO: TokenCounts = { inputTokens:0,cachedInputTokens:0,cacheWriteInputTokens:0,outputTokens:0,reasoningOutputTokens:0,totalTokens:0 };
interface DailyRow extends TokenCounts { day: string; model: string; category: UsageCategory; turnIds: string[] }
interface QuotaCounter { key: string; label: string; resetAt: number; usedPoints: number }
interface Ledger { since: string; baselines: Record<string,TokenCounts>; rows: Record<string,DailyRow>; counters: Record<string,QuotaCounter>; pendingQuota?: {before:Limits|null;category:UsageCategory}|null; quotaRepair?:{at:string;removedPoints:number;reason:string} }
interface UsageNotice { threadId: string; turnId: string; tokenUsage: { total: TokenCounts; last: TokenCounts }; model?: string; category?: UsageCategory; freshThread?: boolean }

function windows(limits: Limits | null) {
  const result: { key:string; label:string; value:LimitWindow }[]=[];
  const indexed = limits?.rateLimitsByLimitId;
  const top = limits?.rateLimits as any;
  const buckets: Record<string,any> = indexed && Object.keys(indexed).length ? indexed : {[top?.limitId || 'default']:top};
  for(const [bucket,snapshot] of Object.entries(buckets)) {
    for(const [key,label] of [['primary','主要窗口'],['secondary','次要窗口']]) {
      const value=snapshot?.[key];
      if(value&&Number.isFinite(value.usedPercent)&&value.usedPercent>=0&&value.usedPercent<=100&&Number.isFinite(value.resetsAt)) result.push({key:`${snapshot.limitId||bucket}:${key}`,label:`${snapshot.limitName||snapshot.limitId||bucket} · ${label}`,value});
    }
  }
  return result;
}
type WindowEntry=ReturnType<typeof windows>[number];
function sameWindow(entries:WindowEntry[],target:WindowEntry){
  const exact=entries.find(w=>w.key===target.key);if(exact)return exact;
  // Older reads only expose an unnamed top-level window; notifications may
  // name it "codex". Alias only an unnamed, otherwise identical window.
  const matches=entries.filter(w=>(w.key.startsWith('default:')||target.key.startsWith('default:'))&&w.key.split(':').at(-1)===target.key.split(':').at(-1)&&w.value.resetsAt===target.value.resetsAt&&(w.value.windowDurationMins??null)===(target.value.windowDurationMins??null));
  return matches.length===1?matches[0]:undefined;
}
function quotaDelta(before:WindowEntry[],after:WindowEntry){
  const old=sameWindow(before,after);
  // An absent or reset baseline tells us nothing about this project's share.
  // Never attribute the account's existing usage to this project.
  if(!old)return {delta:0,reason:'missing-baseline'};
  if(old.value.resetsAt!==after.value.resetsAt)return {delta:0,reason:'window-reset'};
  return {delta:Math.max(0,after.value.usedPercent-old.value.usedPercent),reason:after.value.usedPercent<old.value.usedPercent?'snapshot-decreased':'matched'};
}
function counterFor(counters:Record<string,QuotaCounter>,entry:WindowEntry){
  const exact=counters[entry.key];if(exact)return exact;
  const aliases=Object.values(counters).filter(c=>(c.key.startsWith('default:')||entry.key.startsWith('default:'))&&c.key.split(':').at(-1)===entry.key.split(':').at(-1)&&c.resetAt===entry.value.resetsAt);
  return aliases.length===1?aliases[0]:undefined;
}
export class UsageLedger {
  store:Store;
  current?: { before: Limits|null; category: UsageCategory };
  active = new Map<number,UsageCategory>();
  nextTicket = 0;
  latest: Limits|null = null;
  constructor(store:Store){this.store=store;}
  read():Ledger{return readJson(join(this.store.data,'usage-state.json'),{since:new Date().toISOString(),baselines:{},rows:{},counters:{}});}
  save(state:Ledger){atomicJson(join(this.store.data,'usage-state.json'),state);}
  sync(limits:Limits|null){
    const pending=this.read().pendingQuota;
    if(!this.current&&pending&&windows(limits).length){this.current=pending;this.end(limits);}
    const state=this.read();let changed=false;
    for(const entry of windows(limits)){
      if(!entry.value.resetsAt)continue;
      const old=counterFor(state.counters,entry);
      if(old&&old.resetAt!==entry.value.resetsAt){state.counters[entry.key]={key:entry.key,label:entry.label,resetAt:entry.value.resetsAt,usedPoints:0};changed=true;}
    }
    if(changed)this.save(state);
  }
  record(event:UsageNotice){
    if(!event.category||!event.model)return;
    const state=this.read(),total=event.tokenUsage.total;
    const before=state.baselines[event.threadId] || (event.freshThread ? ZERO : Object.fromEntries(Object.keys(ZERO).map(key=>[key,Math.max(0,Number((total as any)[key]||0)-Number((event.tokenUsage.last as any)[key]||0))])) as unknown as TokenCounts);
    const delta={...ZERO};
    for(const key of Object.keys(ZERO) as (keyof TokenCounts)[]) {
      const value=Number(total[key]||0),previous=Number(before[key]||0);
      if(!Number.isSafeInteger(value)||value<0)throw new Error('Codex 用量计数无效');
      delta[key]=value>=previous?value-previous:value;
    }
    state.baselines[event.threadId]={...total};
    if(!Object.values(delta).some(v=>v>0)){this.save(state);return;}
    const day=shanghai().day,key=`${day}:${event.model}:${event.category}`;
    const row=state.rows[key] ||= {day,model:event.model,category:event.category,turnIds:[],...ZERO};
    for(const name of Object.keys(ZERO) as (keyof TokenCounts)[])row[name]+=delta[name];
    const turnId=`${event.threadId}:${event.turnId}`;if(!row.turnIds.includes(turnId))row.turnIds.push(turnId);
    this.save(state);
    this.store.append('usage.jsonl',{at:new Date().toISOString(),day,model:event.model,category:event.category,threadId:event.threadId,turnId:event.turnId,delta});
  }
  begin(before:Limits|null,category:UsageCategory){
    const ticket=++this.nextTicket;this.active.set(ticket,category);
    // Overlapping runtime calls form one accounting interval. Commit its
    // account-window delta once, when its last runtime member finishes.
    if(!this.current||(category.startsWith('runtime.')&&!this.current.category.startsWith('runtime.'))){this.current={before,category};this.latest=before;}
    const state=this.read();state.pendingQuota=this.current;this.save(state);
    this.store.append('quota-audit.jsonl',{at:new Date().toISOString(),event:'begin',ticket,category,windows:windows(before)});return ticket;
  }
  remember(after:Limits|null){
    if(!after)return;
    // Concurrent responses can deliver older snapshots after newer ones.
    // Keep the highest observation within each reset window.
    const previous=windows(this.latest),entries=windows(after);
    const buckets:Record<string,any>={};
    for(const entry of entries){const old=sameWindow(previous,entry);const value=old&&old.value.resetsAt===entry.value.resetsAt&&old.value.usedPercent>entry.value.usedPercent?old.value:entry.value;const [bucket,key]=entry.key.split(':');(buckets[bucket]??={limitId:bucket})[key]=value;}
    this.latest=entries.length?{...after,rateLimitsByLimitId:buckets}:this.latest;
  }
  observe(after:Limits|null){
    this.remember(after);
    after=this.latest;
    const current=this.current;
    if(!current||!current.category.startsWith('runtime.'))return;
    const state=this.read();
    const before=windows(current.before),now=Date.now()/1000;
    for(const entry of windows(after)) {
      if(!entry.value.resetsAt||entry.value.resetsAt<=now)continue;
      const existing=counterFor(state.counters,entry);
      const counter=existing&&existing.resetAt===entry.value.resetsAt?existing:{key:entry.key,label:entry.label,resetAt:entry.value.resetsAt,usedPoints:0};
      const {delta}=quotaDelta(before,entry);
      const used=counter.usedPoints+delta;
      const budget=this.store.config().budget;
      if(budget.enabled&&(used>=budget.maxPercent||100-entry.value.usedPercent<=budget.reservePercent)) return { exceeded:true,label:entry.label,usedPoints:used,resetAt:entry.value.resetsAt*1000 };
    }
  }
  end(after:Limits|null,ticket?:number){
    this.remember(after);
    if(this.active.size){
      const id=ticket??[...this.active.keys()].at(-1)!;
      if(!this.active.delete(id))return;
      if([...this.active.values()].some(category=>category.startsWith('runtime.')))return this.blocked(after);
    }
    after=this.latest??after;
    // Commit all windows, even when the first has already reached its threshold.
    const current=this.current;if(!current)return;
    const enabled=this.store.config().budget.enabled;
    const state=this.read(),before=windows(current.before);
    if(current.category.startsWith('runtime.'))for(const entry of windows(after)){
      if(!entry.value.resetsAt)continue;
      const existing=counterFor(state.counters,entry);
      const counter=existing&&existing.resetAt===entry.value.resetsAt?existing:{key:entry.key,label:entry.label,resetAt:entry.value.resetsAt,usedPoints:0};
      const {delta,reason}=quotaDelta(before,entry);
      counter.usedPoints+=delta;
      if(existing&&existing.key!==entry.key)delete state.counters[existing.key];
      counter.key=entry.key;counter.label=entry.label;
      state.counters[entry.key]=counter;
      this.store.append('quota-audit.jsonl',{at:new Date().toISOString(),event:'commit',category:current.category,key:entry.key,resetAt:entry.value.resetsAt,before:sameWindow(before,entry)?.value.usedPercent??null,after:entry.value.usedPercent,delta,reason,projectPoints:counter.usedPoints});
    }
    state.pendingQuota=null;this.save(state);this.current=undefined;
    this.latest=null;
    if(this.active.size){this.current={before:after,category:[...this.active.values()][0]};state.pendingQuota=this.current;this.save(state);}
    return enabled?this.blocked(after):null;
  }
  blocked(limits:Limits|null){
    if(!this.store.config().budget.enabled)return null;
    const observed=this.observe(limits);
    if(observed?.exceeded&&observed.usedPoints>=this.store.config().budget.maxPercent)return {reason:`本项目窗口保护已达到 ${observed.usedPoints.toFixed(2)} 个百分点，等待额度重置`,resetAt:observed.resetAt};
    const state=this.read(),now=Date.now()/1000,available=windows(limits);
    if(!available.length)return {reason:'百分比保护已开启，但额度窗口数据未知，暂不调用模型',resetAt:null};
    for(const w of available){
      if(100-w.value.usedPercent<=this.store.config().budget.reservePercent)return {reason:`账号${w.label}剩余 ${Math.max(0,100-w.value.usedPercent).toFixed(1)}%，已触发保留 ${this.store.config().budget.reservePercent}% 的保护`,resetAt:w.value.resetsAt?w.value.resetsAt*1000:null};
      const c=counterFor(state.counters,w);
      if(c&&c.resetAt===w.value.resetsAt&&c.resetAt>now&&c.usedPoints>=this.store.config().budget.maxPercent)return {reason:`本项目窗口保护已达 ${c.usedPoints.toFixed(2)} 个百分点，等待额度重置`,resetAt:c.resetAt*1000};
    }
    return null;
  }
  view(){
    const state=this.read(),today=shanghai().day;
    const rows=Object.values(state.rows).sort((a,b)=>b.day.localeCompare(a.day)||a.model.localeCompare(b.model));
    const daily:Record<string,TokenCounts&{day:string;turns:number}>={};
    for(const row of rows.filter(r=>r.category.startsWith('runtime.'))){const d=daily[row.day]||={day:row.day,turns:0,...ZERO};for(const name of Object.keys(ZERO) as (keyof TokenCounts)[])d[name]+=row[name];d.turns+=row.turnIds.length;}
    return {since:state.since,today:daily[today]||{day:today,turns:0,...ZERO},daily:Object.values(daily).sort((a,b)=>b.day.localeCompare(a.day)),rows:rows.map(({turnIds,...row})=>({...row,turns:turnIds.length})),windows:Object.values(state.counters).filter(c=>c.resetAt*1000>Date.now()),budget:this.store.config().budget,quotaRepair:state.quotaRepair||null};
  }
}
