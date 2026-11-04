import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

export const runner = fileURLToPath(new URL('./test-temp-run.mjs', import.meta.url));
export const helper = new URL('./test-tmpdir.mjs', import.meta.url).href;
export const leaked = `import { makeTestTempDir } from ${JSON.stringify(helper)};
const home = makeTestTempDir('leak-');
console.log('TEMP:' + JSON.stringify({ home, runId: process.env.CAIRN_TEST_RUN_ID }));`;

export function fixture(source, mode = 'node', env = {}) {
  const dir = makeTestTempDir('survivor-fixture-');
  const extension = mode === 'vitest' ? '.test.mjs' : mode === 'playwright' ? '.spec.mjs' : '.mjs';
  const script = join(dir, `case${extension}`);
  writeFileSync(script, source);
  let commandArgs = mode === 'node-test' ? ['--test', '--test-reporter=tap', script] : [script];
  if (mode === 'vitest' || mode === 'playwright') {
    const config = join(dir, 'runner.config.mjs');
    const settings =
      mode === 'vitest'
        ? {
            root: dir,
            test: { include: ['case.test.mjs'], maxWorkers: 1, disableConsoleIntercept: true },
          }
        : { testDir: dir, workers: 1, reporter: 'line', outputDir: join(dir, 'results') };
    writeFileSync(config, `export default ${JSON.stringify(settings)};`);
    const cli = fileURLToPath(
      new URL(
        mode === 'vitest'
          ? '../node_modules/vitest/vitest.mjs'
          : '../node_modules/@playwright/test/cli.js',
        import.meta.url,
      ),
    );
    commandArgs = [cli, mode === 'vitest' ? 'run' : 'test', '--config', config];
  }
  const { NODE_TEST_CONTEXT: _context, ...childEnv } = process.env;
  const result = spawnSync(process.execPath, [runner, '--', process.execPath, ...commandArgs], {
    encoding: 'utf8',
    env: { ...childEnv, ...env },
    timeout: 60_000,
  });
  const allocation = /TEMP:(\{[^\n]+\})/.exec(result.stdout)?.[1];
  return {
    result,
    allocation: allocation ? JSON.parse(allocation) : null,
    cleanup() {
      if (allocation) rmSync(JSON.parse(allocation).home, { recursive: true, force: true });
      releaseTestTempDir(dir);
    },
  };
}
