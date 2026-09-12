import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { contextSettings, settingsPatch, isFast } from '../tools/settings_sync_policy.mjs';
import { RolloutReader, syncSettingsPass } from '../tools/paseo_settings_sync.mjs';
import './desktop-bridge-check.mjs';
import './image-preview-check.mjs';
import './turn-identification-check.mjs';
import './paseo-version-hooks-check.mjs';

const first = { turnId: 'a', model: 'gpt-6-astra', effort: 'medium' };
const pending = { model: 'gpt-5.6-luna', thinkingOptionId: 'high' };
assert.deepEqual(settingsPatch(first, first, pending), {}, 'Do not overwrite unsent Paseo choices');
assert.deepEqual(settingsPatch(first, { ...first, turnId: 'b' }, pending), { model: first.model, effort: 'medium' });
assert.deepEqual(settingsPatch(null, { ...first, effort: null }, pending), { model: first.model });
assert.equal(isFast('priority'), true);
assert.equal(isFast('fast'), true);
assert.equal(isFast('default'), false);
const record = { type: 'turn_context', payload: { turn_id: 'a', model: first.model, effort: 'high', collaboration_mode: { settings: { reasoning_effort: 'medium' } } } };
assert.deepEqual(contextSettings(record), first);
const dir = await mkdtemp(path.join(os.tmpdir(), 'rem-settings-check-'));
try {
  const file = path.join(dir, 'rollout.jsonl');
  const reader = new RolloutReader();
  const line = JSON.stringify(record);
  await writeFile(file, line.slice(0, 30));
  assert.equal(await reader.read(file), null);
  await appendFile(file, line.slice(30) + '\n');
  assert.deepEqual(await reader.read(file), first);
  await appendFile(file, JSON.stringify({ type: 'event_msg', payload: { message: '你好' } }) + '\n');
  assert.deepEqual(await reader.read(file), first);
  await writeFile(file, '');
  assert.equal(await reader.read(file), null, 'Handle truncated/rewound rollout');
} finally { await rm(dir, { recursive: true }); }
// 复现构建升级导致 Fast 读取失败，模型与强度仍必须同步。
const agent = { id: 'test-agent', persistence: { sessionId: 'test-thread' }, ...pending,
  features: [{ id: 'fast_mode', value: true }] };
const calls = [], events = [];
const cache = { tier: 'default', agents: { [agent.id]: { context: null, fast: false, model: pending.model } } };
let unsupported = true;
const pass = {
  agents: [agent], cache, paths: new Map([['test-thread', 'test-rollout']]),
  reader: { read: async () => first },
  bridge: { request: async method => { calls.push(method); assert.equal(method, 'config/read'); return { config: {} }; } },
  desktopSettings: {
    tier: async () => { if (unsupported) throw new Error('Unsupported Desktop build'); return 'default'; },
    setTier: async () => assert.fail('Do not enable Fast from a stale baseline'),
  },
  client: {
    setAgentModel: async (_, model) => { agent.model = model; calls.push('model'); },
    setAgentThinkingOption: async (_, effort) => { agent.thinkingOptionId = effort; calls.push('effort'); },
    fetchAgent: async () => ({ agent }),
    setAgentFeature: async (_, feature, value) => { assert.equal(value, false); calls.push('fast'); agent.features[0].value = value; },
  },
  log: event => events.push(event),
};
await syncSettingsPass(pass);
assert.deepEqual(calls, ['config/read', 'model', 'effort']);
assert.equal('tier' in cache, false);
assert.equal(cache.agents[agent.id].fast, false, 'Do not accept an unverified Fast baseline');
assert(events.includes('fast-sync-error'));
// 再次失败不会覆盖尚未发送的选择。
agent.model = pending.model;
agent.thinkingOptionId = pending.thinkingOptionId;
calls.length = 0;
await syncSettingsPass(pass);
assert.deepEqual(calls, ['config/read']);
// 恢复后以 Desktop 重建基线，不把失联期间的差异解释为付费档位开启请求。
unsupported = false;
calls.length = 0;
await syncSettingsPass(pass);
assert.deepEqual(calls, ['config/read', 'fast']);
assert.equal(cache.tier, 'default');
assert.equal(agent.model, pending.model);
console.log('settings policy, incremental rollout and Fast failure isolation checks passed');
