---
类别: 统计检验的测试夹具手写了 4 个样本，低于被测函数的最小样本常量 5，走进了样本不足分支，公式断言红得莫名其妙
首次来源: #1605 (2026-10-25)
级别: 2
防护: `integration/test/adoption-judge.test.ts` 公式用例的样本量由 `MIN_PAIRS` 派生，并先断言 `degenerate` 为 null；负对照：换回手写 `[1, 2, 3, 4]` 即红，报 `expected 'too_few_pairs' to be null`
拦截: 0
复发: 0
备注: 同类边界常量的测试夹具从常量派生，不手写数字
---
