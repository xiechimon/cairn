import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { prepareOrbSeed } from '../src/orb/seed.js';

test('mounts a private bare snapshot with committed objects and no host working files or config', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orb-safe-seed-'));
  const repo = join(root, 'host');
  execFileSync('git', ['init', '-b', 'main', repo]);
  writeFileSync(join(repo, 'tracked.txt'), 'committed');
  execFileSync('git', ['-C', repo, 'add', 'tracked.txt']);
  execFileSync('git', [
    '-C',
    repo,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.test',
    'commit',
    '-m',
    'Seed',
  ]);
  writeFileSync(join(repo, '.env'), 'host-secret-sentinel');
  execFileSync('git', ['-C', repo, 'config', 'private.token', 'host-secret-sentinel']);
  const seed = await prepareOrbSeed({
    source: repo,
    directory: join(root, 'snapshot'),
    projectId: 'project',
  });
  expect(seed).toEqual({
    source: join(root, 'snapshot', 'repo'),
    target: '/seed/project/repo',
    readonly: true,
    releaseAfterExec: true,
  });
  expect(
    execFileSync('git', ['-C', seed.source, 'rev-parse', '--is-bare-repository'], {
      encoding: 'utf8',
    }).trim(),
  ).toBe('true');
  expect(
    execFileSync('git', ['-C', seed.source, 'show', 'HEAD:tracked.txt'], { encoding: 'utf8' }),
  ).toBe('committed');
  expect(existsSync(join(seed.source, '.env'))).toBe(false);
  expect(readFileSync(join(seed.source, 'config'), 'utf8')).not.toContain('host-secret-sentinel');
  expect(readFileSync(join(repo, '.env'), 'utf8')).toBe('host-secret-sentinel');
}, 30_000);

test('rejects a non-Git host directory before any bind can be constructed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orb-reject-seed-'));
  const source = join(root, 'private');
  mkdirSync(source);
  writeFileSync(join(source, 'machine.json'), 'machine-secret-sentinel');
  await expect(
    prepareOrbSeed({ source, directory: join(root, 'snapshot'), projectId: 'project' }),
  ).rejects.toThrow();
  expect(readFileSync(join(source, 'machine.json'), 'utf8')).toBe('machine-secret-sentinel');
}, 30_000);
