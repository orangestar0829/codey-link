// 任务仅驻留内存。查询不会再次调用模型，重复的提交标识返回同一个任务。
export function createPromptJobs(optimize, {now = Date.now, ttl = 300000, limit = 20} = {}) {
  const jobs = new Map();
  let active = null;
  let disposed = false;
  function prune() {
    for (const [id, job] of jobs) {
      if (!['running','sending'].includes(job.phase) && now() - job.finishedAt > ttl) jobs.delete(id);
    }
  }
  function view(job) {
    return {requestId:job.requestId, phase:job.phase, original:job.text, optimized:job.sentText ?? job.optimized ?? '', error:job.error ?? ''};
  }
  return {
    start({requestId, agentId, text}) {
      if (disposed) throw new Error('插件正在关闭');
      prune();
      const existing = jobs.get(requestId);
      if (existing) {
        if (existing.agentId !== agentId || existing.text !== text) throw new Error('优化请求标识已被使用');
        return view(existing);
      }
      if (active) return {requestId, phase:'rejected', original:text, optimized:'', error:'已有优化正在运行，请稍后重试'};
      while (jobs.size >= limit) {
        const oldest = [...jobs].find(([,item])=>!['running','sending'].includes(item.phase));
        if (!oldest) throw new Error('请等待当前操作完成');
        jobs.delete(oldest[0]);
      }
      const job = {requestId, agentId, text, phase:'running'};
      jobs.set(requestId, job);
      active = requestId;
      void Promise.resolve().then(() => optimize(text)).then(optimized => {
        job.phase = 'ready'; job.optimized = optimized;
      }, error => {
        job.phase = 'failed'; job.error = error.message || '优化失败';
      }).finally(() => {job.finishedAt = now(); if (active === requestId) active = null;});
      return view(job);
    },
    status({requestId, agentId}) {
      prune();
      const job = jobs.get(requestId);
      if (!job || job.agentId !== agentId) return {requestId, phase:'missing', original:'', optimized:'', error:'优化任务不存在或已过期，原文仍可继续使用'};
      return view(job);
    },
    latest({agentId}) {
      prune();
      const job = [...jobs.values()].filter(item=>item.agentId===agentId).at(-1);
      return job ? view(job) : {requestId:'',phase:'missing',original:'',optimized:'',error:''};
    },
    confirm({requestId,agentId,text}, send) {
      prune();
      const job = jobs.get(requestId);
      if (!job || job.agentId !== agentId) throw new Error('优化结果已过期，请复制文本到会话中发送');
      // 发送标记在异步调用前写入；断线或换设备后，同一任务也不会再次提交。
      if (job.sentText !== undefined) return view(job);
      if (job.phase !== 'ready') throw new Error('请等待优化完成');
      job.sentText = text; job.phase = 'sending'; job.error = '';
      void Promise.resolve().then(()=>send(agentId,text)).then(()=>{job.phase='sent';},()=>{
        job.phase='send-unknown';job.error='发送结果未确认，请返回原会话检查。不会自动重发，文本仍可复制。';
      }).finally(()=>{job.finishedAt=now();});
      return view(job);
    },
    dispose() {disposed = true; jobs.clear();},
  };
}
