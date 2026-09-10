import { readFileSync, writeFileSync, renameSync, appendFileSync, existsSync, unlinkSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DesktopBridge } from './desktop_bridge.mjs';
import { connectPaseo } from './paseo_native_client.mjs';
import { contextSettings, settingsPatch, isFast } from './settings_sync_policy.mjs';
import { DesktopSettings } from './desktop_settings.mjs';

const home = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.paseo-codey');
const statePath = path.join(home, 'connection.json');
const lockPath = path.join(home, 'settings-sync.pid.json');
const cachePath = path.join(home, 'settings-sync-state.json');
const logPath = path.join(home, 'logs/settings-sync.jsonl');
const load = file => JSON.parse(readFileSync(file, 'utf8'));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
function save(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  renameSync(temp, file);
}
function log(event, fields = {}) { appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), event, ...fields }) + '\n'); }

// Parse only turn metadata, incrementally. Never log prompts, replies or credentials.
export class RolloutReader {
  constructor() { this.files = new Map(); }
  async read(file) {
    let state = this.files.get(file) || { offset: 0, partial: '', current: null };
    const handle = await open(file, 'r');
    try {
      const size = (await handle.stat()).size;
      if (size < state.offset) state = { offset: 0, partial: '', current: null };
      const buffer = Buffer.alloc(256 * 1024);
      while (state.offset < size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - state.offset), state.offset);
        if (!bytesRead) break;
        state.offset += bytesRead;
        const lines = (state.partial + buffer.subarray(0, bytesRead).toString('utf8')).split('\n');
        state.partial = lines.pop();
        for (const line of lines) {
          // JSON metadata is ASCII; other lines (including split UTF-8 text) are ignored.
          if (!line.includes('"turn_context"')) continue;
          try { const value = contextSettings(JSON.parse(line)); if (value) state.current = value; } catch {}
        }
      }
    } finally { await handle.close(); }
    this.files.set(file, state);
    return state.current;
  }
}

// 一轮同步可独立验证；Fast 失败不阻断实际轮次的模型与推理强度。
export async function syncSettingsPass({ agents, bridge, desktopSettings, client, reader, paths, cache, log }) {
  let tier, fastAvailable = false, fastChanged = false;
  try {
    const config = (await bridge.request('config/read', { includeLayers: false })).config;
    tier = await desktopSettings.tier(config);
    const desktopChanged = !('tier' in cache) || cache.tier !== tier;
    // Desktop changes win simultaneous conflicts. Only a user-observed feature delta
    // writes back; initial mismatches and our own writes never enable paid tiers.
    if (!desktopChanged) {
      for (const agent of agents) {
        const value = agent.features?.find(f => f.id === 'fast_mode')?.value;
        const previous = cache.agents[agent.id];
        if (typeof value !== 'boolean' || typeof previous?.fast !== 'boolean' || value === previous.fast || previous.model !== agent.model) continue;
        tier = value ? 'priority' : 'default';
        await bridge.request('config/batchWrite', { edits: [{
          keyPath: config.profile ? `profiles.${config.profile}.service_tier` : 'service_tier',
          value: tier, mergeStrategy: 'upsert',
        }], filePath: null, expectedVersion: null, reloadUserConfig: true });
        await desktopSettings.setTier(tier);
        log('paseo-fast-to-desktop', { agentId: agent.id, tier });
        break;
      }
    }
    fastChanged = desktopChanged || tier !== cache.tier;
    fastAvailable = true;
  } catch (error) {
    // Fast 状态不可用时不猜测、不写回；恢复后的首轮以 Desktop 状态重新建立基线。
    delete cache.tier;
    log('fast-sync-error', { message: error.message });
  }
  for (const agent of agents) {
    try {
      const id = agent.persistence?.sessionId || agent.runtimeInfo?.sessionId;
      if (!id) continue;
      const previous = cache.agents[agent.id] || {};
      if (!paths.has(id)) {
        const response = await bridge.request('thread/read', { threadId: id, includeTurns: false });
        if (response.thread.path) paths.set(id, response.thread.path);
      }
      const current = paths.has(id) ? await reader.read(paths.get(id)) : null;
      const patch = settingsPatch(previous.context, current, agent);
      if (patch.model) await client.setAgentModel(agent.id, patch.model);
      if (patch.effort) await client.setAgentThinkingOption(agent.id, patch.effort);
      if (Object.keys(patch).length) log('desktop-to-paseo', { agentId: agent.id, ...patch });
      let fast = agent.features?.find(f => f.id === 'fast_mode')?.value;
      // Model changes can add/remove the native Fast feature.
      if (patch.model) fast = (await client.fetchAgent(agent.id)).agent.features?.find(f => f.id === 'fast_mode')?.value;
      if (fastAvailable && typeof fast === 'boolean' && (fastChanged || typeof previous.fast !== 'boolean' || patch.model) && fast !== isFast(tier)) {
        await client.setAgentFeature(agent.id, 'fast_mode', isFast(tier));
        fast = isFast(tier);
        log('desktop-fast-to-paseo', { agentId: agent.id, fast });
      }
      cache.agents[agent.id] = { context: current, fast: fastAvailable ? fast : previous.fast, model: patch.model || agent.model };
    } catch (error) { log('agent-error', { agentId: agent.id, message: error.message }); }
  }
  if (fastAvailable) cache.tier = tier;
}

async function main() {
  if (existsSync(lockPath)) {
    const lock = load(lockPath);
    if (alive(lock.pid)) return;
    unlinkSync(lockPath);
  }
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { flag: 'wx' });
  const launch = load(statePath);
  process.env.REM_CODEY_CDP_PORT = String(launch.cdpPort);
  let bridge, client;
  const cache = existsSync(cachePath) ? load(cachePath) : { agents: {} };
  const reader = new RolloutReader();
  const paths = new Map();
  let stopped = false;
  process.on('SIGTERM', () => { stopped = true; });
  try {
    bridge = await DesktopBridge.connect();
    const desktopSettings = new DesktopSettings(bridge);
    client = await connectPaseo(launch);
    save(lockPath, { pid: process.pid, daemonPid: launch.daemonPid, ready: true });
    log('ready', { daemonPid: launch.daemonPid });
    while (!stopped && client.isConnected && alive(launch.daemonPid)) {
      const live = load(statePath);
      if (live.stoppedAt || live.daemonPid !== launch.daemonPid) break;
      try {
        const agents = [];
        let cursor;
        do {
          const page = await client.fetchAgents(cursor ? { page: { cursor } } : undefined);
          agents.push(...page.entries.map(e => e.agent).filter(a => a.provider === 'codex' && !a.archivedAt));
          cursor = page.pageInfo?.hasMore ? page.pageInfo.nextCursor : null;
        } while (cursor);
        await syncSettingsPass({ agents, bridge, desktopSettings, client, reader, paths, cache, log });
        save(cachePath, cache);
      } catch (error) { log('poll-error', { message: error.message }); }
      if (process.argv.includes('--once')) break;
      await delay(1500);
    }
  } finally {
    await client?.close().catch(() => {});
    await bridge?.close().catch(() => {});
    if (existsSync(lockPath) && load(lockPath).pid === process.pid) unlinkSync(lockPath);
    log('stopped');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { log('fatal', { message: error.message }); process.exitCode = 1; });
}
