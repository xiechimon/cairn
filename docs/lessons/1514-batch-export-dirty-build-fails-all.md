---
类别: 批量导出把单个 build 的脏数据当成整批失败：先是会话缺失，再是多计费模型推不出 model、baseSha 或 agentId 为空、消息缺 role、会话 JSON 损坏
首次来源: #1514 (2026-10-24)
级别: 2
防护: 时间窗导出逐个 build 构造并过 schema，失败按原因计入 `skipped=N (session_missing=a, session_invalid=b, schema_invalid=c)` 后跳过，--build 单个导出仍报错退出；`trajectory-export.test.ts` 在时间窗里夹六个各类脏数据 build 断言计数与其余照常写出
拦截: 2
复发: 1
备注: 负对照：第二轮实现只跳过会话缺失，同一测试在 schema 失败的 build 上整批退出码 1 变红；按原因跳过后通过
---
