import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Desktop debugger connection closed'));
      }
      this.pending.clear();
    });
    ws.addEventListener('message', e => {
      const message = JSON.parse(e.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, timeout } = this.pending.get(message.id);
        clearTimeout(timeout);
        this.pending.delete(message.id);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      } else {
        for (const listener of this.listeners) listener(message);
      }
    });
  }
  static async connect(port = Number(process.env.REM_CODEY_CDP_PORT || 9229)) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Desktop debugger port');
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) }).then(r => r.json());
    const target = targets.find(t => t.type === 'page' && t.url?.startsWith('app://-/index.html') && !t.url.includes('avatar-overlay'));
    if (!target) throw new Error('Codex Desktop page not found in the local debugger');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.close(); reject(new Error('Desktop debugger connection timed out')); }, 5000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Desktop debugger connection failed')); }, { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}, timeoutMs = 20000) {
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Desktop debugger is not connected'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, 45000);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  close() { this.ws.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = await CDP.connect();
  try {
    const expression = process.argv[2] === '--file' ? readFileSync(process.argv[3], 'utf8') : process.argv[2];
    console.log(JSON.stringify(await client.evaluate(expression), null, 2));
  } finally { client.close(); }
}
