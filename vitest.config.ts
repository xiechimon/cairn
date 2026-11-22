import { defineConfig } from 'vitest/config';
import { scrubGitEnv } from './scripts/scrub-git-env.mjs';
import { testRunWorkers } from './scripts/test-admission.mjs';
import { TimedShardSequencer } from './scripts/vitest-timed-shard.mjs';

const workers = await testRunWorkers();

scrubGitEnv();

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
    fsModuleCache: true,
    maxWorkers: workers,
    projects,
    sequence: { sequencer: TimedShardSequencer },
  },
});
