import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import type {ServerResponse} from 'node:http';
import type {Companion} from './companion.ts';
import {VoiceConversation} from './voice.ts';
import {Avatar} from './avatar.ts';
import {readJson} from './store.ts';
const sessions=new WeakMap<Companion,{voice:VoiceConversation;avatar:Avatar}>();
function runtime(app:Companion){let value=sessions.get(app);if(!value){value={voice:new VoiceConversation(app),avatar:new Avatar(app.store)};sessions.set(app,value);}return value;}
export async function growthHttp(app:Companion,method:string,route:string,url:URL,data:any,res:ServerResponse){
 const send=(value:any)=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));return true;};
 if(method==='GET'){
  if(route==='/api/recall')return send({items:app.recall.sync(),interests:app.recall.interests(),semanticReady:!!app.recall.embed,lastError:app.recall.lastError});
  if(route==='/api/modules')return send(app.modules.status());
  if(route==='/api/journeys')return send({tasks:app.journeys.progress(app),favorites:app.journeys.favorites(),login:readJson(join(app.store.data,'platform-health.json'),{})});
  if(route==='/api/minecraft')return send(app.minecraft.status());
  if(route==='/api/avatar'){app.modules.assert('avatar');return send(runtime(app).avatar.settings());}
  if(route==='/api/avatar/asset'){app.modules.assert('avatar');const {bytes,mime}=runtime(app).avatar.read(url.searchParams.get('path')??'');res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});res.end(bytes);return true;}
 }
 if(method!=='POST')return false;
 if(route==='/api/recall/search'){app.modules.assert('recall');return send(await app.recall.search(data.query));}
 if(route==='/api/recall/warm'){app.modules.assert('recall');await app.recall.encoder();return send({ready:true});}
 if(route==='/api/recall/save'){const result=app.recall.save(data);app.reset();return send(result);}
 if(route==='/api/recall/forget'){const result=app.recall.forget(data.id);app.reset();return send(result);}
 if(route==='/api/interests/save')return send(data.remove?app.recall.removeInterest(data.id):app.recall.interest(data));
 if(route==='/api/favorites/save')return send(app.journeys.favorite(data));
 if(route==='/api/journeys/resume')return send(app.journeys.resume(app,data));
 if(route==='/api/modules/save'){const result=app.modules.save(data);if(data.enabled===false){if(data.id==='minecraft')app.minecraft.disconnect();if(data.id==='web')app.tasks.stop('网页模块已停用','web');if(data.id==='android')app.tasks.stop('安卓模块已停用','android');if(data.id==='voice')runtime(app).voice.interrupt();}return send(result);}
 if(route==='/api/workflows/save')return send(app.modules.workflow(data));
 if(route==='/api/workflows/run'){const w=app.modules.settings().workflows.find(x=>x.id===data.id&&x.enabled);if(!w)throw Error('技能不存在或未启用');return send(app.tasks.start(w,'local'));}
 if(route==='/api/mcp/save')return send(await app.modules.saveMcp(data));
 if(route==='/api/mcp/tools')return send({tools:await app.modules.mcpTools(data.id)});
 if(route==='/api/minecraft/save')return send(app.minecraft.save(data));
 if(route==='/api/minecraft/connect'){app.modules.assert('minecraft');return send(app.minecraft.connect());}
 if(route==='/api/minecraft/disconnect')return send(app.minecraft.disconnect());
 if(route==='/api/minecraft/action'){app.modules.assert('minecraft');if(app.store.state().paused&&data.action!=='stop')throw Error('伙伴已暂停');return send(await app.minecraft.run(data));}
 if(route==='/api/avatar/save'){app.modules.assert('avatar');return send(runtime(app).avatar.save(data));}
 if(route==='/api/avatar/import'){app.modules.assert('avatar');return send(runtime(app).avatar.import(data));}
 if(route==='/api/voice/interrupt')return send(runtime(app).voice.interrupt());
 if(route==='/api/voice/stream'){await runtime(app).voice.stream(data,res);return true;}
 return false;
}
export function growthAsset(root:string,route:string){
 const files:Record<string,[string,string]>={'/growth.js':['public/growth.js','text/javascript'],'/voice.js':['public/voice.js','text/javascript'],'/avatar.js':['public/avatar.js','text/javascript'],'/avatar.html':['public/avatar.html','text/html'],'/vendor/pixi.js':['node_modules/pixi.js/dist/browser/pixi.min.js','text/javascript'],'/vendor/live2d.js':['public/vendor/live2d-cubism4.js','text/javascript']};
 if(route==='/avatar-core.js')files[route]=['.runtime/avatar/live2dcubismcore.min.js','text/javascript'];
 const value=files[route];if(!value)return null;const path=join(root,value[0]);if(!existsSync(path))throw Error('组件文件缺失');return {bytes:readFileSync(path),mime:value[1]};
}
