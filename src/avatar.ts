import {join,resolve,sep,extname,dirname} from 'node:path';
import {existsSync,mkdirSync,writeFileSync,readFileSync,realpathSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Store,atomicJson,readJson} from './store.ts';
import {unzipSync} from 'fflate';
export class Avatar {
 store:Store;root:string;
 constructor(store:Store){this.store=store;this.root=join(store.root,'.runtime','avatar');mkdirSync(this.root,{recursive:true});}
 settings(){return readJson<{mode:'builtin'|'live2d';model:string;scale:number}>(join(this.store.data,'avatar.json'),{mode:'builtin',model:'',scale:0.7});}
 save(input:any){if(!['builtin','live2d'].includes(input.mode)||!Number.isFinite(input.scale)||input.scale<0.1||input.scale>3)throw Error('形象参数无效');const model=String(input.model??'');if(input.mode==='live2d'){this.file(model);if(!/\.model3?\.json$/i.test(model))throw Error('请选取model.json或model3.json');if(!existsSync(join(this.root,'live2dcubismcore.min.js')))throw Error('请先导入官方Cubism Core运行库');}const c={mode:input.mode,model,scale:input.scale};atomicJson(join(this.store.data,'avatar.json'),c);return c;}
 file(name:string){if(!name||name.includes('\\')||name.split('/').some(p=>p==='..'||!p)||!['.json','.png','.jpg','.jpeg','.webp','.moc','.moc3','.mtn','.js'].includes(extname(name).toLowerCase()))throw Error('形象文件路径无效');const path=resolve(this.root,name);if(!path.startsWith(resolve(this.root)+sep)||!existsSync(path)||!realpathSync(path).startsWith(realpathSync(this.root)+sep))throw Error('形象文件不存在');return path;}
 import(input:any){const bytes=Buffer.from(input.data??'','base64');if(!bytes.length||bytes.length>30*1024*1024)throw Error('形象文件不超过30MB');if(input.name==='live2dcubismcore.min.js'){writeFileSync(join(this.root,input.name),bytes);return {core:true};}if(!String(input.name).endsWith('.zip'))throw Error('模型请使用ZIP文件');let total=0;const items=unzipSync(bytes,{filter:e=>{total+=e.originalSize;if(total>100*1024*1024||e.originalSize>30*1024*1024)throw Error('解压后模型过大');return !e.name.endsWith('/');}}),folder=randomUUID(),models:string[]=[];
   for(const [name,data] of Object.entries(items)){if(name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>p==='..'||!p)||!/\.(json|png|jpe?g|webp|moc3?|mtn)$/i.test(name))continue;const file=join(this.root,folder,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,data);if(/\.model3?\.json$/i.test(name))models.push(folder+'/'+name);}
   return {models,message:'已导入模型文件，请选择其中的model3.json。模型授权与官方Cubism Core运行库需自行提供。'};
 }
 read(name:string){const file=this.file(name);return {bytes:readFileSync(file),mime:extname(file)==='.json'?'application/json':extname(file)==='.js'?'text/javascript':['.png','.jpg','.jpeg','.webp'].includes(extname(file))?'image/'+(extname(file)==='.jpg'?'jpeg':extname(file).slice(1)):'application/octet-stream'};}
}
