import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { READONLY_EXPORT_MARKER } from '@cairn/shared';
import { repositoryCacheRefPrefix } from '@cairn/shared/repo-cache';
import { afterEach, expect, test, vi } from 'vitest';
import * as backfill from '../src/backend/repo-cache-backfill.js';
import { backfillRepositoryCaches } from '../src/backend/repo-cache-backfill.js';
import { commitEnv, gitPrim, runGitOk } from '../src/git.js';
import { createDaemonLogger } from '../src/log.js';
import { WorkspaceManager } from '../src/workspace.js';
import { boot } from './machine-loop-harness.js';
import { testTempDir } from './test-temp-dir.js';

const identity = { name: 'Fixture', email: 'fixture@example.test' };
afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const root = testTempDir('backfill-');
  const workspaces = join(root, 'workspaces');
  const a = join(root, 'a');
  const b = join(root, 'b');
  for (const dir of [a, b]) {
    mkdirSync(dir);
    await runGitOk(['init', '--initial-branch=main'], { cwd: dir });
    writeFileSync(join(dir, 'source.txt'), dir === a ? 'a' : 'b');
    await runGitOk(['add', 'source.txt'], { cwd: dir });
    await runGitOk(['commit', '-m', 'fixture'], { cwd: dir, env: commitEnv(identity) });
  }
  const cache = join(workspaces, 'project', 'repo');
  mkdirSync(join(workspaces, 'project'), { recursive: true });
  await gitPrim.clone(a, cache, null);
  return { root, workspaces, a, b, cache };
}

test('daemon startup runs the backfill without claiming a repository task', async () => {
  const prepare = vi.spyOn(backfill, 'backfillRepositoryCaches');
  const machine = await boot({});
  expect(prepare).toHaveBeenCalledExactlyOnceWith(
    join(machine.home, 'workspaces'),
    expect.any(Function),
  );
  expect(machine.api.doneBodies).toEqual([]);
});

test('backfill publishes proof once, preserving the checkout and skipping verified caches', async () => {
  const { workspaces, a, cache } = await fixture();
  const head = await gitPrim.head(cache);
  writeFileSync(join(cache, 'source.txt'), 'uncommitted');
  const fetch = vi.spyOn(gitPrim, 'fetch');
  await backfillRepositoryCaches(workspaces, () => {});
  expect(
    await runGitOk(['rev-parse', `${repositoryCacheRefPrefix(a)}/heads/main`], { cwd: cache }),
  ).toBe(head);
  expect(await gitPrim.head(cache)).toBe(head);
  expect(await runGitOk(['diff', '--name-only'], { cwd: cache })).toBe('source.txt');
  await backfillRepositoryCaches(workspaces, () => {});
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('normal project preparation retries a failed startup backfill', async () => {
  const { root, workspaces, a, cache } = await fixture();
  await gitPrim.setRemoteUrl(cache, join(root, 'missing'));
  await backfillRepositoryCaches(workspaces, () => {});
  const workspace = new WorkspaceManager({ logger: createDaemonLogger({}) });
  await workspace.prepare({
    projectId: 'project',
    conversationId: 'retry',
    repoKind: 'local',
    cloneUrl: a,
    workspacesRoot: workspaces,
    credentials: null,
  });
  expect(
    await runGitOk(['rev-parse', `${repositoryCacheRefPrefix(a)}/heads/main`], { cwd: cache }),
  ).toBe(await gitPrim.head(a));
});

test('retarget during backfill cannot publish A as B; a later pass prepares B', async () => {
  const { workspaces, a, b, cache } = await fixture();
  const original = gitPrim.originConfigUrl;
  vi.spyOn(gitPrim, 'originConfigUrl').mockImplementationOnce(async (dir) => {
    const captured = await original(dir);
    await gitPrim.setRemoteUrl(dir, b);
    return captured;
  });
  await backfillRepositoryCaches(workspaces, () => {});
  expect(
    await runGitOk(['for-each-ref', '--format=%(refname)', repositoryCacheRefPrefix(b)], {
      cwd: cache,
    }),
  ).toBe('');
  expect(
    await runGitOk(['rev-parse', `${repositoryCacheRefPrefix(a)}/heads/main`], { cwd: cache }),
  ).toBe(await gitPrim.head(a));
  await backfillRepositoryCaches(workspaces, () => {});
  expect(
    await runGitOk(['rev-parse', `${repositoryCacheRefPrefix(b)}/heads/main`], { cwd: cache }),
  ).toBe(await gitPrim.head(b));
});

test('backfill skips links and non-cache directories instead of fetching outside its root', async () => {
  const { workspaces, root, a } = await fixture();
  const outside = join(root, 'outside');
  mkdirSync(outside);
  await gitPrim.clone(a, join(outside, 'repo'), null);
  symlinkSync(outside, join(workspaces, 'linked-project'));
  mkdirSync(join(workspaces, 'linked-cache'));
  symlinkSync(join(outside, 'repo'), join(workspaces, 'linked-cache', 'repo'));
  mkdirSync(join(workspaces, 'not-a-cache', 'repo'), { recursive: true });
  const conversation = join(workspaces, 'conversation');
  await gitPrim.clone(a, conversation, null);
  await gitPrim.clone(a, join(conversation, 'repo'), null);
  const exported = join(workspaces, 'exported');
  mkdirSync(exported);
  writeFileSync(join(exported, READONLY_EXPORT_MARKER), 'readonly fixture');
  await gitPrim.clone(a, join(exported, 'repo'), null);
  const fetch = vi.spyOn(gitPrim, 'fetch');
  await backfillRepositoryCaches(workspaces, () => {});
  expect(fetch).toHaveBeenCalledTimes(1);
});
