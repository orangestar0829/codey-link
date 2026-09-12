import assert from 'node:assert/strict';
import { bindAcknowledgedTurn, patchTurnIdentification, patchUserMessageIdentity } from '../tools/paseo_compat.mjs';

function pending() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { activeForegroundTurnId: 'local-turn', currentTurnId: null,
    pendingForegroundTurnIdentification: { foregroundTurnId: 'local-turn', promise, resolve } };
}
const response = { turn: { id: 'native-turn', status: 'inProgress' } };
const session = pending(), identification = session.pendingForegroundTurnIdentification;
assert.equal(bindAcknowledgedTurn(session, response, 'local-turn'), true);
assert.equal(await identification.promise, 'native-turn');
assert.equal(session.currentTurnId, 'native-turn');
assert.equal(session.pendingForegroundTurnIdentification, null);
assert.equal(bindAcknowledgedTurn(session, response, 'local-turn'), false);

for (const mutation of [s => { s.currentTurnId = 'new-native-turn'; }, s => { s.activeForegroundTurnId = null; }, s => { s.activeForegroundTurnId = 'new-local-turn'; }]) {
  const s = pending(); mutation(s);
  const before = { ...s };
  assert.equal(bindAcknowledgedTurn(s, response, 'local-turn'), false);
  assert.deepEqual(s, before, 'Do not revive completed turns or overwrite native events');
}
for (const invalid of [{}, { turn: { id: '', status: 'inProgress' } }, { turn: { id: 'native', status: 'completed' } }]) {
  assert.equal(bindAcknowledgedTurn(pending(), invalid, 'local-turn'), false);
}
assert.throws(() => patchTurnIdentification('unknown upstream source'), /needs review/);
const paramsSource = '        const params = {\n            threadId: this.currentThreadId,\n            input,\n        };';
const buildParams = new Function('input', 'options', `${patchUserMessageIdentity(paramsSource)}\nreturn params;`);
const input = [{ type: 'text', text: 'same text may have different attachments' }];
assert.deepEqual(buildParams.call({currentThreadId:'thread'},input,{clientMessageId:'mobile-id'}), {threadId:'thread',input,clientUserMessageId:'mobile-id'});
assert.deepEqual(buildParams.call({currentThreadId:'thread'},input), {threadId:'thread',input});
assert.throws(() => patchUserMessageIdentity('unknown'), /needs review/);
assert.throws(() => patchUserMessageIdentity(paramsSource + paramsSource), /needs review/);
console.log('Turn acknowledgement identity checks passed');
