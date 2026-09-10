import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { contextSettings, settingsPatch, isFast } from '../tools/settings_sync_policy.mjs';
import { RolloutReader } from '../tools/paseo_settings_sync.mjs';

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
console.log('settings policy and incremental rollout checks passed');
