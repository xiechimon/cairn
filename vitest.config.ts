import { defineConfig } from 'vitest/config';
import { scrubGitEnv } from './scripts/scrub-git-env.mjs';

scrubGitEnv();

// Root aggregation for the per-package colocated test/ dirs (01-stack-v2 §4.5:
// vitest projects mode). apps/web's test dir landed with #73 (dnd pure
// core) and joined the i18n/PWA ticket (#74).
// integration/ = 跨端集成面（M3a demo/T2：server 派 step → daemon 真执行 →
// transcript 回传；三端互不依赖纪律不破——集成 harness 独立成包）。
//
// 项目清单分两组（2026-09-30 加）：集成栈在场内起真 server + 真 daemon +
// Chromium，在 2 vCPU 的 CI runner 上与轻 project 争核会假红——实测证据：
// 同 sha 连跑两次同点同败（chip 停在「规划中」、plan 停在 v1）、纯文档提交
// 也红、本地同一条 10.9s 过。故 CI 分两步跑（VITEST_PROJECT_SET=light /
// =integration），本地 `pnpm test` 不带该变量，仍是全量。
const ALL_PROJECTS = ['packages/*', 'apps/server', 'apps/web', 'apps/daemon', 'integration'];
const HEAVY_PROJECTS = ['integration'];
const projectSet = process.env.VITEST_PROJECT_SET;
const projects =
  projectSet === 'integration'
    ? HEAVY_PROJECTS
    : projectSet === 'light'
      ? ALL_PROJECTS.filter((p) => !HEAVY_PROJECTS.includes(p))
      : ALL_PROJECTS;

export default defineConfig({
  test: {
    projects,
  },
});
