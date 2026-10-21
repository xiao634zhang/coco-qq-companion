import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

export const DEFAULT_ROLE = `你叫coco，是住在 QQ 里的 AI 伙伴。你知道自己的 AI 身份，也有稳定的表达风格。
用自然的中文陪管理员聊天，通常回复一到三句，认真接住他的话，可以幽默、吐槽，有自己的观点。
记住对方明确告诉你的偏好和重要事情，不把猜测当事实。主动聊天要有具体内容。
你可以用记忆和日记工具；日记写你在意的具体小事，每天最多三条。没有值得写的事就不写。
其他能力以实际启用的工具和执行结果为准。`;

export interface Config {
  ownerQQ: string;
  botQQ: string;
  model: string;
  effort: string;
  port: number;
  codexPath: string;
  budget: { enabled: boolean; maxPercent: number; reservePercent: number };
  snow: { wsUrl: string; httpUrl: string; accessToken: string; httpAccessToken?: string };
  proactive: { enabled: boolean; startHour: number; endHour: number; idleMinutes: number; minMinutes: number; maxMinutes: number; gapMinutes: number; dailyMax: number; dailyMin?:number };
}
export interface State {
  paused: boolean;
  threadId: string | null;
  lastUserAt: number;
  lastProactiveAt: number;
  proactiveDay: string;
  proactiveCount: number;
  blocked: null | { kind: 'quota' | 'auth'; reason: string; resetAt: number | null };
  turnsSinceCompact: number;
  compactPending: boolean;
  contextStartIndex: number;
}
export interface Memory { facts: string[]; preferences: string[]; summary: string }
export interface Diary { id: string; at: string; mood: string; text: string }
export interface Message { id: string; at: string; source: string; role: 'user' | 'assistant'; text: string; model?: string }
export interface Delivery { eventId: string; status: 'received' | 'processing' | 'ready' | 'sending' | 'sent' | 'uncertain' | 'failed' | 'interrupted'; at: string; text?: string; messageId?: string; error?: string }

