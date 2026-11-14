import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  ASK_USER_QUESTION_KIND,
  type CoordinatorCreateTodoParams,
  type ProviderConfig,
} from '@cairn/shared';
import { openExperimentClient } from '@cairn/shared/langfuse';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDbWithHandle } from '../../apps/server/src/db/client.js';
import {
  build,
  chiefMessage,
  chiefThread,
  message,
  project,
  step,
  todo,
} from '../../apps/server/src/db/schema.js';
import { seed } from '../../apps/server/src/db/seed.js';
import { makeTestTempDir, releaseTestTempDir } from '../../scripts/test-tmpdir.mjs';
import { candidateClosure } from '../eval/coordinator-routing/closure.mts';
import {
  decisionOutput,
  expectedOutput,
  normalize,
  observeTurn,
  replayInput,
  replayThread,
  replayTodo,
} from '../eval/coordinator-routing/contract.mts';
import * as runner from '../eval/coordinator-routing/run.mts';
import { type Manifest, runExperiment } from '../eval/coordinator-routing/run.mts';
import { runSandboxedTurn } from '../eval/coordinator-routing/sandbox.mts';
import { harvestReplayInput, seedReplayState } from '../eval/coordinator-routing/state.mts';
import { startStubLlm } from './stub-llm.js';

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
async function candidateFixture(): Promise<string> {
  const dir = makeTestTempDir('eval-langfuse-candidate-');
  closers.push(async () => releaseTestTempDir(dir));
  for (const path of await candidateClosure(new URL('../..', import.meta.url).pathname)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    cpSync(new URL(`../../${path}`, import.meta.url), join(dir, path));
  }
  return dir;
}
const input = {
  request: 'What is ready?',
  projects: [
    {
      id: 'project-0',
      name: 'docs',
      description: 'Documentation',
      repoKind: null,
      archivedAt: null,
    },
  ],
  snapshot: {
    source: 'harvest-db' as const,
    sourceTraceId: 'source-1',
    capturedAt: 1,
    todos: [],
    threads: [],
    visible: [],
  },
};
function modelProvider(url: string): ProviderConfig {
  return {
    kind: 'http',
    providerId: 'openai-codex',
    api: 'openai-completions',
    baseUrl: url,
    models: [{ id: 'gpt-6.1-sol', name: 'test' }],
  };
}
const manifest: Manifest = {
  dataset: 'routing',
  version: '2026-11-09T00:00:00.000Z',
  candidateSha: 'a'.repeat(40),
  runnerSha: 'b'.repeat(40),
  promptSha: 'c'.repeat(64),
  evaluatorVersions: {},
  thinking: 'low',
  arm: 'candidate',
  repeat: 1,
};

