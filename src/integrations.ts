import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'node:path';
import { functionTool, toolResult } from './tool-result.ts';
import { atomicJson, readJson, shanghai, text } from './store.ts';
import type { Companion } from './companion.ts';

export const MUSIC_ACTIONS=['ncm_search','ncm_now','ncm_comments','music_lyrics','ncm_room'] as const;
export const INTEGRATION_TOOLS=[
 functionTool('companion_music','网易云只读：搜歌、播放状态、评论、歌词和一起听状态。需要网易云PC客户端调试端口9222。先用 describe 查询 action 所需参数再调用。尚未授权播放控制或房间发言。',{action:{type:'string',enum:[...MUSIC_ACTIONS]},args:{type:'object',additionalProperties:true},describe:{type:'boolean'}},['action']),
 functionTool('companion_qzone','QQ空间：feeds好友动态、posts指定QQ说说、like点赞、comment评论、post发说说。写操作仅在管理员明确提出具体要求时执行，失败或超时不重发。',{action:{type:'string',enum:['feeds','posts','like','comment','post']},qq:{type:'string'},tid:{type:'string'},content:{type:'string'}},['action'])
];
export class Integrations {
 client?:Client;transport?:StdioClientTransport;connecting?:Promise<void>;
 app:Companion;constructor(app:Companion){this.app=app;}
 async start(){if(this.client)return;if(this.connecting)return this.connecting;this.connecting=this.connect();try{await this.connecting;}finally{this.connecting=undefined;}}
 async connect(){const root=this.app.store.root;const transport=new StdioClientTransport({command:process.execPath,args:[join(root,'vendor/phone-mcp/src/phone-mcp.js')],cwd:root,env:{...Object.fromEntries(Object.entries(process.env).filter(([,v])=>v!==undefined)) as Record<string,string>,PHONE_SHOT_DIR:join(root,'data/phone-shots'),PHONE_MACRO_FILE:join(root,'data/phone-macros.json')},stderr:'pipe'});const client=new Client({name:'coco-integrations',version:'1.0.0'});try{await client.connect(transport);this.transport=transport;this.client=client;}catch(e){await transport.close();throw e;}}
 async music(args:any){if(!this.app.extensions.settings().music)throw Error('网易云功能已关闭');if(!MUSIC_ACTIONS.includes(args.action))throw Error('音乐操作无效');await this.start();if(args.describe){const list=await this.client!.listTools();return toolResult(list.tools.find(t=>t.name===args.action));}const result=await this.client!.callTool({name:args.action,arguments:args.args??{}},undefined,{timeout:45000});if(result.isError)throw Error(JSON.stringify(result.content).slice(0,500));return toolResult(result.content);}
 async qzone(args:any){if(!this.app.extensions.settings().qzone)throw Error('QQ空间功能已关闭');const a=args.action;let method='',payload:any={};const qq=args.qq??this.app.store.config().ownerQQ;if(!/^\d{5,12}$/.test(qq))throw Error('QQ号无效');
  if(a==='feeds'){method='get_qzone_feeds';payload={page_num:1,count:10};}
  else if(a==='posts'){method='get_qzone_msg_list';payload={target_uin:Number(qq),num:5};}
  else if(['like','comment','post'].includes(a)){
   const file=join(this.app.store.data,'qzone-usage.json'),state=readJson<{day:string;hits:{at:number;action:string}[]}>(file,{day:shanghai().day,hits:[]});if(state.day!==shanghai().day){state.day=shanghai().day;state.hits=[];}const now=Date.now(),hits=state.hits.filter(h=>h.action===a);
   if(hits.length>=(a==='comment'?3:a==='post'?8:20)||hits.some(h=>now-h.at<(a==='comment'?600000:60000)))throw Error('空间操作达到频率或每日上限');
   if(a!=='post'&&!/^[\w.-]{1,150}$/.test(args.tid??''))throw Error('请先读取空间并使用真实tid');
   if(a==='like'){method='like_qzone';payload={tid:args.tid,target_uin:Number(qq)};}else if(a==='comment'){method='comment_qzone';payload={tid:args.tid,target_uin:Number(qq),content:text(args.content,1000)};}else{method='send_qzone_msg';payload={content:text(args.content,2000)};}
   if(a!=='like'&&!payload.content)throw Error('内容不能为空');state.hits.push({at:now,action:a});atomicJson(file,state);
  }else throw Error('空间操作无效');
  const result=await this.app.qq.api(method,payload);if(result.status!=='ok')throw Error(`QQ空间接口未成功：${result.retcode??'未知'}；当前网关可能不支持此接口`);const raw=JSON.stringify(result.data??{});return toolResult(raw.length>16000?{notice:'结果较长，仅返回前16000字符；未显示部分不可推断。',text:raw.slice(0,16000)}:result.data);
 }
 async close(){await this.client?.close();await this.transport?.close();this.client=undefined;}
}
