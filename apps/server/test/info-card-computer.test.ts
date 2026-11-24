import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type ClaudeCodeReport,
  type ComputerCall,
  infoTaskDir,
  type MachineCapabilities,
  machineEnrollResponseSchema,
  machineUploadUrlsResponseSchema,
} from '@cairn/shared';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import type { MachineApi } from '../../daemon/src/machine-client.js';
import { performRepoArchive } from '../../daemon/src/repo-archive.js';
import { startCoordinator } from '../src/coordinator/index.js';
import { attachment, build, machine, message, step, todo } from '../src/db/schema.js';
import { setCoordinatorInServer } from '../src/services/coordinator-context.js';
import { dropComputerWaiters, receiveComputerFrames } from '../src/services/machine-computer.js';
import { claimStep } from '../src/services/machines.js';
import { createProvider } from '../src/services/providers.js';
import { profileForStep } from '../src/services/routing-rules.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import {
  bootServer,
  insertClaudeSubscription,
  insertDevinSubscription,
  insertMachine,
  issueApiKey,
  req,
  seedRoute,
  type TestServer,
} from './helpers.js';

const REPORT = '# 调研报告\nINFO-CARD-COMPUTER-REPORT';
const VM_CAPABILITIES: MachineCapabilities = {
  mcpServers: [],
  skills: [],
  computer: true,
  browser: true,
  computerKind: 'vm',
};

const disposables: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const dispose of disposables.splice(0)) await dispose();
  dropComputerWaiters();
  setCoordinatorInServer(false);
});

async function infoCard(
  s: TestServer,
  projectBody: Record<string, unknown> = {},
): Promise<{ todoId: string; buildId: string }> {
  const project = await req(s.app, 'POST', '/api/projects', {
    name: 'info-computer',
    ...projectBody,
  });
  const projectId = ((await project.json()) as { id: string }).id;
  const created = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: '调研登录方案',
    spec: '调研并写报告。',
    output: 'info',
  });
  const todoId = ((await created.json()) as { id: string }).id;
  const started = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
  });
  expect(started.status).toBe(201);
  const buildId = ((await started.json()) as { builds: { id: string }[] }).builds[0]?.id ?? '';
  return { todoId, buildId };
}

function fakeComputer(
  s: TestServer,
  machineId: string,
): { calls: ComputerCall[]; files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  const calls: ComputerCall[] = [];
  const answer = (call: ComputerCall): { text: string; exitCode?: number; output?: string } => {
    const params = call.params as { command?: string; path?: string; content?: string };
    if (call.tool === 'write_file') {
      files.set(String(params.path), Buffer.from(String(params.content)));
      return { text: 'wrote' };
    }
    const command = params.command ?? '';
    const appended = /^mkdir -p '[^']+' && printf %s '([^']*)' \| base64 -d >> '([^']+)'$/.exec(
      command,
    );
    if (appended !== null) {
      const path = appended[2] ?? '';
      files.set(
        path,
        Buffer.concat([
          files.get(path) ?? Buffer.alloc(0),
          Buffer.from(appended[1] ?? '', 'base64'),
        ]),
      );
      return { text: 'exit code: 0' };
    }
    const listing = /^cd '([^']+\/deliverables)'/.exec(command);
    if (listing !== null) {
      const root = listing[1] ?? '';
      return {
        text: [...files.entries()]
          .filter(([path]) => path.startsWith(`${root}/`))
          .map(([path, bytes]) => `${path.slice(root.length + 1)}\t${bytes.length}\n`)
          .join(''),
      };
    }
    if (command === 'echo hello') return { output: 'hello\n', text: 'exit code: 0' };
    const size = /^test -f '([^']+)' && wc -c/.exec(command);
    if (size !== null) {
      const file = files.get(size[1] ?? '');
      return file === undefined ? { text: '', exitCode: 1 } : { text: String(file.length) };
    }
    const chunk = /^dd if='([^']+)' bs=(\d+) skip=(\d+)/.exec(command);
    if (chunk !== null) {
      const file = files.get(chunk[1] ?? '') ?? Buffer.alloc(0);
      const bs = Number(chunk[2]);
      const skip = Number(chunk[3]);
      return { text: file.subarray(skip * bs, (skip + 1) * bs).toString('base64') };
    }
    return { text: '' };
  };
  s.machineHub.subscribeMachine(s.team.id, machineId, (event) => {
    if (event.type !== 'computer') return;
    calls.push(event.call);
    const result = answer(event.call);
    queueMicrotask(() =>
      receiveComputerFrames(s.db, s.hub, machineId, event.call.callId, [
        ...(result.output === undefined
          ? []
          : [{ kind: 'output' as const, seq: 1, stream: 'stdout' as const, text: result.output }]),
        {
          kind: 'done',
          seq: result.output === undefined ? 1 : 2,
          text: result.text,
          ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
        },
      ]),
    );
  });
  return { calls, files };
}

