import assert from 'node:assert/strict';
import { installBridgeListener, loadDesktopMessageDecoder } from '../tools/desktop_bridge.mjs';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalFetch = globalThis.fetch;
const listeners = new Set();
globalThis.window = {
  addEventListener: (_, listener) => listeners.add(listener),
  removeEventListener: (_, listener) => listeners.delete(listener),
};
try {
  const key = '__testBridge';
  const received = [], cache = new WeakMap();
  let acknowledgements = 0;
  const decode = event => {
    if (cache.has(event)) return cache.get(event);
    if (event.data.marker !== 'codex-host-chunked-message-v1') return event.data;
    acknowledgements++;
    const message = event.data.kind === 'end' ? event.reassembled : null;
    cache.set(event, message);
    return message;
  };
  installBridgeListener(key, decode);
  const state = window[key];
  state.pending.set('large', value => received.push(value));
  state.threads.add('watched');
  const pending = state.pending, events = state.events, threads = state.threads;
  installBridgeListener(key, decode);
  assert.equal(listeners.size, 1, 'Replacing an active listener must not duplicate delivery');
  assert.equal(state.pending, pending);
  assert.equal(state.events, events);
  assert.equal(state.threads, threads);
  const start = { data: { marker: 'codex-host-chunked-message-v1', kind: 'start' } };
  state.listener(start);
  assert.equal(received.length, 0);
  const fullResponse = { type: 'mcp-response', message: { id: 'large', result: { text: 'x'.repeat(2 * 1024 * 1024) } } };
  const end = { data: { marker: 'codex-host-chunked-message-v1', kind: 'end' }, reassembled: fullResponse };
  decode(end); // 原生消费者已经解码，桥接必须复用同一个事件的缓存。
  state.listener(end);
  assert.deepEqual(received, [fullResponse]);
  assert.equal(acknowledgements, 2, 'Do not acknowledge the same event twice');
  state.pending.set('small', value => received.push(value));
  state.listener({ data: { type: 'mcp-response', message: { id: 'small', result: {} } } });
  assert.equal(received.length, 2);
  for (const threadId of ['watched', 'other']) {
    state.listener({ data: { type: 'mcp-notification', method: 'turn/completed', params: { threadId } } });
  }
  assert.equal(state.events.length, 1, 'Preserve thread subscription filtering');
  state.pending.set('broken', value => received.push(value));
  installBridgeListener(key, () => { throw new Error('Invalid chunk'); });
  state.listener(start);
  assert.match(received.at(-1).message.error.message, /Invalid chunk/);
  assert.equal(state.pending.size, 0);
  assert.match(state.decodeError, /Invalid chunk/);
  globalThis.document = { scripts: [{ src: 'app://-/assets/entry.js' }] };
  globalThis.fetch = async () => ({ text: async () => 'app-initial-000000000000.js' });
  await assert.rejects(loadDesktopMessageDecoder(), /needs review/);
} finally {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  globalThis.fetch = originalFetch;
}
console.log('Desktop bridge decoding and active-listener replacement checks passed');
