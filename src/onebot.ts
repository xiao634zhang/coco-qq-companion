import { EventEmitter } from 'node:events';
import type { Config } from './store.ts';

export function localEndpoint(value: string, protocol: 'http:' | 'ws:') {
  const u = new URL(value);
  if (u.protocol !== protocol || !['127.0.0.1','localhost','[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('SnowLuma 地址必须是本机 HTTP / WebSocket 地址，例如 http://127.0.0.1:3000');
  return u;
}
export interface PrivateEvent { post_type: string; message_type?: string; sub_type?: string; user_id?: number | string; self_id?: number | string; message_id?: number | string; message?: unknown; raw_message?: string; time?: number; group_id?:number|string }
export interface SendResult { kind: 'sent' | 'failed' | 'uncertain'; messageId?: string; error?: string }
export function imageFormat(bytes:Buffer){
  if(!Buffer.isBuffer(bytes)||bytes.length<8)return null;
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if(bytes[0]===255&&bytes[1]===216)return 'jpeg';
  if(['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii')))return 'gif';
  if(bytes.length>=12&&bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP')return 'webp';
  return null;
}
export function privateText(event: PrivateEvent): string {
  if (Array.isArray(event.message)) return event.message.map(s => s.type === 'text' ? String(s.data?.text || '') : `[${s.type}消息，当前版本仅支持文字]`).join('').trim();
  return String(event.message || event.raw_message || '').replace(/\[CQ:[^\]]*\]/g, '[媒体消息，当前版本仅支持文字]').trim();
}
export class OneBot extends EventEmitter {
  config: () => Config;
  log: (event: string, detail?: unknown) => void;
  socket?: WebSocket;
  online = false;
  connected = false;
  selfId = '';
  reconnectTimer?: NodeJS.Timeout;
  heartbeatTimer?: NodeJS.Timeout;
  stopped = true;
  generation = 0;
  failures = 0;
  constructor(config: () => Config, log: OneBot['log']) { super(); this.config = config; this.log = log; }
  async api(action: string, body = {}): Promise<any> {
    const c = this.config(); const base = localEndpoint(c.snow.httpUrl, 'http:');
    const token = c.snow.httpAccessToken ?? c.snow.accessToken;
    const recordSend=action==='send_private_msg'&&Array.isArray((body as any).message)&&(body as any).message.some((s:any)=>s.type==='record');
    const r = await fetch(new URL(action, base), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(recordSend?60000:12000) });
    if (!r.ok) throw new Error(`SnowLuma HTTP ${r.status}`);
    return r.json();
  }
  async health() {
    try {
      const [status, login] = await Promise.all([this.api('get_status'), this.api('get_login_info')]);
      this.online = status.status === 'ok' && status.data?.online === true && login.status === 'ok';
      this.selfId = login.data?.user_id ? String(login.data.user_id) : '';
      const expected = this.config().botQQ;
      if (expected && expected !== this.selfId) { this.online = false; throw new Error('SnowLuma 登录账号与配置的小号不一致'); }
      if (this.selfId === this.config().ownerQQ) { this.online = false; throw new Error('AI 账号不能与管理员 QQ 相同'); }
      this.emit('status');
    } catch (e) { this.online = false; this.log('qq.health', String(e)); }
  }
  start() {
    this.stop(); this.stopped = false;
    this.connect();
    this.heartbeatTimer = setInterval(() => void this.health(), 30000);
  }
  connect() {
    if (this.stopped) return;
    const gen = ++this.generation;
    try {
      const c = this.config(), url = localEndpoint(c.snow.wsUrl, 'ws:');
      if (c.snow.accessToken) url.searchParams.set('access_token', c.snow.accessToken);
      const ws = new WebSocket(url); this.socket = ws;
      ws.addEventListener('open', () => { if (gen !== this.generation) return; this.connected = true; this.failures = 0; this.log('qq.connected'); void this.health(); });
      ws.addEventListener('message', event => {
        if (gen !== this.generation || typeof event.data !== 'string' || event.data.length > 1024 * 1024) return;
        try { const value = JSON.parse(event.data); if (value.post_type === 'message') this.emit('message', value);else if(value.post_type==='notice')this.emit('notice',value); }
        catch { this.log('qq.invalid_event'); }
      });
      ws.addEventListener('error', () => { if (gen === this.generation) { ws.close(); this.disconnected(gen); } });
      ws.addEventListener('close', () => this.disconnected(gen));
    } catch (e) { this.log('qq.connect', String(e)); this.disconnected(gen); }
  }
  disconnected(gen: number) {
    if (gen !== this.generation) return;
    this.connected = false; this.online = false;
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(60000, 2000 * 2 ** Math.min(this.failures++, 5)) + Math.random() * 1000;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; this.connect(); }, delay);
  }
  async send(value: string, image?: Buffer): Promise<SendResult> {
    if(image&&(!Buffer.isBuffer(image)||image.length>8*1024*1024||!imageFormat(image)))return {kind:'failed',error:'图片必须为 8 MB 以内的 PNG、JPEG、GIF 或 WebP'};
    if (!this.online || !this.connected) return { kind: 'failed', error: 'QQ 尚未在线' };
    const owner = this.config().ownerQQ;
    if (!/^\d{5,12}$/.test(owner) || owner === this.selfId) return { kind: 'failed', error: '管理员配置无效' };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const message:any[]=[{type:'text',data:{text:value.slice(0,4000)}}];
        if(image)message.push({type:'image',data:{file:'base64://'+image.toString('base64')}});
        const result = await this.api('send_private_msg', { user_id: Number(owner), message });
        if (result.status === 'ok' && result.data?.message_id !== undefined) return { kind: 'sent', messageId: String(result.data.message_id) };
        // Only a definite, explicit failure is safe to retry. Unknown / async outcomes must not replay.
        if (result.status !== 'failed') return { kind: 'uncertain', error: 'QQ 返回了未确认的发送结果，已停止重试' };
        if (attempt === 1) return { kind: 'failed', error: `QQ 拒绝发送 (${result.retcode})` };
        await new Promise(r => setTimeout(r, 3000));
      } catch (e) { return { kind: 'uncertain', error: `发送结果未知，避免重复未重试：${String(e)}` }; }
    }
    return { kind: 'failed', error: '发送失败' };
  }
  stop() {
    this.stopped = true; this.generation++; this.socket?.close(); this.socket = undefined;
    this.connected = false; this.online = false;
    clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined;
    clearInterval(this.heartbeatTimer); this.heartbeatTimer = undefined;
  }
}
