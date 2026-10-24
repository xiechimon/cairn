# Issue 1611 verification

- `gemini --version`: unavailable on this host; live CLI probe is待宿主.
- ACP bridge exposes an injectable child-process seam; unit fixtures cover its validation and event mapping.
- Relevant tests: 5 files, 80 tests passed.
- Shared package tests: 33 files, 566 tests passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed; Biome reported one informational fragment suggestion in `apps/web/src/resources/machines-page.tsx`.
- `pnpm spec:parse`: passed.
- `node scripts/single-use-helper-gate.mjs`: 0.
- `node scripts/comment-discipline-gate.mjs`: 0.

## Web 可见改动截图（Gemini 标志与 runtime 文案）

由 Playwright 在 fixture 构建（`E2E_PORT=8427`）下以 live 打桩路由造出状态：本机行启用 pi / claude-code / gemini，model-sources 含 gemini 段。1440×732，浅色、深色各一组。截图脚本用后已删。

- `machines-light.png`、`machines-dark.png`：机器页本机行的三枚 runtime 标志。
- `providers-light.png`、`providers-dark.png`：provider 页 `?runtime=gemini`，Gemini tab 与头部卡（名称、已安装在、说明）。
- `mark-closeup-light.png`、`mark-closeup-dark.png`：三枚标志特写（12 倍像素比）。

几何实测（同一轮脚本打印）：标志三枚均 16×16、横向间距 32px、不重叠；provider 页三个 tab 均未截断（`scrollWidth <= clientWidth`），图标 14px；头部卡未截断；页面无横向溢出（scrollWidth 1440 = clientWidth）。执行本轮的模型不能读图，以上是几何与 DOM 量测，不是人眼验图；请合并前人工看一眼这六张图。
