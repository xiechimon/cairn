import { defineConfig } from 'vitest/config';
import { scrubGitEnv } from './scripts/scrub-git-env.mjs';

scrubGitEnv();

const ALL_PROJECTS = ['packages/*', 'apps/server', 'apps/web', 'apps/daemon', 'integration'];
const HEAVY_PROJECTS = ['integration'];
const SERVER_SHARED_PROJECTS = ['packages/*', 'apps/server'];
const projectSet = process.env.VITEST_PROJECT_SET;
const projects =
  projectSet === 'integration'
    ? HEAVY_PROJECTS
    : projectSet === 'server-shared'
      ? SERVER_SHARED_PROJECTS
      : projectSet === 'light'
        ? ALL_PROJECTS.filter((p) => !HEAVY_PROJECTS.includes(p))
        : ALL_PROJECTS;

export default defineConfig({
  test: {
    projects,
  },
});
