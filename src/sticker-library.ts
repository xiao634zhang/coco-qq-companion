import {fetch,ProxyAgent} from 'undici';
import type {Stickers} from './stickers.ts';
export const STICKER_SOURCE='https://github.com/zhaoolee/ChineseBQB';
const PACKS={
 panda:{name:'熊猫头常用梗图',folder:'015Golden_Curator_Panda金馆长熊猫🐼BQB',prefix:'金馆长熊猫',files:[
 '00003-邪魅一望.png','00004-敲桌子.gif','00007-喝可乐.gif','00008-快乐.gif',
 '00013-饭碗掉了.gif','00016-不过如此.jpg','00017-生气.jpg','00019-疯狂暗示.jpg',
 '00022-缓缓地喝着龙井枸杞党参.jpg','00024-捂住嘴哭.jpg','00025-懒惰成性.jpg','00028-摸头耳朵.gif',
 '00029-那我加1.gif','00035-盘它.jpg','00037-搬砖问号.jpg','00040-我错了-下次还敢.jpg',
 '00041-无语.jpg','00050-震惊.jpg','00061-这就是强者的世界吗.gif','00063-我心砰砰砰跳.gif',
 '00064-灵魂快要出窍.gif','00076-糟了是心动的感觉.gif','00082-挠头.gif','00083-舒服.gif',
 ]},
 cats:{name:'猫猫反应图与动图',folder:'010Cat_是喵星人啦🐱BQB',prefix:'是喵星人啦',files:[
 '00001-看直播猫.gif','00004-震惊猫.gif','00006-我的悲伤打个有这么大猫.jpeg','00007-凉了猫.jpeg',
 '00008-瘫会儿猫.jpg','00010-哭了猫.jpg','00011-困哈欠猫.gif','00012-我哭了你呢猫.jpg',
 '00013-猫喝牛奶猫.jpg','00014-猫问号-疑问猫.jpg','00015-困苦猫.gif','00019-喵瞪口呆猫.png',
 '00020-左右摇摆扭起来-左手右手一个慢动作猫.gif','00023-揉脸猫.gif','00024-爱心猫.jpg','00025-害羞猫.png',
 '00027-惆怅猫.jpg','00028-锤桌子猫.gif','00031-擦眼泪猫.jpg','00035-我累了猫.jpg',
 '00037-探头偷看猫.gif','00038-你凶我猫.jpg','00041-敲键盘猫.gif','00043-点头如捣蒜猫.gif',
 ]},
};
export function stickerPacks(){return Object.entries(PACKS).map(([id,p])=>({id,name:p.name,count:p.files.length,source:STICKER_SOURCE}));}
export function packEntries(id:string){const p=PACKS[id as keyof typeof PACKS];if(!p)throw Error('未知表情库');return p.files.map(file=>({
 id:'bqb-'+id+'-'+file.slice(0,5),name:(id==='panda'?'熊猫头·':'猫猫·')+file.replace(/^\d+-|\.[^.]+$/g,''),
 tags:[id==='panda'?'熊猫头':'猫猫',...file.replace(/^\d+-|\.[^.]+$/g,'').split('-')],
 url:'https://raw.githubusercontent.com/zhaoolee/ChineseBQB/master/'+[p.folder,p.prefix+file].map(encodeURIComponent).join('/'),
}));}
export async function installStickerPack(stickers:Stickers,id:string,download?:(url:string)=>Promise<Buffer>){
 const entries=packEntries(id),proxy=process.env.HTTPS_PROXY||process.env.HTTP_PROXY,agent=proxy&&!download?new ProxyAgent(proxy):undefined;
 const failures:string[]=[];let installed=0,existing=0;
 try{for(const e of entries){if(stickers.all().some(x=>x.id===e.id)){existing++;continue;}
  try{let bytes:Buffer;
   if(download)bytes=await download(e.url);
   else{const r=await fetch(e.url,{dispatcher:agent,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('下载失败 '+r.status);const chunks:Buffer[]=[];let size=0;for await(const chunk of r.body!){size+=chunk.length;if(size>8*1024*1024)throw Error('图片超过8 MB');chunks.push(Buffer.from(chunk));}bytes=Buffer.concat(chunks);}
   await stickers.import({name:e.name,tags:e.tags,data:bytes.toString('base64'),source:e.url,pack:id},e.id);installed++;
  }catch(error){failures.push(e.name+': '+String(error));}
 }}finally{await agent?.close();}
 return {installed,existing,failures,message:`已导入${installed}张，已有${existing}张，失败${failures.length}张`};
}
