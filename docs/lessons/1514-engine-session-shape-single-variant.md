---
类别: 引擎会话形状与模型推导只照一种写法：Pi 工具结果校验失败、Claude 信封被跳过，Claude 帧缺 provider 时多模型运行推不出 input.model
首次来源: #1514 (2026-10-24)
级别: 2
防护: `trajectory-export.test.ts` 经根命令导出 Pi toolResult 与 Claude assistant 信封并断言消息全集；注入第二个计费模型，分别用 Pi 形状（带 provider）和 Claude Code 形状（只有 message.model）断言 input.model，Claude 形状按 daemon 账单口径补 claude-code 前缀
拦截: 3
复发: 1
备注: 负对照：旧解析器在 toolResult 的 role 校验失败；旧实现只接受一条 token_usage；复发时 Claude 帧缺 provider，整包 schema 失败，测试变红，补前缀后通过。会话形状来自外部引擎，类型层拦不住
---
