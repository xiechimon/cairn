import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
} from '@earendil-works/pi-ai';
import { and, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  chiefMessage,
  chiefThread,
  memoryConsolidation,
  project,
  step,
} from '../../src/db/schema.js';
import {
  ensureMemoryIndex,
  listMemoryEntries,
  memoryDocumentVersion,
} from '../../src/services/memory.js';
import { executeMemoryDocumentTool } from '../../src/services/memory-documents.js';
import { coordinatorMemoryOwner } from '../../src/services/routing-rules.js';
import { req } from '../helpers.js';
import { boot, type World, world } from './runner-world.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CONSOLIDATION_CALL = "one scope's long-term memory";

function owner(w: World): string {
  const agentId = coordinatorMemoryOwner(w.s.db, w.teamId);
  if (agentId === undefined) throw new Error('no memory owner');
  return agentId;
}

function indexText(w: World, projectId: string | null = null): string {
  const row = listMemoryEntries(w.s.db, { teamId: w.teamId, agentId: owner(w) }).find(
    (entry) => entry.layer === 'core' && entry.projectId === projectId,
  );
  return row?.content ?? '';
}

function seedIndex(w: World, content: string, projectId: string | null = null): void {
  const agentId = owner(w);
  const row = ensureMemoryIndex(w.s.db, { agentId, teamId: w.teamId, projectId });
  executeMemoryDocumentTool(
    w.s.db,
    { agentId, teamId: w.teamId, projectId, source: 'test' },
    'update_memory',
    {
      scope: projectId ?? 'team',
      file: 'MEMORY.md',
      baseVersion: memoryDocumentVersion(row),
      content,
    },
  );
}

function seedFile(
  w: World,
  title: string,
  content: string,
  projectId: string | null = null,
  source = 'test',
): string {
  const agentId = owner(w);
  const saved = executeMemoryDocumentTool(
    w.s.db,
    { agentId, teamId: w.teamId, projectId, source },
    'save_memory',
    { scope: projectId ?? 'team', file: title, content },
  ) as { id: string };
  return saved.id;
}

function quiet(w: World, ageMs = 31 * MINUTE): void {
  w.s.db
    .update(chiefMessage)
    .set({ createdAt: Date.now() - ageMs })
    .where(eq(chiefMessage.threadId, w.threadId))
    .run();
  w.s.db.update(step).set({ status: 'done' }).where(eq(step.id, w.stepId)).run();
}

function providerFor(handler: (prompt: string) => string | Promise<string>) {
  const base = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: 200_000 }],
    tokensPerSecond: 1e9,
  });
  base.setResponses([fauxAssistantMessage('noted')]);
  const calls: string[] = [];
  const provider: typeof base.provider = {
    ...base.provider,
    streamSimple(model, context, options) {
      const last = String(context.messages.at(-1)?.content ?? '');
      if (!last.includes(CONSOLIDATION_CALL))
        return base.provider.streamSimple(model, context, options);
      calls.push(last);
      const answer = handler(last);
      const stream = createAssistantMessageEventStream();
      const done = (text: string) => {
        const message = {
          ...fauxAssistantMessage(text),
          api: model.api,
          provider: model.provider,
          model: model.id,
        };
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end(message);
      };
      if (typeof answer === 'string') done(answer);
      else void answer.then(done);
      return stream;
    },
  };
  return { provider, calls: () => calls };
}

const answer = (edits: unknown[], dropFiles: unknown[] = []) =>
  JSON.stringify({ edits, dropFiles });

function records(w: World, projectId: string | null = null) {
  return w.s.db
    .select()
    .from(memoryConsolidation)
    .where(
      and(
        eq(memoryConsolidation.teamId, w.teamId),
        projectId === null
          ? sql`${memoryConsolidation.projectId} is null`
          : eq(memoryConsolidation.projectId, projectId),
      ),
    )
    .all();
}

async function runOnce(w: World, provider: ReturnType<typeof providerFor>) {
  const coordinator = boot(w, provider, {
    memoryConsolidationIdleMs: 30 * MINUTE,
    memoryConsolidationIntervalMs: 6 * HOUR,
    memoryConsolidationTimeoutMs: 5_000,
    memoryConsolidationRetryMs: 1_000,
  });
  coordinator.tick();
  await coordinator.idle();
  return coordinator;
}

