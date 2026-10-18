import {shanghai} from './store.ts';

export async function aiHotNews(fetcher:typeof fetch=fetch){
 const r=await fetcher('https://aihot.news/api/v1/hot-topics',{headers:{'User-Agent':'aihot-api/2.0.0; client=coco-qq-companion'},signal:AbortSignal.timeout(20000),redirect:'error'});
 if(!r.ok)throw Error(`AIHOT 暂时不可用（HTTP ${r.status}），本次不补发`);
 const raw=await r.text();if(raw.length>1024*1024)throw Error('AIHOT 返回内容过大');
 const data=JSON.parse(raw);if(!Array.isArray(data.items))throw Error('AIHOT 返回格式无效');
 const items=data.items.slice(0,10).map((v:any)=>{
  const title=String(v.title??'').replace(/[\r\n]/g,' ').slice(0,120),url=new URL(v.links?.aihot);
  if(!title||url.protocol!=='https:'||url.hostname!=='aihot.news'||url.username||url.password)throw Error('AIHOT 新闻链接无效');
  return {title,url:url.href,latestAt:typeof v.latestAt==='string'?v.latestAt:null};
 });
 if(!items.length)throw Error('AIHOT 当前没有热门资讯');
 return {items,text:`AI 科技热榜 · ${shanghai().time}\n来源：AIHOT 当前热门事件，按平台热榜排序（可能包含持续数日的热点）\n\n`+items.map((v:any,i:number)=>`${i+1}. ${v.title}\n${v.url}`).join('\n\n')};
}
