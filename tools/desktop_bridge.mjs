import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CDP } from './cdp.mjs';

// Local PoC: use the Desktop's existing initialized app-server connection.
// This process never spawns codex, reinitializes the shared connection, or owns it.
export class DesktopBridge {
  constructor(cdp, key) { this.cdp = cdp; this.key = key; this.sequence = 0; }
  static async connect() {
    const cdp = await CDP.connect();
    const key = `__remProbe_${randomUUID().replaceAll('-', '')}`;
    const bridge = new DesktopBridge(cdp, key);
    try { await cdp.evaluate(`(() => {
      if (typeof window.electronBridge?.sendMessageFromView !== 'function') throw new Error('Desktop IPC bridge is unavailable');
      const state = { events: [], threads: new Set(), pending: new Map() };
      state.listener = event => {
        const data = event.data;
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
      window.addEventListener('message', state.listener);
      window[${JSON.stringify(key)}] = state;
      return { connected: true, nativeBridge: typeof window.electronBridge?.sendMessageFromView };
    })()`); } catch (error) { cdp.close(); throw error; }
    return bridge;
  }
  async request(method, params = {}) {
    const id = `rem-poc-${this.key}-${++this.sequence}`;
    const envelope = { type: 'mcp-request', hostId: 'local', request: { id, method, params } };
    const data = await this.cdp.evaluate(`new Promise((resolve, reject) => {
      const state = window[${JSON.stringify(this.key)}];
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
    return this.cdp.evaluate(`window[${JSON.stringify(this.key)}].events.splice(0)`);
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
