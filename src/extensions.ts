import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Store, atomicJson, readJson, text } from './store.ts';
import { functionTool } from './tool-result.ts';

export const DEFAULT_EXTENSIONS={humanize:true,typing:true,maxParts:3,groups:[] as string[],poke:true,music:true,qzone:true,autoDiary:true,voiceInput:true,voiceReply:false,voice:'kokoro:zf_001',whisperModel:'small',apps:['com.android.browser','com.android.chrome','com.ss.android.ugc.aweme','com.ss.android.ugc.aweme.mobile','com.xingin.xhs','com.zhihu.android'],eveningReview:false};
export type ExtensionSettings=typeof DEFAULT_EXTENSIONS;
export interface Experience {id:string;at:string;taskId:string;title:string;summary:string;links:string[];diaryId?:string}
export const EXPERIENCE_TOOLS=[functionTool('companion_experience_list','查找自己实际浏览、玩游戏的经历，包含来源与时间。',{query:{type:'string'}})];
export class Extensions {
  store:Store;constructor(store:Store){this.store=store;}
  settings():ExtensionSettings{return {...DEFAULT_EXTENSIONS,...readJson(join(this.store.data,'extensions.json'),{})};}
  save(input:any){const c=this.settings();for(const k of ['humanize','typing','poke','music','qzone','autoDiary','voiceInput','voiceReply','eveningReview'] as const)if(input[k]!==undefined){if(typeof input[k]!=='boolean')throw Error('开关格式无效');c[k]=input[k];}
    if(input.maxParts!==undefined){if(!Number.isInteger(input.maxParts)||input.maxParts<1||input.maxParts>4)throw Error('分条上限为1–4');c.maxParts=input.maxParts;}
    for(const k of ['groups','apps'] as const)if(input[k]!==undefined){if(!Array.isArray(input[k])||input[k].length>50||input[k].some((v:any)=>typeof v!=='string'||!(k==='groups'?/^\d{5,12}$/:/^[a-zA-Z][\w]*(?:\.[\w]+)+$/).test(v)))throw Error('群号或应用包名格式无效');c[k]=[...new Set(input[k])] as string[];}
    if(input.voice!==undefined){if(input.voice!=='sapi'&&!/^kokoro:zf_\d{3}$/.test(input.voice)&&!/^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(input.voice))throw Error('音色标识无效');c.voice=input.voice;}
    if(input.whisperModel!==undefined){if(!['tiny','base','small','medium','large-v3'].includes(input.whisperModel))throw Error('识别模型无效');c.whisperModel=input.whisperModel;}
    atomicJson(join(this.store.data,'extensions.json'),c);return c;
  }
  experiences(query=''){return this.store.lines('experiences.jsonl').filter((e:any)=>!query||JSON.stringify(e).includes(query)).slice(-100).reverse() as Experience[];}
  remember(task:{id:string;goal:string;summary:string;status:string;category:string}){
    if(task.status!=='completed'||task.category.startsWith('development.')||!task.summary||this.experiences().some(e=>e.taskId===task.id))return;
    const e:Experience={id:randomUUID(),at:new Date().toISOString(),taskId:task.id,title:task.goal.slice(0,120),summary:task.summary.slice(0,3000),links:[...new Set(task.summary.match(/https?:\/\/[^\s<>\)\]）]+/g)??[])].slice(0,12)};
    if(this.settings().autoDiary)try{const d=this.store.diary(`我完成了：${e.title}\n${e.summary}`.slice(0,2000),'浏览与游戏');e.diaryId=d.id;}catch(error){this.store.log('experience.diary_skipped',String(error));}
    this.store.append('experiences.jsonl',e);
  }
  status(){return {settings:this.settings(),mediaPythonInstalled:existsSync(join(this.store.root,'.runtime/media-python/Scripts/python.exe')),experiences:this.experiences()};}
}
export function splitReply(value:string,max=3){let parts=value.trim().split(/\n\s*\n|\n/).map(s=>s.trim()).filter(Boolean);if(parts.length===1&&value.length>100)parts=parts[0].split(/(?<=[。！？])(?=[^”’」])/u).filter(Boolean);if(parts.length<=max)return parts;return [...parts.slice(0,max-1),parts.slice(max-1).join('\n')];}
