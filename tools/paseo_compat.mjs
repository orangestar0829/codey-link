import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only the dedicated daemon opts in. The installed/original Paseo is untouched.
const home = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.paseo-codey');

export function bindAcknowledgedTurn(session, response, foregroundTurnId) {
  const nativeTurnId = response?.turn?.id;
  const identification = session.pendingForegroundTurnIdentification;
  // 原生事件可能先于响应到达，或该轮已经结束；不得覆盖较新的状态。
  if (session.activeForegroundTurnId !== foregroundTurnId || session.currentTurnId ||
      identification?.foregroundTurnId !== foregroundTurnId ||
      typeof nativeTurnId !== 'string' || !nativeTurnId.trim() ||
      response.turn.status !== 'inProgress') return false;
  session.currentTurnId = nativeTurnId;
  identification.resolve(nativeTurnId);
  session.pendingForegroundTurnIdentification = null;
  return true;
}

export function patchTurnIdentification(source) {
  const start = '            await this.client.request("turn/start", turnStart.params, TURN_START_TIMEOUT_MS);';
  const started = '        this.currentTurnId = parsed.turnId;\n        const pendingIdentification = this.pendingForegroundTurnIdentification;';
  if (source.split(start).length !== 2 || source.split(started).length !== 2) {
    throw new Error('Paseo turn identification compatibility hook needs review for this installed version');
  }
  return `${bindAcknowledgedTurn.toString()}\n${source}`
    .replace(start, '            const acknowledgedStart = await this.client.request("turn/start", turnStart.params, TURN_START_TIMEOUT_MS);\n            bindAcknowledgedTurn(this, acknowledgedStart, turnId);')
    .replace(started, '        if (this.currentTurnId === parsed.turnId && !this.pendingForegroundTurnIdentification) return;\n' + started);
}

export function patchUserMessageIdentity(source) {
  const original = '        const params = {\n            threadId: this.currentThreadId,\n            input,\n        };';
  if (source.split(original).length !== 2) {
    throw new Error('Paseo user message identity compatibility hook needs review for this installed version');
  }
  // 与原生 steer 请求一致，把发送端的标识存进后端历史，不能依赖正文猜测附件归属。
  return source.replace(original, '        const params = {\n            threadId: this.currentThreadId,\n            input,\n            ...(options?.clientMessageId ? { clientUserMessageId: options.clientMessageId } : {}),\n        };');
}

export function patchFastModels(source, models) {
  if (!Array.isArray(models) || !models.every(model => typeof model === 'string')) throw new Error('Invalid Codey Fast model capabilities');
  // 0.7 使用前缀列表，0.8 改为明确的模型集合；只接受这两种已核验结构。
  const candidates = [
    'return CODEX_FAST_MODE_SUPPORTED_MODEL_PREFIXES.some((prefix) => normalizedModelId === prefix || normalizedModelId.startsWith(prefix));',
    'return CODEX_FAST_MODE_SUPPORTED_MODELS.has(normalizedModelId);',
  ];
  const matches = candidates.filter(candidate => source.includes(candidate));
  if (matches.length !== 1 || source.split(matches[0]).length !== 2) throw new Error('Paseo Fast compatibility hook needs review for this installed version');
  return source.replace(matches[0], `return ${JSON.stringify(models)}.includes(normalizedModelId);`);
}

if (process.env.PASEO_HOME && path.resolve(process.env.PASEO_HOME) === home) {
  registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (url.replaceAll('\\', '/').endsWith('/agent/providers/codex-app-server-agent.js')) {
        const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
        return { ...result, source: patchUserMessageIdentity(patchTurnIdentification(source)) };
      }
      if (!url.replaceAll('\\', '/').endsWith('/agent/providers/codex-feature-definitions.js')) return result;
      const models = JSON.parse(readFileSync(path.join(home, 'fast-models.json'), 'utf8')).models;
      const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
      return { ...result, source: patchFastModels(source, models) };
    },
  });
}
