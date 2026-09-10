import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only the dedicated daemon opts in. The installed/original Paseo is untouched.
const home = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.paseo-codey');
if (process.env.PASEO_HOME && path.resolve(process.env.PASEO_HOME) === home) {
  registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (!url.replaceAll('\\', '/').endsWith('/agent/providers/codex-feature-definitions.js')) return result;
      const models = JSON.parse(readFileSync(path.join(home, 'fast-models.json'), 'utf8')).models;
      if (!Array.isArray(models) || !models.every(x => typeof x === 'string')) throw new Error('Invalid Codey Fast model capabilities');
      const original = 'return CODEX_FAST_MODE_SUPPORTED_MODEL_PREFIXES.some((prefix) => normalizedModelId === prefix || normalizedModelId.startsWith(prefix));';
      const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
      if (source.split(original).length !== 2) throw new Error('Paseo Fast compatibility hook needs review for this installed version');
      return { ...result, source: source.replace(original, `return ${JSON.stringify(models)}.includes(normalizedModelId);`) };
    },
  });
}
