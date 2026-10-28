import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conversationBranch } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { commitEnv, runGit } from '../../apps/daemon/src/git.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  build as buildTable,
  gateState as gateStateTable,
  gateVerdict as gateVerdictTable,
  step as stepTable,
  todo as todoTable,
} from '../../apps/server/src/db/schema.js';
import { seed } from '../../apps/server/src/db/seed.js';
import { systemGitOps } from '../../apps/server/src/lib/git.js';
import { TeamStreamHub } from '../../apps/server/src/services/events.js';
import { enqueueLocalMerge } from '../../apps/server/src/services/local-merge.js';
import { localGateFacts } from '../../apps/server/src/services/local-merge-facts.js';
import {
  AGENT_ID,
  api,
  bootRealServer,
  daemonLogLines,
  type RealServer,
  seedWorld,
  waitFor,
} from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

const IDENTITY = { name: 'it-user', email: 'it-user@cairn.local' };
const PLAN_MD = [
  '# 方案',
  'Kind: fix',
  '',
  'Context: 探针任务，README 当前无探针行。',
  'Changes: 在 README.md 追加一行 g2t2 probe。',
  'Edge cases: 无。',
  'Verification: 读回 README.md 确认探针行在位。',
].join('\n');

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;

async function seedUserRepo(): Promise<string> {
  const dir = join(mkdtempSync(join(tmpdir(), 'cairn-g2t2-user-')), 'repo');
  await runGit(['init', '-b', 'main', dir]);
  writeFileSync(join(dir, 'README.md'), '# user repo\n');
  await runGit(['add', '-A'], { cwd: dir });
  await runGit(['commit', '-m', 'init'], { cwd: dir, env: commitEnv(IDENTITY) });
  return dir;
}

async function headOf(dir: string): Promise<string> {
  const r = await runGit(['rev-parse', 'HEAD'], { cwd: dir });
  return r.stdout.trim();
}

async function reflogMain(dir: string): Promise<string> {
  const r = await runGit(['reflog', 'main'], { cwd: dir });
  return r.stdout;
}

function nlinksUnder(dir: string): number[] {
  const out: number[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) out.push(statSync(p).nlink);
    }
  };
  walk(dir);
  return out;
}

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

function lifecycleTurns(probeLine: string) {
  return [
    {
      toolCall: { name: 'bash', arguments: { command: `cat > plan.md <<'EOF'\n${PLAN_MD}\nEOF` } },
    },
    { content: '方案已就绪：Context / Changes / Edge cases / Verification 四段完整。' },
    { toolCall: { name: 'bash', arguments: { command: `printf "${probeLine}\\n" >> README.md` } } },
    { content: '修改已完成并验证通过。' },
    { content: '合并已确认：分支改动已并入默认分支。' },
  ];
}

