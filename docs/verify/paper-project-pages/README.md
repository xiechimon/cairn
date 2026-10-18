# Paper project pages: evidence

Project settings and new project on the shared page patterns from #1387.
Shots are 1440x900 at DPR 2, light and dark, from a `vite build --mode fixture`
bundle served by `vite preview`:

    node docs/verify/paper-project-pages/capture.mjs <before|after> http://127.0.0.1:<port>

| shot | what it shows |
| --- | --- |
| `*-settings-fixture.png` | scenario r2-24c (hosted project, fixture face) |
| `*-settings-github.png` | live build with stubbed `/api`: GitHub project with a local path and a description (editable rows) |
| `*-settings-local.png` | live build, local project: the 转换为 GitHub 形态 card |
| `*-new-fixture.png` | scenario 01, empty form |
| `*-new-filled.png` | live build, name typed: 创建项目 enabled |

`before-metrics.json` / `after-metrics.json` hold the measured boxes. Light
theme, after vs before:

- settings card: `--radius-card` 10px, five rows of 52px (before: 14px registry card with a centered avatar block on top).
- 删除: 32px tall, 8px corners, in its own card (before: 10px soft pill inside a card with the title and description stacked above it).
- new project: name input and repo control 520px wide, 32px, 8px corners (before: 768px); 创建项目 76x32 right-aligned (before: a 768px bar).
