import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DesktopBridge } from './desktop_bridge.mjs';
import { readImageConfig, imageConfigEnv } from './image_preview.mjs';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = path.join(root, '.paseo-codey');
const configPath = path.join(home, 'config.json');
const statePath = path.join(home, 'connection.json');
const args = process.argv.slice(2);
const flags = new Set(['--stop', '--relay', '--no-browser', '--no-pause', '--check-only', '--help']);
const options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (flags.has(key)) options[key] = true;
  else if (['--port', '--cdp-port', '--paseo-exe'].includes(key) && args[i + 1]) options[key] = args[++i];
  else { console.error(`未知参数或缺少参数值：${key}`); process.exit(1); }
}

const loadJson = file => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : null;
function writeJson(file, data) {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, file);
}
function portNumber(value, label) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 65535) throw new Error(`${label} 必须是 1–65535 的整数`);
  return result;
}
async function processSnapshot() {
  const command = `$ErrorActionPreference='Stop'
$OutputEncoding=[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$items=Get-CimInstance Win32_Process | Where-Object {$_.Name -in @('Codey.exe','codex.exe','ChatGPT.exe','Paseo.exe')}
@($items | ForEach-Object {
  $p=$_
  $match=[regex]::Match([string]$p.CommandLine,'--remote-debugging-port[= ](\\d+)')
  [pscustomobject]@{pid=$p.ProcessId;ppid=$p.ParentProcessId;name=$p.Name;exe=$p.ExecutablePath;appServer=([string]$p.CommandLine -match 'app-server');fastctx=([string]$p.CommandLine -match 'mcp_servers.codey_fastctx');cdpPort=if($match.Success){[int]$match.Groups[1].Value}else{0}}
}) | ConvertTo-Json -Depth 3 -Compress`;
  const { stdout } = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    { windowsHide: true, encoding: 'utf8', timeout: 15000 });
  return JSON.parse(stdout.replace(/^\uFEFF/, ''));
}
function resolvePaseo(processes, oldState) {
  // 优先复用专用服务选定的运行时，避免被另一个 Paseo 窗口切回旧版。
  const candidates = [options['--paseo-exe'], oldState?.paseoExe,
    ...processes.filter(p => p.name.toLowerCase() === 'paseo.exe').map(p => p.exe),
    path.resolve(root, '..', 'tool', 'Paseo', 'Paseo.exe')].filter(Boolean);
  for (const exe of candidates) {
    const resources = path.join(path.dirname(exe), 'resources');
    const runner = path.join(resources, 'app.asar.unpacked', 'dist', 'daemon', 'node-entrypoint-runner.js');
    if (existsSync(exe) && existsSync(runner)) return { exe, runner,
      cli: path.join(resources, 'app.asar', 'node_modules', '@getpaseo', 'cli', 'dist', 'index.js') };
  }
  throw new Error('找不到 Paseo 安装目录。先打开 Paseo，或使用 --paseo-exe 指定 Paseo.exe。');
}
function paseoClient(install) {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PASEO_NODE_ENV: 'production', PASEO_DESKTOP_MANAGED: '0', PASEO_HOME: home };
  // Launch overrides lock the relay toggle. Keep its value in config.json so the UI can change it.
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'PASEO_RELAY_ENABLED') delete env[key];
  }
  const hook = `--import=${pathToFileURL(path.join(root, 'tools/paseo_compat.mjs')).href}`;
  env.NODE_OPTIONS = [env.NODE_OPTIONS, hook].filter(Boolean).join(' ');
  return async (argv, timeout = 45000) => {
    try {
      return await exec(install.exe, ['--disable-warning=DEP0040', install.runner, 'node-script', install.cli, ...argv], {
        windowsHide: true, cwd: root, encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024,
        env,
      });
    } catch (error) {
      throw new Error((error.stderr || error.stdout || error.message).trim());
    }
  };
}
async function statusOf(paseo) {
  if (!existsSync(configPath)) return null;
  try { return JSON.parse((await paseo(['daemon', 'status', '--home', home, '--json'], 20000)).stdout); }
  catch { return null; }
}
async function requireFreePort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`本机端口 ${port} 已被其他进程占用。可使用 --port 17678，脚本不会终止占用进程。`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
async function probeCodey(processes) {
  const candidates = processes.filter(p => p.name.toLowerCase() === 'codex.exe' && p.appServer).map(backend => {
    const wrapper = processes.find(p => p.pid === backend.ppid && p.name.toLowerCase() === 'codey.exe' && p.appServer);
    const desktop = wrapper && processes.find(p => p.pid === wrapper.ppid && p.cdpPort);
    return { backend, wrapper, desktop };
  }).filter(p => p.desktop);
  const chosenPort = options['--cdp-port'] ? portNumber(options['--cdp-port'], 'CDP 端口') : null;
  const matches = chosenPort ? candidates.filter(p => p.desktop.cdpPort === chosenPort) : candidates;
  if (chosenPort && !matches.length && candidates.length) throw new Error(`CDP 端口 ${chosenPort} 不属于检测到的 Codey Desktop；当前端口：${candidates.map(p => p.desktop.cdpPort).join(', ')}。`);
  if (matches.length !== 1) throw new Error(matches.length ? '发现多个 Codey Desktop 后端，请用 --cdp-port 选择。' : '未找到 Codey 启动的 Codex Desktop 后端。请先用 Codey 打开 Codex Desktop，并保持应用运行。');
  const { backend, wrapper, desktop } = matches[0];
  process.env.REM_CODEY_CDP_PORT = String(desktop.cdpPort);
  let bridge;
  try {
    bridge = await DesktopBridge.connect();
    const config = (await bridge.request('config/read', { includeLayers: false })).config;
    if (!config?.mcp_servers?.codey_fastctx || !config?.agents?.codey_quick_scan || !config?.developer_instructions?.includes('CODEY_DELEGATION_V2')) {
      throw new Error('当前后端缺少 FastCtx、具名子代理或 Codey 运行时指令');
    }
    const loaded = await bridge.request('thread/loaded/list');
    const models = (await bridge.request('model/list', { includeHidden: false })).data;
    const fastModels = models.filter(model => model.additionalSpeedTiers?.includes('fast') ||
      model.serviceTiers?.some(tier => ['priority', 'fast'].includes(tier.id))).map(model => model.model);
    const version = (await exec(backend.exe, ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 10000 })).stdout.trim();
    if (!/^codex-cli \d+\.\d+\.\d+/.test(version)) throw new Error('无法识别当前 Codex 后端版本');
    return { backendPid: backend.pid, backendExe: backend.exe, backendVersion: version, wrapperPid: wrapper.pid,
      desktopPid: desktop.pid, cdpPort: desktop.cdpPort, loadedThreads: loaded.data.length, fastModels, checkedAt: new Date().toISOString() };
  } catch (error) { throw new Error(`连接当前 Codey 后端失败：${error.message}`); }
  finally { if (bridge) await bridge.close().catch(() => {}); }
}

