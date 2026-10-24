---
类别: 别的 PR 给 step 输入加了 blockerHandoff，轨迹包 schema 要求该字段而导出器没有填，合并 main 后整批导出失败，prepush 才暴露
首次来源: #1514 (2026-10-25)
级别: 2
防护: 导出器从 step.blockerHandoff 取首个快照写入 input；`trajectory-export.test.ts` 新增带 blockerHandoff 的 step 用例，断言字段原样导出且其中的假 token 被打码，主用例的 input 断言补 blockerHandoff: null
拦截: 1
复发: 0
备注: 负对照：未改导出器时新用例报 `Schema validation failed at input.blockerHandoff`，补字段后 28 条全绿。导出器经 parse(unknown) 构造，类型层看不到 schema 新增字段，靠导出测试拦
---
