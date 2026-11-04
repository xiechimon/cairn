# API 参考

## 任务

### `GET /api/tasks?teamId=<id>`
返回团队全部任务。响应为任务对象数组。

### `POST /api/tasks/delete`
请求体 `{ "ids": ["<taskId>", ...] }`，返回 `{ "deleted": ["<taskId>"] }`。

> 变更中：该端点的响应字段 `deleted` 在 0.5.0 起由字符串数组改为
> `{ "deleted": [...], "skipped": [...] }`，以便调用方区分「不存在」与「已删除」。