const DUPLICATES = [
  '- 每周一交审计表：部门周报在周一 10:00 前提交',
  '- 审计表提交：每周一上午 10 点前交部门周报',
  '- 旧版发布在 2019 年的 8 楼机房',
  '- 代码评审周三下午',
].join('\n');

beforeEach(() => {});

describe('memory consolidation', () => {
  it('merges duplicate lines and drops a stale one, recording before and after', async () => {
    const w = await world('这周开始，审计表改成周二交。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    const provider = providerFor(() =>
      answer([
        {
          op: 'merge',
          lines: [1, 2],
          text: '- 审计表：每周二上午 10 点前交部门周报',
          why: '两条说的是同一件事，用户改成了周二',
        },
        { op: 'delete', lines: [3], message: 1, why: '旧版机房早已搬走' },
      ]),
    );
    await runOnce(w, provider);
    expect(provider.calls()).toHaveLength(1);
    expect(provider.calls()[0]).toContain('审计表改成周二交');
    expect(indexText(w)).toBe(
      ['- 审计表：每周二上午 10 点前交部门周报', '- 代码评审周三下午'].join('\n'),
    );
    const run = records(w)[0];
    expect(run?.status).toBe('applied');
    expect(run?.edits.map((edit) => edit.kind)).toEqual(['merge', 'delete']);
    expect(run?.edits[0]?.before).toBe(
      [
        '- 每周一交审计表：部门周报在周一 10:00 前提交',
        '- 审计表提交：每周一上午 10 点前交部门周报',
      ].join('\n'),
    );
    expect(run?.edits[0]?.after).toBe('- 审计表：每周二上午 10 点前交部门周报');
    expect(run?.beforeText).toBe(DUPLICATES);
    expect(run?.afterText).toBe(indexText(w));
  });

  it('does not request a pass while the scope is busy or recently active', async () => {
    const w = await world('记住：发布在周四。');
    seedIndex(w, DUPLICATES);
    const provider = providerFor(() => answer([]));
    w.s.db.update(step).set({ status: 'done' }).where(eq(step.id, w.stepId)).run();
    await runOnce(w, provider);
    expect(provider.calls()).toHaveLength(0);
    expect(records(w)).toHaveLength(0);
    const coordinator = await runOnce(w, provider);
    await coordinator.close();
  });

  it('waits for the interval when memory has not changed since the last pass', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    w.s.db
      .insert(memoryConsolidation)
      .values({
        id: 'pass-1',
        teamId: w.teamId,
        agentId: owner(w),
        projectId: null,
        status: 'empty',
        summary: '',
        edits: [],
        dropFiles: [],
        beforeText: DUPLICATES,
        afterText: DUPLICATES,
        startedAt: Date.now() - 30 * MINUTE,
        finishedAt: Date.now() - 30 * MINUTE,
        undoneAt: null,
      })
      .run();
    const provider = providerFor(() => answer([]));
    await runOnce(w, provider);
    expect(provider.calls()).toHaveLength(0);
    expect(records(w)).toHaveLength(1);
  });

  it('records an empty pass and does not call again before the interval', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    const provider = providerFor(() => answer([]));
    await runOnce(w, provider);
    expect(provider.calls()).toHaveLength(1);
    expect(records(w).map((run) => run.status)).toEqual(['empty']);
    expect(indexText(w)).toBe(DUPLICATES);
    await runOnce(w, provider);
    expect(provider.calls()).toHaveLength(1);
  });

  it('discards the answer when the memory changed while the model ran', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    let release: (text: string) => void = () => {};
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const provider = providerFor(() => gate);
    const coordinator = boot(w, provider, {
      memoryConsolidationIdleMs: 30 * MINUTE,
      memoryConsolidationIntervalMs: 6 * HOUR,
      memoryConsolidationTimeoutMs: 5_000,
      memoryConsolidationRetryMs: 1_000,
    });
    coordinator.tick();
    await until(() => provider.calls().length === 1);
    seedIndex(w, `${DUPLICATES}\n- 用户刚加的一条`);
    release(answer([{ op: 'delete', lines: [3], message: 1, why: '过时' }]));
    await coordinator.idle();
    expect(indexText(w)).toBe(`${DUPLICATES}\n- 用户刚加的一条`);
    expect(records(w)).toHaveLength(0);
  });

  it('discards the answer when the conversation resumes mid-pass', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    let release: (text: string) => void = () => {};
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const provider = providerFor(() => gate);
    const coordinator = boot(w, provider, {
      memoryConsolidationIdleMs: 30 * MINUTE,
      memoryConsolidationIntervalMs: 6 * HOUR,
      memoryConsolidationTimeoutMs: 5_000,
      memoryConsolidationRetryMs: 1_000,
    });
    coordinator.tick();
    await until(() => provider.calls().length === 1);
    w.s.db
      .insert(chiefMessage)
      .values({
        id: 'mid-pass-message',
        threadId: w.threadId,
        role: 'user',
        content: '对了，还有个事。',
        createdAt: Date.now(),
      })
      .run();
    release(answer([{ op: 'delete', lines: [3], message: 1, why: '过时' }]));
    await coordinator.idle();
    expect(indexText(w)).toBe(DUPLICATES);
    expect(records(w)).toHaveLength(0);
  });

  it('records a rejected pass and keeps the index when the answer is unusable', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    const provider = providerFor(() => 'not json at all');
    await runOnce(w, provider);
    expect(indexText(w)).toBe(DUPLICATES);
    expect(records(w).map((run) => run.status)).toEqual(['rejected']);
    expect(records(w)[0]?.summary).toContain('JSON');
  });

  it('refuses an edit that would lengthen the index', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    const provider = providerFor(() =>
      answer([
        {
          op: 'rewrite',
          lines: [4],
          text: '- 代码评审改到每周三下午三点，由测试组主持，会议室在三楼',
          why: '补充细节',
        },
      ]),
    );
    await runOnce(w, provider);
    expect(indexText(w)).toBe(DUPLICATES);
    expect(records(w).map((run) => run.status)).toEqual(['rejected']);
    expect(records(w)[0]?.summary).toContain('grow');
  });

  it('refuses an answer that leaves an over-budget index over budget', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    const long = Array.from({ length: 130 }, (_, index) => `- 条目 ${index + 1}`).join('\n');
    seedIndex(w, long);
    const provider = providerFor(() =>
      answer([{ op: 'delete', lines: [1], message: 1, why: '过时' }]),
    );
    await runOnce(w, provider);
    expect(indexText(w)).toBe(long);
    expect(records(w).map((run) => run.status)).toEqual(['rejected']);
    expect(records(w)[0]?.summary).toContain('budget');
  });

  it('brings an over-budget index back under the budget', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    const long = Array.from({ length: 130 }, (_, index) => `- 条目 ${index + 1}`).join('\n');
    seedIndex(w, long);
    const lines = Array.from({ length: 20 }, (_, index) => index + 1);
    const provider = providerFor(() =>
      answer([{ op: 'delete', lines, message: 1, why: '都是过时条目' }]),
    );
    await runOnce(w, provider);
    expect(indexText(w).split('\n')).toHaveLength(110);
    expect(records(w).map((run) => run.status)).toEqual(['applied']);
  });

  it('refuses line numbers that do not exist or repeat', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    const provider = providerFor(() =>
      answer([{ op: 'merge', lines: [1, 9], text: '- 合并后', why: '越界' }]),
    );
    await runOnce(w, provider);
    expect(indexText(w)).toBe(DUPLICATES);
    expect(records(w).map((run) => run.status)).toEqual(['rejected']);
  });

  it('never drops a memory file the user imported', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    seedFile(w, '导入的规范.md', '仓库里的规范', null, 'import:repo');
    seedFile(w, '旧的部署笔记.md', '2019 年的部署步骤', null, 'test');
    const provider = providerFor(() =>
      answer(
        [{ op: 'delete', lines: [3], message: 1, why: '过时' }],
        [
          { file: '导入的规范.md', why: '没人引用' },
          { file: '旧的部署笔记.md', why: '仓库已经改了' },
        ],
      ),
    );
    await runOnce(w, provider);
    const files = listMemoryEntries(w.s.db, { teamId: w.teamId, agentId: owner(w) }).filter(
      (row) => row.layer === 'searchable',
    );
    const alive = files.filter((row) => row.invalidAt === null && row.supersededBy === null);
    expect(alive.map((row) => row.title)).toEqual(['导入的规范.md']);
    expect(records(w)[0]?.dropFiles.map((drop) => drop.title)).toEqual(['旧的部署笔记.md']);
  });

  it('undoes a pass and brings a dropped file back', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    seedFile(w, '旧的部署笔记.md', '2019 年的部署步骤');
    const provider = providerFor(() =>
      answer(
        [{ op: 'delete', lines: [3], message: 1, why: '过时' }],
        [{ file: '旧的部署笔记.md', why: '仓库已经改了' }],
      ),
    );
    await runOnce(w, provider);
    const run = records(w)[0];
    expect(run?.status).toBe('applied');
    const undoneAt = await req(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/memory-consolidation/${run?.id}/undo`,
    );
    expect(undoneAt.status).toBe(200);
    expect(indexText(w)).toBe(DUPLICATES);
    const files = listMemoryEntries(w.s.db, { teamId: w.teamId, agentId: owner(w) }).filter(
      (row) => row.layer === 'searchable' && row.invalidAt === null && row.supersededBy === null,
    );
    expect(files.map((row) => row.title)).toEqual(['旧的部署笔记.md']);
    expect(((await undoneAt.json()) as { undoneAt: number }).undoneAt).toBeGreaterThan(0);
    const listed = await req(w.s.app, 'GET', `/api/teams/${w.teamId}/memory-consolidation`);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { consolidations: { undoneAt: number | null }[] };
    expect(body.consolidations[0]?.undoneAt).toBeGreaterThan(0);
  });

  it('refuses undo once memory was edited after the pass', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    const provider = providerFor(() =>
      answer([{ op: 'delete', lines: [3], message: 1, why: '过时' }]),
    );
    await runOnce(w, provider);
    const run = records(w)[0];
    seedIndex(w, `${indexText(w)}\n- 之后又加的一条`);
    const undo = await req(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/memory-consolidation/${run?.id}/undo`,
    );
    expect(undo.status).toBe(409);
    expect(indexText(w)).toContain('之后又加的一条');
    expect(records(w)[0]?.undoneAt).toBeNull();
  });

  it('does nothing without a usable provider route', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    const provider = providerFor(() => answer([]));
    const coordinator = boot(w, provider, {
      memoryConsolidationIdleMs: 30 * MINUTE,
      memoryConsolidationIntervalMs: 6 * HOUR,
      memoryConsolidationTimeoutMs: 5_000,
      memoryConsolidationRetryMs: 1_000,
      fixedProviders: [],
    });
    coordinator.tick();
    await coordinator.idle();
    expect(provider.calls()).toHaveLength(0);
    expect(records(w)).toHaveLength(0);
    expect(indexText(w)).toBe(DUPLICATES);
  });

  it('gives up on a hung answer without writing', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    const provider = providerFor(() => new Promise<string>(() => {}));
    await runOnce(w, provider);
    expect(indexText(w)).toBe(DUPLICATES);
    expect(records(w)).toHaveLength(0);
  });

  it('keeps at most the newest ten records per scope', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    for (let index = 0; index < 11; index += 1)
      w.s.db
        .insert(memoryConsolidation)
        .values({
          id: `old-${index}`,
          teamId: w.teamId,
          agentId: owner(w),
          projectId: null,
          status: 'empty',
          summary: '',
          edits: [],
          dropFiles: [],
          beforeText: DUPLICATES,
          afterText: DUPLICATES,
          startedAt: Date.now() - 10 * HOUR - index * MINUTE,
          finishedAt: Date.now() - 10 * HOUR - index * MINUTE,
          undoneAt: null,
        })
        .run();
    const provider = providerFor(() => answer([]));
    await runOnce(w, provider);
    expect(records(w)).toHaveLength(10);
  });

  it('writes nothing when the server shuts down mid-request', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    const provider = providerFor(() => new Promise<string>(() => {}));
    const coordinator = boot(w, provider, {
      memoryConsolidationIdleMs: 30 * MINUTE,
      memoryConsolidationIntervalMs: 6 * HOUR,
      memoryConsolidationTimeoutMs: 60_000,
      memoryConsolidationRetryMs: 1_000,
    });
    coordinator.tick();
    await until(() => provider.calls().length === 1);
    await coordinator.close();
    expect(indexText(w)).toBe(DUPLICATES);
    expect(records(w)).toHaveLength(0);
  });

  it('tries again on the first tick after a restart', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    const provider = providerFor(() => new Promise<string>(() => {}));
    const first = boot(w, provider, {
      memoryConsolidationIdleMs: 30 * MINUTE,
      memoryConsolidationIntervalMs: 6 * HOUR,
      memoryConsolidationTimeoutMs: 60_000,
      memoryConsolidationRetryMs: 1_000,
    });
    first.tick();
    await until(() => provider.calls().length === 1);
    await first.close();
    expect(records(w)).toHaveLength(0);
    const second = await runOnce(
      w,
      providerFor(() => answer([])),
    );
    await second.close();
    expect(records(w).map((run) => run.status)).toEqual(['empty']);
  });

  it('does not request a pass below three entries', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, ['- 发布在周四', '- 周报周一交'].join('\n'));
    const provider = providerFor(() => answer([]));
    await runOnce(w, provider);
    expect(provider.calls()).toHaveLength(0);
    expect(records(w)).toHaveLength(0);
  });

  it('refuses a deletion when the evidence window has no messages', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    w.s.db
      .update(chiefMessage)
      .set({ createdAt: Date.now() - 8 * 24 * HOUR })
      .where(eq(chiefMessage.threadId, w.threadId))
      .run();
    seedIndex(w, DUPLICATES);
    const provider = providerFor(() => answer([{ op: 'delete', lines: [3], why: '过时' }]));
    await runOnce(w, provider);
    expect(indexText(w)).toBe(DUPLICATES);
    expect(records(w).map((run) => run.status)).toEqual(['rejected']);
    expect(records(w)[0]?.summary).toContain('deletion needs');
  });

  it('does not write when the only requested drop is an imported file', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    seedFile(w, '导入的规范.md', '仓库里的规范', null, 'import:repo');
    const provider = providerFor(() => answer([], [{ file: '导入的规范.md', why: '没人引用' }]));
    await runOnce(w, provider);
    expect(indexText(w)).toBe(DUPLICATES);
    expect(records(w).map((run) => run.status)).toEqual(['empty']);
  });

  it('never drops a file the edited index still links', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(
      w,
      `${DUPLICATES}\n- [旧的部署笔记.md](%E6%97%A7%E7%9A%84%E9%83%A8%E7%BD%B2%E7%AC%94%E8%AE%B0.md)`,
    );
    seedFile(w, '旧的部署笔记.md', '2019 年的部署步骤');
    const provider = providerFor(() =>
      answer([], [{ file: '旧的部署笔记.md', why: '看起来没用' }]),
    );
    await runOnce(w, provider);
    const files = listMemoryEntries(w.s.db, { teamId: w.teamId, agentId: owner(w) }).filter(
      (row) => row.layer === 'searchable' && row.invalidAt === null && row.supersededBy === null,
    );
    expect(files.map((row) => row.title)).toEqual(['旧的部署笔记.md']);
    expect(records(w).map((run) => run.status)).toEqual(['empty']);
  });

  it('keeps the newest applied pass when newer rejected passes exceed the limit', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    w.s.db
      .insert(memoryConsolidation)
      .values({
        id: 'applied-old',
        teamId: w.teamId,
        agentId: owner(w),
        projectId: null,
        status: 'applied',
        summary: '',
        edits: [],
        dropFiles: [],
        beforeText: DUPLICATES,
        afterText: DUPLICATES,
        startedAt: Date.now() - 8 * HOUR,
        finishedAt: Date.now() - 8 * HOUR,
        undoneAt: null,
      })
      .run();
    for (let index = 0; index < 11; index += 1)
      w.s.db
        .insert(memoryConsolidation)
        .values({
          id: `rejected-${index}`,
          teamId: w.teamId,
          agentId: owner(w),
          projectId: null,
          status: 'rejected',
          summary: 'no',
          edits: [],
          dropFiles: [],
          beforeText: DUPLICATES,
          afterText: '',
          startedAt: Date.now() - 7 * HOUR - index * MINUTE,
          finishedAt: Date.now() - 7 * HOUR - index * MINUTE,
          undoneAt: null,
        })
        .run();
    const provider = providerFor(() => answer([]));
    await runOnce(w, provider);
    const ids = records(w).map((run) => run.id);
    expect(ids).toContain('applied-old');
    expect(ids).toHaveLength(10);
  });

  it('refuses to undo an older applied pass', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    let call = 0;
    const provider = providerFor(() => {
      call += 1;
      return answer([
        { op: 'delete', lines: [3], message: 1, why: call === 1 ? '旧机房搬走' : '用户已经取消' },
      ]);
    });
    const first = await runOnce(w, provider);
    await first.close();
    const firstRun = records(w)[0];
    w.s.db
      .update(memoryConsolidation)
      .set({ startedAt: Date.now() - 7 * HOUR, finishedAt: Date.now() - 7 * HOUR })
      .where(eq(memoryConsolidation.id, firstRun?.id ?? ''))
      .run();
    const second = await runOnce(w, provider);
    await second.close();
    const undo = await req(
      w.s.app,
      'POST',
      `/api/teams/${w.teamId}/memory-consolidation/${firstRun?.id}/undo`,
    );
    expect(undo.status).toBe(409);
    expect(indexText(w)).toBe(
      [
        '- 每周一交审计表：部门周报在周一 10:00 前提交',
        '- 审计表提交：每周一上午 10 点前交部门周报',
      ].join('\n'),
    );
  });

  it('tells the next pass not to repeat an undone pass', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    const provider = providerFor(() =>
      answer([
        {
          op: 'merge',
          lines: [1, 2],
          text: '- 审计表：每周二上午 10 点前交部门周报',
          why: '两条重复',
        },
      ]),
    );
    await runOnce(w, provider);
    const run = records(w)[0];
    await req(w.s.app, 'POST', `/api/teams/${w.teamId}/memory-consolidation/${run?.id}/undo`);
    w.s.db
      .update(memoryConsolidation)
      .set({ startedAt: Date.now() - 7 * HOUR, finishedAt: Date.now() - 7 * HOUR })
      .where(eq(memoryConsolidation.id, run?.id ?? ''))
      .run();
    const prompts: string[] = [];
    const second = providerFor((prompt) => {
      prompts.push(prompt);
      return answer([]);
    });
    await runOnce(w, second);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('the user undid it');
    expect(prompts[0]).toContain('- 审计表：每周二上午 10 点前交部门周报');
  });

  it('writes nothing when the project is archived while the model runs', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    w.s.db.insert(project).values({ id: 'project-audit', teamId: w.teamId, name: '审计' }).run();
    w.s.db
      .insert(chiefThread)
      .values({
        id: 'chief-project-audit',
        chiefId: w.s.user.id,
        userId: w.s.user.id,
        teamId: w.teamId,
        projectId: 'project-audit',
        title: '审计项目',
        createdAt: Date.now() - 3 * HOUR,
        updatedAt: Date.now() - HOUR,
        sessionId: 'session-audit',
        sessionOpenedAt: Date.now() - 3 * HOUR,
      })
      .run();
    w.s.db
      .insert(chiefMessage)
      .values({
        id: 'project-audit-message',
        threadId: 'chief-project-audit',
        role: 'user',
        content: '这个项目的报表每月 5 号要交。',
        createdAt: Date.now() - 2 * HOUR,
      })
      .run();
    seedIndex(
      w,
      ['- 报表每月 5 号交', '- 报表：每个月五号提交', '- 报表交给财务组'].join('\n'),
      'project-audit',
    );
    let release: (text: string) => void = () => {};
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const provider = providerFor(() => gate);
    const coordinator = boot(w, provider, {
      memoryConsolidationIdleMs: 30 * MINUTE,
      memoryConsolidationIntervalMs: 6 * HOUR,
      memoryConsolidationTimeoutMs: 5_000,
      memoryConsolidationRetryMs: 1_000,
    });
    coordinator.tick();
    await until(() => provider.calls().length === 1);
    w.s.db
      .update(project)
      .set({ archivedAt: Date.now() })
      .where(eq(project.id, 'project-audit'))
      .run();
    release(
      answer([{ op: 'merge', lines: [1, 2], text: '- 报表：每月 5 号提交', why: '两条重复' }]),
    );
    await coordinator.idle();
    expect(indexText(w, 'project-audit')).toBe(
      ['- 报表每月 5 号交', '- 报表：每个月五号提交', '- 报表交给财务组'].join('\n'),
    );
    expect(records(w, 'project-audit')).toHaveLength(0);
  });

  it('refuses an answer that would empty the index', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    const provider = providerFor(() =>
      answer([{ op: 'delete', lines: [1, 2, 3, 4], message: 1, why: '全删' }]),
    );
    await runOnce(w, provider);
    expect(indexText(w)).toBe(DUPLICATES);
    expect(records(w).map((run) => run.status)).toEqual(['rejected']);
    expect(records(w)[0]?.summary).toContain('empty');
  });

  it('gives up without writing when the provider fails', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    const provider = providerFor(() => {
      throw new Error('quota exhausted');
    });
    await runOnce(w, provider);
    expect(indexText(w)).toBe(DUPLICATES);
    expect(records(w)).toHaveLength(0);
  });

  it('prunes records older than thirty days', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    w.s.db
      .insert(memoryConsolidation)
      .values({
        id: 'ancient',
        teamId: w.teamId,
        agentId: owner(w),
        projectId: null,
        status: 'empty',
        summary: '',
        edits: [],
        dropFiles: [],
        beforeText: DUPLICATES,
        afterText: DUPLICATES,
        startedAt: Date.now() - 31 * 24 * HOUR,
        finishedAt: Date.now() - 31 * 24 * HOUR,
        undoneAt: null,
      })
      .run();
    const provider = providerFor(() => answer([]));
    await runOnce(w, provider);
    expect(records(w).map((run) => run.id)).not.toContain('ancient');
  });

  it('takes one scope per tick when two are eligible', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    seedIndex(w, DUPLICATES);
    w.s.db.insert(project).values({ id: 'project-audit', teamId: w.teamId, name: '审计' }).run();
    w.s.db
      .insert(chiefThread)
      .values({
        id: 'chief-project-audit',
        chiefId: w.s.user.id,
        userId: w.s.user.id,
        teamId: w.teamId,
        projectId: 'project-audit',
        title: '审计项目',
        createdAt: Date.now() - 3 * HOUR,
        updatedAt: Date.now() - HOUR,
        sessionId: 'session-audit',
        sessionOpenedAt: Date.now() - 3 * HOUR,
      })
      .run();
    w.s.db
      .insert(chiefMessage)
      .values({
        id: 'project-audit-message',
        threadId: 'chief-project-audit',
        role: 'user',
        content: '这个项目的报表每月 5 号要交。',
        createdAt: Date.now() - 2 * HOUR,
      })
      .run();
    seedIndex(
      w,
      ['- 报表每月 5 号交', '- 报表：每个月五号提交', '- 报表交给财务组'].join('\n'),
      'project-audit',
    );
    const provider = providerFor(() => answer([]));
    const first = await runOnce(w, provider);
    await first.close();
    expect(provider.calls()).toHaveLength(1);
    const second = await runOnce(w, provider);
    await second.close();
    expect(provider.calls()).toHaveLength(2);
    expect(records(w)).toHaveLength(1);
    expect(records(w, 'project-audit')).toHaveLength(1);
  });

  it('consolidates a project scope without touching team memory', async () => {
    const w = await world('记住：发布在周四。');
    quiet(w);
    const teamText = await (async () => {
      seedIndex(w, '- 团队：周一上午 10 点前交周报');
      return indexText(w);
    })();
    w.s.db.insert(project).values({ id: 'project-audit', teamId: w.teamId, name: '审计' }).run();
    w.s.db
      .insert(chiefThread)
      .values({
        id: 'chief-project-audit',
        chiefId: w.s.user.id,
        userId: w.s.user.id,
        teamId: w.teamId,
        projectId: 'project-audit',
        title: '审计项目',
        createdAt: Date.now() - 3 * HOUR,
        updatedAt: Date.now() - HOUR,
        sessionId: 'session-audit',
        sessionOpenedAt: Date.now() - 3 * HOUR,
      })
      .run();
    w.s.db
      .insert(chiefMessage)
      .values({
        id: 'project-audit-message',
        threadId: 'chief-project-audit',
        role: 'user',
        content: '这个项目的报表每月 5 号要交。',
        createdAt: Date.now() - 2 * HOUR,
      })
      .run();
    seedIndex(
      w,
      ['- 报表每月 5 号交', '- 报表：每个月五号提交', '- 报表模板在共享盘'].join('\n'),
      'project-audit',
    );
    const provider = providerFor(() =>
      answer([
        {
          op: 'merge',
          lines: [1, 2],
          text: '- 报表：每月 5 号提交',
          why: '两条重复',
        },
      ]),
    );
    await runOnce(w, provider);
    expect(provider.calls()[0]).toContain('Scope: project-audit');
    expect(provider.calls()[0]).toContain('报表每月 5 号要交');
    expect(indexText(w, 'project-audit')).toBe(
      ['- 报表：每月 5 号提交', '- 报表模板在共享盘'].join('\n'),
    );
    expect(indexText(w)).toBe(teamText);
    expect(records(w, 'project-audit')).toHaveLength(1);
    expect(records(w)).toHaveLength(0);
  });
});

async function until(check: () => boolean, ms = 8_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !check()) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(check()).toBe(true);
}
