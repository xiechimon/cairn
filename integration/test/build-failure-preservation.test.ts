import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentBackend, StepEvent } from '@cairn/shared';
import { conversationBranch, machineDoneBodySchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { runGitOk } from '../../apps/daemon/src/git.js';
import { StepJournal } from '../../apps/daemon/src/journal.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { runStep } from '../../apps/daemon/src/runner.js';
import { statePaths } from '../../apps/daemon/src/state.js';
import { WorkspaceManager } from '../../apps/daemon/src/workspace.js';
import {
  CLAIMED,
  FakeMachineApi,
  fakeBackend,
} from '../../apps/daemon/test/machine-loop-harness.js';
import { agent, build, machine, message, step, todo } from '../../apps/server/src/db/schema.js';
import { applyBuildStepAction } from '../../apps/server/src/services/builds.js';
import { claimStep, finishStep } from '../../apps/server/src/services/machines.js';
import { bootServer, req } from '../../apps/server/test/helpers.js';

async function failedBuild(failure: 'duration' | 'idle' | 'crash' = 'duration') {
  const s = bootServer();
  const home = mkdtempSync(join(tmpdir(), 'cairn-1739-'));
  const logger = createDaemonLogger({ logFile: join(home, 'daemon.log') });
  const paths = statePaths(home, join(home, 'workspaces'));
  const workspace = new WorkspaceManager({ logger });
  const client = new FakeMachineApi();
  const created = await req(s.app, 'POST', '/api/projects', {
    name: 'preserve',
    repoKind: 'hosted',
  });
  const project = (await created.json()) as { id: string };
  const bare = join(s.reposDir, s.team.id, 'preserve.git');
  const seed = join(home, 'seed');
  await runGitOk(['clone', bare, seed]);
  const identity = {
    GIT_AUTHOR_NAME: 'probe',
    GIT_AUTHOR_EMAIL: 'probe@localhost',
    GIT_COMMITTER_NAME: 'probe',
    GIT_COMMITTER_EMAIL: 'probe@localhost',
  };
  writeFileSync(join(seed, 'README.md'), 'base\n');
  await runGitOk(['add', 'README.md'], { cwd: seed });
  await runGitOk(['commit', '-m', 'base'], { cwd: seed, env: identity });
  await runGitOk(['push', 'origin', 'main'], { cwd: seed });
  s.db
    .insert(machine)
    .values({ id: 'm1', teamId: s.team.id, name: 'probe', online: true, enabledRuntimes: ['pi'] })
    .run();
  s.db
    .insert(agent)
    .values({
      id: 'a1',
      teamId: s.team.id,
      displayName: 'probe',
      modelId: 'stub-model',
      machineId: 'm1',
    })
    .run();
  s.db
    .insert(todo)
    .values({
      id: 't1',
      teamId: s.team.id,
      projectId: project.id,
      title: 'preserve',
      phase: 'building',
      phaseAt: 1,
      seqNum: 1,
      latestBuildId: 'b1',
      assignment: { plan: null, build: { agentId: 'a1' } },
    })
    .run();
  s.db
    .insert(build)
    .values({ id: 'b1', todoId: 't1', withPlan: false, triggerSource: 'user', createdAt: 1 })
    .run();
  s.db
    .insert(step)
    .values({
      id: 's1',
      buildId: 'b1',
      kind: 'build',
      status: 'claimed',
      machineId: 'm1',
      createdAt: 1,
      claimedAt: 1,
    })
    .run();
  const commits: string[] = [];
  let release = () => {};
  const backend: AgentBackend = {
    ...fakeBackend([]).backend,
    async createSession(opts) {
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        sessionId: 'preserve-session',
        events: (async function* (): AsyncGenerator<StepEvent> {
          for (const name of ['first', 'second']) {
            writeFileSync(join(opts.cwd, `${name}.txt`), `${name}\n`);
            await runGitOk(['add', `${name}.txt`], { cwd: opts.cwd });
            await runGitOk(['commit', '-m', name], { cwd: opts.cwd, env: identity });
            commits.push(await runGitOk(['rev-parse', 'HEAD'], { cwd: opts.cwd }));
            yield { type: 'text_delta', text: name };
          }
          if (failure === 'crash') throw new Error('backend crashed');
          await gate;
        })(),
        stop: async () => release(),
        steer: async () => {},
        usage: () => [],
      };
    },
  };
  const claimed = {
    ...CLAIMED,
    step: { ...CLAIMED.step, buildId: 'b1', kind: 'build' as const },
    conversationId: 'b1',
    project: {
      id: project.id,
      name: 'preserve',
      repo: { kind: 'hosted' as const, cloneUrl: bare },
    },
  };
  await runStep(
    {
      client,
      journal: new StepJournal(paths.outboxDir),
      backendFor: () => backend,
      logger,
      paths,
      workspace,
      workspacesDir: paths.workspacesDir,
      mcpConfigPath: join(home, 'mcp.json'),
    },
    claimed,
    {
      streamDurationCapMs: failure === 'idle' ? 5000 : 500,
      streamTimeouts: { first: 5000, idle: failure === 'idle' ? 200 : 5000, body: 5000 },
    },
  );
  const body = machineDoneBodySchema.parse(client.doneBodies[0]!.body);
  const deps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
  };
  await finishStep(deps, 'm1', 's1', body);
  return {
    s,
    home,
    bare,
    commits,
    body,
    workspace,
    logger,
    claimed,
    deps,
    dispose: () => {
      s.dispose();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test.each(['duration', 'idle', 'crash'] as const)(
  '%s failure pushes existing commits and exposes them in the fallback report and changes API',
  async (failure) => {
    const w = await failedBuild(failure);
    try {
      expect(w.body.errorMessage).toContain(
        failure === 'crash' ? 'backend crashed' : `arm=${failure}`,
      );
      expect(w.commits).toHaveLength(2);
      expect(
        await runGitOk(['rev-parse', `refs/heads/${conversationBranch('b1')}`], { cwd: w.bare }),
      ).toBe(w.commits.at(-1));
      const reports = w.s.db
        .select()
        .from(message)
        .where(eq(message.conversationId, 'b1'))
        .all()
        .map((row) => String(row.content))
        .join('\n');
      for (const commit of w.commits) expect(reports).toContain(commit);
      expect(reports).toContain('first.txt');
      expect(reports).toContain('second.txt');
      expect(w.body.preservedCommits).toEqual(w.commits);
      expect(w.body.commit).toBe(w.commits.at(-1));
      const changes = await req(w.s.app, 'GET', '/api/builds/b1/changes');
      expect(await changes.json()).toMatchObject({
        changed: true,
        files: expect.arrayContaining([
          expect.objectContaining({ path: 'first.txt' }),
          expect.objectContaining({ path: 'second.txt' }),
        ]),
      });
    } finally {
      w.dispose();
    }
  },
);

test('restart of a failed build without a PR reuses its branch and restores earlier commits on a fresh workspace', async () => {
  const w = await failedBuild();
  try {
    await applyBuildStepAction(w.s.svc, 'b1', {
      action: 'restart',
      feedback: '',
      clientMessageId: 'restart-1739',
    });
    expect(w.s.db.select().from(build).all()).toHaveLength(1);
    const next = await claimStep(w.deps, 'm1', w.s.team.id, 1, 'http://localhost');
    expect(next?.conversationId).toBe('b1');
    expect(next?.step.kind).toBe('build');
    const freshRoot = join(w.home, 'fresh');
    const prepared = await w.workspace.prepare({
      projectId: w.claimed.project.id,
      conversationId: next!.conversationId,
      cloneUrl: w.bare,
      repoKind: 'hosted',
      workspacesRoot: freshRoot,
      credentials: null,
    });
    expect(prepared.branch).toBe(conversationBranch('b1'));
    expect(readFileSync(join(prepared.cwd, 'first.txt'), 'utf8')).toBe('first\n');
    expect(await runGitOk(['rev-parse', 'HEAD'], { cwd: prepared.cwd })).toBe(w.commits.at(-1));
  } finally {
    w.dispose();
  }
});
