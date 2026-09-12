# Agent Note: 普通发送保留原生附件消息关联

Status: implemented

## Problem

Paseo 原生用户消息已有 48×48 的附件图片卡片，不需要重新设计布局。但 provider 普通 turn/start 没有传 clientUserMessageId，只有 steer 会传；后端历史缺少该关联标识。手机有本地附件记录时，历史合并可能无法准确关联，尤其是本地文本与后端附件包装不同的情况。

## Decision

- 专用 daemon 的源码钩子在普通 turn/start 参数中传入 options.clientMessageId 对应的 clientUserMessageId。没有标识时不添加字段，不生成替代标识，不根据正文或时间猜测关联。
- 保留现有图片兼容块。此次不改变手机客户端、不修改已安装 Paseo、不补写旧历史、不改变原图和缩略图样式。
- 源码锚点必须唯一匹配，否则拒绝加载，继续保持未知版本的兼容检查。

## Validation

- 本机 Codex CLI 导出的 TurnStartParams JSON Schema 明确包含 clientUserMessageId。
- 隔离加载真实安装的 CodexAppServerAgentSession，原版 buildTurnStartParams 丢失标识，补丁版保留标识，无标识请求保持不变；没有发出网络请求或向用户任务发送提示。
- 运行上游 v0.7.2 的原生消息合并代码：本地与历史正文不同、缺少共同标识时保留两条；有共同标识时合并为一条并保留本地图片。空本地状态仍无法从纯文字历史恢复图片。
- 聚焦检查覆盖普通发送字段、有无标识、重复或未知源码锚点拒绝。手机新消息的真实发送与重进验收仍需用户确认。

## Alternatives considered

- 仅添加 images 到历史协议：当前协议解析会丢弃这些字段，客户端恢复映射也不读取，不能单靠桥接完成。
- 给旧消息按文本补标识：重复文字或不同附件可能错误关联，拒绝猜测。
- 去掉兼容预览块：冷加载与跨设备仍缺附件数据，会再次看不到图片。

## Consequences

只修复新普通发送的关联基础，不能承诺已清空本地状态、换设备或既有缺失标识的消息恢复为原生卡片。完整的历史附件能力仍需要协议提供可获取的附件描述，客户端下载缩略图并复用现有卡片组件；完整原图应继续按需获取。
