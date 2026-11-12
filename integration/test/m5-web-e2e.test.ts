import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MERGE_ANNOUNCEMENT, type TranscriptRow } from '@cairn/shared';
import { type Browser, chromium, type Page, expect as pexpect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import { step as stepTable } from '../../apps/server/src/db/schema.js';
import { readFile } from '../../apps/server/src/services/git.js';
import { dueSchedules } from '../../apps/server/src/services/schedules.js';
import { makeTestTempDir } from '../../scripts/test-tmpdir.mjs';
import {
  api,
  bootRealServer,
  CONFINEMENT_READY_LAUNCH,
  type RealServer,
  waitFor,
} from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const WEB_DIST = join(ROOT, 'apps/web/dist');

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let browser: Browser;
let page: Page;
let probeTodoId = '';
let probeConvId = '';

beforeAll(async () => {
  const build = spawnSync('pnpm', ['--filter', '@cairn/web', 'exec', 'vite', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (build.status !== 0) {
    throw new Error(`web build failed:\n${build.stdout}\n${build.stderr}`);
  }
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    throw new Error(`web dist missing at ${WEB_DIST} (static hosting would 404)`);
  }
  stub = await startStubLlm([
    {
      toolCall: { name: 'bash', arguments: { command: 'printf "m5 spine probe\\n" >> README.md' } },
    },
    { content: '修改已完成并验证通过：README.md 末行为 m5 spine probe。' },
    { content: '合并已确认：分支改动已并入默认分支。' },
    {
      toolCall: {
        name: 'bash',
        arguments: { command: 'printf "m5 reject first\\n" >> README.md' },
      },
    },
    { content: '驳回探针首轮修改已完成。', delayMs: 500 },
    {
      toolCall: {
        name: 'bash',
        arguments: { command: 'printf "m5 reject probe\\n" >> README.md' },
      },
    },
    { content: '驳回轮修改已完成。' },
    {
      toolCall: {
        name: 'bash',
        arguments: { command: 'printf "m5 schedule probe\\n" >> README.md' },
      },
    },
    { content: '定时轮修改已完成，等待审核。' },
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试执行 Agent：按任务要求用 bash 工具完成文件改动，然后简短汇报。',
    webDir: WEB_DIST,
    scheduler: true,
  });
  home = makeTestTempDir('cairn-m5web-home-');
  const config = loadDaemonConfig(
    { serverUrl: server.url, apiKey: server.apiKey, teamId: server.teamId, home, name: 'm5-web' },
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

    confinementPreflight: CONFINEMENT_READY_LAUNCH,
  });
  await waitFor(() => {
    try {
      return readFileSync(paths.daemonLog, 'utf8').includes('[wake] push channel connected');
    } catch {
      return false;
    }
  }, 30_000);
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 732 }, locale: 'zh-CN' });
}, 300_000);

afterAll(async () => {
  await browser?.close();
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  if (home) rmSync(home, { recursive: true, force: true });
});

function collectConvStream(buildId: string): { types: Set<string>; stop(): void } {
  const types = new Set<string>();
  const ctrl = new AbortController();
  void (async () => {
    const res = await fetch(`${server.url}/api/conversations/${buildId}/stream`, {
      signal: ctrl.signal,
    });
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf('\n\n');
      while (idx >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            types.add((JSON.parse(line.slice(5).trim()) as { type: string }).type);
          } catch {}
        }
        idx = buf.indexOf('\n\n');
      }
    }
  })().catch(() => {});
  return { types, stop: () => ctrl.abort() };
}

async function openProjectTasks(projectId: string): Promise<void> {
  await page.goto(`${server.url}/app/project/${projectId}/tasks`);
  await pexpect(
    page.getByRole('complementary').getByRole('button', { name: 'Coordinator' }),
  ).toBeVisible({ timeout: 30_000 });
}

