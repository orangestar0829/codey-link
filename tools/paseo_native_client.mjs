import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

export async function connectPaseo(state) {
  const modules = path.join(path.dirname(state.paseoExe), 'resources/app.asar/node_modules');
  const { DaemonClient } = await import(pathToFileURL(path.join(modules, '@getpaseo/client/dist/daemon-client.js')).href);
  const { WebSocket } = await import(pathToFileURL(path.join(modules, 'ws/wrapper.mjs')).href);
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${state.port}/ws`, clientId: `rem-settings-${randomUUID()}`,
    clientType: 'cli', appVersion: '0.7.2', connectTimeoutMs: 10000,
    webSocketFactory: (url, config) => new WebSocket(url, config?.protocols, { headers: config?.headers }),
    reconnect: { enabled: false },
  });
  await client.connect();
  return client;
}
