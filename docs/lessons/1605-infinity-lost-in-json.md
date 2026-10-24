---
类别: 裁决结构里的数字取到 ±Infinity，`JSON.stringify` 写成 null，落盘后显著性数字丢失，读回的裁决与内存里的不一致
首次来源: #1605 (2026-10-25)
级别: 2
防护: `integration/test/adoption-judge.test.ts` 的「裁决落盘读回后与原值完全相等」用例覆盖零方差、样本不足、无有效配对等边界；结构改为 z 恒为有限数并带 `meanSign` 与 `degenerate` 字段
拦截: 0
复发: 0
备注: 负对照：把零方差的 z 改回 `meanSign * Infinity`，4 条用例变红（含 uniform gain、uniform drop 两条落盘读回）；改回有限数后 45 条全绿。凡写盘的结构不放 Infinity / NaN
---
