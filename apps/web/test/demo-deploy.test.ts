import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';

const { ignoreCommand } = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
) as { ignoreCommand: string };

test.each([
  ['apps/web/src/app.ts', 1],
  ['packages/shared/src/records.ts', 1],
  ['pnpm-lock.yaml', 1],
  ['pnpm-workspace.yaml', 1],
  ['package.json', 1],
  ['docs/unrelated.md', 0],
] as const)('demo deployment decision for %s is exit %s', (changed, expected) => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-demo-deploy-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args: string[]) => {
    const result = spawnSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'user.name=Demo test',
        '-c',
        'user.email=demo@example.invalid',
        ...args,
      ],
      { cwd: root, encoding: 'utf8', env },
    );
    expect(result.status, result.stderr).toBe(0);
  };
  try {
    mkdirSync(join(root, 'apps/web'), { recursive: true });
    git('init', '--quiet');
    writeFileSync(join(root, 'baseline'), 'baseline\n');
    git('add', 'baseline');
    git('commit', '--quiet', '-m', 'baseline');
    const file = join(root, changed);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'changed\n');
    git('add', changed);
    git('commit', '--quiet', '-m', 'change');
    const result = spawnSync('sh', ['-c', ignoreCommand], {
      cwd: join(root, 'apps/web'),
      encoding: 'utf8',
      env,
    });
    expect(result.status, result.stderr).toBe(expected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
