import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'node:path';
import { functionTool, toolResult } from './tool-result.ts';
import { atomicJson, readJson, shanghai, text } from './store.ts';
import type { Companion } from './companion.ts';

export const MUSIC_ACTIONS=['ncm_search','ncm_now','ncm_comments','music_lyrics','ncm_room'] as const;
export const INTEGRATION_TOOLS=[
 functionTool('companion_music','网易云只读：搜歌、播放状态、评论、歌词和一起听状态。需要网易云PC客户端调试端口9222。先用 describe 查询 action 所需参数再调用。尚未授权播放控制或房间发言。',{action:{type:'string',enum:[...MUSIC_ACTIONS]},args:{type:'object',additionalProperties:true},describe:{type:'boolean'}},['action']),
 functionTool('companion_qzone','QQ空间：feeds好友动态、posts指定QQ说说、like点赞、comment评论、post发说说。可传管理员提供的完整说说url定位目标；abstime使用读取到的发表时间。写操作仅在管理员明确提出具体要求时执行，失败或超时不重发。',{action:{type:'string',enum:['feeds','posts','like','comment','post']},qq:{type:'string'},tid:{type:'string'},url:{type:'string'},abstime:{type:'integer',minimum:0},content:{type:'string'}},['action'])
];
export class Integrations {
 client?:Client;transport?:StdioClientTransport;connecting?:Promise<void>;
 app:Companion;constructor(app:Companion){this.app=app;}
 postTimes=new Map<string,number>();
 rememberPosts(qq:string,data:any){for(const p of data?.msglist??[]){if(/^[\w.-]{1,150}$/.test(p.tid??'')){this.postTimes.set(qq+':'+p.tid,Number(p.time??p.created_time??0));if(this.postTimes.size>200)this.postTimes.delete(this.postTimes.keys().next().value!);}}return data;}
 async posts(qq:string){
  let primary:any;try{primary=await this.app.qq.api('get_qzone_msg_list',{target_uin:Number(qq),num:5});}catch{}
  if(primary?.status==='ok'&&Array.isArray(primary.data?.msglist))return this.rememberPosts(qq,primary.data);
  // Only the read path falls back. Never retry a write through another endpoint.
  let fallback:any;try{fallback=await this.app.qq.api('get_qzone_feeds',{page_num:1,count:20});}catch{}
  if(fallback?.status==='ok'&&Array.isArray(fallback.data?.feeds)){
   const posts=fallback.data.feeds.filter((p:any)=>String(p.uin)===qq&&Number(p.appid)===311&&/^[\w.-]{1,150}$/.test(p.key??'')).slice(0,5).map((p:any)=>({tid:p.key,uin:qq,time:Number(p.time??0),content:String(p.html??'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,' ').slice(0,2500),url:`https://user.qzone.qq.com/${qq}/mood/${p.key}`}));
   if(posts.length)return this.rememberPosts(qq,{msglist:posts,source:'recent_friend_feeds',partial:true,notice:'原空间列表接口失败，下面仅为最近好友动态中已核对作者的说说，不代表完整列表。'});
  }
  throw Error('空间说说列表读取失败，最近动态中也未找到该账号的说说；请提供具体说说链接以便定位点赞，或检查小号是否有访问权限。尚未执行点赞。');
 }
 async start(){if(this.client)return;if(this.connecting)return this.connecting;this.connecting=this.connect();try{await this.connecting;}finally{this.connecting=undefined;}}
 async connect(){const root=this.app.store.root;const transport=new StdioClientTransport({command:process.execPath,args:[join(root,'vendor/phone-mcp/src/phone-mcp.js')],cwd:root,env:{...Object.fromEntries(Object.entries(process.env).filter(([,v])=>v!==undefined)) as Record<string,string>,PHONE_SHOT_DIR:join(root,'data/phone-shots'),PHONE_MACRO_FILE:join(root,'data/phone-macros.json')},stderr:'pipe'});const client=new Client({name:'coco-integrations',version:'1.0.0'});try{await client.connect(transport);this.transport=transport;this.client=client;}catch(e){await transport.close();throw e;}}
 async music(args:any){if(!this.app.extensions.settings().music)throw Error('网易云功能已关闭');if(!MUSIC_ACTIONS.includes(args.action))throw Error('音乐操作无效');await this.start();if(args.describe){const list=await this.client!.listTools();return toolResult(list.tools.find(t=>t.name===args.action));}const result=await this.client!.callTool({name:args.action,arguments:args.args??{}},undefined,{timeout:45000});if(result.isError)throw Error(JSON.stringify(result.content).slice(0,500));return toolResult(result.content);}
 async qzone(args:any){if(!this.app.extensions.settings().qzone)throw Error('QQ空间功能已关闭');args={...args};if(args.url){const target=qzoneTarget(args.url);if(args.qq&&args.qq!==target.qq||args.tid&&args.tid!==target.tid)throw Error('说说链接与目标账号或tid不一致');args.qq=target.qq;args.tid=target.tid;}const a=args.action;let method='',payload:any={};const qq=args.qq??this.app.store.config().ownerQQ;if(!/^\d{5,12}$/.test(qq))throw Error('QQ号无效');
  if(a==='feeds'){method='get_qzone_feeds';payload={page_num:1,count:10};}
  else if(a==='posts')return toolResult(await this.posts(qq));
  else if(['like','comment','post'].includes(a)){
   const file=join(this.app.store.data,'qzone-usage.json'),state=readJson<{day:string;hits:{at:number;action:string}[]}>(file,{day:shanghai().day,hits:[]});if(state.day!==shanghai().day){state.day=shanghai().day;state.hits=[];}const now=Date.now(),hits=state.hits.filter(h=>h.action===a);
   if(hits.length>=(a==='comment'?3:a==='post'?8:20)||hits.some(h=>now-h.at<(a==='comment'?600000:60000)))throw Error('空间操作达到频率或每日上限');
   if(a!=='post'&&!/^[\w.-]{1,150}$/.test(args.tid??''))throw Error('请先读取空间并使用真实tid');
   if(a==='like'){const abstime=args.abstime??this.postTimes.get(qq+':'+args.tid)??0;if(!Number.isSafeInteger(abstime)||abstime<0)throw Error('说说发表时间无效');method='like_qzone';payload={tid:args.tid,target_uin:Number(qq),abstime};}else if(a==='comment'){method='comment_qzone';payload={tid:args.tid,target_uin:Number(qq),content:text(args.content,1000)};}else{method='send_qzone_msg';payload={content:text(args.content,2000)};}
   if(a!=='like'&&!payload.content)throw Error('内容不能为空');state.hits.push({at:now,action:a});atomicJson(file,state);
  }else throw Error('空间操作无效');
  const result=await this.app.qq.api(method,payload);if(result.status!=='ok'||typeof result.data?.code==='number'&&result.data.code!==0||typeof result.data?.subcode==='number'&&result.data.subcode!==0)throw Error(`QQ空间接口未成功：${result.retcode??'未知'}；未确认成功，不自动重试；可能涉及登录、访问权限或接口兼容`);const raw=JSON.stringify(result.data??{});return toolResult(raw.length>16000?{notice:'结果较长，仅返回前16000字符；未显示部分不可推断。',text:raw.slice(0,16000)}:result.data??{success:true,action:a,qq,...(args.tid?{tid:args.tid}:{})});
 }
 async close(){await this.client?.close();await this.transport?.close();this.client=undefined;}
}
export function qzoneTarget(value:string){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!['user.qzone.qq.com','h5.qzone.qq.com'].includes(u.hostname))throw Error('请使用完整的QQ空间官方说说链接');const mood=u.pathname.match(/^\/(\d{5,12})\/mood\/([\w.-]{1,150})\/?$/);const qq=mood?.[1]??u.searchParams.get('uin')??'',tid=mood?.[2]??u.searchParams.get('tid')??u.searchParams.get('cellid')??'';if(!/^\d{5,12}$/.test(qq)||!/^[\w.-]{1,150}$/.test(tid))throw Error('链接中未找到账号和说说tid，请复制完整说说链接');return {qq,tid};}