async function createAndStart(title: string): Promise<void> {
  const projects = (await api(server.url, 'GET', '/api/projects')).body as { id: string }[];
  const projectId =
    projects[0]?.id ??
    (
      (await api(server.url, 'POST', '/api/projects', { name: '默认项目', repoKind: 'hosted' }))
        .body as {
        id: string;
      }
    ).id;
  await api(server.url, 'POST', `/api/projects/${projectId}/todos`, { title: '', spec: title });
  await openProjectTasks(projectId);
  await pexpect(page.getByRole('link', { name: title })).toBeVisible({
    timeout: 30_000,
  });
  const todos = (await api(server.url, 'GET', '/api/todos')).body as {
    id: string;
    title: string;
    projectId: string;
  }[];
  const created = todos.find((t) => t.title === title);
  if (!created) throw new Error(`createAndStart: todo not persisted (${title})`);
  const policy = await api(server.url, 'PATCH', `/api/projects/${created.projectId}/merge-policy`, {
    mergePolicy: 'human',
  });
  if (policy.status !== 200) {
    throw new Error(`createAndStart merge-policy: ${policy.status}`);
  }
  const started = await api(server.url, 'POST', `/api/projects/${created.projectId}/builds`, {
    todoIds: [created.id],
  });
  if (started.status !== 201) throw new Error(`createAndStart: startBuilds ${started.status}`);
}

async function openDetail(title: string): Promise<void> {
  await page.getByRole('link', { name: title }).click();
  await pexpect(page.getByTestId('side-chat')).toBeVisible({ timeout: 15_000 });
}

async function dumpSpineDiagnostics(label: string): Promise<void> {
  const out: string[] = [];
  try {
    const chip = await page.getByTestId('side-chat').getAttribute('data-phase', { timeout: 3_000 });
    out.push(`UI chip = ${JSON.stringify(chip)}`);
  } catch (err) {
    out.push(`UI chip unreadable: ${String(err).slice(0, 120)}`);
  }
  try {
    out.push(
      `server phase = ${probeTodoId ? server.todoPhase(probeTodoId) : '<todo id not recorded>'}`,
    );
  } catch (err) {
    out.push(`server phase unreadable: ${String(err).slice(0, 120)}`);
  }
  try {
    const reqs = stub?.requests ?? [];
    out.push(
      `stub received ${reqs.length} request(s); last = ${JSON.stringify(reqs[reqs.length - 1] ?? null).slice(0, 240)}`,
    );
  } catch (err) {
    out.push(`stub counter unreadable: ${String(err).slice(0, 120)}`);
  }
  try {
    if (probeConvId !== '') {
      const steps = server.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, probeConvId))
        .all();
      out.push(
        `DB steps rows: ${steps.length}: ${steps
          .map((s) => `${s.kind}/${s.status}@${s.createdAt}`)
          .join(' | ')}`,
      );
    }
  } catch (err) {
    out.push(`DB truth unreadable: ${String(err).slice(0, 120)}`);
  }
  try {
    const times = stub?.requestTimes ?? [];
    if (times.length > 0) {
      const t0 = times[0]!;
      out.push(`stub request times (ms since first): ${times.map((t) => t - t0).join(', ')}`);
    }
  } catch (err) {
    out.push(`stub timeline unreadable: ${String(err).slice(0, 120)}`);
  }
  try {
    const all = readFileSync(paths.daemonLog, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');
    const real = all.filter((l) => !l.includes('[skills] filtered:'));
    const wake = all.filter((l) => l.includes('[wake]')).length;
    out.push(
      `daemon log ${all.length} lines ([skills] filtered omitted: ${all.length - real.length}); [wake] count: ${wake}`,
    );
    out.push(`daemon log tail (15 lines):\n${real.slice(-15).join('\n')}`);
  } catch (err) {
    out.push(`daemon log unreadable: ${String(err).slice(0, 120)}`);
  }
  console.error(
    `\n===== spine timeout diagnostics: ${label} =====\n${out.join('\n')}\n===== end diagnostics =====\n`,
  );
}

async function withDiagnostics<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    await dumpSpineDiagnostics(label);
    throw err;
  }
}

