# Codey Desktop / Paseo bridge

通过本机 Codex Desktop 已有的连接，让 Paseo 使用当前 Codey 后端，并保留 FastCtx 和 Codey 子代理能力。适配器不会另起 Codex app-server。

## 环境要求

- Windows，Node.js 22 或更新版本。
- 已安装 Paseo，且 Codey 启动的 Codex Desktop 正在运行。
- Desktop 已开启本机 CDP 调试端口，后端具有 Codey 运行时能力。

当前已验证的组合为 Paseo 0.7.2、Codex CLI 0.153.4，原生 Fast 选择器对应 Desktop 资源版本 `app-initial-92cbfeba4f7c.js`。适配依赖 Desktop 内部接口；应用升级后需要重新验证。

## 启动与停止

双击 `启动-Paseo-Codey.cmd`。脚本自动检测当前 Codey 进程、CDP 端口和 Paseo 安装目录，验证后启动专用 daemon、设置同步进程，并打开 Web 页面。默认入口为 `http://127.0.0.1:17677`。

重复启动会复用现有专用进程。关闭命令行窗口不停止服务；双击 `停止-Paseo-Codey.cmd` 停止专用 daemon，同步进程随后退出，Codey 后端保持运行。

Node 应位于 PATH；也可用环境变量 `REM_CODEY_NODE` 指定 Node 可执行文件。需要手动指定 Paseo 时，将安装程序位置作为 `--paseo-exe` 的参数传入，不要把本机安装路径写进受版本管理的脚本。

在仓库目录中也可以运行：

```powershell
# 仅检查后端，不启动或停止 daemon
node tools/launch_paseo_codey.mjs --check-only

# 启动但不打开浏览器
node tools/launch_paseo_codey.mjs --no-browser

# 启用 relay 并显示手机配对信息
node tools/launch_paseo_codey.mjs --relay

# 指定端口，或停止专用 daemon
node tools/launch_paseo_codey.mjs --port 17678
node tools/launch_paseo_codey.mjs --stop
```

使用 CMD 入口且不希望等待按键时，将 `--no-pause` 放在第一个参数位置。运行中的连接配置有变化时，先停止专用 daemon 再启动。

## 手机连接与历史

在专用 daemon 的 Web 页面开启 relay 后，用手机扫描该服务的配对二维码。脚本将 relay 开关保存到配置中，不使用锁定界面开关的 daemon 启动覆盖参数。原 Paseo 应用可能仍连接另一套服务，需要在手机上选择这里启动的专用服务。

配对 URL 和二维码具有访问凭据性质，不要提交到 Git 或公开分享。历史会话可用 Paseo 的导入功能连接；适配器在 `thread/read` 和 turn 请求前订阅事件，以接收恢复后会话的后续输出。

## 设置同步

- **模型与推理强度**：按会话同步。发送消息后，以实际轮次记录为准更新；Desktop 到 Paseo 通常约 1.5–3 秒。尚未发送的选择不会被旧轮次反复覆盖。
- **Fast**：通过 Desktop 原生选择状态与 Paseo 设置接口双向同步。Desktop Fast 是全局选择，会联动专用 daemon 中已打开且支持 Fast 的 Codex 会话。同一次检查发现两端同时变化时，优先采用 Desktop 的变化。
- **Fast 模型支持**：专用进程使用 Codey 模型目录替换 Paseo 的固定前缀判断，使目录中支持 Fast 的 Astra 等模型显示原生开关。只修改模块加载结果，不修改原 Paseo 安装包。

Paseo 修改 Fast 时，同步进程会更新 Codex 对应的 `service_tier` 配置及 Desktop 原生选择状态。开关可用和状态同步不代表上游实际速度或计费已经验证。权限设置仍由各客户端的原生机制处理。

## 本地数据与提交范围

运行配置、配对身份、进程信息、日志及同步水位保存在 `.paseo-codey/`。这些文件包含机器信息或会话数据，已整体加入忽略规则。历史取证资料、旧 PoC 配置和机器专用调查脚本同样不纳入版本管理，保留在本地供复查。

提交前检查 `git diff --cached` 和 `git status --short`，不要强制添加上述目录。日志默认仅记录元数据；故障详情仍可能包含本地路径，不能直接当作脱敏报告发布。

## 源码与验证

| 文件 | 用途 |
| --- | --- |
| `tools/launch_paseo_codey.mjs` | 启停、安装检测与后端能力核验 |
| `tools/cdp.mjs`、`tools/desktop_bridge.mjs` | 本机 Desktop 请求与事件连接 |
| `tools/paseo_desktop_shim.mjs` | Paseo JSONL 子进程适配 |
| `tools/paseo_settings_sync.mjs`、`tools/settings_sync_policy.mjs` | 轮次读取、同步策略和水位 |
| `tools/desktop_settings.mjs` | 当前 Desktop 原生 Fast 状态适配 |
| `tools/paseo_native_client.mjs` | 原生 Paseo 设置客户端 |
| `tools/paseo_compat.mjs` | 专用 daemon 的 Fast 模型目录兼容 |
| `tools/asar_inspect.py` | 只读提取安装包指定文件 |

不连接服务的策略测试：

```powershell
node tests/settings-policy-check.mjs
```

已进行本机共享后端、历史恢复、模型与强度同步、原生 Fast 开关双向同步的集成验证。私有会话记录不随仓库分发。手机最终显示、上游加速效果以及其他应用版本需要单独验收。
