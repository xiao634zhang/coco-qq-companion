import { mkdirSync, existsSync, readdirSync, copyFileSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from './store.ts';

const FILES = ['data/avatar.json','data/recall.json','data/interests.json','data/favorites.json','data/modules.json','data/minecraft.json','config.json','role.md','data/memory.json','data/state.json','data/chat.jsonl','data/diary.jsonl','data/deliveries.json','data/usage-state.json','data/usage.jsonl','data/quota-audit.jsonl','data/abilities.json','data/tasks.json','data/social-cli.json','data/task-pool.json','data/daily-jobs.json','data/daily-events.jsonl','data/stickers/index.json','data/extensions.json','data/experiences.jsonl','data/phone-macros.json','data/group-chat.jsonl','data/qzone-usage.json','data/evening-review.json'];
const stickerFile=(file:string)=>/^data\/stickers\/[a-zA-Z0-9-]+\.(png|jpeg|gif|webp)$/.test(file);
export function backup(store: Store) {
  const name = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(3).toString('hex');
  const dir = join(store.root, 'backups', name); mkdirSync(dir, { recursive: true });
  const stickers=join(store.data,'stickers'),files=[...FILES,...(existsSync(stickers)?readdirSync(stickers).map(n=>'data/stickers/'+n).filter(stickerFile):[])];
  for (const file of files) if (existsSync(join(store.root, file))) {
    const dest = join(dir, file); mkdirSync(join(dest, '..'), { recursive: true }); copyFileSync(join(store.root, file), dest);
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ version: 1, at: new Date().toISOString(), files, sessionOnRestore: 'reset' }, null, 2));
  return name;
}
export function backupList(store: Store) {
  const dir = join(store.root, 'backups');
  return existsSync(dir) ? readdirSync(dir).filter(n => /^[\dTZ-]+-[a-f0-9]{6}$/.test(n) && existsSync(join(dir,n,'manifest.json'))).sort().reverse() : [];
}
export function restore(store: Store, name: string) {
  if (!backupList(store).includes(name)) throw new Error('备份不存在');
  const dir = join(store.root, 'backups', name);
  const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
  if(!Array.isArray(manifest.files)||manifest.files.some((file:unknown)=>typeof file!=='string'||(!FILES.includes(file)&&!stickerFile(file))))throw Error('备份清单包含无效文件');
  const contents = new Map<string, Buffer>();
  for (const file of manifest.files as string[]) if (existsSync(join(dir,file))) {
    const content = readFileSync(join(dir,file));
    if (file.endsWith('.json')) JSON.parse(content.toString('utf8'));
    if (file.endsWith('.jsonl')) for (const row of content.toString('utf8').split('\n').filter(Boolean)) JSON.parse(row);
    contents.set(file,content);
  }
  if (!contents.has('config.json') || !contents.has('data/memory.json')) throw new Error('备份不完整');
  const previous = backup(store);
  for (const [file, content] of contents) {mkdirSync(join(store.root,file,'..'),{recursive:true});writeFileSync(join(store.root,file),content);}
  store.updateState({ paused: true, threadId: null, turnsSinceCompact: 0, compactPending: false, contextStartIndex: store.messages(Number.MAX_SAFE_INTEGER).length });
  return { restored: name, previous, message: '已恢复并暂停；会话将重新建立，长期记忆和日记保留。' };
}
export function autostart(store: Store, enabled?: boolean) {
  if (process.platform !== 'win32') { if (enabled) throw new Error('开机启动仅支持 Windows'); return false; }
  const base = process.env.APPDATA;
  if (!base) { if (enabled) throw new Error('未找到 Windows APPDATA，无法配置开机启动'); return false; }
  const path = join(base,'Microsoft/Windows/Start Menu/Programs/Startup/QQCodexCompanion.vbs');
  if (enabled === true) {
    const script = join(store.root,'scripts','start.ps1').replaceAll('"','""');
    mkdirSync(join(path,'..'),{recursive:true});
    writeFileSync(path, `Set shell = CreateObject("WScript.Shell")\r\nshell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${script}"" -Background", 0, False\r\n`);
  } else if (enabled === false && existsSync(path)) unlinkSync(path);
  return existsSync(path);
}
