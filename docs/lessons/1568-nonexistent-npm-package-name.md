---
类别: 官网和文档写了 npm 上不存在的包名（`npx @xiechimon/cairn` 返回 404），访客照抄直接报错
首次来源: PR #1568 (2026-10-23)
级别: 2
防护: `scripts/npm-command-gate.mjs` 在 CI 里查 README、site/、web 界面里 npx / npm i 用到的包名，npm 404 即红
拦截: 0
复发: 0
备注: 负对照：对含 `npx @xiechimon/cairn` 的 site/index.html 跑闸为红，改回 `@xiechimon/pacman` 后为绿；闸自身首版的 pathspec 漏扫 site/ 根目录文件，也由这次负对照发现
---