interface LocalRepo {
  project: Record<string, unknown>;
  runnerId: string;
}

async function enrollLocalRunner(s: TestServer, repoDir: string): Promise<LocalRepo> {
  const enrolled = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await issueApiKey(s)}`,
    },
    body: JSON.stringify(readyMachine({ teamId: s.team.id, name: 'repo-runner' })),
  });
  const runner = machineEnrollResponseSchema.parse(await enrolled.json());
  const call = async (path: string, init: RequestInit) => {
    const res = await s.app.request(path, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${runner.token}` },
    });
    expect(res.status).toBe(200);
    return res;
  };
  const client = {
    uploadUrls: async (stepId: string, files: { name: string }[]) =>
      machineUploadUrlsResponseSchema.parse(
        await (
          await call(`/api/machine/upload-urls/${stepId}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ files }),
          })
        ).json(),
      ),
    putUpload: async (url: string, _headers: unknown, body: string, contentType: string) => {
      await call(url.replace(/^https?:\/\/[^/]+/, ''), {
        method: 'PUT',
        headers: { 'content-type': contentType },
        body,
      });
    },
  } as unknown as MachineApi;
  s.machineHub.subscribeMachine(s.team.id, runner.machineId, (event) => {
    if (event.type === 'repo.archive') {
      void performRepoArchive({ client, logger: { workspace: () => {} } as never }, event.archive);
    }
  });
  return { project: { kind: 'local', localPath: repoDir }, runnerId: runner.machineId };
}

async function runInfoCard(
  responses: (dir: string) => Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0],
  localRepoDir?: string,
): Promise<{
  s: TestServer;
  buildId: string;
  todoId: string;
  vm: { calls: ComputerCall[]; files: Map<string, Buffer> };
}> {
  setCoordinatorInServer(true);
  const s = bootServer();
  disposables.push(() => s.dispose());
  const machineId = insertMachine(s, { name: 'mac', capabilities: VM_CAPABILITIES });
  createProvider(
    { db: s.db, box: s.secretBox },
    {
      teamId: s.team.id,
      body: {
        providerId: 'stub',
        label: 'Stub',
        baseUrl: 'http://127.0.0.1:9',
        api: 'openai-completions',
        apiKey: 'sk-stub-secret-key-0123456789',
        models: [{ id: 'm', name: 'm' }],
      },
      createdBy: s.user.id,
    },
  );
  const localRepo =
    localRepoDir === undefined ? undefined : await enrollLocalRunner(s, localRepoDir);
  seedRoute(s, 'session', {
    provider: 'stub',
    modelId: 'm',
    ...(localRepo === undefined ? {} : { machineId: localRepo.runnerId }),
  });
  const vm = fakeComputer(s, machineId);
  const { todoId, buildId } = await infoCard(s, localRepo?.project);
  const dir = infoTaskDir(buildId);

  const faux = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: 200_000 }],
    tokensPerSecond: 1e9,
  });
  faux.setResponses(responses(dir));
  const storageDir = makeTestTempDir('info-card-runner-');
  disposables.push(() => {
    releaseTestTempDir(storageDir);
  });
  const coordinator = startCoordinator({
    machine: {
      db: s.db,
      hub: s.hub,
      machineHub: s.machineHub,
      box: s.secretBox,
      user: s.user,
      vapidKeys: s.vapidKeys,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir: s.skillsDir,
      convHub: s.convHub,
    },
    storageDir,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    heartbeatMs: 1_000,
    tickMs: 3_600_000,
    stopPollMs: 50,
    fixedProviders: [faux.provider],
  });
  disposables.push(async () => {
    await coordinator.close();
  });

  coordinator.tick();
  await coordinator.idle();

  return { s, buildId, todoId, vm };
}

describe('info cards run in the agent computer', () => {
  test('an info card in a local-repo project gets a snapshot of the repo from its Runner in the task dir', async () => {
    const repo = makeTestTempDir('info-local-repo-');
    disposables.push(() => {
      releaseTestTempDir(repo);
    });
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo });
    git('init', '-q');
    writeFileSync(join(repo, 'README.md'), 'LOCAL-REPO-SNAPSHOT-MARKER\n');
    git('add', 'README.md');
    git('commit', '-q', '-m', 'init');

    const { s, buildId, vm } = await runInfoCard(
      (dir) => [
        () =>
          fauxAssistantMessage([fauxToolCall('shell', { command: 'echo hello' })], {
            stopReason: 'toolUse',
          }),
        () =>
          fauxAssistantMessage(
            [fauxToolCall('write_file', { path: `${dir}/report.md`, content: REPORT })],
            { stopReason: 'toolUse' },
          ),
        () =>
          fauxAssistantMessage([fauxToolCall('submit_report', { path: `${dir}/report.md` })], {
            stopReason: 'toolUse',
          }),
        () => fauxAssistantMessage('报告已提交。'),
      ],
      repo,
    );

    const dir = infoTaskDir(buildId);
    const archive = Buffer.from(
      vm.files.get(`${dir}/.repo-0.b64`)?.toString('utf8') ?? '',
      'base64',
    );
    expect(archive.length).toBeGreaterThan(0);
    const unpacked = makeTestTempDir('info-local-unpacked-');
    disposables.push(() => {
      releaseTestTempDir(unpacked);
    });
    execFileSync('tar', ['xz', '-C', unpacked], { input: archive });
    expect(readFileSync(join(unpacked, 'README.md'), 'utf8')).toBe('LOCAL-REPO-SNAPSHOT-MARKER\n');
    expect(vm.files.has(`${dir}/repo-snapshot-failed.txt`)).toBe(false);
    const unpack = vm.calls.find((call) => JSON.stringify(call.params).includes('tar xz'));
    expect(JSON.stringify(unpack?.params)).not.toContain('--strip-components');
    expect(s.db.select().from(step).where(eq(step.buildId, buildId)).get()?.status).toBe('done');
  });

  test('a provider route writes its report through submit_report from the computer', async () => {
    let shellResult = '';
    const { s, buildId, todoId, vm } = await runInfoCard((dir) => [
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall('shell', { command: 'echo hello' }),
            fauxToolCall('write_file', { path: `${dir}/report.md`, content: REPORT }),
            fauxToolCall('write_file', {
              path: `${dir}/deliverables/pages/summary.html`,
              content: '<p>summary</p>',
            }),
          ],
          { stopReason: 'toolUse' },
        ),
      (context) => {
        shellResult = JSON.stringify(context.messages.filter((m) => m.role === 'toolResult'));
        return fauxAssistantMessage([fauxToolCall('submit_report', { path: `${dir}/report.md` })], {
          stopReason: 'toolUse',
        });
      },
      () => fauxAssistantMessage('报告已提交。'),
    ]);

    const row = s.db.select().from(step).where(eq(step.buildId, buildId)).get();
    expect(row?.status).toBe('done');
    expect(row?.machineId).toBeNull();
    expect(s.db.select().from(todo).where(eq(todo.id, todoId)).get()?.phase).toBe('review');
    const reportId = s.db
      .select()
      .from(build)
      .where(eq(build.id, buildId))
      .get()?.reportAttachmentId;
    const stored = s.db
      .select()
      .from(attachment)
      .where(eq(attachment.id, reportId ?? ''))
      .get();
    expect(readFileSync(join(s.attachmentsDir, stored?.storageKey ?? ''), 'utf8')).toBe(REPORT);
    const deliverables = s.db
      .select()
      .from(message)
      .where(eq(message.id, `deliverables-${buildId}`))
      .get();
    expect(JSON.stringify(deliverables?.content)).toContain('summary.html');
    expect(vm.calls.map((call) => call.tool)).toContain('write_file');
    expect(shellResult).toContain('hello');
    expect(vm.calls.every((call) => call.scopeKey?.startsWith('chief:') === true)).toBe(true);
  });

  test('a length-truncated tool call comes back to the model and the run still submits the report', async () => {
    let retryContext = '';
    const { s, buildId } = await runInfoCard((dir) => [
      () =>
        fauxAssistantMessage(
          [{ type: 'text', text: 'Writing the report now.' }, fauxToolCall('write_file', {})],
          { stopReason: 'length' },
        ),
      (context) => {
        retryContext = JSON.stringify(context.messages);
        return fauxAssistantMessage(
          [fauxToolCall('write_file', { path: `${dir}/report.md`, content: '# Part one\n' })],
          { stopReason: 'toolUse' },
        );
      },
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall('write_file', {
              path: `${dir}/report.md`,
              content: 'Part two\n',
              append: true,
            }),
          ],
          { stopReason: 'toolUse' },
        ),
      () =>
        fauxAssistantMessage([fauxToolCall('submit_report', { path: `${dir}/report.md` })], {
          stopReason: 'toolUse',
        }),
      () => fauxAssistantMessage('Report submitted.'),
    ]);

    expect(retryContext).toContain('cut off at the length limit');
    expect(retryContext).not.toContain('"type":"toolCall"');
    expect(s.db.select().from(step).where(eq(step.buildId, buildId)).get()?.status).toBe('done');
    const reportId = s.db
      .select()
      .from(build)
      .where(eq(build.id, buildId))
      .get()?.reportAttachmentId;
    const stored = s.db
      .select()
      .from(attachment)
      .where(eq(attachment.id, reportId ?? ''))
      .get();
    expect(readFileSync(join(s.attachmentsDir, stored?.storageKey ?? ''), 'utf8')).toBe(
      '# Part one\nPart two\n',
    );
  });

  test('a run that ends without submit_report is nudged before the card fails', async () => {
    let nudged = '';
    const { s, buildId } = await runInfoCard((dir) => [
      () => fauxAssistantMessage('I have everything I need.'),
      (context) => {
        nudged = JSON.stringify(context.messages);
        return fauxAssistantMessage(
          [fauxToolCall('write_file', { path: `${dir}/report.md`, content: '# Late report\n' })],
          { stopReason: 'toolUse' },
        );
      },
      () =>
        fauxAssistantMessage([fauxToolCall('submit_report', { path: `${dir}/report.md` })], {
          stopReason: 'toolUse',
        }),
      () => fauxAssistantMessage('Report submitted.'),
    ]);

    expect(nudged).toContain('without a successful submit_report call');
    expect(s.db.select().from(step).where(eq(step.buildId, buildId)).get()?.status).toBe('done');
  });

  test('a claude-code route is claimed by the Runner with only relay tools, locked down', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    insertClaudeSubscription(s);
    const report = {
      installed: true,
      hostname: 'mac',
      models: [{ id: 'sonnet', name: 'sonnet' }],
      auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
    } as ClaudeCodeReport;
    const computerHost = insertMachine(s, { name: 'vm-host', capabilities: VM_CAPABILITIES });
    const runner = insertMachine(s, { name: 'runner', claudeCodeReport: report });
    seedRoute(s, 'session', { provider: 'claude-code', modelId: 'sonnet', machineId: runner });
    await infoCard(s);

    const claimed = await claimStep(
      {
        ...s.svc,
        box: s.secretBox,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: s.skillsDir,
      },
      runner,
      s.team.id,
      10,
      'http://localhost',
    );
    expect(computerHost).not.toBe(runner);
    expect(claimed?.agent).toMatchObject({ provider: 'claude-code' });
    expect(claimed?.remoteToolsOnly).toBe(true);
    expect(claimed?.mcpServers).toEqual([]);
    expect(claimed?.project?.repo ?? null).toBeNull();
    const names = claimed?.remoteTools?.map((tool) => tool.name) ?? [];
    expect(names).toEqual(
      expect.arrayContaining(['shell', 'write_file', 'browser_navigate', 'submit_report']),
    );
    expect(names).not.toContain('computer_observe');
  });

  test('a devin route is claimed by the Runner with the relay tools offered and its own tools left on', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    insertDevinSubscription(s);
    const runner = insertMachine(s, {
      name: 'runner',
      capabilities: { mcpServers: [], skills: [], devin: { installed: true, version: '0.1.0' } },
    });
    insertMachine(s, { name: 'vm-host', capabilities: VM_CAPABILITIES });
    seedRoute(s, 'session', {
      provider: 'devin',
      modelId: 'swe-2-high',
      thinkingLevel: 'off',
      machineId: runner,
    });
    await infoCard(s);

    const claimed = await claimStep(
      {
        ...s.svc,
        box: s.secretBox,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: s.skillsDir,
      },
      runner,
      s.team.id,
      10,
      'http://localhost',
    );
    expect(claimed?.agent).toMatchObject({ provider: 'devin' });
    expect(claimed?.remoteToolsOnly).toBeUndefined();
    expect(claimed?.mcpServers).toEqual([]);
    expect(claimed?.project?.repo ?? null).toBeNull();
    const names = claimed?.remoteTools?.map((tool) => tool.name) ?? [];
    expect(names).toEqual(
      expect.arrayContaining(['shell', 'write_file', 'browser_navigate', 'submit_report']),
    );
    expect(claimed?.agent?.description).toContain('自带工具');
  });

  test('a devin route waits with devin-subscription when subscription is absent', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const runner = insertMachine(s, {
      name: 'runner',
      capabilities: { mcpServers: [], skills: [], devin: { installed: true, version: '0.1.0' } },
    });
    insertMachine(s, { name: 'vm-host', capabilities: VM_CAPABILITIES });
    seedRoute(s, 'session', { provider: 'devin', modelId: 'swe-2-high', machineId: runner });
    const { todoId, buildId } = await infoCard(s);

    const claimed = await claimStep(
      {
        ...s.svc,
        box: s.secretBox,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: s.skillsDir,
      },
      runner,
      s.team.id,
      10,
      'http://localhost',
    );
    expect(claimed).toBeNull();
    const pending = s.db.select().from(step).where(eq(step.buildId, buildId)).get();
    const todoRow = s.db.select().from(todo).where(eq(todo.id, todoId)).get();
    const queue = stepQueueProjector(s.db, s.team.id).project({
      id: pending?.id ?? '',
      createdAt: pending?.createdAt ?? 0,
      homeMachineId:
        todoRow === undefined || pending === undefined
          ? null
          : (profileForStep(s.db, todoRow, pending.kind, pending.id)?.machineId ?? null),
    });
    expect(queue?.blocked).toEqual({ kind: 'devin-subscription', missing: [] });
    expect(pending?.status).toBe('pending');
  });

  test('with no online machine the card waits with no-computer, and an online non-VM machine unblocks it', async () => {
    setCoordinatorInServer(true);
    const s = bootServer();
    disposables.push(() => s.dispose());
    const machineId = insertMachine(s, { name: 'windows-box' });
    s.db.update(machine).set({ online: false }).where(eq(machine.id, machineId)).run();
    createProvider(
      { db: s.db, box: s.secretBox },
      {
        teamId: s.team.id,
        body: {
          providerId: 'stub',
          label: 'Stub',
          baseUrl: 'http://127.0.0.1:9',
          api: 'openai-completions',
          apiKey: 'sk-stub-secret-key-0123456789',
          models: [{ id: 'm', name: 'm' }],
        },
        createdBy: s.user.id,
      },
    );
    seedRoute(s, 'session', { provider: 'stub', modelId: 'm' });
    const { todoId, buildId } = await infoCard(s);

    const pending = s.db.select().from(step).where(eq(step.buildId, buildId)).get();
    const todoRow = s.db.select().from(todo).where(eq(todo.id, todoId)).get();
    const projectQueue = () =>
      stepQueueProjector(s.db, s.team.id).project({
        id: pending?.id ?? '',
        createdAt: pending?.createdAt ?? 0,
        homeMachineId:
          todoRow === undefined || pending === undefined
            ? null
            : (profileForStep(s.db, todoRow, pending.kind, pending.id)?.machineId ?? null),
      });
    expect(projectQueue()?.blocked?.kind).toBe('no-computer');
    expect(s.db.select().from(step).where(eq(step.buildId, buildId)).get()?.status).toBe('pending');

    s.db.update(machine).set({ online: true }).where(eq(machine.id, machineId)).run();
    expect(projectQueue()?.blocked).toBeUndefined();
  });
});
