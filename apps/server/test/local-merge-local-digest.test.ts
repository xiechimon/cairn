import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_AUTONOMY_SETTINGS } from '@cairn/shared';
import { afterEach, expect, test } from 'vitest';
import { commitEnv, runGitOk } from '../../daemon/src/git.js';
import { inspectLocalPatch } from '../../daemon/src/local-merge.js';
import {
  agent as agentTable,
  build as buildTable,
  gateState as gateStateTable,
  gateVerdict as gateVerdictTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { localGateFacts } from '../src/services/local-merge-facts.js';
import { bootServer, type TestServer } from './helpers.js';

const disposals: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});

const identity = { name: 'server-digest', email: 'server-digest@cairn.local' };

async function seededRepo(): Promise<{ dir: string; base: string; head: string }> {
  const dir = join(mkdtempSync(join(tmpdir(), 'srv-local-digest-')), 'repo');
  mkdirSync(dir);
  const git = (args: string[]) => runGitOk(args, { cwd: dir, env: commitEnv(identity) });
  await git(['init', '-b', 'main']);
  writeFileSync(join(dir, 'README.md'), '# repo\n');
  await git(['add', '-A']);
  await git(['commit', '-m', 'base']);
  const base = await git(['rev-parse', 'HEAD']);
  await git(['checkout', '-b', 'cairn/conv-build']);
  mkdirSync(join(dir, 'apps/web/src'), { recursive: true });
  writeFileSync(join(dir, 'apps/web/src/local.ts'), 'export const value = 1;\n');
  await git(['add', '-A']);
  await git(['commit', '-m', 'candidate']);
  const head = await git(['rev-parse', 'HEAD']);
  await git(['checkout', 'main']);
  return { dir, base, head };
}

function seededWorld(s: TestServer, localPath: string, base: string, head: string): void {
  s.db
    .insert(projectTable)
    .values({
      id: 'project',
      teamId: s.team.id,
      name: 'Local',
      repoKind: 'local',
      localPath,
      autonomy: { ...DEFAULT_AUTONOMY_SETTINGS, mergePolicy: 'autonomous', localChecks: ['true'] },
    })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: 'agent',
      teamId: s.team.id,
      displayName: 'Local agent',
      description: '',
      provider: 'anthropic',
      modelId: 'claude-x',
      tools: ['merge', 'push'],
      machineId: null,
    })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: 'todo',
      teamId: s.team.id,
      projectId: 'project',
      title: 'Deliver local change',
      spec: '',
      phase: 'review',
      phaseAt: Date.now(),
      seqNum: 1,
      latestBuildId: 'build',
      sourceRef: 'github:xiechimon/cairn#1625',
      assignment: { plan: null, build: { agentId: 'agent' } },
    })
    .run();
  s.db
    .insert(buildTable)
    .values({ id: 'build', todoId: 'todo', withPlan: false, triggerSource: 'user', createdAt: 1 })
    .run();
  for (const [id, kind, commit, createdAt] of [
    ['plan', 'plan', base, 1],
    ['build', 'build', head, 2],
  ] as const) {
    s.db
      .insert(stepTable)
      .values({
        id,
        buildId: 'build',
        kind,
        machineId: null,
        status: 'done',
        prompt: null,
        createdAt,
        checkpointCommit: commit,
      })
      .run();
  }
}

test('the judged digest of a local build is the real diff digest the daemon recomputes', async () => {
  const repo = await seededRepo();
  const s = bootServer();
  disposals.push(() => s.dispose());
  seededWorld(s, repo.dir, repo.base, repo.head);
  const deps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
  };
  const daemon = await inspectLocalPatch(repo.dir, repo.base, repo.head);
  const facts = await localGateFacts(deps, 'build', 'main');
  expect(facts?.readiness.patchDigest).toBe(daemon.patchDigest);
  expect(facts?.judgedDigest).toBeNull();
  s.db
    .insert(gateVerdictTable)
    .values(
      (
        [
          { kind: 'verify' as const, perspective: null },
          { kind: 'review' as const, perspective: 'correctness' },
          { kind: 'decision' as const, perspective: null },
        ] as const
      ).map((v, index) => ({
        stepId: `verdict-${v.kind}`,
        buildId: 'build',
        kind: v.kind,
        perspective: v.perspective,
        outcome: 'pass' as const,
        patchDigest: daemon.patchDigest,
        headSha: repo.head,
        expectedHeadSha: repo.head,
        createdAt: index,
      })),
    )
    .run();
  s.db
    .insert(gateStateTable)
    .values({
      buildId: 'build',
      ready: true,
      headSha: repo.head,
      patchDigest: daemon.patchDigest,
      policy: 'autonomous',
      blockers: [],
      evaluatedAt: Date.now(),
    })
    .run();
  const judged = await localGateFacts(deps, 'build', 'main');
  expect(judged?.judgedDigest).toBe(daemon.patchDigest);
  expect(judged?.readiness.ready).toBe(true);
  expect(judged?.readiness.blockers).toEqual([]);
});

test('a local project whose path holds a different patch yields a digest that does not match', async () => {
  const repo = await seededRepo();
  const s = bootServer();
  disposals.push(() => s.dispose());
  seededWorld(s, repo.dir, repo.base, repo.head);
  const deps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
  };
  writeFileSync(join(repo.dir, 'extra.txt'), 'unjudged\n');
  const git = (args: string[]) => runGitOk(args, { cwd: repo.dir, env: commitEnv(identity) });
  await git(['checkout', 'cairn/conv-build']);
  writeFileSync(join(repo.dir, 'apps/web/src/local.ts'), 'export const value = 2;\n');
  await git(['commit', '-am', 'moved head']);
  await git(['checkout', 'main']);
  const daemon = await inspectLocalPatch(repo.dir, repo.base, repo.head);
  const facts = await localGateFacts(deps, 'build', 'main');
  expect(facts?.readiness.patchDigest).toBe(daemon.patchDigest);
});
