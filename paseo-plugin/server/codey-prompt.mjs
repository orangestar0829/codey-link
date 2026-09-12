import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {evaluateDesktop} from './desktop-rpc.mjs';

export async function optimizeWithCodey(text, home = process.env.PASEO_HOME) {
  if (!home) throw new Error('未找到 CodeyLink 专用服务，请重新运行启动器');
  const state = JSON.parse(await readFile(path.join(home, 'connection.json'), 'utf8'));
  if (!Number.isInteger(state.cdpPort)) throw new Error('Codey 连接信息已失效，请重新运行启动器');
  const id = randomUUID();
  // 固定调用优化入口，不开放任意 Desktop 脚本、路径或设置读取。
  const expression = `(async () => {
    const bridge = window.__codexSessionDeleteBridge;
    const state = window.__codeyPromptOptimize?.snapshot?.();
    if (typeof bridge !== 'function' || !state?.ready) return {error:'Codey 提示词优化尚未就绪'};
    if (!state.enabled) return {error:'请先在 Codey 中启用提示词优化'};
    const old = window.__codeyLinkPromptLease;
    if (state.buttonBusy || (old && old.until > Date.now())) return {error:'Codey 正在优化其他文本，请稍后重试'};
    const id = ${JSON.stringify(id)};
    window.__codeyLinkPromptLease = {id, until:Date.now()+90000};
    let timer;
    try {
      const operation = Promise.resolve().then(() => bridge('/api/optimize_prompt', {text:${JSON.stringify(text)}}));
      operation.finally(() => {
        if (window.__codeyLinkPromptLease?.id === id) delete window.__codeyLinkPromptLease;
      }).catch(() => {});
      const result = await Promise.race([operation, new Promise(resolve => {
        timer = setTimeout(() => resolve({message:'Codey 优化等待超时，请稍后检查后重试'}), 75000);
      })]);
      if (typeof result?.optimized === 'string' && result.optimized.trim()) return {optimized:result.optimized};
      return {error:String(result?.message || 'Codey 没有返回优化结果').slice(0,800)};
    } catch (error) {return {error:String(error?.message || 'Codey 优化调用失败').slice(0,800)};}
    finally {clearTimeout(timer);}
  })()`;
  const value = await evaluateDesktop(state.cdpPort, expression);
  if (value?.error) throw new Error(value.error);
  if (typeof value?.optimized !== 'string' || value.optimized.length > 65536) throw new Error('Codey 返回了无效的优化结果');
  return value.optimized;
}
