# 1626 信息卡可见改动

证据由 `apps/web/e2e/info-card-report.spec.ts` 生成，状态全部来自 live 面打桩（fixture 构建，API 响应由 Playwright 路由提供），视口 1440x732：

```sh
CAIRN_E2E_EVIDENCE=docs/verify/1626 E2E_PORT=8397 pnpm --filter @cairn/web exec playwright test e2e/info-card-report.spec.ts
```

## 状态怎么造的

- 信息卡：`output: 'info'`，phase 为 review，`hasChanges: false`，changes 接口返回空文件集。
- 会话消息：一条用户任务行加一条 `info-report` 系统行，形状与 server `storeInfoReport` 落库的一致（`attachmentId`、`attachmentToken` 为 `![report.md](attachment:team-1/att-report.md)`、`content` 为报告正文）。
- 代码卡（对照，无截图）：`output: 'code'`，changes 接口返回一个文件改动，用来断言合并行照旧。
- 主题：测试在页面加载前写入 `localStorage['cairn-theme']`，并断言 `html[data-theme]` 与期望一致。

## 图

- `transcript-report-light.png`、`transcript-report-dark.png`：信息卡详情页会话列。agent 行里先是报告附件引用（`report.md` 链接，指向 `/api/attachments/att-report`），其后是报告正文（标题、加粗、三条列表）。
- `transcript-report-closeup.png`：浅色下同一行的特写，带头像，外扩 48px。
- `complete-dialog-info-light.png`、`complete-dialog-info-dark.png`：信息卡点「完成」后的对话框。没有「将改动合并到默认分支」勾选行，也没有复选框，只有一行说明「信息卡的产出是报告附件，不进合并。」，「完成」按钮可点。
