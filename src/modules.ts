import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store,readJson,atomicJson,text} from './store.ts';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
export const BUILTIN_MODULES=[
 {id:'recall',name:'记忆与话题',version:'1.0.0',description:'本地语义检索、记忆纠错与话题延续'},
 {id:'schedules',name:'灵活定时',version:'1.0.0',description:'每日、每周、间隔与一次性安排'},
 {id:'web',name:'网页与社交阅读',version:'1.0.0',description:'网页、某书、某乎的现有任务通道'},
 {id:'android',name:'安卓与游戏',version:'1.0.0',description:'现有模拟器操作与宏'},
 {id:'voice',name:'实时语音',version:'1.0.0',description:'浏览器说话检测、流式文字、分句播音与打断'},
 {id:'avatar',name:'桌面形象',version:'1.0.0',description:'内置动态形象、状态与口型；可导入Live2D素材'},
 {id:'minecraft',name:'Minecraft',version:'1.0.0',description:'Mineflayer连接、跟随、采集、整理与单块建造'},
];
export class Modules {
 store:Store;clients=new Map<string,Client>();
 constructor(store:Store){this.store=store;}
 settings(){return readJson<{enabled:Record<string,boolean>;workflows:any[];mcp:any[]}>(join(this.store.data,'modules.json'),{enabled:{},workflows:[],mcp:[]});}
 status(){const s=this.settings();return {modules:BUILTIN_MODULES.map(m=>({...m,enabled:s.enabled[m.id]!==false})),workflows:s.workflows,mcp:s.mcp.map(({token,...m}:any)=>({...m,tokenConfigured:!!token,connected:this.clients.has(m.id)}))};}
 assert(id:string){if(this.settings().enabled[id]===false)throw Error(`模块 ${id} 已在技能中心停用`);}
 save(input:any){const s=this.settings();if(input.id){if(!BUILTIN_MODULES.some(m=>m.id===input.id)||typeof input.enabled!=='boolean')throw Error('模块开关无效');s.enabled[input.id]=input.enabled;}
   atomicJson(join(this.store.data,'modules.json'),s);return this.status();}
 workflow(input:any){const s=this.settings(),id=input.id??randomUUID(),old=s.workflows.find(w=>w.id===id);if(input.remove){s.workflows=s.workflows.filter(w=>w.id!==id);}else{if(!['web','android','game'].includes(input.scope))throw Error('技能任务类型无效');const w={id,name:text(input.name,80),goal:text(input.goal,2000),scope:input.scope,minutes:input.minutes??10,version:(old?.version??0)+1,enabled:input.enabled!==false};if(!w.name||!w.goal||!Number.isInteger(w.minutes)||w.minutes<1||w.minutes>30)throw Error('技能参数无效');if(!old&&s.workflows.length>=50)throw Error('技能最多50个');s.workflows=[w,...s.workflows.filter(x=>x.id!==id)];}atomicJson(join(this.store.data,'modules.json'),s);return this.status();}
 async saveMcp(input:any){const s=this.settings(),id=input.id??randomUUID(),old=s.mcp.find(x=>x.id===id);if(input.remove){await this.clients.get(id)?.close();this.clients.delete(id);s.mcp=s.mcp.filter(x=>x.id!==id);}else{const u=new URL(input.url);if(u.username||u.password||!(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw Error('MCP需HTTPS或本机HTTP地址');if(!Array.isArray(input.allowedTools)||input.allowedTools.length>50||input.allowedTools.some((v:any)=>typeof v!=='string'||v.length>100))throw Error('请指定允许调用的工具名');if(!old&&s.mcp.length>=10)throw Error('MCP最多10个');s.mcp=[{id,name:text(input.name,80),url:u.href,enabled:input.enabled===true,allowedTools:input.allowedTools,token:input.token===undefined?old?.token:text(input.token,4096)},...s.mcp.filter(x=>x.id!==id)];await this.clients.get(id)?.close();this.clients.delete(id);}atomicJson(join(this.store.data,'modules.json'),s);return this.status();}
 async connect(id:string){const c=this.settings().mcp.find(x=>x.id===id&&x.enabled);if(!c)throw Error('MCP未启用');let client=this.clients.get(id);if(!client){client=new Client({name:'coco',version:'0.2.0'},{capabilities:{}});await client.connect(new StreamableHTTPClientTransport(new URL(c.url),{requestInit:{headers:c.token?{Authorization:`Bearer ${c.token}`}:{}}}),{timeout:10000});this.clients.set(id,client);}return client;}
 async mcpTools(id:string){const result=await (await this.connect(id)).listTools({}, {timeout:10000});return result.tools.map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema}));}
 async call(id:string,name:string,args:any){const c=this.settings().mcp.find(x=>x.id===id&&x.enabled);if(!c?.allowedTools.includes(name))throw Error('此MCP工具未由管理员启用');return (await this.connect(id)).callTool({name,arguments:args??{}},undefined,{timeout:30000});}
 async close(){await Promise.allSettled([...this.clients.values()].map(c=>c.close()));this.clients.clear();}
}
