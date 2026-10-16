import { defineConfig } from 'vitest/config';

// apps/web unit tests live in test/ (i18n coverage + PWA, #74). The
// Playwright e2e specs under e2e/ stay out of vitest — they run via
// `pnpm --filter @pacman/web e2e` (issue #75 AC3).
//
// resolve.alias 与 vite.config.ts 同值（#425 的 @/* 别名）：components/ui
// 的 registry 同源件按 refresh 管线 R1 用 `@/components/ui/<x>.js` 形态
// import（#989/#1003），vitest 独立 config 不继承 vite.config 的 alias——
// 缺它则任何拉到 registry 件的单测在 import 解析期炸（#1006：dialog-shell
// 组合 dialog.tsx 后三测试文件实测命中）。
export default defineConfig({
  // @/* 别名镜像 vite.config.ts（#425）：registry 件用它互引（field.tsx 引
  // label/separator、alert-dialog.tsx 引 button），任何 render 到这些件的
  // 单测（如经 agent-detail 链拉进 create-provider-dialog 的
  // chief-identity）都要靠这里解析，缺则报 Cannot find package
  // '@/components/ui/…'（#1008 独立复现于 alert-dialog 首消费者上线）。
  // 裸 `cn` → src/lib/cn.ts 同样镜像 vite.config.ts（Paper 字号键）。
  resolve: {
    alias: [
      { find: '@', replacement: new URL('./src', import.meta.url).pathname },
      { find: /^cn$/, replacement: new URL('./src/lib/cn.ts', import.meta.url).pathname },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
