# Agent Note: Paseo 插件复用 Codey 提示词优化

Status: implemented

## Problem

用户主要通过 Paseo 手机 App 操作，希望使用 Codey 已配置的提示词优化功能。需要区分“调用优化器”和“读取、替换原生输入框草稿”两个能力，避免把可添加插件按钮等同于可以操作原生草稿。

## Decision

插件通过专用 daemon 的服务端 RPC 接入当前 Desktop 的 Codey bridge，仅允许调用 `/api/optimize_prompt` 并提交 `{text}`。优化模型、规则、路由和凭据继续由 Codey 持有和使用，不将完整设置或 API Key 发送到手机，不创建另一个 Codex 后端。

第一版使用 agent 范围的 `/optimize 原始需求` 命令：收到文本后打开优化面板，保留原文，显示可编辑结果；用户主动选择“发送到当前会话”或“复制”。Paseo 插件命令由客户端处理，优化草稿本身不进入模型对话；只有用户确认发送后才调用当前 agent 的 `send`。异步结果绑定原 host / agent，切换会话后不向新会话发送，不在超时后自动重试或补发。

优化面板也可作为按钮入口，但它只能操作面板自己的文本。Paseo 0.8.0 的公开客户端契约没有读取或替换主 composer 草稿的方法；第一版不承诺与 Codey 的一键原地替换完全一致。

## Alternatives considered

- 在插件中另写优化模型配置和请求实现：会与 Codey 的模型、规则和鉴权行为分离。
- 修改 Paseo Web 的 DOM：无法覆盖原生手机 App。
- 给 Paseo 增加受支持的 composer draft API：能支持原位优化及保留附件，适合作为后续上游改进；当前需要改客户端。

## Verification

1. 通过当前 Codey 优化器和 390px Web 获得真实结果；只传测试文本，未创建后端或向用户会话发送任务。刷新后的结果与原结果相同，`prompt.start` 仅调用一次，发送调用为零。
2. `tests/prompt-optimization-check.mjs` 覆盖作业复用、并发限制、超期清理、不同 agent 隔离、发送去重、迟到结果保护、断线后查询原作业及重进面板后的已发送状态。
3. 官方 0.8.0 插件编译与真实 daemon RPC 通过；确认发送使用模拟 agent 校验。安卓 relay、原生手机复制及实际会话内 Slash 命令仍需实测。面板说明了附件边界。
4. 已在专用 0.8.0 服务的现有长会话中打开命令中心的优化入口；390px 面板正确绑定原 agent，页面无脚本异常，没有发送任务。切换运行时前备份服务目录，之后核对服务身份、配对密钥和会话目录均未变化，原 Codey 后端仍在运行。

## Consequences

截至 2026-09-12，已核对上游 Codey 的 `public/prompt-optimize.js`、`backend/src/commands/prompt_optimization.rs`，以及 Paseo v0.8.0 的插件 client contracts 与 SDK `agent.send`。本机 Codey 1.0.0 的优化入口 ready/enabled，并对一条只读测试需求返回真实优化结果。官方 0.8.0 编译器、独立 daemon、真实插件 RPC 和 390px Web 均已验证：刷新面板恢复同一结果而不重新优化，验证过程发送次数为零。

Desktop 的内部 bridge 属于版本敏感接口，需要能力探测、固定调用路径和失败提示。超时应忽略迟到的结果，不能声称已取消 Codey 内部请求。当前公开插件 API 无法自动读写主输入框或拾取其附件；不能把独立面板验证写成原生 composer 集成已通过。确认发送、安卓 relay、真实会话内 Slash 命令及手机冷启动恢复仍需人工实测。

优化沿用 Codey 的模型和凭据，手机无需重复配置。Paseo 单次插件 RPC 有 30 秒超时，因此采用开始、查询和确认三个短请求；后台优化作业及发送标记仅在内存保留，重载或重启会丢失，不承诺跨服务重启的恰好一次发送。单个作业确认后不能再次发送，响应不明时保留状态并要求先查看原会话。

专用新版运行时独立存放于被忽略的运行目录，不覆盖原 Paseo 安装。启动器按显式指定、已保存位置、运行中应用的顺序选择程序，使后续双击启动继续使用已选版本；更换位置时需显式指定新版。

原始源码与本机探测保留在忽略的 `evidence/`；本 note 不记录个人路径、真实提示词或凭据。
