# 主题(外观)

用户切浅色/深色:根元素即时换肤(`html.light` + `data-theme`),选择持久化在 `pacman-theme` localStorage 键,重载保形;无存储时跟随系统色(e2e colorScheme dark 即此默认)。

## Sub-features

- `theme-apply` 切换即时重绘:根 `.light` 类 + `dataset.theme`。
- `theme-persist` `pacman-theme` 键落 localStorage,重载后仍生效(apps/web/src/theme.ts `THEME_STORAGE_KEY`)。
- `theme-segments` 用户菜单 popover 的「外观」分段行(浅色/深色,`data-active` 跟随)——**live 面暂无 popover 触发器**(见 Gotchas)。

## Drive (vp.mjs)

- `vp.mjs drive theme persist`
- `vp.mjs drive theme sealed-tokens-audit`

前置（stack / daemon / stub-llm …）、状态与脚本参数：`vp.mjs list theme`。`vp.mjs` = `node .claude/skills/verify-pacman/scripts/vp.mjs`。

## How to get to it (user POV)

- 用户菜单 popover「外观」行(浅色/深色分段)。
- 直改 `pacman-theme` 存储(开发者路径;live 面当前唯一可驱动路径)。

## Driving it with verify-pacman

Preconditions:

- `launch.mjs` 起栈 + `doctor.mjs` 全 PASS。

- **双向持久化。** Run `node <skill>/scripts/drive.mjs theme`。链路:默认 dark 截图 → `localStorage.setItem('pacman-theme','light')` + reload → `dataset.theme='light'` 且根含 `.light` → 截图;再置 'dark' + reload → 回 dark。证据 `01-theme-default-dark.png` / `02-theme-light.png` / `03-theme-dark.png` + `result.json`。
- **注入即初值。** storage 注入路径同键:reload 前先注入 light,首帧即 light(fixture e2e theme-toggle.spec.ts 第 3 测已锁;live 复验同 probe 即覆盖——probe 的写入就是同一条注入路径)。

## Gotchas

- **popover 触发器是 fixture-only**:`UserMenu` 只在 `!live && detail.userMenuOpen` 时挂载(todo-detail-page.tsx);live 界面上没有打开用户菜单的钮(触发器归后票)。别在 live 驱动里找 `.user-menu-seg`——找不到不是 bug。
- 主题键是 `pacman-theme`(**中划线**);i18n 的 locale 键才是 `pacman.locale`(**点**),别混。
- 断言三件套:`dataset.theme` + 根 `.light` 类 + localStorage 值;只看背景色会被截图压缩骗。
- probe 用 reload 驱动,不动系统 colorScheme;e2e 的 follow-system 断言(`emulateMedia`)属 fixture 面,不在此重复。
