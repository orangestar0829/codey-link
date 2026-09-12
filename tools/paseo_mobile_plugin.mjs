import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = path.join(root, '.paseo-codey');
const pluginId = 'codey-link-mobile';
const action = process.argv[2] ?? 'status';
const exec = promisify(execFile);

async function main() {
  if (action === '--help') {
    console.log('用法：node tools/paseo_mobile_plugin.mjs install|reload|disable|status\n只操作本项目启动器已验证的专用 daemon，需要电脑和手机 Paseo 0.8.x。');
    return;
  }
  if (!['install', 'reload', 'disable', 'status'].includes(action) || process.argv.length > 3) {
    throw new Error('请选择 install、reload、disable 或 status');
  }
  const state = JSON.parse(await readFile(path.join(home, 'connection.json'), 'utf8'));
  if (!state.paseoExe || !Number.isInteger(state.port) || state.port < 1 || state.port > 65535) {
    throw new Error('启动信息不完整，请先通过本项目启动器启动专用 daemon');
  }
  const resources = path.join(path.dirname(state.paseoExe), 'resources');
  const runner = path.join(resources, 'app.asar.unpacked/dist/daemon/node-entrypoint-runner.js');
  const cli = path.join(resources, 'app.asar/node_modules/@getpaseo/cli/dist/index.js');
  const env = {...process.env, ELECTRON_RUN_AS_NODE: '1', PASEO_NODE_ENV: 'production', PASEO_DESKTOP_MANAGED: '0', PASEO_HOME: home};
  const call = async (args) => {
    const result = await exec(state.paseoExe, ['--disable-warning=DEP0040', runner, 'node-script', cli, ...args], {
      cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024,
    });
    return result.stdout.trim();
  };
  const version = await call(['--version']);
  if (!/^0\.8\.\d+$/.test(version)) throw new Error(`当前 Paseo CLI 为 ${version}，手机插件需要 0.8.x；请升级后重新运行主启动器`);
  const status = JSON.parse(await call(['daemon', 'status', '--home', home, '--json']));
  // 同时核对目录、端口、运行时版本，避免操作默认服务或只更新了 CLI 的旧 daemon。
  if (status.localDaemon !== 'running' || status.connectedDaemon !== 'reachable' ||
      path.resolve(status.home ?? '') !== home || status.listen !== `127.0.0.1:${state.port}` ||
      !/^0\.8\.\d+$/.test(status.daemonVersion ?? '') ||
      path.resolve(status.daemonNode ?? '') !== path.resolve(state.paseoExe)) {
    throw new Error('未找到匹配的 Paseo 0.8.x 专用 daemon，请先用主启动器重新启动服务');
  }
  const host = `127.0.0.1:${state.port}`;
  const command = action === 'install' ? ['install', path.join(root, 'paseo-plugin')]
    : action === 'status' ? ['ls', pluginId] : [action, pluginId];
  console.log(await call(['plugin', ...command, '--host', host, '--json']));
  if (action === 'install' || action === 'reload') {
    console.log('在此专用服务的 Settings → Plugins 中开启 Enable plugins 和 codey-link-mobile，然后重新进入会话。');
  }
}

main().catch(error => {
  console.error(`手机插件操作失败：${error.stderr || error.stdout || error.message}`);
  process.exitCode = 1;
});
