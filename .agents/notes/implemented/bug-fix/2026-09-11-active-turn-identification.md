# Agent Note: 方向调整使用已确认的原生轮次编号

Status: implemented

## Problem

Paseo 接管一个仍在运行的共享 Desktop 会话后，turn/start 可以被后端接受为当前轮次的追加输入，不再产生新的 turn/started 通知。Paseo provider 忽略 turn/start 响应里的 turn.id，清空 currentTurnId 后一直等待通知。

此时方向调整的 steer 准入失败，退回 replace 流程；interrupt 又等待同一个轮次识别 Promise。实际日志出现三次约两秒的 interrupt 超时，随后再等待两秒，报告 active run cancellation was not acknowledged。桥接没有收到对应的 turn/interrupt，不能将其解释为后端拒绝取消或图片大小问题。

## Decision

- 专用 daemon 的模块加载钩子补充 Codex provider：原生轮次开始响应为 inProgress，且本地前台轮次及待识别记录仍匹配时，使用真实响应中的 turn.id 完成绑定。
- 事件先到、轮次已结束、前台轮次已改变或响应无效时不覆盖状态。迟到的同一轮次开始通知不重复重置流状态。
- 保留原有取消确认与超时机制，不伪造取消成功，也不增加重发用户消息的逻辑。
- 补丁只作用于专用 daemon；源码特征必须唯一匹配，否则拒绝加载并要求检查上游版本。原 Paseo 安装文件保持不变。

## Validation

- 独立加载本机安装的真实 CodexAppServerAgentSession 类，以隔离的传输替身模拟无 turn/started 通知的响应。原版 currentTurnId 为空、steer 不可用、interrupt 等待不结束；补丁版绑定真实响应编号，发送正确的 turn/steer 和 turn/interrupt。没有向用户活动任务注入测试消息或取消请求。
- 聚焦测试覆盖响应绑定、事件先到、完成和更新轮次保护、无效响应和未知源码拒绝。
- 重载专用 daemon 后，原 Codey 后端进程不变，当前原生轮次仍为 inProgress，历史尾部读取成功。失败的方向调整文字没有进入后端历史，需由用户重新提交。
- 用户在手机再次尝试方向调整后确认可以正常使用；该确认不代表所有取消操作或断线场景均已验收。

## Alternatives considered

- 延长两秒超时：缺失的通知不会因为等待更久而出现，无法修复根因。
- 跳过取消确认或强行标记结束：会造成客户端与真实运行状态不一致，保留原生安全检查。
- 在桥接中无条件补发 turn/started：容易重复重置流状态；直接绑定确认响应的编号，并保护当前前台轮次，范围更小。

## Consequences

活动轮次的方向调整不再仅依赖通知到达。兼容逻辑依赖已验证的 Paseo provider 源码结构，上游升级仍须复核。补丁在 daemon 加载模块时生效，部署需要重载专用 daemon，会短暂断开客户端连接。传输断开、真正取消失败等错误仍会按原生机制报告。
