import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import { publicURL } from './web-browser.ts';
const exec=promisify(execFile);
export class Phone {
  root:string;adb:string;userHome:string;serial='';client?:Client;transport?:StdioClientTransport;
  constructor(root:string){this.root=root;this.adb=join(root,'.runtime/platform-tools/adb.exe');this.userHome=join(root,'data/android-user');mkdirSync(this.userHome,{recursive:true});}
  async run(args:string[],target=true){if(target&&!this.serial)throw new Error('请先选择模拟器设备');return (await exec(this.adb,[...(target?['-s',this.serial]:[]),...args],{windowsHide:true,timeout:20000,maxBuffer:4*1024*1024,env:{...process.env,ANDROID_USER_HOME:this.userHome}})).stdout;}
  async devices(){const s=await this.run(['devices','-l'],false);return s.split(/\r?\n/).slice(1).filter(l=>/\sdevice\s/.test(l)).map(l=>({serial:l.split(/\s/)[0],detail:l}));}
  async select(serial:string){if(!/^[a-zA-Z0-9_.:\[\]-]{1,100}$/.test(serial))throw new Error('设备标识无效');if(!(await this.devices()).some(d=>d.serial===serial))throw new Error('指定设备不在线');await this.close();this.serial=serial;await this.start();return {selected:serial};}
  async start(){
    if(this.client)return;
    if(!this.serial)throw new Error('尚未选择模拟器设备');
    mkdirSync(join(this.root,'data/phone-shots'),{recursive:true});
    const mediaEnv=join(this.root,'data/media-env.json');if(existsSync(mediaEnv))process.env.PHONE_FFMPEG=JSON.parse(readFileSync(mediaEnv,'utf8').replace(/^\uFEFF/,'')).path;
    this.transport=new StdioClientTransport({command:process.execPath,args:[join(this.root,'vendor/phone-mcp/src/phone-mcp.js')],cwd:this.root,env:{...Object.fromEntries(Object.entries(process.env).filter(([,v])=>v!==undefined)) as Record<string,string>,ANDROID_USER_HOME:this.userHome,PHONE_ADB:this.adb,PHONE_SERIAL:this.serial,PHONE_SHOT_DIR:join(this.root,'data/phone-shots'),PHONE_MACRO_FILE:join(this.root,'data/phone-macros.json')},stderr:'pipe'});
    this.client=new Client({name:'qq-companion',version:'0.2.0'});
    try{await this.client.connect(this.transport);}catch(e){await this.close();throw e;}
  }
  async allowedForeground(){
    const s=await this.run(['shell','dumpsys','activity','activities']);
    const line=s.split('\n').find(l=>/mResumedActivity|topResumedActivity/.test(l))||'';
    const pkg=line.match(/\b([a-zA-Z][\w]*(?:\.[\w]+)+)\//)?.[1];
    const settings=join(this.root,'data/extensions.json');const apps=existsSync(settings)?JSON.parse(readFileSync(settings,'utf8')).apps:undefined;
    if(!pkg||!(apps??['com.android.chrome','com.android.browser','com.ss.android.ugc.aweme','com.ss.android.ugc.aweme.mobile','com.xingin.xhs','com.zhihu.android']).includes(pkg))throw new Error('当前应用未在能力页面启用，请选择应用后重试');
  }
  async openApp(pkg:string){if(!/^[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(pkg))throw Error('包名无效');const settings=join(this.root,'data/extensions.json');const apps=existsSync(settings)?JSON.parse(readFileSync(settings,'utf8')).apps:undefined;if(!(apps??['com.android.chrome','com.android.browser','com.ss.android.ugc.aweme','com.ss.android.ugc.aweme.mobile','com.xingin.xhs','com.zhihu.android']).includes(pkg))throw Error('该应用未启用');const packages=await this.run(['shell','pm','list','packages',pkg]);if(!packages.split(/\r?\n/).includes('package:'+pkg))throw Error('模拟器尚未安装此App，请先安装并完成登录');const out=await this.run(['shell','monkey','-p',pkg,'-c','android.intent.category.LAUNCHER','1']);if(/Error|Exception|No activities/.test(out))throw Error(out.slice(0,300));return {opened:pkg};}
  async record(seconds:number,frames:number){if(!Number.isInteger(seconds)||seconds<1||seconds>20||!Number.isInteger(frames)||frames<2||frames>6)throw Error('录屏为1–20秒、2–6帧');await this.start();const r=await this.client!.callTool({name:'phone_record_screen',arguments:{seconds,frames}},undefined,{timeout:120000});if(r.isError)throw Error(JSON.stringify(r.content).slice(0,400));return r.content as any[];}
  async call(name:string,args:any){
    if(!['phone_screenshot','phone_dump','phone_tap','phone_tap_text','phone_swipe','phone_text','phone_key'].includes(name))throw new Error('手机工具未开放');
    await this.start();
    if(!['phone_screenshot','phone_dump'].includes(name))await this.allowedForeground();
    if(name==='phone_text'&&/[^\x00-\x7f]/.test(String(args.text??'')))return this.chineseText(String(args.text));
    const r=await this.client!.callTool({name,arguments:args},undefined,{timeout:30000});
    if(r.isError)throw new Error(JSON.stringify(r.content).slice(0,600));
    if(!['phone_screenshot','phone_dump'].includes(name))await new Promise(r=>setTimeout(r,350));
    const content=r.content as any[];
    const image=content.find(c=>c.type==='image');
    return {text:content.filter(c=>c.type==='text').map(c=>c.text).join('\n').slice(0,12000),image:image?await sharp(Buffer.from(image.data,'base64')).resize({width:1280,height:1280,fit:'inside',withoutEnlargement:true}).png().toBuffer():undefined};
  }
  async chineseText(value:string){
    if(!value||value.length>4000)throw new Error('输入内容须为 1–4000 个字符');
    const ime='com.android.adbkeyboard/.AdbIME';
    if(!(await this.run(['shell','ime','list','-a','-s'])).includes(ime))throw new Error('请先安装 ADBKeyboard 以支持中文输入');
    const old=(await this.run(['shell','settings','get','secure','default_input_method'])).trim();
    const enabled=(await this.run(['shell','settings','get','secure','enabled_input_methods'])).trim();
    const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
    try{
      await this.run(['shell','ime','enable',ime]);
      await this.run(['shell','settings','put','secure','enabled_input_methods',quote(enabled&&enabled!=='null'?enabled+':'+ime:ime)]);
      await this.run(['shell','settings','put','secure','default_input_method',ime]);
      await new Promise(r=>setTimeout(r,600));
      const result=await this.run(['shell','am','broadcast','-a','ADB_INPUT_B64','--es','msg',Buffer.from(value,'utf8').toString('base64')]);
      if(!/result=0/.test(result))throw new Error('中文输入广播失败：'+result.slice(0,300));
      return {text:'已输入文本并恢复原输入法',image:undefined};
    }finally{
      try{if(old&&old!=='null')await this.run(['shell','settings','put','secure','default_input_method',old]);}
      finally{
        if(enabled==='null')await this.run(['shell','settings','delete','secure','enabled_input_methods']);
        else await this.run(['shell','settings','put','secure','enabled_input_methods',quote(enabled)]);
      }
    }
  }
  async open(url:string){
    const u=await publicURL(url);
    const packages=await this.run(['shell','pm','list','packages']);
    const pkg=packages.includes('package:com.android.chrome')?'com.android.chrome':packages.includes('package:com.android.browser')?'com.android.browser':'';
    if(!pkg)throw new Error('请在模拟器安装 Chrome 或使用内置浏览器');
    const out=await this.run(['shell','am','start','-a','android.intent.action.VIEW','-d',"'"+u.href.replaceAll("'",'%27')+"'",'-p',pkg]);
    if(/Error|Exception/i.test(out))throw new Error(out.slice(0,400));return {opened:u.href,package:pkg};
  }
  async dimensions(){const s=await this.run(['shell','wm','size']);const m=[...s.matchAll(/(\d+)x(\d+)/g)].at(-1);if(!m)throw new Error('无法读取分辨率');return {width:Number(m[1]),height:Number(m[2])};}
  async close(){const c=this.client;this.client=undefined;try{await c?.close();}finally{await this.transport?.close();this.transport=undefined;}}
}