async function main() {
  if (options['--help']) {
    console.log('双击“启动-Paseo-Codey.cmd”启动，双击“停止-Paseo-Codey.cmd”停止。\n可选：--relay 手机中继配对；--port 17678；--no-browser；--check-only；--no-pause。');
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('需要 Node.js 22 或更新版本');
  // 启动时验证配置并固定传递给 daemon / provider；停止不受错误配置阻碍。
  const imageEnv = options['--stop'] ? {} : imageConfigEnv(readImageConfig());
  Object.assign(process.env, imageEnv);
  const oldState = loadJson(statePath);
  const processes = await processSnapshot();
  const install = resolvePaseo(processes, oldState);
  const paseo = paseoClient(install);
  if (options['--stop']) {
    if (!existsSync(configPath)) { console.log('专用 Paseo daemon 尚未启动。'); return; }
    const stopped = JSON.parse((await paseo(['daemon', 'stop', '--home', home, '--json'])).stdout);
    console.log(stopped.message || '专用 Paseo daemon 已停止。');
    if (oldState) writeJson(statePath, { ...oldState, stoppedAt: new Date().toISOString() });
    console.log('Codey Desktop 后端保持运行。');
    return;
  }
  console.log('[1/4] 检查当前 Codey Desktop 后端…');
  const backend = await probeCodey(processes);
  console.log(`已连接：PID ${backend.backendPid}，${backend.backendVersion}，FastCtx / Codey 子代理正常。`);
  if (options['--check-only']) return;
  const existing = loadJson(configPath);
  const port = portNumber(options['--port'] || existing?.daemon?.listen?.split(':').at(-1) || 17677, 'Paseo 端口');
  const relay = options['--relay'] || existing?.daemon?.relay?.enabled === true;
  const config = existing ? structuredClone(existing) : {
    version: 1, features: { dictation: { enabled: false }, voiceMode: { enabled: false } },
    agents: { providers: Object.fromEntries(['claude', 'copilot', 'opencode', 'pi', 'omp'].map(id => [id, { enabled: false }])) },
  };
  config.daemon = { ...config.daemon, listen: `127.0.0.1:${port}`, relay: { ...config.daemon?.relay, enabled: relay } };
  config.agents ||= {};
  config.agents.providers ||= {};
  config.agents.providers.codex = { ...config.agents.providers.codex, enabled: true,
    command: [process.execPath, path.join(root, 'tools', 'paseo_desktop_shim.mjs')],
    env: { ...config.agents.providers.codex?.env, ...imageEnv, REM_CODEY_CDP_PORT: String(backend.cdpPort),
      REM_CODEY_RUNTIME_STATE: statePath, REM_CODEY_BRIDGE_LOG: path.join(home, 'logs', 'bridge.jsonl'),
      REM_CODEY_ENFORCE_CAPABILITIES: '1', REM_CODEY_LOG_RAW_EVENTS: '0' },
  };
  let daemon = await statusOf(paseo);
  const running = daemon?.localDaemon === 'running';
  if (running && (JSON.stringify(existing) !== JSON.stringify(config))) {
    throw new Error('专用 daemon 正在运行，但本次连接配置发生变化。先运行“停止-Paseo-Codey.cmd”，再重新启动。');
  }
  if (!running) await requireFreePort(port);
  mkdirSync(home, { recursive: true });
  writeJson(path.join(home, 'fast-models.json'), { models: backend.fastModels, checkedAt: backend.checkedAt });
  if (JSON.stringify(existing) !== JSON.stringify(config)) {
    if (existing) copyFileSync(configPath, `${configPath}.backup-${Date.now()}`);
    writeJson(configPath, config);
  }
  const state = { ...backend, home, port, relay, paseoExe: install.exe, nodeExe: process.execPath, url: `http://127.0.0.1:${port}` };
  writeJson(statePath, state);
  let started = false;
  try {
    console.log(running ? '[2/4] 专用 daemon 已运行，复用现有进程…' : '[2/4] 启动专用 Paseo daemon…');
    if (!running) {
      await paseo(['daemon', 'start', '--home', home, '--listen', `127.0.0.1:${port}`,
        '--no-inject-mcp', '--web-ui'], 60000);
      started = true;
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      daemon = await statusOf(paseo);
      if (daemon?.localDaemon === 'running' && daemon.connectedDaemon === 'reachable') break;
      await delay(500);
    }
    if (daemon?.localDaemon !== 'running' || daemon.connectedDaemon !== 'reachable' || path.resolve(daemon.home) !== home || daemon.listen !== `127.0.0.1:${port}`) {
      throw new Error('专用 Paseo daemon 未通过存活 / 目录 / 端口检查');
    }
    console.log('[3/4] 通过 Paseo provider 验证原 Codey 后端连接…');
    const models = JSON.parse((await paseo(['provider', 'models', 'codex', '--host', `127.0.0.1:${port}`, '--json'])).stdout);
    if (!models || (Array.isArray(models) && !models.length)) throw new Error('Paseo 未返回 Codex 模型列表');
    const response = await fetch(state.url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok || !(await response.text()).toLowerCase().includes('<html')) throw new Error('Paseo Web 界面未就绪');
    writeJson(statePath, { ...state, daemonPid: daemon.pid, verifiedAt: new Date().toISOString() });
    await ensureSettingsSync(install, daemon.pid);
    console.log(`[4/4] 启动成功。Paseo PID ${daemon.pid} → 原 Codey 后端 PID ${backend.backendPid}`);
    console.log(`\n本机入口：${state.url}\n数据目录：${home}\n关闭此窗口后，daemon 继续运行。`);
    if (relay) {
      console.log('\n手机配对：');
      console.log((await paseo(['daemon', 'pair', '--home', home, '--relay'])).stdout);
    }
    if (!options['--no-browser']) {
      const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', state.url], { windowsHide: true, detached: true, stdio: 'ignore' });
      browser.on('error', error => console.error(`自动打开浏览器失败，请手动打开上面的地址：${error.message}`));
      browser.unref();
    }
  } catch (error) {
    if (started) {
      console.error('启动验证失败，正在关闭本次新启动的专用 daemon…');
      await paseo(['daemon', 'stop', '--home', home, '--json']).catch(stopError => console.error(stopError.message));
    }
    throw error;
  }
}

async function ensureSettingsSync(install, daemonPid) {
  const lockPath = path.join(home, 'settings-sync.pid.json');
  const lock = loadJson(lockPath);
  if (lock?.ready && lock.daemonPid === daemonPid) {
    try { process.kill(lock.pid, 0); return; } catch {}
  }
  const child = spawn(install.exe, ['--disable-warning=DEP0040', install.runner, 'node-script',
    path.join(root, 'tools/paseo_settings_sync.mjs')], {
    cwd: root, windowsHide: true, detached: true, stdio: 'ignore',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PASEO_NODE_ENV: 'production', PASEO_HOME: home },
  });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  child.unref();
  for (let i = 0; i < 30; i++) {
    if (spawnError) throw spawnError;
    const current = loadJson(lockPath);
    if (current?.ready && current.daemonPid === daemonPid) return;
    await delay(500);
  }
  throw new Error('会话设置同步进程未就绪，请检查 .paseo-codey/logs/settings-sync.jsonl');
}

main().catch(error => { console.error(`\n启动 / 停止失败：${error.message}`); process.exitCode = 1; });
