# 变更日志

## [0.5.0] - 2026-09-26
- **破坏性变更**：`POST /api/tasks/delete` 的响应由 `{deleted: string[]}` 改为
  `{deleted: string[], skipped: string[]}`，调用方需同步调整。
- `@cairn/shared` 新增 `DeleteTasksResponse.skipped` 字段。

## [0.4.0] - 2026-09-18
- 新增看板拖拽排序
- 修复主题切换时侧栏闪烁

## [0.3.2] - 2026-09-02
- 任务导出支持 CSV
- 修复搜索结果排序错误
