import assert from 'node:assert/strict';
import {patchFastModels} from '../tools/paseo_compat.mjs';
const legacy='return CODEX_FAST_MODE_SUPPORTED_MODEL_PREFIXES.some((prefix) => normalizedModelId === prefix || normalizedModelId.startsWith(prefix));';
const current='return CODEX_FAST_MODE_SUPPORTED_MODELS.has(normalizedModelId);';
for(const source of [legacy,current]) {
  const supports=new Function('normalizedModelId',patchFastModels(source,['gpt-6-astra','gpt-5.6-luna']));
  assert.equal(supports('gpt-6-astra'),true);
  assert.equal(supports('gpt-6-astra-unknown'),false);
  assert.equal(supports('not-supported'),false);
}
for(const source of ['unknown',legacy+current,current+current]) assert.throws(()=>patchFastModels(source,[]),/needs review/);
assert.throws(()=>patchFastModels(current,[null]),/Invalid/);
console.log('Paseo 0.7/0.8 Fast hook guards passed');