describe('Langfuse Coordinator runner', () => {
  it.each(['expected', 'observed'])('validates %s dependency endpoints', (kind) => {
    const schema = kind === 'expected' ? expectedOutput : decisionOutput;
    const output = {
      decision: 'route',
      parts: [
        { project: 'docs', title: 'one' },
        { project: 'docs', title: 'two' },
      ],
      questions: [],
      askCandidates: [],
      blockedBy: [[1, 0]],
      stepStatus: 'done',
      turnTraceId: 'a'.repeat(32),
      promptSha256: 'b'.repeat(64),
    };
    const raw =
      kind === 'expected'
        ? {
            decision: output.decision,
            parts: output.parts.map(({ project }) => ({ project })),
            askCandidates: [],
            blockedBy: output.blockedBy,
          }
        : output;
    expect(schema.safeParse(raw).success).toBe(true);
    for (const edge of [
      [2, 0],
      [0, 2],
      [0, 0],
      [1, 1],
      [-1, 0],
      [0.5, 1],
    ])
      expect(schema.safeParse({ ...raw, blockedBy: [edge] }).success).toBe(false);
  });

  it.each(['project', 'todo', 'build', 'source'])(
    'fails closed on unknown or future %s time',
    (site) => {
      const oldTodo = {
        id: 'old',
        projectId: 'project-0',
        title: 'Old',
        spec: '',
        phase: 'done',
        phaseAt: 1,
        archivedAt: null,
        seqNum: 1,
        orderIndex: 0,
        blockedBy: null,
        latestBuildId: null,
        sourceKind: null,
        sourceRef: null,
        request: null,
        output: 'info',
        createdAt: 1,
        updatedAt: 10,
      };
      const oldBuild = {
        id: 'old-build',
        todoId: 'old',
        withPlan: false,
        prevPhase: null,
        triggerSource: 'user',
        planDocId: null,
        errorMessage: null,
        prUrl: null,
        prNumber: null,
        diffHash: null,
        reportAttachmentId: null,
        stop: null,
        reportLine: null,
        createdAt: 1,
        updatedAt: 10,
      };
      const rows = new Map<unknown, Record<string, unknown>[]>([
        [step, [{ id: 'source', kind: 'chief', buildId: 'thread', createdAt: 10 }]],
        [chiefMessage, [{ role: 'user', threadId: 'thread', content: 'request', projectId: null }]],
        [chiefThread, [{ teamId: 'team' }]],
        [project, [{ ...input.projects[0], createdAt: 1, updatedAt: 10 }]],
        [todo, [oldTodo]],
        [build, [oldBuild]],
      ]);
      const db = {
        transaction: (work: () => unknown) => work(),
        select: () => ({
          from: (table: unknown) => {
            const query = {
              where: (_value: unknown) => query,
              get: () => rows.get(table)?.[0],
              all: () => rows.get(table) ?? [],
            };
            return query;
          },
        }),
      } as unknown as Parameters<typeof harvestReplayInput>[0];
      expect(() => harvestReplayInput(db, 'source')).toThrow('missing source resources');
      const row = rows.get({ project, todo, build, source: step }[site])![0]!;
      for (const field of site === 'source' ? ['createdAt'] : ['createdAt', 'updatedAt']) {
        const previous = row[field];
        for (const time of [undefined, null, 0, -1, NaN, ...(site === 'source' ? [] : [11])]) {
          row[field] = time;
          expect(() => harvestReplayInput(db, 'source')).toThrow(/incomplete:.*time/);
        }
        row[field] = previous;
      }
      expect(() => harvestReplayInput(db, 'source')).toThrow('missing source resources');
    },
  );

  it.each(['project reference', 'pinned input'])('validates experiment %s', async (site) => {
    const item = {
      id: '1',
      datasetId: 'd',
      sourceTraceId: 'source-1',
      status: 'ACTIVE',
      input,
      expectedOutput: {
        decision: 'route',
        parts: [{ project: 'missing' }],
        askCandidates: [],
        blockedBy: [],
      },
    };
    const execute = vi.fn(async () => ({
      decision: 'answer',
      parts: [],
      questions: [],
      askCandidates: [],
      blockedBy: [],
      stepStatus: 'done',
      turnTraceId: 'a'.repeat(32),
      promptSha256: 'b'.repeat(64),
    }));
    const experiment = vi.fn(async ({ task }: { task: (item: unknown) => Promise<unknown> }) => ({
      itemResults: [
        await task({ ...item, input: { ...input, request: 'changed after preflight' } }),
      ],
    }));
    const client = {
      dataset: { get: async () => ({ items: [item] }) },
      experiment: { run: experiment },
    } as unknown as Parameters<typeof runExperiment>[0];
    if (site === 'project reference') {
      await expect(runExperiment(client, manifest, execute)).rejects.toThrow('expectedOutput');
      expect(experiment).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    }
    item.expectedOutput.parts[0]!.project = 'docs';
    await runExperiment(client, manifest, execute);
    expect(execute).toHaveBeenCalledWith(input);
  });

  it('uses one observable decision and rejects mixed, failed and empty turns', () => {
    expect(normalize('done', [], false, 'answer')).toBe('answer');
    expect(normalize('done', ['docs'], false, '')).toBe('route');
    expect(normalize('claimed', [], true, '')).toBe('ask');
    for (const args of [
      ['done', ['docs'], true, ''],
      ['failed', [], false, 'answer'],
      ['done', [], false, ''],
    ] as const)
      expect(() => normalize(args[0], args[1], args[2], args[3])).toThrow();
    expect(() => replayInput.parse({ ...input, repository: 'current checkout' })).toThrow();
    expect(() =>
      replayInput.parse({ ...input, projects: [input.projects[0], input.projects[0]] }),
    ).toThrow();
  });

  it('rejects a harvested case without a visible-state snapshot', () => {
    const { snapshot: _snapshot, ...missing } = input;
    expect(() => replayInput.parse(missing)).toThrow();
  });

  it.each(['todos', 'open_thread'])(
    'rejects %s until its complete read closure is captured',
    (name) => {
      expect(() =>
        observeTurn(
          {
            protocol: 'cairn.routing.observations.v1',
            todos: [],
            toolCalls: [name],
            questions: [],
            text: 'answer',
            stepStatus: 'done',
            turnTraceId: 'a'.repeat(32),
            promptSha256: 'b'.repeat(64),
          },
          input,
        ),
      ).toThrow('uncaptured state');
    },
  );

  it.each([
    undefined,
    null,
    {},
    { decision: 'hold' },
    { decision: 'route', parts: [{ project: 1 }], askCandidates: [], blockedBy: [] },
    { decision: 'route', parts: [{}], askCandidates: [], blockedBy: [] },
    {
      decision: 'route',
      parts: [{ project: 'docs', title: 'extra' }],
      askCandidates: [],
      blockedBy: [],
    },
    { decision: 'answer', parts: [], askCandidates: [], blockedBy: [], notes: 1 },
    { decision: 'route', parts: [{ project: 'docs' }], askCandidates: [], blockedBy: [[1, '0']] },
  ])(
    'rejects an ACTIVE item with invalid expectedOutput %j before starting the SDK experiment',
    async (expectedOutput) => {
      const execute = vi.fn();
      const experiment = vi.fn(async () => ({ itemResults: [] }));
      const client = {
        dataset: {
          get: async () => ({
            items: [
              {
                id: '1',
                datasetId: 'd',
                sourceTraceId: 't1',
                status: 'ACTIVE',
                input: { ...input, snapshot: { ...input.snapshot, sourceTraceId: 't1' } },
                expectedOutput: { decision: 'answer', parts: [], askCandidates: [], blockedBy: [] },
              },
              {
                id: '2',
                datasetId: 'd',
                sourceTraceId: 't2',
                status: 'ACTIVE',
                input: { ...input, snapshot: { ...input.snapshot, sourceTraceId: 't2' } },
                expectedOutput,
              },
            ],
          }),
        },
        experiment: { run: experiment },
      };
      await expect(
        runExperiment(client as unknown as Parameters<typeof runExperiment>[0], manifest, execute),
      ).rejects.toThrow('expectedOutput');
      expect(experiment).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('lets six near-budget turns finish and always cleans up on a deadline', async () => {
    vi.useFakeTimers();
    try {
      const close = vi.fn(async () => {});
      const output = {
        decision: 'answer',
        parts: [],
        questions: [],
        askCandidates: [],
        blockedBy: [],
        stepStatus: 'done',
        turnTraceId: 'a'.repeat(32),
        promptSha256: 'b'.repeat(64),
      };
      const items = Array.from({ length: 6 }, (_, n) => ({
        id: String(n),
        datasetId: 'd',
        sourceTraceId: String(n),
        status: 'ACTIVE',
        input: { ...input, snapshot: { ...input.snapshot, sourceTraceId: String(n) } },
        expectedOutput: { decision: 'answer', parts: [], askCandidates: [], blockedBy: [] },
      }));
      const client = {
        dataset: { get: async () => ({ items }) },
        experiment: {
          run: async ({ task }: { task: (item: unknown) => Promise<unknown> }) => {
            const itemResults = [];
            for (const item of items) itemResults.push(await task(item));
            return { itemResults };
          },
        },
      } as unknown as Parameters<typeof runExperiment>[0];
      const work = runner.runExperimentWithCleanup(
        client,
        manifest,
        async () => {
          await new Promise((r) => setTimeout(r, 609_000));
          return output;
        },
        close,
      );
      const assertion = expect(work).resolves.toMatchObject({ itemResults: expect.any(Array) });
      await vi.advanceTimersByTimeAsync(6 * 609_000);
      await assertion;
      expect(close).toHaveBeenCalledOnce();
      close.mockClear();
      const failed = runner.runExperimentWithCleanup(
        client,
        manifest,
        () => new Promise(() => {}),
        close,
      );
      const rejected = expect(failed).rejects.toThrow('incomplete');
      await vi.advanceTimersByTimeAsync(610_000);
      await rejected;
      expect(close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('seeds harvested todos for projects and sourceTodoId without counting old tasks as new routes', async () => {
    const world = {
      ...input,
      projects: [
        {
          id: 'project-0',
          name: 'docs',
          description: 'Documentation',
          repoKind: null,
          archivedAt: null,
        },
      ],
      snapshot: {
        source: 'harvest-db' as const,
        sourceTraceId: 'source-1',
        capturedAt: 1,
        todos: [
          {
            id: 'existing',
            projectId: 'project-0',
            title: 'Existing docs',
            spec: 'Repair the reference.',
            phase: 'todo' as const,
            phaseAt: 1,
            archivedAt: null,
            seqNum: 7,
            orderIndex: 3,
            blockedBy: null,
            latestBuildId: null,
            sourceKind: null,
            sourceRef: null,
            request: null,
            output: 'info' as const,
          },
        ],
        threads: [],
        visible: [{ id: 'existing', ownership: null, blocks: true }],
      },
    };
    const model = await startStubLlm([
      { toolCall: { name: 'projects', arguments: {} } },
      { content: 'one task' },
    ]);
    closers.push(() => model.close());
    expect(
      await runSandboxedTurn(world, modelProvider(model.url), 'test-key', 30_000),
    ).toMatchObject({ decision: 'answer', parts: [] });
    const projectResult = model.requests
      .flatMap((request) => request.messages)
      .find((m) => m.role === 'tool')?.content;
    expect(JSON.parse(String(projectResult))).toEqual([
      { id: 'project-0', name: 'docs', repoKind: null, todoCount: 1 },
    ]);
    const route = await startStubLlm([
      {
        toolCall: {
          name: 'create_todo',
          arguments: { projectId: 'project-0', sourceTodoId: 'existing' },
        },
      },
      { content: 'recorded' },
    ]);
    closers.push(() => route.close());
    expect(
      await runSandboxedTurn(world, modelProvider(route.url), 'test-key', 30_000),
    ).toMatchObject({
      decision: 'route',
      parts: [{ project: 'docs', title: 'Repair the reference.' }],
    });
  }, 90_000);

  it('rejects unverifiable DB harvests and seeds independently captured snapshots', async () => {
    const source = openDbWithHandle(':memory:');
    const target = openDbWithHandle(':memory:');
    try {
      const { user, team } = seed(source.db);
      const destination = seed(target.db);
      seedReplayState(source.db, team.id, input);
      source.db
        .insert(todo)
        .values({
          id: 'old',
          teamId: team.id,
          projectId: 'project-0',
          title: 'Old',
          spec: 'Original words',
          phase: 'building',
          phaseAt: 10,
          seqNum: 4,
          latestBuildId: 'old-build',
        })
        .run();
      source.db
        .insert(build)
        .values({
          id: 'old-build',
          todoId: 'old',
          withPlan: true,
          prevPhase: 'todo',
          triggerSource: 'user',
          createdAt: 10,
        })
        .run();
      source.db
        .insert(chiefThread)
        .values({
          id: 'source-thread',
          chiefId: 'source-chief',
          userId: user.id,
          teamId: team.id,
          title: 'Source',
          createdAt: 1,
          updatedAt: 1,
          sessionId: 'source-session',
          sessionOpenedAt: 1,
        })
        .run();
      source.db
        .insert(chiefMessage)
        .values({
          id: 'source-turn',
          threadId: 'source-thread',
          role: 'user',
          content: 'The original request',
          projectId: 'project-0',
          createdAt: 1,
        })
        .run();
      source.db
        .insert(step)
        .values({
          id: 'source-turn',
          buildId: 'source-thread',
          kind: 'chief',
          status: 'done',
          createdAt: 1,
        })
        .run();
      expect(() => harvestReplayInput(source.db, 'source-turn')).toThrow(
        'incomplete: unknown project time',
      );
      const harvested = replayInput.parse({
        ...input,
        request: 'The original request',
        chip: 'docs',
        snapshot: {
          ...input.snapshot,
          source: 'trace',
          sourceTraceId: 'a'.repeat(32),
          todos: source.db
            .select()
            .from(todo)
            .all()
            .map((row) =>
              replayTodo.parse(
                Object.fromEntries(
                  Object.keys(replayTodo.shape).map((key) => [key, row[key as keyof typeof row]]),
                ),
              ),
            ),
          threads: source.db
            .select()
            .from(build)
            .all()
            .map((row) =>
              replayThread.parse(
                Object.fromEntries(
                  Object.keys(replayThread.shape).map((key) => [key, row[key as keyof typeof row]]),
                ),
              ),
            ),
          visible: [{ id: 'old', ownership: null, blocks: true }],
        },
      });
      expect(harvested).toMatchObject({
        request: 'The original request',
        chip: 'docs',
        snapshot: {
          source: 'trace',
          sourceTraceId: expect.stringMatching(/^[a-f0-9]{32}$/),
          todos: [{ id: 'old', latestBuildId: 'old-build', spec: 'Original words' }],
          threads: [{ id: 'old-build', todoId: 'old' }],
        },
      });
      seedReplayState(target.db, destination.team.id, harvested);
      expect(target.db.select().from(todo).all()).toMatchObject([
        {
          id: 'old',
          latestBuildId: 'old-build',
          spec: 'Original words',
          teamId: destination.team.id,
        },
      ]);
      expect(target.db.select().from(build).all()).toMatchObject([
        { id: 'old-build', todoId: 'old' },
      ]);
      source.db
        .insert(message)
        .values({
          id: 'pending-question',
          conversationId: 'old-build',
          role: 'assistant',
          content: { kind: ASK_USER_QUESTION_KIND, status: 'pending' },
          createdAt: 20,
        })
        .run();
      expect(() => harvestReplayInput(source.db, 'source-turn')).toThrow('incomplete');
      const waiting = replayInput.parse({
        ...harvested,
        snapshot: {
          ...harvested.snapshot,
          visible: [
            { id: 'old', ownership: { owner: 'coordinator', reason: 'question' }, blocks: true },
          ],
        },
      });
      expect(waiting.snapshot.visible).toEqual([
        { id: 'old', ownership: { owner: 'coordinator', reason: 'question' }, blocks: true },
      ]);
      const model = await startStubLlm([{ content: 'quiet' }]);
      closers.push(() => model.close());
      await expect(
        runSandboxedTurn(waiting, modelProvider(model.url), 'test-key', 30_000),
      ).rejects.toThrow('worker exit 2');
      expect(model.requests).toHaveLength(0);
      const unsupported = openDbWithHandle(':memory:');
      try {
        const fresh = seed(unsupported.db);
        expect(() => seedReplayState(unsupported.db, fresh.team.id, waiting)).toThrow(
          'uncaptured visible thread state',
        );
      } finally {
        unsupported.close();
      }
      expect(() => harvestReplayInput(source.db, 'missing')).toThrow('Missing harvest source');
      expect(() =>
        replayInput.parse({
          ...harvested,
          snapshot: {
            ...harvested.snapshot,
            todos: harvested.snapshot.todos.map((t) => ({ ...t, surprise: true })),
          },
        }),
      ).toThrow();
      expect(() =>
        replayInput.parse({
          ...harvested,
          snapshot: {
            ...harvested.snapshot,
            todos: harvested.snapshot.todos.map((t) => ({ ...t, phase: 'invented' })),
          },
        }),
      ).toThrow();
      for (const snapshot of [
        undefined,
        { ...harvested.snapshot, surprise: true },
        { ...harvested.snapshot, threads: [] },
        {
          ...harvested.snapshot,
          todos: [...harvested.snapshot.todos, ...harvested.snapshot.todos],
        },
      ])
        expect(() => replayInput.parse({ ...harvested, snapshot })).toThrow();
    } finally {
      source.close();
      target.close();
    }
  });

  it('runs the actual CLI beyond its former hour budget and flushes SDK cleanup', () => {
    const dir = makeTestTempDir('eval-langfuse-cli-budget-');
    closers.push(async () => releaseTestTempDir(dir));
    const fixture = join(dir, 'items.json');
    writeFileSync(
      fixture,
      JSON.stringify(
        Array.from({ length: 6 }, (_, n) => ({
          id: String(n),
          datasetId: 'd',
          sourceTraceId: String(n),
          status: 'ACTIVE',
          input: { ...input, snapshot: { ...input.snapshot, sourceTraceId: String(n) } },
          expectedOutput: { decision: 'answer', parts: [], askCandidates: [], blockedBy: [] },
        })),
      ),
    );
    const preload = join(dir, 'cli-fixtures.mjs');
    writeFileSync(
      preload,
      `
import childProcess from 'node:child_process';
import {registerHooks, syncBuiltinESMExports} from 'node:module';
const fixture = ${JSON.stringify(fixture)};
const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => originalSetTimeout(fn, ms >= 15000 ? ms / 1000 : ms, ...args);
childProcess.execFileSync = (_command, args) => args[0] === 'rev-parse' ? 'a'.repeat(40) : '';
syncBuiltinESMExports();
const modules = {
  '@cairn/shared/langfuse': \`import {readFileSync} from 'node:fs';export function openExperimentClient(){return {client:{dataset:{get:async()=>({items:JSON.parse(readFileSync(\${JSON.stringify(fixture)},'utf8'))})},experiment:{run:async({task,data})=>{const itemResults=[];for(const item of data)itemResults.push(await task(item));return {itemResults,runName:'fixture',experimentId:'fixture'};}}},close:async()=>{console.log('SDK-CLEANUP');}}}\`,
  'eval-auth.js': \`export async function evalCodexKey(){return 'test-key';}\`,
  './sandbox.mts': \`export async function runSandboxedTurn(){await new Promise(r=>setTimeout(r,609000));return {decision:'answer',parts:[],questions:[],askCandidates:[],blockedBy:[],stepStatus:'done',turnTraceId:'a'.repeat(32),promptSha256:'b'.repeat(64)};}\`,
};
registerHooks({resolve(specifier,context,next){const key=specifier.includes('eval-auth.')?'eval-auth.js':(specifier==='./sandbox.mts'||specifier.includes('coordinator-routing/sandbox.mts'))?'./sandbox.mts':(specifier==='@cairn/shared/langfuse'||specifier.includes('packages/shared/src/langfuse.'))?'@cairn/shared/langfuse':undefined;return key?{url:'data:text/javascript,'+encodeURIComponent(modules[key]),shortCircuit:true}:next(specifier,context);}});
`,
    );
    const path = join(dir, 'manifest.json');
    writeFileSync(
      path,
      JSON.stringify({
        ...manifest,
        runnerSha: manifest.candidateSha,
        promptSha: createHash('sha256')
          .update(readFileSync(new URL('../../apps/server/src/services/chief.ts', import.meta.url)))
          .digest('hex'),
      }),
    );
    const cli = spawnSync(
      process.execPath,
      [
        '--import',
        preload,
        '--import',
        import.meta.resolve('tsx'),
        new URL('../eval/coordinator-routing/run.mts', import.meta.url).pathname,
        path,
      ],
      { encoding: 'utf8', timeout: 15_000, env: { ...process.env, PI_CODING_AGENT_DIR: dir } },
    );
    expect({ status: cli.status, stderr: cli.stderr, stdout: cli.stdout }).toMatchObject({
      status: 0,
      stderr: '',
    });
    expect(cli.stdout).toContain('SDK-CLEANUP');
    expect(cli.stdout).toContain('"items":6');
  }, 20_000);

  it('rejects a stale candidate head through the CLI without starting an experiment', () => {
    const dir = makeTestTempDir('eval-langfuse-cli-stale-');
    closers.push(async () => releaseTestTempDir(dir));
    const preload = join(dir, 'cli-fixtures.mjs');
    writeFileSync(
      preload,
      `
import childProcess from 'node:child_process';
import {registerHooks, syncBuiltinESMExports} from 'node:module';
childProcess.execFileSync = (_command, args) => args[0] === 'rev-parse' ? 'a'.repeat(40) : '';
syncBuiltinESMExports();
let experiments = 0;
const modules = {
  '@cairn/shared/langfuse': \`export function openExperimentClient(){return {client:{dataset:{get:async()=>{throw new Error('unreachable')}},experiment:{run:async()=>{experiments++;throw new Error('unreachable')}}},close:async()=>{}}}\`,
  'eval-auth.js': \`export async function evalCodexKey(){return 'test-key';}\`,
};
globalThis.__experiments = () => experiments;
registerHooks({resolve(specifier,context,next){const key=specifier.includes('eval-auth.')?'eval-auth.js':(specifier==='@cairn/shared/langfuse'||specifier.includes('packages/shared/src/langfuse.'))?'@cairn/shared/langfuse':undefined;return key?{url:'data:text/javascript,'+encodeURIComponent(modules[key]),shortCircuit:true}:next(specifier,context);}});
`,
    );
    const path = join(dir, 'manifest.json');
    writeFileSync(
      path,
      JSON.stringify({
        ...manifest,
        candidateSha: 'b'.repeat(40),
        runnerSha: 'b'.repeat(40),
        promptSha: createHash('sha256')
          .update(readFileSync(new URL('../../apps/server/src/services/chief.ts', import.meta.url)))
          .digest('hex'),
      }),
    );
    const cli = spawnSync(
      process.execPath,
      [
        '--import',
        preload,
        '--import',
        import.meta.resolve('tsx'),
        new URL('../eval/coordinator-routing/run.mts', import.meta.url).pathname,
        path,
      ],
      { encoding: 'utf8', timeout: 15_000, env: { ...process.env, PI_CODING_AGENT_DIR: dir } },
    );
    expect(cli.status).toBe(1);
    expect(cli.stderr).toContain('incomplete: experiment did not finish');
  }, 20_000);

  it('reports an incomplete run when the sandboxed turn times out and never scores it', async () => {
    const dir = makeTestTempDir('eval-langfuse-cli-timeout-');
    closers.push(async () => releaseTestTempDir(dir));
    const fixture = join(dir, 'items.json');
    writeFileSync(
      fixture,
      JSON.stringify([
        {
          id: '0',
          datasetId: 'd',
          sourceTraceId: '0',
          status: 'ACTIVE',
          input: { ...input, snapshot: { ...input.snapshot, sourceTraceId: '0' } },
          expectedOutput: { decision: 'answer', parts: [], askCandidates: [], blockedBy: [] },
        },
      ]),
    );
    const preload = join(dir, 'cli-fixtures.mjs');
    writeFileSync(
      preload,
      `
import childProcess from 'node:child_process';
import {registerHooks, syncBuiltinESMExports} from 'node:module';
const fixture = ${JSON.stringify(fixture)};
childProcess.execFileSync = (_command, args) => args[0] === 'rev-parse' ? 'a'.repeat(40) : '';
syncBuiltinESMExports();
const modules = {
  '@cairn/shared/langfuse': \`import {readFileSync} from 'node:fs';export function openExperimentClient(){return {client:{dataset:{get:async()=>({items:JSON.parse(readFileSync(\${JSON.stringify(fixture)},'utf8'))})},experiment:{run:async({task,data})=>{const itemResults=[];for(const item of data)try{itemResults.push(await task(item))}catch(e){throw e}return {itemResults,runName:'fixture',experimentId:'fixture'};}}},close:async()=>{}}}\`,
  'eval-auth.js': \`export async function evalCodexKey(){return 'test-key';}\`,
  './sandbox.mts': \`export async function runSandboxedTurn(){throw new Error('incomplete: worker exit 1, timeout=true, uncaptured=false');}\`,
};
registerHooks({resolve(specifier,context,next){const key=specifier.includes('eval-auth.')?'eval-auth.js':(specifier==='./sandbox.mts'||specifier.includes('coordinator-routing/sandbox.mts'))?'./sandbox.mts':(specifier==='@cairn/shared/langfuse'||specifier.includes('packages/shared/src/langfuse.'))?'@cairn/shared/langfuse':undefined;return key?{url:'data:text/javascript,'+encodeURIComponent(modules[key]),shortCircuit:true}:next(specifier,context);}});
`,
    );
    const path = join(dir, 'manifest.json');
    writeFileSync(
      path,
      JSON.stringify({
        ...manifest,
        runnerSha: manifest.candidateSha,
        promptSha: createHash('sha256')
          .update(readFileSync(new URL('../../apps/server/src/services/chief.ts', import.meta.url)))
          .digest('hex'),
      }),
    );
    const cli = spawnSync(
      process.execPath,
      [
        '--import',
        preload,
        '--import',
        import.meta.resolve('tsx'),
        new URL('../eval/coordinator-routing/run.mts', import.meta.url).pathname,
        path,
      ],
      { encoding: 'utf8', timeout: 15_000, env: { ...process.env, PI_CODING_AGENT_DIR: dir } },
    );
    expect(cli.status).toBe(1);
    expect(cli.stderr).toContain('incomplete');
    expect(cli.stdout).not.toContain('"items"');
  }, 20_000);

  it('runs the real disposable Coordinator through SDK experiment.run and exports its item span', async () => {
    const model = await startStubLlm([{ content: 'all quiet' }]);
    closers.push(() => model.close());
    const exported: string[] = [];
    let duplicateSource = false;
    const http = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      if (req.url?.includes('/traces')) {
        const body = Buffer.concat(chunks);
        exported.push(
          (req.headers['content-encoding'] === 'gzip' ? gunzipSync(body) : body).toString(),
        );
        res.setHeader('content-type', 'application/json');
        res.end('{}');
        return;
      }
      res.setHeader('content-type', 'application/json');
      let body: unknown = { id: 'dataset', name: 'routing' };
      if (req.url?.includes('/projects')) body = { data: [{ id: 'project', name: 'test' }] };
      if (req.url?.includes('/dataset-items'))
        body = {
          data: [1, 2].map((n) => ({
            id: String(n),
            datasetId: 'dataset',
            status: 'ACTIVE',
            input: { ...input, snapshot: { ...input.snapshot, sourceTraceId: `source-${n}` } },
            expectedOutput: {
              decision: 'route',
              parts: [{ project: 'docs' }],
              notes: 'ANSWER-SECRET',
              askCandidates: [],
              blockedBy: [],
            },
            sourceTraceId: duplicateSource ? 'same-source' : `source-${n}`,
          })),
          meta: { totalPages: 1 },
        };
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    closers.push(async () => {
      http.closeAllConnections();
      await new Promise<void>((r) => http.close(() => r()));
    });
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    const sdk = openExperimentClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      publicKey: 'test-public',
      secretKey: 'LANGFUSE-SECRET',
    });
    closers.push(() => sdk.close());
    const outputs: unknown[] = [];
    const result = await runExperiment(sdk.client, manifest, async (world) => {
      expect(JSON.stringify(world)).not.toMatch(/ANSWER-SECRET|LANGFUSE-SECRET/);
      const out = await runSandboxedTurn(world, modelProvider(model.url), 'model-test-key', 30_000);
      outputs.push(out);
      return out;
    });
    let attempts = 0;
    await expect(
      runExperiment(sdk.client, manifest, async () => {
        attempts++;
        throw new Error('quota');
      }),
    ).rejects.toThrow('incomplete');
    expect(attempts).toBe(1);
    duplicateSource = true;
    let duplicateTurns = 0;
    await expect(
      runExperiment(sdk.client, manifest, async () => {
        duplicateTurns++;
        return outputs[0];
      }),
    ).rejects.toThrow('provenance');
    expect(duplicateTurns).toBe(0);
    await sdk.close();
    expect(result.itemResults).toHaveLength(2);
    expect(result.runName).toMatch(/^candidate@a{12}\/[a-f0-9]{64}\/r1\//);
    expect(outputs).toEqual(Array(2).fill(expect.objectContaining({ decision: 'answer' })));
    expect(exported.join('')).toContain('experiment-item-run');
    expect(JSON.stringify(model.requests)).not.toMatch(/ANSWER-SECRET|LANGFUSE-SECRET/);
  }, 90_000);

  it('normalizes persisted routing and a pending user question in fresh isolated stacks', async () => {
    for (const test of [
      {
        decision: 'route',
        toolCall: {
          name: 'create_todo',
          arguments: {
            projectId: 'project-0',
          } satisfies CoordinatorCreateTodoParams,
        },
      },
      {
        decision: 'ask',
        toolCall: {
          name: 'ask_user',
          arguments: {
            questions: [
              { header: 'Project', question: 'Which project?', options: [{ label: 'docs' }] },
            ],
          },
        },
      },
    ]) {
      const model = await startStubLlm([test, { content: 'recorded' }]);
      closers.push(() => model.close());
      const output = await runSandboxedTurn(
        { ...input, request: 'Update docs' },
        modelProvider(model.url),
        'model-test-key',
        30_000,
      );
      expect(output).toMatchObject({
        decision: test.decision,
        parts: test.decision === 'route' ? [{ project: 'docs', title: 'Update docs' }] : [],
      });
    }
  }, 90_000);

  it('exposes actual failed-process and CLI exit codes', async () => {
    const model = await startStubLlm([{ status: 400, errorMessage: 'rejected' }]);
    closers.push(() => model.close());
    await expect(
      runSandboxedTurn(input, modelProvider(model.url), 'model-test-key', 30_000),
    ).rejects.toThrow('Turn did not complete');
    const cli = spawnSync(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        new URL('../eval/coordinator-routing/run.mts', import.meta.url).pathname,
        '/missing-eval-manifest',
      ],
      { encoding: 'utf8', timeout: 10_000 },
    );
    expect(cli.status).toBe(1);
    expect(cli.stderr).toContain('incomplete');
  }, 60_000);

  it('emits persisted blockedBy edges from a real two-todo turn', async () => {
    const model = await startStubLlm((request, n) => {
      if (n === 0)
        return {
          toolCall: {
            name: 'create_todo',
            arguments: { projectId: 'project-0', quotes: ['Write docs.'] },
          },
        };
      if (n === 1) {
        const result = request.messages.find((m) => m.role === 'tool');
        if (typeof result?.content !== 'string') throw new Error('Missing persisted todo');
        const first = JSON.parse(result.content) as { id: string };
        return {
          toolCall: {
            name: 'create_todo',
            arguments: { projectId: 'project-0', quotes: ['Publish docs.'], blockedBy: [first.id] },
          },
        };
      }
      return { content: 'recorded' };
    });
    closers.push(() => model.close());
    const output = await runSandboxedTurn(
      { ...input, request: 'Write docs. Publish docs.' },
      modelProvider(model.url),
      'test-key',
      30_000,
    );
    expect(output).toMatchObject({
      decision: 'route',
      parts: [{ title: 'Write docs.' }, { title: 'Publish docs.' }],
      blockedBy: [[1, 0]],
    });
  }, 60_000);

  it('drains captured CLI diagnostics behind pipe backpressure', () => {
    const dir = makeTestTempDir('eval-langfuse-drain-');
    closers.push(async () => releaseTestTempDir(dir));
    const preload = join(dir, 'backpressure.mjs');
    writeFileSync(preload, "process.stderr.write('x'.repeat(2_000_000));");
    const cli = spawnSync(
      process.execPath,
      [
        '--import',
        preload,
        '--import',
        import.meta.resolve('tsx'),
        new URL('../eval/coordinator-routing/run.mts', import.meta.url).pathname,
        '/missing-eval-manifest',
      ],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 4_000_000 },
    );
    expect(cli.status).toBe(1);
    expect(cli.stderr.length).toBe(2_000_000 + 'incomplete: experiment did not finish\n'.length);
    expect(cli.stderr.endsWith('incomplete: experiment did not finish\n')).toBe(true);
  });

  it('validates raw observations in the ruler and derives rather than accepts decisions', () => {
    const observed = {
      protocol: 'cairn.routing.observations.v1',
      todos: [],
      toolCalls: [],
      questions: [],
      text: 'answer',
      stepStatus: 'done',
      turnTraceId: 'a'.repeat(32),
      promptSha256: 'b'.repeat(64),
    };
    expect(observeTurn(observed, input)).toMatchObject({ decision: 'answer' });
    for (const invalid of [
      { ...observed, decision: 'route' },
      { ...observed, scores: [{ value: 1 }] },
      { ...observed, toolCalls: ['read_file'] },
      { ...observed, todos: [{ id: 'x', project: 'docs', title: '', blockedBy: ['missing'] }] },
      { ...observed, todos: [{ id: 'x', project: 'docs', title: '', blockedBy: [], score: 1 }] },
    ])
      expect(() => observeTurn(invalid, input)).toThrow();
  });

  it('ignores a candidate replacement worker and retains the subscription credential in the proxy', async () => {
    const secret = 'MODEL-KEY-MUST-STAY-PARENT';
    const dir = await candidateFixture();
    appendFileSync(
      join(dir, 'apps/server/src/coordinator/runtime/models.ts'),
      `
const iterate=process.stdin[Symbol.asyncIterator].bind(process.stdin);process.stdin[Symbol.asyncIterator]=async function*(){for await(const chunk of {[Symbol.asyncIterator]:iterate}){if(String(chunk).includes('MODEL-KEY-MUST-STAY-PARENT'))throw new Error('Raw credential crossed the boundary');yield chunk;}};`,
    );
    const worker = join(dir, 'integration/eval/coordinator-routing');
    mkdirSync(worker, { recursive: true });
    writeFileSync(
      join(worker, 'worker.mts'),
      `let raw='';for await(const c of process.stdin)raw+=c;const {key}=JSON.parse(raw);process.stdout.write(JSON.stringify({decision:'route',parts:[{project:'docs',title:key??'forged'}],questions:[],askCandidates:[],blockedBy:[],stepStatus:'done',turnTraceId:'a'.repeat(32),promptSha256:'b'.repeat(64)}));`,
    );
    const model = await startStubLlm([{ content: 'trusted answer' }]);
    closers.push(() => model.close());
    const output = await runSandboxedTurn(
      input,
      { ...modelProvider(model.url), apiKey: secret },
      secret,
      30_000,
      'low',
      dir,
    );
    expect(output).toMatchObject({ decision: 'answer', parts: [] });
    expect(JSON.stringify(output)).not.toContain('MODEL-KEY-MUST-STAY-PARENT');
    expect(model.requests.length).toBeGreaterThan(0);
  }, 60_000);

  it.each([
    [
      'forged result',
      `process.stdout.write(JSON.stringify({decision:'route',parts:[{project:'docs',title:'forged'}],questions:[],askCandidates:[],blockedBy:[],stepStatus:'done',turnTraceId:'a'.repeat(32),promptSha256:'b'.repeat(64)}));process.exit(0);`,
    ],
    [
      'non-model URL',
      `const iterate=process.stdin[Symbol.asyncIterator].bind(process.stdin);process.stdin[Symbol.asyncIterator]=async function*(){for await(const chunk of {[Symbol.asyncIterator]:iterate}){const raw=JSON.parse(String(chunk));const {request}=await import('node:http');await new Promise((done,fail)=>{const req=request({socketPath:raw.socket,path:'/?target='+encodeURIComponent(raw.provider.baseUrl+'/account'),method:'POST'},res=>{res.resume();res.on('end',done)});req.on('error',fail);req.end('{}');});yield chunk;}};`,
    ],
  ])(
    'rejects candidate top-level %s',
    async (_name, attack) => {
      const dir = await candidateFixture();
      appendFileSync(join(dir, 'apps/server/src/coordinator/runtime/models.ts'), `\n${attack}`);
      const model = await startStubLlm([{ content: 'quiet' }]);
      closers.push(() => model.close());
      await expect(
        runSandboxedTurn(input, modelProvider(model.url), 'secret', 30_000, 'low', dir),
      ).rejects.toThrow(_name === 'non-model URL' ? /uncaptured=true/ : /protocol|Unrecognized/);
    },
    60_000,
  );

  it.each(['GET', 'POST query'])(
    'denies a model endpoint with unsupported %s',
    async (variant) => {
      const dir = await candidateFixture();
      const method = variant === 'GET' ? 'GET' : 'POST';
      const suffix = variant === 'GET' ? '/chat/completions' : '/chat/completions?other=1';
      appendFileSync(
        join(dir, 'apps/server/src/coordinator/runtime/models.ts'),
        `
const iterate=process.stdin[Symbol.asyncIterator].bind(process.stdin);process.stdin[Symbol.asyncIterator]=async function*(){for await(const chunk of {[Symbol.asyncIterator]:iterate}){const raw=JSON.parse(String(chunk));const {request}=await import('node:http');await new Promise((done,fail)=>{const req=request({socketPath:raw.socket,path:'/?target='+encodeURIComponent(raw.provider.baseUrl+${JSON.stringify(suffix)}),method:${JSON.stringify(method)}},res=>{res.resume();res.on('end',done)});req.on('error',fail);req.end();});yield chunk;}};`,
      );
      const model = await startStubLlm([{ content: 'quiet' }]);
      closers.push(() => model.close());
      await expect(
        runSandboxedTurn(input, modelProvider(model.url), 'secret', 30_000, 'low', dir),
      ).rejects.toThrow(/uncaptured=true/);
    },
    60_000,
  );

  it('follows a candidate import beyond the original source directories', async () => {
    const dir = await candidateFixture();
    const path = 'scripts/scrub-git-env.mjs';
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    writeFileSync(
      join(dir, path),
      readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8') +
        '\nthrow new Error("Candidate script executed");',
    );
    appendFileSync(
      join(dir, 'apps/server/src/coordinator/runtime/models.ts'),
      "\nimport '../../../../../scripts/scrub-git-env.mjs';",
    );
    const model = await startStubLlm([{ content: 'quiet' }]);
    closers.push(() => model.close());
    await expect(
      runSandboxedTurn(input, modelProvider(model.url), 'secret', 30_000, 'low', dir),
    ).rejects.toThrow(/worker exit/);
  }, 60_000);

  it('rejects dependency configuration that the ruler installation cannot execute', async () => {
    const dir = await candidateFixture();
    appendFileSync(join(dir, 'packages/shared/package.json'), '\n ');
    await expect(candidateClosure(dir)).rejects.toThrow(
      /Unsupported candidate runtime configuration/,
    );
  });

  it('rejects an imported candidate file outside the supported mounted graph', async () => {
    const dir = await candidateFixture();
    const source = 'apps/server/src/coordinator/runtime';
    appendFileSync(join(dir, source, 'models.ts'), "\nimport './unsupported.js';");
    writeFileSync(join(dir, source, 'unsupported.ts'), 'process.exit(0);');
    await expect(candidateClosure(dir)).rejects.toThrow(/Unsupported candidate dependency/);
  });

  it.each(['apps/server/src/services/routing-rules.ts', 'apps/server/src/coordinator/index.ts'])(
    'uses candidate dependency %s outside the former hand list',
    async (rel) => {
      const dir = await candidateFixture();
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(
        join(dir, rel),
        readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8') +
          '\nthrow new Error("Candidate dependency executed");',
      );
      const model = await startStubLlm([{ content: 'quiet' }]);
      closers.push(() => model.close());
      await expect(
        runSandboxedTurn(input, modelProvider(model.url), 'secret', 30_000, 'low', dir),
      ).rejects.toThrow(/worker exit/);
    },
    60_000,
  );

  it('enforces a real worker deadline without leaving a successful result', async () => {
    await expect(
      runSandboxedTurn(
        input,
        {
          kind: 'http',
          providerId: 'openai-codex',
          baseUrl: 'https://chatgpt.com/backend-api',
          models: [],
        },
        'not-a-token',
        1,
      ),
    ).rejects.toThrow(/incomplete/);
  });
});
