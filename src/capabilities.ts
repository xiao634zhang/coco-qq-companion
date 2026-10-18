import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { freemem } from 'node:os';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { Store, readJson, atomicJson, text } from './store.ts';
import { functionTool, toolResult, type ToolContent } from './tool-result.ts';
import { WebBrowser, browserPath } from './web-browser.ts';
import { Phone } from './phone.ts';
import { SocialCLI } from './social-cli.ts';

export interface AbilitySettings {web:boolean;android:boolean;game:boolean;serial:string;minutes:number;maxActions:number;visionModels:string[]}
export const DEFAULT_ABILITIES:AbilitySettings={web:false,android:false,game:false,serial:'',minutes:10,maxActions:60,visionModels:[]};
const str={type:'string'},num={type:'integer'};
export const ACTION_TOOLS=[
  functionTool('web_social_feed','通过已授权本机CLI读取小红书或知乎推荐流。知乎还可选 hot 热榜，不需要模拟器。',{platform:{type:'string',enum:['xhs','zhihu']},mode:{type:'string',enum:['recommended','hot']}},['platform']),
  functionTool('web_social_search','通过已授权CLI搜索小红书或知乎，返回内容ID。',{platform:{type:'string',enum:['xhs','zhihu']},query:str},['platform','query']),
  functionTool('web_social_read','通过已授权CLI读取搜索/推荐中实际返回的ID。小红书kind=note，也支持管理员提供的完整官方分享URL，保留其链接签名；知乎kind=answer/question。读取失败不能直接判断登录过期。',{platform:{type:'string',enum:['xhs','zhihu']},kind:{type:'string',enum:['note','answer','question']},id:str},['platform','kind','id']),
  functionTool('web_open','打开公开网页 URL。',{url:str},['url']),
  functionTool('web_read','读取当前网页正文和链接。'),
  functionTool('web_follow','按最近读取的链接编号导航。',{id:num},['id']),
  functionTool('web_scroll','上下滚动并读取页面。',{direction:{type:'string',enum:['up','down']}},['direction']),
  functionTool('web_screenshot','获取当前网页截图，需要视觉能力验证通过。'),
  functionTool('android_open','在选定模拟器的浏览器打开公开网页。玩游戏先打开 https://play2048.co/。',{url:str},['url']),
  functionTool('android_app','启动已在前端启用且已安装的原生App，使用真实包名。',{package:str},['package']),
  functionTool('android_record','录制模拟器画面并返回多张关键帧理解变化，不包含声音。',{seconds:num,frames:num},['seconds','frames']),
  functionTool('android_macro','保存、列出或执行连续动作。最多5步，每一步都占任务动作数；支持tap/swipe/text/key，先观察再用。name为保存名称，play为已有宏名称；不提供actions或play时列出。',{name:str,play:str,actions:{type:'array',maxItems:5,items:{type:'object',properties:{type:{type:'string',enum:['tap','swipe','text','key']},x:num,y:num,x1:num,x2:num,y1:num,y2:num,text:str,key:{type:'string',enum:['back','enter']}},required:['type'],additionalProperties:false}}}),
  functionTool('android_look','读取屏幕结构或截图。坐标操作使用原始屏幕尺寸。',{image:{type:'boolean'}},['image']),
  functionTool('android_tap','点击原始屏幕坐标。',{x:num,y:num},['x','y']),
  functionTool('android_tap_text','按当前可见文字点按。',{text:str},['text']),
  functionTool('android_swipe','按原始屏幕坐标滑动。',{x1:num,y1:num,x2:num,y2:num},['x1','y1','x2','y2']),
  functionTool('android_text','输入文字；中文需要 ADBKeyboard。',{text:str},['text']),
  functionTool('android_key','按返回或回车。',{key:{type:'string',enum:['back','enter']}},['key'])
];
export class Capabilities {
  store:Store;browser:WebBrowser;phone:Phone;social:SocialCLI;
  constructor(store:Store){this.store=store;this.social=new SocialCLI(store.root);process.env.PLAYWRIGHT_BROWSERS_PATH=join(store.root,'.runtime/pw-browsers');this.browser=new WebBrowser(store.root);this.phone=new Phone(store.root);this.phone.serial=this.settings().serial;}
  settings(){return {...DEFAULT_ABILITIES,...readJson<Partial<AbilitySettings>>(join(this.store.data,'abilities.json'),{})};}
  save(input:any){
    const c=this.settings();for(const k of ['web','android','game'] as const)if(input[k]!==undefined){if(typeof input[k]!=='boolean')throw new Error('能力开关无效');c[k]=input[k];}
    for(const [k,min,max] of [['minutes',1,30],['maxActions',1,120]] as const)if(input[k]!==undefined){if(!Number.isInteger(input[k])||input[k]<min||input[k]>max)throw new Error('任务限制超出范围');c[k]=input[k];}
    if(c.game&&!c.android)throw new Error('游戏需要启用安卓');
    atomicJson(join(this.store.data,'abilities.json'),c);return c;
  }
  async select(serial:string){const result=await this.phone.select(serial);const c=this.settings();c.serial=serial;atomicJson(join(this.store.data,'abilities.json'),c);return result;}
  tools(scope:'web'|'android'|'game'){const c=this.settings();return ACTION_TOOLS.filter(t=>scope==='web'?c.web&&t.name.startsWith('web_'):c.android&&t.name.startsWith('android_'));}
  async status(){let devices:any[]=[],error='';try{devices=await this.phone.devices();}catch(e){error=String(e).slice(0,300);}return {settings:this.settings(),social:this.social.status(),browserInstalled:!!browserPath(this.store.root),adbInstalled:existsSync(this.phone.adb),freeMemoryGB:Math.round(freemem()/2**30*10)/10,devices,error};}
  vision(model:string){if(!this.settings().visionModels.includes(model))throw new Error('请先在能力页面验证当前模型的截图理解');}
  markVision(model:string){const c=this.settings();c.visionModels=[...new Set([...c.visionModels,model])];atomicJson(join(this.store.data,'abilities.json'),c);}
  snapshot(bytes:Buffer){writeFileSync(join(this.store.data,'latest-task.png'),bytes);return createHash('sha256').update(bytes).digest('hex');}
  async execute(name:string,args:any,scope:'web'|'android'|'game',model:string){
    if(!this.tools(scope).some(t=>t.name===name))throw new Error('此任务未开放该工具');
    if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('参数无效');
    let value:any,image:Buffer|undefined;
    if(name==='web_social_feed')value=await this.social.feed(args);
    else if(name==='web_social_search')value=await this.social.search(args);
    else if(name==='web_social_read')value=await this.social.read(args);
    else if(name==='web_search')value=await this.browser.search(text(args.query,300));
    else if(name==='web_open'){const url=text(args.url,2000),host=new URL(url).hostname;const platform=['xiaohongshu.com','www.xiaohongshu.com','xhslink.cn','xhslink.com','www.xhslink.com'].includes(host)?'xhs':['zhihu.com','www.zhihu.com','zhuanlan.zhihu.com'].includes(host)?'zhihu':null;if(platform){const cookies=await this.social.browserCookies(platform);if(cookies.length){await this.browser.start();await this.browser.context!.addCookies(cookies);}}value=await this.browser.open(url);}
    else if(name==='web_read')value=await this.browser.read();
    else if(name==='web_follow'){if(!Number.isInteger(args.id))throw new Error('链接编号无效');value=await this.browser.follow(args.id);}
    else if(name==='web_scroll'){if(!['up','down'].includes(args.direction))throw new Error('方向无效');value=await this.browser.scroll(args.direction);}
    else if(name==='web_screenshot'){this.vision(model);image=await this.browser.screenshot();value={image:'当前网页截图'};}
    else{
      if(!this.settings().serial)throw new Error('请在能力页面选择模拟器设备');
      if(name==='android_open')value=await this.phone.open(text(args.url,2000));
      else if(name==='android_app')value=await this.phone.openApp(text(args.package,150));
      else if(name==='android_record'){this.vision(model);const content=await this.phone.record(args.seconds,args.frames);return {contentItems:content.flatMap<ToolContent>(c=>c.type==='image'?[{type:'inputImage',imageUrl:'data:'+c.mimeType+';base64,'+c.data}]:c.type==='text'?[{type:'inputText',text:c.text}]:[])};}
      else if(name==='android_look'){
        if(args.image!==true&&args.image!==false)throw new Error('请指定是否截图');
        if(args.image){this.vision(model);const r=await this.phone.call('phone_screenshot',{});image=r.image;if(!image)throw new Error('设备未返回截图');value={...await this.phone.dimensions(),notice:'截图可能已缩放；点按使用这里的原始尺寸换算坐标。'};}
        else value=(await this.phone.call('phone_dump',{max:80})).text;
      }else{
        const d=await this.phone.dimensions();
        for(const key of ['x','x1','x2','y','y1','y2'])if(args[key]!==undefined&&(!Number.isInteger(args[key])||args[key]<0||args[key]>=(key.startsWith('x')?d.width:d.height)))throw new Error('坐标超出屏幕');
        const mapping:Record<string,string>={android_tap:'phone_tap',android_tap_text:'phone_tap_text',android_swipe:'phone_swipe',android_text:'phone_text',android_key:'phone_key'};
        const actual=mapping[name];if(!actual)throw new Error('工具未开放');
        if(name==='android_key'&&!['back','enter'].includes(args.key))throw new Error('按键未开放');
        if(name==='android_text'||name==='android_tap_text')args={text:text(args.text,500)};
        value=(await this.phone.call(actual,args)).text;
      }
    }
    if(image)this.snapshot(image);
    return toolResult(value,image);
  }
  async visionImage(){
    const svg='<svg width="400" height="220"><rect width="400" height="220" fill="white"/><circle cx="80" cy="110" r="45" fill="red"/><rect x="230" y="65" width="90" height="90" fill="blue"/></svg>';
    return sharp(Buffer.from(svg)).png().toBuffer();
  }
  cleanup(){for(const dir of ['phone-shots']){const base=join(this.store.data,dir);if(!existsSync(base))continue;for(const f of readdirSync(base)){const p=join(base,f);if(/^shot-.*\.png$/.test(f)&&Date.now()-statSync(p).mtimeMs>7*86400000)unlinkSync(p);}}}
  async close(){await Promise.allSettled([this.browser.close(),this.phone.close()]);}
}
