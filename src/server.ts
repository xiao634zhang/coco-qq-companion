import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Store, text, type Config, type Memory, type Diary } from './store.ts';
import { Companion } from './companion.ts';
import { localEndpoint } from './onebot.ts';
import { nextCheck } from './scheduler.ts';
import { backup, backupList, restore, autostart } from './backup.ts';

async function body(req: IncomingMessage,max=256000): Promise<any> {
  let value = ''; for await (const chunk of req) { value += chunk; if (Buffer.byteLength(value) > max) throw new Error('请求内容过大'); }
  return value ? JSON.parse(value) : {};
}
function response(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
export function validateConfig(current: Config, input: any): Config {
  const c = structuredClone(current);
  for (const key of ['ownerQQ','botQQ'] as const) if (input[key] !== undefined) {
    if (typeof input[key] !== 'string' || (input[key] && !/^\d{5,12}$/.test(input[key]))) throw new Error('QQ 号格式无效'); c[key] = input[key];
  }
  if (c.ownerQQ && c.botQQ && c.ownerQQ === c.botQQ) throw new Error('管理员和 AI 的 QQ 号必须不同');
  if (input.snow) {
    for (const key of ['wsUrl','httpUrl'] as const) if (input.snow[key] !== undefined) { localEndpoint(input.snow[key], key === 'wsUrl' ? 'ws:' : 'http:'); c.snow[key] = input.snow[key]; }
    if (input.snow.accessToken !== undefined) c.snow.accessToken = text(input.snow.accessToken, 1024);
    if (input.snow.httpAccessToken !== undefined) c.snow.httpAccessToken = input.snow.httpAccessToken === null ? undefined : text(input.snow.httpAccessToken, 1024);
  }
  if (input.proactive) {
    if (input.proactive.enabled !== undefined) { if (typeof input.proactive.enabled !== 'boolean') throw new Error('主动开关无效'); c.proactive.enabled = input.proactive.enabled; }
    const ranges = { startHour: [0,23], endHour: [1,24], idleMinutes: [30,1440], minMinutes: [30,1440], maxMinutes: [30,1440], gapMinutes: [60,1440], dailyMax: [0,8] };
    for (const [key, range] of Object.entries(ranges)) if (input.proactive[key] !== undefined) {
      const v = input.proactive[key]; if (!Number.isInteger(v) || v < range[0] || v > range[1]) throw new Error(`主动设置 ${key} 超出范围`);
      (c.proactive as any)[key] = v;
    }
    if (c.proactive.startHour >= c.proactive.endHour || c.proactive.minMinutes > c.proactive.maxMinutes) throw new Error('主动时间范围无效');
  }
  if(input.budget){
    const reserve=input.budget.reservePercent??c.budget.reservePercent;
    if(typeof input.budget.enabled!=='boolean'||!Number.isFinite(input.budget.maxPercent)||input.budget.maxPercent<1||input.budget.maxPercent>100||!Number.isFinite(reserve)||reserve<0||reserve>=100)throw new Error('窗口上限为 1–100%，账号保留为 0–99%');
    c.budget={enabled:input.budget.enabled,maxPercent:input.budget.maxPercent,reservePercent:reserve};
  }
  return c;
}
export function createHttp(app: Companion) {
  const store = app.store;
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return response(res, 403, { error: '只允许本机访问' });
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`) return response(res,403,{error:'跨站请求已拒绝'});
      const url = new URL(req.url || '/', `http://${host}`), route = url.pathname;
      if (req.method === 'GET' && route === '/health') return response(res,200,{ ok:true, service:'qq-companion', pid:process.pid });
      if (!route.startsWith('/api/')) {
        const files: Record<string, [string,string]> = { '/':['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/abilities.js':['abilities.js','text/javascript'], '/extensions.js':['extensions.js','text/javascript'], '/style.css':['style.css','text/css'] };
        if (req.method !== 'GET' || !files[route]) return response(res,404,{error:'不存在'});
        const [file, mime] = files[route]; res.writeHead(200,{'Content-Type':`${mime}; charset=utf-8`,'Cache-Control':'no-store'}); return res.end(readFileSync(join(store.root,'public',file)));
      }
      const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /,'')), token = Buffer.from(store.token());
      if (supplied.length !== token.length || !timingSafeEqual(supplied,token)) return response(res,401,{error:'请先输入管理令牌'});
      const data = req.method === 'POST' ? await body(req,route==='/api/media/import'?42*1024*1024:route==='/api/stickers/import'?12*1024*1024:256000) : {};
      if (req.method === 'GET') {
        if(route==='/api/extensions')return response(res,200,app.extensions.status());
        if(route==='/api/experiences')return response(res,200,{items:app.extensions.experiences(url.searchParams.get('query')??'')});
        if(route==='/api/macros')return response(res,200,{items:JSON.parse(existsSync(join(store.data,'phone-macros.json'))?readFileSync(join(store.data,'phone-macros.json'),'utf8'):'{}')});
        if(route==='/api/apps'){const packages=await app.tasks.abilities.phone.run(['shell','pm','list','packages','-3']);return response(res,200,{packages:packages.split(/\r?\n/).filter(Boolean).map(s=>s.replace(/^package:/,''))});}
        if(route==='/api/media/file'){const p=app.media.file(url.searchParams.get('id')??'');res.writeHead(200,{'Content-Type':p.endsWith('.mp3')?'audio/mpeg':'application/octet-stream','Cache-Control':'no-store'});return res.end(readFileSync(p));}
        if (route === '/api/abilities') return response(res,200,await app.tasks.abilities.status());
        if (route === '/api/tasks') return response(res,200,{tasks:app.tasks.all(),pool:app.tasks.pool(),lanes:app.tasks.overview(),events:store.lines('task-events.jsonl').slice(-80)});
        if (route === '/api/task-pool') return response(res,200,app.tasks.pool());
        if (route === '/api/daily') return response(res,200,{jobs:app.daily.all(),events:store.lines('daily-events.jsonl').slice(-60)});
        if (route === '/api/stickers') return response(res,200,{items:app.stickers.list()});
        if (route === '/api/stickers/image') {const {item,path}=app.stickers.file(url.searchParams.get('id')??'');res.writeHead(200,{'Content-Type':'image/'+item.format,'Cache-Control':'no-store'});return res.end(readFileSync(path));}
        if (route === '/api/task-screenshot') { const id=url.searchParams.get('id');if(id&&!app.tasks.all().some(t=>t.id===id))throw Error('任务不存在');const p=id?join(store.data,'task-shots',id+'.png'):join(store.data,'latest-task.png');if(!existsSync(p))return response(res,404,{error:'暂无这次任务的截图'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});return res.end(readFileSync(p)); }
        if (route === '/api/status') return response(res,200,app.status());
        if (route === '/api/config') { const c = store.config(); return response(res,200,{...c, snow:{...c.snow,accessToken:'',httpAccessToken:'',tokenConfigured:!!c.snow.accessToken,httpTokenConfigured:c.snow.httpAccessToken !== undefined},autostart:autostart(store)}); }
        if (route === '/api/content') return response(res,200,{role:store.role(),memory:store.memory(),diary:store.diaries(10000),messages:store.messages(80)});
        if (route === '/api/logs') return response(res,200,{events:store.lines('events.jsonl').slice(-80),deliveries:Object.values(store.deliveries()).slice(-30)});
        if (route === '/api/backups') return response(res,200,backupList(store));
        if (route === '/api/usage') return response(res,200,app.ledger.view());
      }
      if (req.method !== 'POST') return response(res,404,{error:'不存在'});
      let result: unknown;
      if(route==='/api/chat'){if(!text(data.text,8000))throw Error('消息不能为空');}
      if (route === '/api/pause') { app.pause(); result = {paused:true}; }
      else if (route === '/api/tasks/stop') { result=app.tasks.stop('管理员停止',data.scope); }
      else if (route === '/api/tasks/cancel') { result=app.tasks.cancel(text(data.id,100)); }
      else if (route === '/api/screenshot/send') { if(data.taskId&&!app.tasks.all().some(t=>t.id===data.taskId))throw Error('任务不存在');result=await app.screenshots.send(data.source??'latest',data.taskId); }
      else if (route === '/api/stickers/send') { result=await app.stickers.send(text(data.id,100)); }
      else if (route === '/api/login') { result = await app.codex.login(); }
      else if (route === '/api/refresh') { await app.refresh(); result = app.status(); }
      else if (route === '/api/disconnect-qq') { app.qq.stop(); result = {disconnected:true}; }
      else if (route === '/api/shutdown') { response(res,200,{stopping:true}); setTimeout(() => server.emit('shutdown'),50); return; }
      else if (route === '/api/connect-codex') { await app.codex.start(); await app.refresh(); result = app.status(); }
      else {
        result = await app.enqueue(async () => {
          switch (route) {
            case '/api/extensions': {const settings=app.extensions.save(data);return {settings,message:'扩展设置已保存'};}
            case '/api/music':return app.integrations.music(data);
            case '/api/qzone':return app.integrations.qzone(data);
            case '/api/experiences/clear': store.rewrite('experiences.jsonl',[]);return {message:'浏览经历已清除，已有日记可在日记页单独编辑'};
            case '/api/macros/remove': {app.tasks.stop('管理员修改操作宏','android');const p=join(store.data,'phone-macros.json'),items=JSON.parse(existsSync(p)?readFileSync(p,'utf8'):'{}');delete items[text(data.name,60)];writeFileSync(p,JSON.stringify(items,null,2));return {message:'操作宏已删除'};}
            case '/api/apps/open': {const current=app.tasks.lanes.device.current();if(app.tasks.lanes.device.executing||current?.status==='running')throw Error('模拟器任务进行中，请先停止任务');return app.tasks.abilities.phone.openApp(text(data.package,150));}
            case '/api/media/import':return app.media.import(text(data.name,200),text(data.data,42*1024*1024));
            case '/api/media/transcribe':return app.media.transcribe(text(data.id,100),app.extensions.settings().whisperModel);
            case '/api/media/frames':return app.media.frames(text(data.id,100));
            case '/api/media/speak': {const speech=await app.media.speak(text(data.text,2000),app.extensions.settings().voice);return {id:speech.id};}
            case '/api/media/send': {const p=app.media.file(text(data.id,100));if(!p.endsWith('.mp3'))throw Error('请先生成MP3语音');const result=await app.sendVoice('voice-manual:'+Date.now(),readFileSync(p));if(result?.status!=='ok')throw Error('QQ未确认语音发送成功');return {message:'语音已发送到管理员QQ'};}
            case '/api/task-pool': return app.tasks.setLimit(data.maxTasks);
            case '/api/stickers/import': return {item:await app.stickers.import(data),message:'表情包已导入'};
            case '/api/stickers/remove': return app.stickers.remove(text(data.id,100));
            case '/api/daily/save': return app.daily.save(data);
            case '/api/daily/remove': return app.daily.remove(text(data.id,100));
            case '/api/abilities': {app.tasks.stop('能力设置变更');return app.tasks.abilities.save(data);}
            case '/api/social': {app.tasks.stop('平台 CLI 授权设置变更','web');return app.tasks.abilities.social.save(data);}
            case '/api/abilities/device': {app.tasks.stop('设备切换','android');return app.tasks.abilities.select(text(data.serial,100));}
            case '/api/abilities/vision': return app.tasks.verifyVision();
            case '/api/abilities/verify-web': return app.tasks.start({scope:'web',goal:'搜索 Android 官方 ADB 文档，打开官方来源核实 ADB 属于哪个工具包。只回答一句中文并附实际来源 Markdown 链接。',minutes:2},'local','development.tools');
            case '/api/abilities/verify-social': return app.tasks.start({scope:'web',goal:'执行平台 CLI 联调：只用 web_social_search 与 web_social_read，分别在小红书(xhs)和知乎(zhihu)搜索“人工智能”，从实际返回结果各选一条 note/answer/question，再调用 read 读取正文。不要使用内置搜索或浏览器工具。读取成功后以 [TASK_DONE] 开头，用简短中文各总结一句并附实际来源链接。若平台失败如实报告，不伪造结果。',minutes:5},'local','development.tools');
            case '/api/abilities/verify-android': return app.tasks.start({scope:'game',goal:'验证安卓 2048：当前浏览器已打开 https://play2048.co/ 。先 android_look 看图，在棋盘内看图选择方向滑动，完成至少20次有效移动。每次移动后观察棋盘变化，记录实际移动数和分数；不要点击撤销、提示或重新开始。完成20次后截图并用 [TASK_DONE] 汇报实际分数和移动数。',minutes:8},'local','development.tools');
            case '/api/abilities/verify-douyin': return app.tasks.start({scope:'android',goal:'验证模拟器可见的抖音网页版：使用 android_open 打开 https://www.douyin.com/ ，android_look(image=true)观察页面。若为推荐视频流，观察并滑动到下一个视频后再截图，核实内容确实切换；若出现验证码或登录，不点击验证控件，不尝试处理或绕过，以 [TASK_WAITING] 报告需要管理员在模拟器中接手；若只是下载App页面，按真实情况说明，不声称已刷视频。验证最多8次工具调用，成功以 [TASK_DONE] 汇报。'},'local','development.tools');
            case '/api/tasks/start': return app.tasks.start(data,'local');
            case '/api/tasks/resume': return app.tasks.resume(data.scope);
            case '/api/config': {
              const old = store.config(), c = validateConfig(old,data);
              app.qq.stop(); store.saveConfig(c); app.nextCheckAt = nextCheck(c);
              if (c.ownerQQ !== old.ownerQQ) app.reset();
              return {saved:true,message:'已保存；QQ 配置更改后请重新连接'};
            }
            case '/api/budget': {
              const c=validateConfig(store.config(),{budget:data});store.saveConfig(c);app.nextCheckAt=nextCheck(c);
              return {saved:true,message:c.budget.enabled?`已开启 ${c.budget.maxPercent}% 窗口软上限`:'已关闭百分比保护；每日统计继续记录'};
            }
            case '/api/model': return {message:await app.switchModel(text(data.model,100), data.effort === undefined ? undefined : text(data.effort,30))};
            case '/api/verify': return app.verify();
            case '/api/connect-qq': return app.connectQQ();
            case '/api/resume': return {message:await app.command('/继续')};
            case '/api/reset': app.reset(); return {reset:true};
            case '/api/role': store.saveRole(text(data.role,12000)); app.reset(); return {saved:true};
            case '/api/memory': {
              const m: Memory = {facts:[],preferences:[],summary:text(data.summary || '',4000)};
              for (const key of ['facts','preferences'] as const) { if (!Array.isArray(data[key]) || data[key].length > 80) throw new Error('记忆应为最多 80 条的列表'); m[key] = data[key].map((v:unknown)=>text(v,300)).filter(Boolean); }
              store.saveMemory(m); app.reset(); return {saved:true};
            }
            case '/api/diary': {
              if (!Array.isArray(data.entries) || data.entries.length > 10000) throw new Error('日记格式无效');
              const entries: Diary[] = data.entries.map((d:any)=>({id:text(d.id,100),at:text(d.at,40),mood:text(d.mood || '',100),text:text(d.text,2000)}));
              if (entries.some(d=>!Number.isFinite(Date.parse(d.at)))) throw new Error('日记日期无效');
              store.rewrite('diary.jsonl',entries); app.reset(); return {saved:true};
            }
            case '/api/chat': {
              const value=text(data.text,8000); if(!value) throw new Error('消息不能为空');
              store.updateState({lastUserAt:Date.now()}); const answer=await app.chat(value);
              if (store.state().paused) throw new Error('本轮已暂停');
              store.message('assistant',answer,'local',store.config().model); return {reply:answer};
            }
            case '/api/backup': return {name:backup(store)};
            case '/api/restore': app.pause(); app.qq.stop(); return restore(store,text(data.name,100));
            case '/api/autostart': if(typeof data.enabled!=='boolean') throw new Error('开关无效'); return {enabled:autostart(store,data.enabled)};
            default: throw new Error('不存在的操作');
          }
        });
      }
      response(res,200,result ?? {ok:true});
    } catch (e) { store.log('http.error',String(e)); response(res,400,{error:String(e).replace(/^Error: /,'')}); }
  });
  server.requestTimeout=300000;
  return server;
}
export async function main() {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'); const store=new Store(root);
  const app=new Companion(store); const server=createHttp(app), c=store.config();
  const pidPath=join(store.data,'server.pid');
  if(existsSync(pidPath)) {
    const pid=Number(readFileSync(pidPath,'utf8'));
    try {process.kill(pid,0); throw new Error('服务可能已运行，请先使用健康检查确认');} catch(e:any) {if(e.code!=='ESRCH') throw e;}
  }
  await new Promise<void>((ok,bad)=>{server.once('error',bad);server.listen(c.port,'127.0.0.1',()=>ok());});
  writeFileSync(pidPath,String(process.pid));
  console.log(`管理页面：http://127.0.0.1:${c.port}/`);
  console.log('管理令牌保存在 data/console-token；双击 open-console.cmd 可直接进入。');
  let closed=false;
  const close=()=>{if(closed)return;closed=true;app.stop();server.close();if(existsSync(pidPath))unlinkSync(pidPath);setTimeout(()=>process.exit(0),500).unref();};
  server.on('shutdown',close); process.on('SIGINT',close); process.on('SIGTERM',close);
  void app.start().catch(e=>store.log('startup.error',String(e)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(e=>{console.error(String(e));process.exitCode=1;});
