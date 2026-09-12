import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CDP } from './cdp.mjs';

// 必须传入原始 MessageEvent，让原生解码器复用缓存并只确认一次分片。
export function installBridgeListener(key, decodeMessage) {
  const state = window[key] || { events: [], threads: new Set(), pending: new Map() };
  const listener = event => {
    let data;
    try { data = decodeMessage(event); }
    catch (error) {
      state.decodeError = `Desktop message decoding failed: ${error.message}`;
      for (const [id, callback] of state.pending) {
        callback({ message: { id, error: { code: -32000, message: state.decodeError } } });
      }
      state.pending.clear();
      return;
    }
    if (!data || typeof data !== 'object') return;
    if (data.type === 'mcp-response') {
      const response = data.message;
      const callback = state.pending.get(response?.id);
      if (callback) { state.pending.delete(response.id); callback(data); }
    }
    if (data.type === 'mcp-notification' || data.type === 'mcp-request') {
      const p = data.params || data.request?.params;
      const id = p?.threadId || p?.thread?.id;
      if (state.threads.has(id)) {
        state.events.push({ receivedAt: Date.now(), ...data });
        if (state.events.length > 10000) state.events.shift();
      }
    }
  };
  // 替换监听器时保留请求、订阅和已收到事件，可升级运行中的桥接。
  if (state.listener) window.removeEventListener('message', state.listener);
  state.listener = listener;
  state.decodeError = null;
  state.decoderVersion = 1;
  window[key] = state;
  window.addEventListener('message', listener);
}

export async function loadDesktopMessageDecoder() {
  const entry = document.scripts[0]?.src;
  const source = await fetch(entry).then(response => response.text());
  const asset = source.match(/app-initial-[a-f0-9]+\.js/)?.[0];
  const exportName = {
    'app-initial-92cbfeba4f7c.js': 'ymn',
    'app-initial-f094ef01c64d.js': 'Cmn',
  }[asset];
  if (!exportName) throw new Error('Desktop message decoder needs review for this Desktop build');
  const module = await import(new URL(asset, entry).href);
  if (typeof module[exportName] !== 'function') throw new Error('Desktop native message decoder unavailable');
  return module[exportName];
}

// Local PoC: use the Desktop's existing initialized app-server connection.
// This process never spawns codex, reinitializes the shared connection, or owns it.
export class DesktopBridge {
  constructor(cdp, key) { this.cdp = cdp; this.key = key; this.sequence = 0; }
  static async connect() {
    const cdp = await CDP.connect();
    const key = `__remProbe_${randomUUID().replaceAll('-', '')}`;
    const bridge = new DesktopBridge(cdp, key);
    try { await cdp.evaluate(`(async () => {
      if (typeof window.electronBridge?.sendMessageFromView !== 'function') throw new Error('Desktop IPC bridge is unavailable');
      const decode = await (${loadDesktopMessageDecoder.toString()})();
      (${installBridgeListener.toString()})(${JSON.stringify(key)}, decode);
      return { connected: true, nativeBridge: typeof window.electronBridge?.sendMessageFromView };
    })()`); } catch (error) { cdp.close(); throw error; }
    return bridge;
  }
  async request(method, params = {}) {
    const id = `rem-poc-${this.key}-${++this.sequence}`;
    const envelope = { type: 'mcp-request', hostId: 'local', request: { id, method, params } };
    const data = await this.cdp.evaluate(`new Promise((resolve, reject) => {
      const state = window[${JSON.stringify(this.key)}];
      if (state.decodeError) throw new Error(state.decodeError);
      const envelope = ${JSON.stringify(envelope)};
      const timer = setTimeout(() => { state.pending.delete(envelope.request.id); reject(new Error('Desktop RPC timeout: ' + envelope.request.method)); }, 35000);
      state.pending.set(envelope.request.id, value => { clearTimeout(timer); resolve(value); });
      window.electronBridge.sendMessageFromView(envelope).catch(error => {
        clearTimeout(timer); state.pending.delete(envelope.request.id); reject(error);
      });
    })`);
    this.lastMetrics = data.hostMetrics;
    if (data.message?.error) throw new Error(JSON.stringify(data.message.error));
    return data.message?.result ?? data;
  }
  async watch(threadId) {
    await this.cdp.evaluate(`window[${JSON.stringify(this.key)}].threads.add(${JSON.stringify(threadId)}); true`);
  }
  async unwatch(threadId) {
    await this.cdp.evaluate(`window[${JSON.stringify(this.key)}].threads.delete(${JSON.stringify(threadId)}); true`);
  }
  async drain() {
    return this.cdp.evaluate(`(() => { const state = window[${JSON.stringify(this.key)}]; if (state.decodeError) throw new Error(state.decodeError); return state.events.splice(0); })()`);
  }
  async respond(response) {
    const envelope = { type: 'mcp-response', hostId: 'local', response };
    await this.cdp.evaluate(`window.electronBridge.sendMessageFromView(${JSON.stringify(envelope)}).then(() => true)`);
  }
  async close() {
    try {
      await this.cdp.evaluate(`(() => { const s = window[${JSON.stringify(this.key)}]; if(s) { window.removeEventListener('message', s.listener); delete window[${JSON.stringify(this.key)}]; } return true; })()`);
    } finally { this.cdp.close(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bridge = await DesktopBridge.connect();
  try {
    const params = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : {};
    const result = await bridge.request(process.argv[2] || 'thread/loaded/list', params);
    console.log(JSON.stringify(result, null, 2));
  } finally { await bridge.close(); }
}
