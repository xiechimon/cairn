---
类别: 新增的提示词段落打破两条既有集成测试：带反馈的失败重启只剩失败原因时也追加教训段，m7 反馈对账串对不上；空白反馈纯重启轮被塞入教训段，破坏 #720 的 prompt 为空
首次来源: #1615 推送前 prepush (2026-10-24)
级别: 2
防护: `integration/test/m7-failed-send-e2e.test.ts` 与 `restart-blank-feedback-e2e.test.ts` 在 prepush 全量集成里变红；`retry-lessons.test.ts` 补「空白反馈纯重启」「只有失败原因」两条用例钉住；教训段只在带用户反馈的重启里出现，且至少有一条教训之外的上一轮记录
拦截: 2
复发: 0
备注: 负对照：改动前两条集成测试实跑均红（m7 的 llmSawFeedback 为 false，空白反馈用例 prompt 非 null），改后均绿；根因是本地只跑了 server 单测，没跑受影响的集成测试
---
