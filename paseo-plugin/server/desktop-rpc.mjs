// 插件编译器不允许引用 tools/；这里只保留一次性、环回连接的 Desktop 求值传输。
export async function evaluateDesktop(port, expression) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Desktop 调试端口无效');
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {signal:AbortSignal.timeout(5000)});
  if (!response.ok) throw new Error('无法连接当前 Desktop');
  const targets = await response.json();
  const target = targets.find(item => item.type === 'page' && item.url?.startsWith('app://-/index.html') && !item.url.includes('avatar-overlay'));
  if (!target?.webSocketDebuggerUrl) throw new Error('未找到当前 Desktop 页面');
  const endpoint = new URL(target.webSocketDebuggerUrl);
  if (endpoint.protocol !== 'ws:' || !['127.0.0.1','localhost'].includes(endpoint.hostname) || Number(endpoint.port) !== port) {
    throw new Error('Desktop 调试连接不属于本机目标端口');
  }
  const socket = new WebSocket(endpoint);
  try {
    return await new Promise((resolve, reject) => {
      let connected = false;
      let timer = setTimeout(() => reject(new Error('Desktop 连接超时')), 5000);
      const fail = message => {clearTimeout(timer);reject(new Error(message));};
      socket.addEventListener('open', () => {
        connected = true; clearTimeout(timer);
        timer = setTimeout(() => fail('等待 Codey 优化超时'), 85000);
        socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
      }, {once:true});
      socket.addEventListener('error', () => fail('Desktop 调试连接失败'), {once:true});
      socket.addEventListener('close', () => fail(connected?'Desktop 调试连接已断开':'Desktop 连接失败'), {once:true});
      socket.addEventListener('message', event => {
        let message;
        try {message = JSON.parse(event.data);} catch {fail('Desktop 响应格式无效');return;}
        if (message.id !== 1) return;
        clearTimeout(timer);
        if (message.error || message.result?.exceptionDetails) fail('Desktop 优化调用失败，请检查电脑端状态');
        else resolve(message.result?.result?.value);
      });
    });
  } finally {socket.close();}
}
