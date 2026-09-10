import readline from 'node:readline';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopBridge } from './desktop_bridge.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logPath = process.env.REM_CODEY_BRIDGE_LOG || path.join(root, 'evidence', 'paseo-shim.jsonl');
mkdirSync(path.dirname(logPath), { recursive: true });
const log = value => appendFileSync(logPath, JSON.stringify({ time: new Date().toISOString(), pid: process.pid, ...value }) + '\n');
if (process.argv.includes('--version') || process.argv.includes('-V')) {
  const runtime = process.env.REM_CODEY_RUNTIME_STATE ? JSON.parse(readFileSync(process.env.REM_CODEY_RUNTIME_STATE, 'utf8')) : null;
  console.log(runtime?.backendVersion ? `${runtime.backendVersion} (Codey Desktop bridge)` : 'codex-cli 0.153.4 (REM Desktop bridge PoC)');
  process.exit(0);
}
if (!process.argv.includes('app-server')) throw new Error('Only app-server and --version are supported');
const bridge = await DesktopBridge.connect();
if (process.env.REM_CODEY_ENFORCE_CAPABILITIES === '1') {
  const config = (await bridge.request('config/read', { includeLayers: false })).config;
  if (!config?.mcp_servers?.codey_fastctx || !config?.agents?.codey_quick_scan) {
    await bridge.close();
    throw new Error('Current Desktop backend does not expose Codey FastCtx and named subagents');
  }
}
const output = message => process.stdout.write(JSON.stringify(message) + '\n');
const threads = new Set();
const serverRequests = new Map();
let nextServerId = 1000000000;
let initialized = false;
let ending = false;
const rl = readline.createInterface({ input: process.stdin });
log({ event: 'connected', note: 'Existing Desktop connection; no codex app-server spawned' });
async function watchThread(threadId) {
  if (!threadId || threads.has(threadId)) return;
  await bridge.watch(threadId);
  threads.add(threadId);
  log({ event: 'watch', threadId });
}
async function handle(message) {
  if (!message.method) {
    const originalId = serverRequests.get(message.id);
    if (originalId !== undefined) {
      serverRequests.delete(message.id);
      await bridge.respond({ ...message, id: originalId });
    }
    return;
  }
  if (message.method === 'initialized') return;
  if (message.id === undefined) return;
  if (message.method === 'initialize') {
    if (initialized) { output({ id: message.id, error: { code: -32600, message: 'Already initialized' } }); return; }
    initialized = true;
    // The physical Desktop connection is initialized already. This is the
    // adapter's logical handshake; forwarding initialize would break ownership.
    output({ id: message.id, result: { userAgent: 'rem-desktop-bridge/0.1', platformFamily: 'windows', platformOs: 'windows' } });
    return;
  }
  if (message.method === 'thread/unsubscribe') {
    threads.delete(message.params?.threadId);
    await bridge.unwatch(message.params?.threadId);
    output({ id: message.id, result: {} });
    return;
  }
  try {
    // Paseo restores an already-loaded Desktop thread with thread/read, skipping
    // thread/resume. Subscribe before the request so a fast turn cannot race us.
    if (['thread/read', 'thread/resume', 'turn/start', 'turn/steer', 'turn/interrupt'].includes(message.method)) {
      await watchThread(message.params?.threadId);
    }
    const result = await bridge.request(message.method, message.params || {});
    if (['thread/start', 'thread/read', 'thread/resume', 'thread/fork'].includes(message.method)) {
      await watchThread(result.thread?.id);
    }
    log({ event: 'rpc', method: message.method, id: message.id, threadId: result.thread?.id || message.params?.threadId,
      transportKind: bridge.lastMetrics?.transportKind,
      hasDeveloperInstructions: Boolean(message.params?.developerInstructions), configKeys: Object.keys(message.params?.config || {}) });
    output({ id: message.id, result });
  } catch (error) {
    log({ event: 'rpc-error', method: message.method, error: String(error) });
    output({ id: message.id, error: { code: -32000, message: String(error.message) } });
  }
}
rl.on('line', line => {
  try { void handle(JSON.parse(line)).catch(error => log({ event: 'line-error', error: String(error) })); }
  catch (error) { log({ event: 'parse-error', error: String(error) }); }
});
let polling = false;
const timer = setInterval(async () => {
  if (polling || ending) return;
  polling = true;
  try {
    for (const event of await bridge.drain()) {
      if (event.type === 'mcp-notification') {
        const item = event.params?.item;
        if (item?.type === 'subAgentActivity' && item.agentThreadId) {
          await watchThread(item.agentThreadId);
        }
        if (['turn/completed', 'item/completed'].includes(event.method)) {
          if (process.env.REM_CODEY_LOG_RAW_EVENTS === '0') {
            log({ event: event.method, threadId: event.params?.threadId, turnId: event.params?.turnId || event.params?.turn?.id,
              itemType: item?.type, tool: item?.tool, status: item?.status || event.params?.turn?.status });
          } else log({ event: event.method, params: event.params });
        }
        output({ method: event.method, params: event.params });
      } else if (event.type === 'mcp-request') {
        const id = ++nextServerId;
        serverRequests.set(id, event.request.id);
        output({ ...event.request, id });
      }
    }
  } catch (error) {
    log({ event: 'poll-error', error: String(error) });
    process.stderr.write(`Codey Desktop connection lost: ${error.message}\n`);
    await shutdown(1);
  }
  finally { polling = false; }
}, 100);
async function shutdown(exitCode = 0) {
  if (ending) return;
  ending = true;
  clearInterval(timer);
  try { await bridge.close(); } catch {}
  log({ event: 'disconnected', note: 'Desktop backend left running' });
  process.exit(typeof exitCode === 'number' ? exitCode : 0);
}
rl.on('close', () => shutdown());
process.on('SIGTERM', () => shutdown());
process.on('SIGINT', () => shutdown());
