const empty = () => ({input:'', output:'', phase:'idle', requestId:null, error:'', sendAttempted:false, sendToken:null});

export function createPromptController({start, status, latest, send, delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
  newId = () => `opt-${Date.now()}-${Math.random().toString(36).slice(2)}`}) {
  const drafts = new Map();
  const listeners = new Set();
  const watches = new Map();
  let disposed = false;
  const get = id => {if (!drafts.has(id)) drafts.set(id, empty()); return drafts.get(id);};
  const update = (id, patch) => {
    if (disposed) return;
    drafts.set(id, {...get(id), ...patch});
    for (const listener of listeners) listener();
  };
  const current = (id, requestId) => !disposed && get(id).requestId === requestId;
  function apply(id, result) {
    if (!current(id, result.requestId)) return true;
    if (result.phase === 'running') return false;
    if (result.phase === 'sending') {update(id,{phase:'sending',sendAttempted:true});return false;}
    if (['sent','send-unknown'].includes(result.phase)) update(id,{phase:result.phase,output:result.optimized,sendAttempted:true,error:result.error||''});
    else if (result.phase === 'ready') update(id, {phase:'ready', output:result.optimized, error:''});
    else update(id, {phase:'idle', requestId:null, error:result.error || '优化失败'});
    return true;
  }
  async function poll(id, requestId) {
    if (watches.has(requestId)) return watches.get(requestId);
    const work = (async () => {
      for (let i = 0; i < 110 && current(id, requestId); i++) {
        try {if (apply(id, await status({agentId:id, requestId}))) return;}
        catch {if (current(id, requestId)) update(id, {phase:'waiting', error:'连接中断。点击“刷新结果”查询同一任务，不会重复优化。'}); return;}
        await delay(750);
      }
      if (current(id, requestId)) update(id, {phase:'waiting', error:'仍在等待优化结果，请稍后刷新。'});
    })();
    watches.set(requestId, work);
    try {await work;} finally {watches.delete(requestId);}
  }
  return {
    get,
    subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);},
    async restore(id) {
      const original=get(id);
      if (!latest || original.input || original.requestId) return;
      let result;
      try {result=await latest({agentId:id});} catch {return;}
      if (disposed || get(id)!==original || result.phase==='missing') return;
      update(id,{input:result.original,requestId:result.requestId,phase:'optimizing'});
      if(!apply(id,result)) await poll(id,result.requestId);
    },
    setInput(id, input) {update(id, {...empty(), input});},
    setOutput(id, output) {update(id, {output, phase:'ready', sendAttempted:false, sendToken:null, error:''});},
    async optimize(id) {
      const draft = get(id);
      if (['optimizing', 'sending', 'waiting'].includes(draft.phase)) return;
      const text = draft.input.trim();
      if (!text || text.length > 32768) {update(id, {error:'请输入 1–32768 字符的原始需求'}); return;}
      const requestId = newId();
      update(id, {requestId, phase:'optimizing', output:'', error:'', sendAttempted:false, sendToken:null});
      try {
        if (apply(id, await start({agentId:id, requestId, text}))) return;
        await poll(id, requestId);
      } catch {if (current(id, requestId)) update(id, {phase:'waiting', error:'提交结果未确认。请刷新结果，避免重复提交优化。'});}
    },
    async refresh(id) {
      const {requestId} = get(id);
      if (!requestId) return;
      update(id, {phase:'optimizing', error:''});
      await poll(id, requestId);
    },
    async send(id) {
      const draft = get(id);
      if (!draft.output.trim() || draft.sendAttempted || draft.phase !== 'ready') return false;
      const sendToken = newId();
      const text = draft.output;
      update(id, {phase:'sending', sendAttempted:true, sendToken, error:''});
      try {
        const result=await send({agentId:id,requestId:draft.requestId,text});
        if (get(id).sendToken !== sendToken) return false;
        if(!apply(id,result)) await poll(id,draft.requestId);
        return get(id).phase==='sent';
      } catch {
        if (get(id).sendToken === sendToken) update(id, {phase:'send-unknown', error:'发送结果未确认，请返回原会话检查。不会自动重发，文本仍可复制。'});
        return false;
      }
    },
    dispose() {disposed = true; listeners.clear(); drafts.clear();},
  };
}
