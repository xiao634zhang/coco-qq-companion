import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Store,atomicJson,readJson,text} from './store.ts';
export interface Recollection {id:string;text:string;kind:'fact'|'preference'|'conversation'|'experience';source:string;sourceId:string;at:string;updatedAt:string;tags:string[];forgotten?:boolean;previous?:string}
export type Embed=(texts:string[])=>Promise<number[][]>;
export class Recall {
  store:Store;embed?:Embed;loading?:Promise<Embed>;lastError='';
  constructor(store:Store,embed?:Embed){this.store=store;this.embed=embed;}
  file(){return join(this.store.data,'recall.json');}
  all(){return readJson<Recollection[]>(this.file(),[]);}
  write(items:Recollection[]){atomicJson(this.file(),items);}
  sync(){
    const items=this.all(),memory=this.store.memory();let changed=false;
    const add=(value:string,kind:Recollection['kind'],source:string,sourceId:string,at:string)=>{
      if(items.some(e=>e.source===source&&e.sourceId===sourceId))return;
      items.push({id:randomUUID(),text:value,kind,source,sourceId,at,updatedAt:at,tags:[]});changed=true;
    };
    for(const [key,kind] of [['facts','fact'],['preferences','preference']] as const)for(const value of memory[key])add(value,kind,'memory:'+key,createHash('sha256').update(value).digest('hex'),new Date().toISOString());
    for(const e of items)if(e.source.startsWith('memory:')&&!e.forgotten){const values=e.source==='memory:facts'?memory.facts:memory.preferences;if(!values.includes(e.text)){e.forgotten=true;changed=true;}}
    for(const m of this.store.messages(3000))add(m.text,'conversation','chat:'+m.source,m.id,m.at);
    for(const e of this.store.lines<any>('experiences.jsonl'))add((e.title+'\n'+e.summary).slice(0,4000),'experience','experience',e.id,e.at);
    if(changed)this.write(items);return items.filter(e=>!e.forgotten);
  }
  save(input:any){
    const value=text(input.text,4000);if(!value)throw Error('记忆不能为空');
    if(!['fact','preference','conversation','experience'].includes(input.kind))throw Error('记忆类型无效');
    const tags=(input.tags??[]);if(!Array.isArray(tags)||tags.length>12||tags.some((v:any)=>typeof v!=='string'||v.length>40))throw Error('标签无效');
    const items=this.all(),old=input.id?items.find(e=>e.id===input.id&&!e.forgotten):undefined;if(input.id&&!old)throw Error('记忆不存在');
    const now=new Date().toISOString(),e:Recollection={...old,id:old?.id??randomUUID(),text:value,kind:input.kind,source:old?.source??'manual',sourceId:old?.sourceId??randomUUID(),at:old?.at??now,updatedAt:now,tags,previous:old?.text!==value?old?.text:old?.previous};
    if(old?.source.startsWith('memory:')){const m=this.store.memory(),key=old.source==='memory:facts'?'facts':'preferences';m[key]=m[key].map(v=>v===old.text?value:v);this.store.saveMemory(m);e.sourceId=createHash('sha256').update(value).digest('hex');}
    this.write([e,...items.filter(x=>x.id!==e.id)]);return e;
  }
  forget(id:string){
    const items=this.all(),e=items.find(x=>x.id===id);if(!e)throw Error('记忆不存在');
    const oldText=e.text;e.forgotten=true;e.text='';e.previous=undefined;e.tags=[];e.updatedAt=new Date().toISOString();
    if(e.source.startsWith('memory:')){const m=this.store.memory();m.facts=m.facts.filter(v=>v!==oldText);m.preferences=m.preferences.filter(v=>v!==oldText);this.store.saveMemory(m);}
    if(e.source.startsWith('chat:'))this.store.rewrite('chat.jsonl',this.store.messages(Number.MAX_SAFE_INTEGER).filter(m=>m.id!==e.sourceId));
    if(e.source==='experience')this.store.rewrite('experiences.jsonl',this.store.lines<any>('experiences.jsonl').filter(x=>x.id!==e.sourceId));
    this.write(items);this.clearVectors();return {forgotten:true};
  }
  clearVectors(){atomicJson(join(this.store.data,'recall-vectors.json'),{});}
  async encoder(){
    if(this.embed)return this.embed;
    if(!this.loading)this.loading=(async()=>{
      const {pipeline,env}=await import('@huggingface/transformers');
      const proxy=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
      if(proxy){const {ProxyAgent,fetch}=await import('undici');const dispatcher=new ProxyAgent(proxy);env.fetch=async(url,init)=>{const r=await fetch(url,{...init,dispatcher});return new Response(r.body as any,{status:r.status,statusText:r.statusText,headers:Object.fromEntries(r.headers)});};}
      env.cacheDir=join(this.store.root,'.runtime','models','embeddings');env.allowLocalModels=false;
      const pipe=await pipeline('feature-extraction','Xenova/paraphrase-multilingual-MiniLM-L12-v2',{dtype:'q8'});
      const fn:Embed=async values=>{const r=await pipe(values,{pooling:'mean',normalize:true});return r.tolist() as number[][];};this.embed=fn;this.lastError='';return fn;
    })().catch(e=>{this.lastError=String(e);this.loading=undefined;throw e;});
    return this.loading;
  }
  async search(query:string,limit=8){
    query=text(query,1000);const all=this.sync();if(!query)return {mode:'recent',items:all.slice(-limit).reverse()};
    const lexical=(s:string)=>{const q=[...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{1,2}/gu)??[])];return q.reduce((n,w)=>n+(s.toLowerCase().includes(w)?1:0),0)/Math.max(q.length,1);};
    const candidates=all.slice(-5000);
    try{
      const embed=await this.encoder(),cachePath=join(this.store.data,'recall-vectors.json'),cache=readJson<Record<string,number[]>>(cachePath,{}),key=(s:string)=>createHash('sha256').update(s).digest('hex');
      const missing=candidates.filter(e=>!cache[key(e.text)]);
      for(let i=0;i<missing.length;i+=16){const chunk=missing.slice(i,i+16),vectors=await embed(chunk.map(e=>e.text));chunk.forEach((e,j)=>{cache[key(e.text)]=vectors[j]});}
      const [q]=await embed([query]),live=this.all().filter(e=>!e.forgotten),keys=new Set(live.map(e=>key(e.text)));
      for(const hash of Object.keys(cache))if(!keys.has(hash))delete cache[hash];atomicJson(cachePath,cache);
      const current=candidates.filter(e=>live.some(x=>x.id===e.id&&x.text===e.text));
      return {mode:'semantic',items:current.map(e=>({...e,score:cache[key(e.text)].reduce((n,v,i)=>n+v*(q[i]??0),0)})).sort((a,b)=>b.score-a.score).slice(0,limit)};
    }catch(e){this.lastError=String(e);const live=this.all().filter(e=>!e.forgotten);return {mode:'keyword-fallback',error:'本地语义模型暂不可用，当前使用文字检索',items:live.filter(e=>lexical(e.text)>0).sort((a,b)=>lexical(b.text)-lexical(a.text)).slice(0,limit)};}
  }
  interests(){return readJson<{id:string;topic:string;note:string;at:string;sourceIds:string[];enabled:boolean}[]>(join(this.store.data,'interests.json'),[]);}
  interest(input:any){const topic=text(input.topic,80),note=text(input.note,1000);if(!topic||!note)throw Error('话题和延续内容不能为空');const all=this.interests(),old=all.find(x=>x.id===input.id||x.topic===topic);if(!old&&all.length>=50)throw Error('话题最多50条');const e={id:old?.id??randomUUID(),topic,note,at:new Date().toISOString(),sourceIds:Array.isArray(input.sourceIds)?input.sourceIds.filter((x:any)=>typeof x==='string').slice(0,12):[],enabled:input.enabled!==false};atomicJson(join(this.store.data,'interests.json'),[e,...all.filter(x=>x.id!==e.id)]);return e;}
  removeInterest(id:string){atomicJson(join(this.store.data,'interests.json'),this.interests().filter(e=>e.id!==id));return {removed:true};}
}