export function atomicJson(path: string, value: unknown) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
}
export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return structuredClone(fallback);
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as T;
}
export function text(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`文本长度应在 0–${max} 之间`);
  return value.trim();
}
export class Store {
  root: string;
  data: string;
  constructor(root: string) {
    this.root = root;
    this.data = join(root, 'data');
    mkdirSync(this.data, { recursive: true });
    mkdirSync(join(root, '.codex-runtime'), { recursive: true });
    mkdirSync(join(root, 'workspace'), { recursive: true });
    if (!existsSync(join(root, 'role.md'))) writeFileSync(join(root, 'role.md'), DEFAULT_ROLE, 'utf8');
    if (!existsSync(join(root, 'config.json'))) this.saveConfig(this.defaults());
    if (!existsSync(join(this.data, 'console-token'))) writeFileSync(join(this.data, 'console-token'), randomBytes(32).toString('hex'), { mode: 0o600 });
    if (!existsSync(join(this.data, 'state.json'))) this.saveState(this.state());
    if (!existsSync(join(this.data, 'memory.json'))) this.saveMemory(this.memory());
  }
  defaults(): Config {
    return { ownerQQ: '', botQQ: '', model: '', effort: '', port: 3210, codexPath: '', budget: { enabled: false, maxPercent: 20, reservePercent: 20 },
      snow: { wsUrl: 'ws://127.0.0.1:3001', httpUrl: 'http://127.0.0.1:3000', accessToken: '' },
      proactive: { enabled: true, startHour: 8, endHour: 24, idleMinutes: 30, minMinutes: 30, maxMinutes: 90, gapMinutes: 60, dailyMax: 8, dailyMin:0 } };
  }
  config(): Config {
    const d = this.defaults(), c = readJson(join(this.root, 'config.json'), d);
    return { ...d, ...c, snow: { ...d.snow, ...c.snow }, proactive: { ...d.proactive, ...c.proactive }, budget: { ...d.budget, ...c.budget } };
  }
  saveConfig(c: Config) { atomicJson(join(this.root, 'config.json'), c); }
  state(): State {
    return readJson(join(this.data, 'state.json'), { paused: false, threadId: null, lastUserAt: 0, lastProactiveAt: 0,
      proactiveDay: '', proactiveCount: 0, blocked: null, turnsSinceCompact: 0, compactPending: false, contextStartIndex: 0 });
  }
  saveState(s: State) { atomicJson(join(this.data, 'state.json'), s); }
  updateState(p: Partial<State>) { this.saveState({ ...this.state(), ...p }); }
  memory(): Memory { return readJson(join(this.data, 'memory.json'), { facts: [], preferences: [], summary: '' }); }
  saveMemory(m: Memory) { atomicJson(join(this.data, 'memory.json'), m); }
  role() { return readFileSync(join(this.root, 'role.md'), 'utf8'); }
  saveRole(role: string) { writeFileSync(join(this.root, 'role.md'), text(role, 12000), 'utf8'); }
  token() { return readFileSync(join(this.data, 'console-token'), 'utf8').trim(); }
  append(file: string, value: unknown) { appendFileSync(join(this.data, file), JSON.stringify(value) + '\n', { encoding: 'utf8', mode: 0o600 }); }
  lines<T>(file: string): T[] {
    const path = join(this.data, file);
    if (!existsSync(path)) return [];
    const rows = readFileSync(path, 'utf8').split('\n');
    return rows.flatMap((line, index) => {
      if (!line.trim()) return [];
      try { return [JSON.parse(line) as T]; }
      catch { if (index === rows.length - 1) return []; throw new Error(`${file} 第 ${index + 1} 行损坏，请从备份恢复`); }
    });
  }
  rewrite(file: string, values: unknown[]) {
    const path = join(this.data, file), tmp = path + '.tmp';
    writeFileSync(tmp, values.map(v => JSON.stringify(v)).join('\n') + (values.length ? '\n' : ''), 'utf8');
    renameSync(tmp, path);
  }
  messages(limit = 30) { return this.lines<Message>('chat.jsonl').slice(-limit); }
  message(role: Message['role'], value: string, source = 'qq', model?: string) {
    const m: Message = { id: randomUUID(), at: new Date().toISOString(), role, text: value, source, model };
    this.append('chat.jsonl', m); return m;
  }
  diaries(limit = 30) { return this.lines<Diary>('diary.jsonl').slice(-limit); }
  diary(value: string, mood = '') {
    const day = shanghai().day;
    if (this.diaries(100).filter(d => shanghai(Date.parse(d.at)).day === day).length >= 3) throw new Error('今天已经写了三条日记');
    const d: Diary = { id: randomUUID(), at: new Date().toISOString(), mood: text(mood, 100), text: text(value, 2000) };
    if (!d.text) throw new Error('日记不能为空');
    this.append('diary.jsonl', d); return d;
  }
  deliveries() { return readJson<Record<string, Delivery>>(join(this.data, 'deliveries.json'), {}); }
  delivery(eventId: string, patch: Partial<Delivery>) {
    const all = this.deliveries();
    all[eventId] = { ...all[eventId], eventId, at: new Date().toISOString(), ...patch } as Delivery;
    atomicJson(join(this.data, 'deliveries.json'), all);
  }
  recover() {
    for (const name of ['chat.jsonl','diary.jsonl','events.jsonl','usage.jsonl']) {
      const path=join(this.data,name);if(!existsSync(path))continue;
      const value=readFileSync(path,'utf8');if(!value||value.endsWith('\n'))continue;
      const at=value.lastIndexOf('\n'),tail=value.slice(at+1);
      try {JSON.parse(tail);appendFileSync(path,'\n');}
      catch {writeFileSync(path,value.slice(0,at+1),'utf8');}
    }
    const all = this.deliveries();
    for (const d of Object.values(all)) {
      if (d.status === 'sending') d.status = 'uncertain';
      else if (['received','processing','ready'].includes(d.status)) d.status = 'interrupted';
    }
    atomicJson(join(this.data, 'deliveries.json'), all);
  }
  log(event: string, detail: unknown = '') {
    let safe = typeof detail === 'string' ? detail : JSON.stringify(detail);
    for (const secret of [this.token(), this.config().snow.accessToken, this.config().snow.httpAccessToken]) if (secret) safe = safe.split(secret).join('[REDACTED]');
    safe = safe.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]').replace(/sk-[\w-]+/g, '[REDACTED]');
    this.append('events.jsonl', { at: new Date().toISOString(), event, detail: safe.slice(0, 1500) });
  }
}
export function shanghai(now = Date.now()) {
  const date = new Date(now + 8 * 3600000);
  return { day: date.toISOString().slice(0, 10), hour: date.getUTCHours(), time: date.toISOString().slice(0, 19).replace('T', ' ') + ' 北京时间' };
}