async function waitChip(phase: string, timeoutMs = 150_000): Promise<void> {
  await withDiagnostics(`waitChip(${phase})`, () =>
    pexpect(page.getByTestId('side-chat')).toHaveAttribute('data-phase', phase, {
      timeout: timeoutMs,
    }),
  );
}

describe('M5 web E2E: main sequence full chain (01 §7.4 spine, zero UI reload)', () => {
  let buildId = '';
  let stream: { types: Set<string>; stop(): void };

  test('create → session → review → merge → done (main-sequence spine)', async () => {
    await createAndStart('M5 脊柱探针');

    const todos = (await api(server.url, 'GET', '/api/todos')).body as {
      id: string;
      title: string;
      latestBuildId: string | null;
    }[];
    const spine = todos.find((t) => t.title === 'M5 脊柱探针');
    expect(spine).toBeTruthy();
    probeTodoId = spine!.id;
    buildId = spine!.latestBuildId!;
    probeConvId = buildId;
    expect(buildId).toBeTruthy();

    stream = collectConvStream(buildId);

    await openDetail('M5 脊柱探针');
    await waitChip('review');

    expect(
      stream.types.has('text_delta'),
      `conv stream types: ${[...stream.types].join(',')}`,
    ).toBe(true);
    expect(stream.types.has('message')).toBe(true);
    expect(stream.types.has('step')).toBe(true);
    stream.stop();

    await page.getByTestId('side-chat').getByRole('button', { name: '更多操作…' }).click();
    await page.getByRole('menuitem', { name: '完成' }).click();
    const accept = page.getByRole('dialog', { name: '完成任务' });
    await pexpect(accept.getByRole('button', { name: '完成' })).toBeVisible();
    await accept.getByRole('button', { name: '完成' }).click();
    await waitChip('done');

    const transcript = (await api(server.url, 'GET', `/api/conversations/${buildId}/messages`))
      .body as { messages: TranscriptRow[] };
    expect(transcript.messages.some((row) => row.content === MERGE_ANNOUNCEMENT)).toBe(true);
    await pexpect(page.locator('.chat-note', { hasText: '发起了合并' })).toBeVisible();
    await pexpect(page.locator('.chat-note').filter({ hasText: /^已完成$/ })).toBeVisible({
      timeout: 30_000,
    });

    const projects = (await api(server.url, 'GET', '/api/projects')).body as {
      id: string;
      name: string;
    }[];
    const projectId = projects[0]!.id;
    await waitFor(async () => {
      const file = await readFile(server, projectId, 'README.md', 'main').catch(() => null);
      return file?.content.includes('m5 spine probe') ?? false;
    }, 30_000);
    expect(server.todoPhase(spine!.id)).toBe('done');
  }, 300_000);

  test('reject branch: feedback at the review gate → rework session → back to review', async () => {
    await createAndStart('M5 驳回探针');
    const todos = (await api(server.url, 'GET', '/api/todos')).body as {
      id: string;
      title: string;
      latestBuildId: string | null;
    }[];
    const target = todos.find((t) => t.title === 'M5 驳回探针');
    probeTodoId = target!.id;
    const rejectBuildId = target!.latestBuildId!;
    probeConvId = rejectBuildId;

    await openDetail('M5 驳回探针');
    await waitChip('review');

    await withDiagnostics('review feedback requests a rework session', async () => {
      await page
        .locator('.side-panel .composer-input')
        .fill('Drop the project suffix from the title');
      const [revision] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().endsWith(`/api/todos/${target!.id}/messages`) &&
            response.request().method() === 'POST',
          { timeout: 10_000 },
        ),
        page.locator('.side-panel .composer-send').click(),
      ]);
      expect(revision.ok()).toBe(true);
      expect(revision.request().postDataJSON()).toMatchObject({
        content: 'Drop the project suffix from the title',
      });
      expect(await revision.json()).toMatchObject({ delivered: 'revision' });
    });
    await withDiagnostics('accepted feedback appears in the transcript', () =>
      pexpect(
        page.locator('.chat-bubble', { hasText: 'Drop the project suffix from the title' }),
      ).toBeVisible({ timeout: 30_000 }),
    );
    await withDiagnostics('rework session returns the card to review', () =>
      waitFor(
        () =>
          server.db
            .select()
            .from(stepTable)
            .where(eq(stepTable.buildId, rejectBuildId))
            .all()
            .filter((s) => s.kind === 'session' && s.status === 'done').length === 2 &&
          server.todoPhase(target!.id) === 'review',
        150_000,
      ),
    );
    const rejectSteps = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, rejectBuildId))
      .all();
    expect(rejectSteps.filter((s) => s.kind === 'session')).toHaveLength(2);
    expect(rejectSteps.filter((s) => s.kind === 'plan')).toHaveLength(0);
    await waitChip('review');
  }, 300_000);

  test('scheduled run parks at review: create once schedule in UI → tick trigger → continues the latest build → parks at review + started-by-schedule marker (r3 §9)', async () => {
    await page.goto(`${server.url}/app/schedules`);
    await page.getByRole('button', { name: '新建定时', exact: true }).click();
    await pexpect(page.getByRole('dialog', { name: '新建定时' })).toBeVisible();
    await page.getByRole('radio', { name: '单次' }).click();
    const next = new Date(Date.now() + 60_000);
    let minute = Math.ceil(next.getMinutes() / 15) * 15;
    let hour = next.getHours();
    if (minute === 60) {
      minute = 0;
      hour = (hour + 1) % 24;
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    const pickSelect = async (slot: string, value: string) => {
      await page.locator(`button[aria-label="${slot}"]`).click();
      await page.getByRole('listbox').getByRole('option', { name: value, exact: true }).click();
    };
    await pickSelect('时', pad(hour));
    await pickSelect('分', pad(minute));
    await page.getByRole('button', { name: '保存' }).click();
    await pexpect(page.getByText('下次')).toBeVisible({ timeout: 15_000 });
    const schedules = (await api(server.url, 'GET', '/api/schedules')).body as {
      id: string;
      kind: string;
      nextRunAt: number | null;
    }[];
    expect(schedules).toHaveLength(1);
    expect(schedules[0]!.kind).toBe('once');

    const todosBefore = (await api(server.url, 'GET', '/api/todos')).body as {
      id: string;
      title: string;
      latestBuildId: string | null;
    }[];
    const spineBefore = todosBefore.find((t) => t.title === 'M5 脊柱探针');

    const triggeredAt = (schedules[0]!.nextRunAt ?? Date.now()) + 60_000;
    await server.scheduler!.tick(triggeredAt);

    const spine = spineBefore;
    await withDiagnostics('scheduled run phase advances to review', () =>
      waitFor(() => server.todoPhase(spine!.id) === 'review', 150_000),
    );
    const after = (await api(server.url, 'GET', `/api/todos/${spine!.id}`)).body as {
      latestBuildId: string | null;
    };
    expect(after.latestBuildId).toBe(spineBefore!.latestBuildId);
    const scheduledSteps = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, after.latestBuildId!))
      .all()
      .filter((s) => s.scheduleId === schedules[0]!.id);
    expect(scheduledSteps.map((s) => s.kind)).toEqual(['session']);
    expect((await api(server.url, 'GET', '/api/schedules')).body).toEqual([
      expect.objectContaining({
        id: schedules[0]!.id,
        kind: 'once',
        lastRunStatus: 'completed',
        nextRunAt: null,
      }),
    ]);
    const later = triggeredAt + 86_400_000;
    expect(dueSchedules(server.svc, later)).toEqual([]);
    await server.scheduler!.tick(later);
    expect(
      server.db.select().from(stepTable).where(eq(stepTable.scheduleId, schedules[0]!.id)).all(),
    ).toEqual(scheduledSteps);

    const spineProject = (await api(server.url, 'GET', `/api/todos/${spine!.id}`)).body as {
      projectId: string;
    };
    await openProjectTasks(spineProject.projectId);
    await openDetail('M5 脊柱探针');
    await pexpect(page.locator('.chat-scheduled')).toBeVisible({ timeout: 15_000 });
    await waitChip('review');
  }, 300_000);
});
