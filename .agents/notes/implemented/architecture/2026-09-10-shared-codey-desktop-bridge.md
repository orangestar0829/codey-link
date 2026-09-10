# Agent Note: 通过 Desktop IPC 复用 Codey 后端

Status: implemented

## Problem

手机和 Web 用户希望通过 Paseo 继续 Codey Desktop 的工作，并保留 FastCtx、具名子代理、模型及运行时指令。Paseo 原生启动独立 Codex app-server，无法据此证明它使用当前 Codey 后端。

共享后端后仍有客户端状态差异需要处理：恢复已有线程时可能遗漏事件订阅，模型和推理强度没有反向更新，Paseo 的固定模型前缀判断也会遗漏 Astra 的 Fast 开关。

## Decision

桥接通过本机 CDP 调用已有的 `electronBridge.sendMessageFromView`，由 Desktop 原有请求管理器将请求转发到既有 stdio 后端。Paseo 的 provider command override 启动 JSONL 适配器，适配器本身不启动 Codex。

物理连接属于 Desktop。适配器的 `initialize` 只建立逻辑客户端，不重新初始化物理连接；退出适配器或执行逻辑 `thread/unsubscribe` 不终止 Desktop 后端。

专用 daemon 使用项目内的 `.paseo-codey/`，与原 Paseo 数据目录分开。安装位置和当前进程身份在运行时检测，不将具体机器路径、真实会话标识或配对凭据写入本记录。

实现入口：

- [Desktop 请求与事件桥接](../../../../tools/desktop_bridge.mjs)
- [Paseo JSONL 适配器](../../../../tools/paseo_desktop_shim.mjs)
- [启动器](../../../../tools/launch_paseo_codey.mjs)
- [使用说明与兼容范围](../../../../README.md)

## Verification

以下为 2026-09-10 在 Windows、Codey v0.10.8、ChatGPT（Powered by Codex & OWL）26.903.61454、Paseo 0.7.2 和 Codex CLI 0.153.4 上记录的本机验证结论，不代表对其他安装版本的保证。Codey 与 ChatGPT 桌面应用版本由使用者确认并补记；本文中的 Codex Desktop 指该应用提供的 Codex 界面。完整版本组合与功能边界见[版本兼容记录](../../../../COMPATIBILITY.md)：

- 测试前后，原 Codey 后端进程身份保持不变，存活的 Codex 后端进程集合相同。
- 外部客户端可以发送 turn、接收流式输出、调用实际 FastCtx read / grep，并观察具名子代理完成。
- 两个逻辑客户端收到相同 delta 和 completed 事件；断开其中一个不影响另一个；中断测试返回 interrupted。
- Paseo 原生 provider 经适配器执行 FastCtx 和 Codey 子代理，时间线显示工具结果。
- 正常停止专用 daemon 后，原 Desktop 后端及另一套 Paseo 服务保持运行，适配器所属的临时 renderer 监听器得到清理。

原始日志和会话记录仅保留在被 Git 忽略的取证目录中，不作为可公开下载的证据附件。本仓库提供实现、操作说明及可独立运行的策略测试；涉及真实后端的结论需要在目标安装上再次验收。

## One-click launcher

一键入口解析实时进程树，识别 Codey 包装层、后端和 Desktop 调试端口，再通过有效配置核验 FastCtx、具名子代理和 Codey 指令。Paseo 程序位置与后端版本来自实际安装和运行进程。

启动时经 Paseo provider 的模型列表查询验证适配器连接，重复启动复用已有专用 daemon。停止通过 Paseo lifecycle RPC 结束专用 daemon；运行中的连接配置发生变化时要求先停止再启动。启动失败仅清理本次新启动的 daemon，连接失效时报错，不切换到普通后端。

已记录的验证包括启动、重复启动复用、真实 FastCtx 调用、拒绝不匹配的 CDP 端口，以及停止后保留原后端和另一套 Paseo 服务。

### Relay toggle repair

旧启动方式向 daemon 传入 `--no-relay` 或 `--relay`，Paseo 0.7.2 会将开关标记为由启动参数控制，导致界面的 `set_daemon_config_request` 被拒绝。

启动器改为持久化 `daemon.relay.enabled`，不向 daemon 传递 relay 覆盖参数，并按 Windows 环境变量名称大小写不敏感规则删除继承的 `PASEO_RELAY_ENABLED`。启动器自身的 `--relay` 参数仍用于启用持久化配置并显示配对信息。

验证时，即使启动脚本继承 `PASEO_RELAY_ENABLED=false`，专用 daemon 的配对配置接口仍可启用 relay；再次启动保留启用状态。原生客户端经加密 relay 连接到与本机相同的服务身份，原 Codey 后端保持运行。手机扫码和发送消息也已完成；这不等于所有移动端显示场景均已验收。

### Restored thread event subscription

某个从手机发出的请求已在 Codex 完成，但关联 Paseo 会话一直处于 running。检查发现旧适配器的 renderer watch 集合为空：Paseo 发现线程已由 Desktop 加载后，只调用 `thread/read` 恢复，跳过 `thread/resume`；旧适配器仅在 start、resume 和 fork 后注册监听，因此遗漏后续输出与完成通知。

适配器现在在 `thread/read`、`thread/resume` 和 turn 请求前注册目标线程，并通过 `watchThread` 去重；新建或 fork 返回的线程仍在响应后注册。