beforeAll(async () => {
  stub = await startStubLlm([
    ...lifecycleTurns('g2t2 probe line'),
    ...lifecycleTurns('g2t2 dirty probe'),
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试执行 Agent：按任务要求用 bash 工具完成文件改动，然后简短汇报。',
  });
  home = mkdtempSync(join(tmpdir(), 'cairn-g2t2-home-'));
  const config = loadDaemonConfig(
    { serverUrl: server.url, apiKey: server.apiKey, teamId: server.teamId, home, name: 'g2t2-mbp' },
    {},
  );
  paths = statePaths(config.home, config.workspacesDir);
  const logger = createDaemonLogger({ logFile: paths.daemonLog });
  handle = await runMachine({
    config,
    paths,
    logger,
    idleSleepPrevention: false,
    proxyEnv: {},
    claimBackoffBaseMs: 50,
    heartbeatIntervalMs: 500,
  });
  await waitFor(() => logLines().includes('[wake] push channel connected'), 30_000);
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${logLines().slice(-40).join('\n')}\n`,
  );
});

describe('G2-T2 local form full lifecycle (spec 12: mirror clone + push back to the user repo = delivery, main checkout untouched)', () => {
  let userRepo: string;
  let projectId: string;
  let todoId: string;
  let buildId: string;

  test('failure modes 1-3: plan/build → conv branch pushed back to the user repo → merge → conv branch update lands delivery, user main checkout unchanged (#1211)', async () => {
    userRepo = await seedUserRepo();
    const headSeed = await headOf(userRepo);
    const reflogSeed = await reflogMain(userRepo);
    const world = await seedWorld(
      server.url,
      server.teamId,
      { title: 'G2-T2 local 探针', spec: '在 README.md 追加一行 g2t2 probe line。' },
      {
        repoKind: 'local',
        localPath: userRepo,
        projectName: 'g2t2-local',
        mergePolicy: 'human',
      },
    );
    projectId = world.projectId;
    todoId = world.todoId;

    const started = await api(server.url, 'POST', `/api/projects/${projectId}/builds`, {
      todoIds: [todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    expect(started.status).toBe(201);
    buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(todoId) === 'confirm', 120_000);

    const baseRepo = join(paths.workspacesDir, projectId, 'repo');
    expect(existsSync(join(baseRepo, '.git'))).toBe(true);
    const objectLinks = nlinksUnder(join(baseRepo, '.git', 'objects'));
    expect(objectLinks.filter((n) => n >= 2).length).toBeGreaterThan(0);
    const hostedDir = join(server.reposDir, server.teamId);
    expect(existsSync(hostedDir) ? readdirSync(hostedDir) : []).toEqual([]);

    const confirmed = await api(server.url, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'confirm',
    });
    expect(confirmed.status).toBe(202);
    await waitFor(() => server.todoPhase(todoId) === 'review', 120_000);

    const branch = `cairn/conv-${buildId}`;
    const branchSha = await systemGitOps.resolveCommit(userRepo, `refs/heads/${branch}`);
    expect(branchSha).toMatch(/^[0-9a-f]{40}$/);
    const readme = await systemGitOps.readFileAt(userRepo, branchSha!, 'README.md');
    expect(new TextDecoder().decode(readme!.content)).toContain('g2t2 probe line');
    expect(logLines().some((l) => l.includes(`pushed ${branch}`))).toBe(true);
    expect(await headOf(userRepo)).toBe(headSeed);
    expect(await reflogMain(userRepo)).toBe(reflogSeed);
    expect(readFileSync(join(userRepo, 'README.md'), 'utf8')).not.toContain('g2t2 probe line');

    const mergeRes = await api(server.url, 'POST', `/api/builds/${buildId}/merge`, {});
    expect(mergeRes.status, JSON.stringify(mergeRes.body)).toBe(202);
    expect(mergeRes.body).toEqual({ delegated: true });
    await waitFor(() => server.todoPhase(todoId) === 'done', 120_000);

    const steps = server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
    const mergeStep = steps.find((s) => s.kind === 'merge')!;
    expect(mergeStep.status).toBe('done');
    const landed = await systemGitOps.resolveCommit(userRepo, `refs/heads/${branch}`);
    expect(landed).toBe(mergeStep.checkpointCommit);
    expect(await headOf(userRepo)).toBe(headSeed);
    expect(await reflogMain(userRepo)).toBe(reflogSeed);
    expect(readFileSync(join(userRepo, 'README.md'), 'utf8')).not.toContain('g2t2 probe line');
    const status = await runGit(['status', '--porcelain'], { cwd: userRepo });
    expect(status.stdout.trim()).toBe('');
  }, 200_000);

  test('failure mode 4: dirty workspace → merge step still done (#1211: delivery does not read the user workspace); user HEAD/dirty files unchanged', async () => {
    const dirtyRepo = await seedUserRepo();
    const world = await seedWorld(
      server.url,
      server.teamId,
      { title: 'G2-T2 脏区探针', spec: '在 README.md 追加一行 g2t2 dirty probe。' },
      {
        repoKind: 'local',
        localPath: dirtyRepo,
        projectName: 'g2t2-dirty',
        mergePolicy: 'human',
      },
    );
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    expect(started.status).toBe(201);
    const dirtyBuildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 120_000);
    await api(server.url, 'POST', `/api/builds/${dirtyBuildId}/steps`, { action: 'confirm' });
    await waitFor(() => server.todoPhase(world.todoId) === 'review', 120_000);

    writeFileSync(join(dirtyRepo, 'README.md'), '# user repo\nUSER UNCOMMITTED WORK\n');
    const headBefore = await headOf(dirtyRepo);

    const mergeRes = await api(server.url, 'POST', `/api/builds/${dirtyBuildId}/merge`, {});
    expect(mergeRes.status, JSON.stringify(mergeRes.body)).toBe(202);
    await waitFor(() => server.todoPhase(world.todoId) === 'done', 120_000);

    const buildRow = server.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.id, dirtyBuildId))
      .get()!;
    expect(buildRow.errorMessage).toBeNull();
    const steps = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, dirtyBuildId))
      .all();
    expect(steps.find((s) => s.kind === 'merge')!.status).toBe('done');
    const dirtyLanded = await systemGitOps.resolveCommit(
      dirtyRepo,
      `refs/heads/cairn/conv-${dirtyBuildId}`,
    );
    expect(dirtyLanded).toMatch(/^[0-9a-f]{40}$/);
    expect(await headOf(dirtyRepo)).toBe(headBefore);
    expect(readFileSync(join(dirtyRepo, 'README.md'), 'utf8')).toContain('USER UNCOMMITTED WORK');
  }, 200_000);
});

for (const checkout of ['default', 'other', 'dirty'] as const) {
  test(`autonomous local landing through claim and report with a ${checkout} checkout`, async () => {
    const repo = await seedUserRepo();
    const git = async (args: string[]) => {
      const result = await runGit(args, { cwd: repo, env: commitEnv(IDENTITY) });
      expect(result.code, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    const base = await headOf(repo);
    const world = await seedWorld(
      server.url,
      server.teamId,
      {
        title: 'Land autonomous local candidate',
        spec: 'Seeded ready verdict for local executor acceptance.',
      },
      { repoKind: 'local', localPath: repo, mergePolicy: 'autonomous' },
    );
    const checks = ['test -f apps/web/src/local.ts'];
    expect(
      (
        await api(server.url, 'PATCH', `/api/projects/${world.projectId}/merge-policy`, {
          localChecks: checks,
        })
      ).status,
    ).toBe(200);
    const buildId = randomUUID();
    await git(['checkout', '-b', conversationBranch(buildId)]);
    mkdirSync(join(repo, 'apps/web/src'), { recursive: true });
    writeFileSync(join(repo, 'apps/web/src/local.ts'), 'export const value = 1;\n');
    await git(['add', 'apps/web/src/local.ts']);
    await git(['commit', '-m', 'candidate']);
    const head = await headOf(repo);
    await git(['checkout', 'main']);
    if (checkout === 'other') await git(['checkout', '-b', 'user']);
    if (checkout === 'dirty') writeFileSync(join(repo, 'README.md'), 'uncommitted user work\n');
    server.db
      .insert(buildTable)
      .values({
        id: buildId,
        todoId: world.todoId,
        withPlan: false,
        triggerSource: 'user',
        createdAt: Date.now(),
      })
      .run();
    server.db
      .update(todoTable)
      .set({
        phase: 'review',
        latestBuildId: buildId,
        assignment: { plan: null, build: { agentId: AGENT_ID } },
        sourceRef: 'github:xiechimon/cairn#1625',
      })
      .where(eq(todoTable.id, world.todoId))
      .run();
    server.db
      .insert(stepTable)
      .values([
        {
          id: randomUUID(),
          buildId,
          kind: 'plan',
          machineId: null,
          status: 'done',
          prompt: null,
          createdAt: Date.now(),
          checkpointCommit: base,
        },
        {
          id: randomUUID(),
          buildId,
          kind: 'build',
          machineId: null,
          status: 'done',
          prompt: null,
          createdAt: Date.now() + 1,
          checkpointCommit: head,
        },
      ])
      .run();
    const deps = { db: server.db, hub: new TeamStreamHub(), user: seed(server.db).user };
    const judgedDigest = (await localGateFacts(deps, buildId, 'main'))?.readiness.patchDigest ?? '';
    expect(judgedDigest).toMatch(/^pd2:/);
    server.db
      .insert(gateVerdictTable)
      .values(
        (
          [
            { kind: 'verify' as const, perspective: null },
            { kind: 'review' as const, perspective: 'correctness' },
            { kind: 'decision' as const, perspective: null },
          ] as const
        ).map((v, index) => ({
          stepId: randomUUID(),
          buildId,
          kind: v.kind,
          perspective: v.perspective,
          outcome: 'pass' as const,
          patchDigest: judgedDigest,
          headSha: head,
          expectedHeadSha: head,
          createdAt: Date.now() + index,
        })),
      )
      .run();
    server.db
      .insert(gateStateTable)
      .values({
        buildId,
        ready: true,
        headSha: head,
        patchDigest: judgedDigest,
        policy: 'autonomous',
        blockers: [],
        evaluatedAt: Date.now(),
      })
      .run();
    const queued = await enqueueLocalMerge(deps, buildId, 'main');
    expect(queued.readiness?.blockers).toEqual([]);
    expect(queued.enqueued).toBe(true);
    await waitFor(
      () =>
        server.db
          .select()
          .from(stepTable)
          .where(eq(stepTable.buildId, buildId))
          .all()
          .find((row) => row.kind === 'merge')?.status === 'done',
      30_000,
    );
    const defaultHead = await git(['rev-parse', 'main']);
    if (checkout === 'dirty') {
      expect(defaultHead).toBe(base);
      expect(server.todoPhase(world.todoId)).toBe('review');
      expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('uncommitted user work\n');
    } else {
      expect(server.todoPhase(world.todoId)).toBe('done');
      expect(await git(['rev-list', '--count', `${base}..main`])).toBe('1');
      expect(await git(['rev-parse', 'main^'])).toBe(base);
      expect(await git(['rev-parse', 'main^{tree}'])).toBe(
        await git(['rev-parse', `${head}^{tree}`]),
      );
      expect(await headOf(repo)).toBe(checkout === 'default' ? defaultHead : base);
      expect(existsSync(join(repo, 'apps/web/src/local.ts'))).toBe(checkout === 'default');
    }
  }, 60_000);
}
