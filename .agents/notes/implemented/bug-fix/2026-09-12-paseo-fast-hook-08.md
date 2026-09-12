# Agent Note: Paseo Fast 目录兼容钩子适配集合判断

Status: implemented

## Problem

Paseo 0.8.0 将 Codex Fast 支持判断从模型前缀数组改为明确模型集合。仅识别旧代码锚点的加载钩子会在升级后拒绝加载，妨碍共享后端接入。

## Decision

`tools/paseo_compat.mjs` 的 `patchFastModels` 分别识别已核对的前缀判断与集合判断，再替换为当前后端模型目录。要求源文件中恰好一个已知锚点，未知或多重匹配继续失败，不放宽到任意代码替换。

## Alternatives considered

- 删除 Fast 钩子：会使客户端固定目录与实际共享后端目录再次分离。
- 模糊匹配所有返回表达式：升级后可能静默替换错误位置。

## Consequences

独立下载的官方 Paseo 0.8.0 运行时通过加载钩子预检和 provider 级模型、客户端消息 ID 检查；旧版锚点与异常结构也有聚焦验证。测试未发送真实模型请求，未替换当前 daemon，不据此增加 COMPATIBILITY.md 的“已通过”记录。

验收命令：`node tests/settings-policy-check.mjs`。官方运行时取证保留在被忽略的 `evidence/` 中。