验证中，通过原 provider 的历史读取恢复遗漏回复，没有重新发送原请求或改写 Codex 历史。随后在同一恢复会话发送独立验证消息，确认回复返回、会话回到 idle，原后端进程身份保持不变。

## Session settings synchronization

Desktop 修改推理强度并发送消息后，Paseo 仍可能保留旧值。独立同步进程增量读取每个导入线程的 `turn_context`，仅在实际轮次或设置改变时，通过 Paseo 原生 RPC 更新模型和强度。已处理水位持久化，避免轮询时反复覆盖尚未发送的新选择。

Fast 不能只监测 `config/read`。本次验证环境的 `sessionFlags.service_tier=default` 覆盖用户配置，而 Desktop 选择器另有 `fromConfig`、`standard`、`custom` 原生状态。适配通过 Codey 已有的作用域发现能力定位该状态，并校验已验证的 Desktop 资源版本及唯一信号形状。Paseo 用户切换 Fast 时，同时更新配置和原生选择状态。

Desktop Fast 是全局选择，会联动专用 daemon 中打开且支持 Fast 的会话。同一次检查发现两端同时改变时，优先采用 Desktop 的变化；记录自身写入，避免形成反馈循环。

`paseo_compat.mjs` 通过专用子进程的 `NODE_OPTIONS` 加载钩子，将 Paseo 固定前缀判断替换为实时 `model/list` 支持目录。它只修改模块加载结果，不修改原 ASAR；模块结构改变时拒绝继续套用补丁。启动器带起单实例同步进程，停止 daemon 后同步进程退出。

实现与测试：

- [设置同步进程](../../../../tools/paseo_settings_sync.mjs)
- [同步策略](../../../../tools/settings_sync_policy.mjs)
- [Desktop 原生 Fast 适配](../../../../tools/desktop_settings.mjs)
- [Fast 模型目录兼容](../../../../tools/paseo_compat.mjs)
- [策略与增量读取测试](../../../../tests/settings-policy-check.mjs)

验证结果：

- 原模块不识别 Astra Fast，专用加载钩子能识别；未知模型仍不被视为支持。
- 隔离会话验证 Desktop 的模型 / 强度变化传播到 Paseo，以及 Paseo 选择用于原后端的下一轮请求。
- 多次轮询后，未发送的 Paseo 选择保持不变。
- Desktop 和 Paseo 两个方向的 Fast 开启、关闭均通过原生状态检查，测试后恢复原选择。
- 最初仅写配置的 Fast 测试失败，改用原生选择状态后通过；没有将配置写入成功当作界面同步成功。

以上未验证上游实际加速、计费结果及修复后的全部手机显示场景。权限选择器的完整双向同步不在这次实现范围内。

## Compatibility records

兼容声明按完整版本组合和功能范围记录，使用“已验证”“未验证”“部分兼容”“不兼容”四种状态。Codey、Codex Desktop、Codex CLI 后端及 Paseo 分别记录，避免上层应用版本相同而内部组件已变化时误判兼容。手机验证另外记录 App 版本及实际显示范围。

对外以 ChatGPT“关于”界面的应用版本标识 Desktop，便于使用者核对；内部脚本的构建标识不作为版本表字段。代码对界面构建和原生状态的校验仍保留，应用版本说明不替代这些实现检查。

[README](../../../../README.md) 展示当前验证基线，[COMPATIBILITY.md](../../../../COMPATIBILITY.md) 保存功能矩阵、历史组合和升级验证方式。项目版本独立编号，每次验证绑定实际 tag 或 commit；升级后没有测试记录的组合先标记为未验证，不将其等同于不兼容，也不承诺兼容全部更高版本。

## Alternatives considered

- **直接连接现有 app-server WebSocket**：验证环境的后端实际使用 stdio，没有相应 WebSocket 监听入口；接口支持该传输方式，不意味着当前实例已经开放它。
- **重新启动普通 Codex 并复制配置**：不满足复用当前后端的目标，也无法据此确认完整 Codey 运行时增强。
- **直接维护 Paseo 分支或修改安装包**：当前 command override 和专用加载钩子可以完成本次集成。将来正式化时仍可选择内置 transport 接口。
- **多个客户端直接读取 stdout**：会争抢响应，缺少请求关联与生命周期所有权，因此通过 Desktop 已有请求管理器转发。
- **只通过配置文件同步 Fast**：启动覆盖参数与 Desktop 原生选择状态不同步，实测不足以驱动界面和后续选择，因此同时处理原生状态。
- **将最低组件版本描述成开放的兼容范围**：内部接口变化无法由版本大小关系保证，因此将运行最低要求与已验证版本组合分开记录。

## Consequences

收益是用独立适配器复用已有 Codey 后端，保留其 FastCtx、子代理和运行时能力，并继续使用 Paseo 原生时间线及设置接口。机器身份、配对数据与原始对话证据留在本地，仓库中的决策记录保留机制、取舍和验证结论。

代价是依赖 Desktop 私有 IPC、作用域结构及本机 CDP。应用版本变化需要复核适配；大消息分块、断线恢复、审批唯一处理权、并发修改和移动端长期稳定性仍需进一步验收，本项目不声明生产级可靠性。

CDP 保持本机环回，远程接入使用 Paseo 的配对与 relay 流程。具体部署信息从运行时状态和本地日志获取，不通过公开 note 分发。
