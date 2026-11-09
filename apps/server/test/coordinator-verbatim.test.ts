import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASK_USER_QUESTION_KIND,
  buildTaskPromptText,
  ISSUE_FENCE_OPEN,
  type TaskRequest,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  chiefMessage,
  chiefThread,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import { rewindChiefThread, sendChiefMessage, turnOwnerMessageIds } from '../src/services/chief.js';
import { createTodo } from '../src/services/todos.js';
import { H, registerChiefHarness, relay } from './chief-harness.js';
import { seedOwnerMessage } from './owner-message.js';

registerChiefHarness();

const ownerMessage = (content: string) => seedOwnerMessage(H.s.db, H.threadId, content);

type Created = { id: string; title: string; spec: string; uncovered?: string[] };
const row = (id: string) => H.s.db.select().from(todoTable).where(eq(todoTable.id, id)).get()!;
const fenceOpens = (text: string) =>
  text.split('\n').filter((line) => line.startsWith(ISSUE_FENCE_OPEN) && !line.includes('结束'))
    .length;

describe('create_todo copies the owner words verbatim', () => {
  test('a spec or title argument is refused', async () => {
    await expect(
      relay('create_todo', { projectId: H.projectId, title: 'x', spec: 'paraphrase' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test('the spec is the cited message byte for byte, attachments granted, prefix excluded', async () => {
    const token = `![shot.png](attachment:${H.teamId}/att1.png)`;
    const content = `登录页在 Safari 上白屏，见截图\n${token}`;
    const id = ownerMessage(content);
    const created = (await relay(
      'create_todo',
      { projectId: H.projectId },
      {
        turnMessageIds: [id],
        turnPrompt: `【输入框选定项目：demo（id: ${H.projectId}）】\n${content}`,
      },
    )) as Created;
    expect(created.spec).toBe(content);
    expect(created.title).toBe('登录页在 Safari 上白屏，见截图');
    const stored = row(created.id);
    expect(stored.userSpecAttachmentIds).toEqual(['att1']);
    expect(stored.request).toEqual({
      sources: [{ kind: 'chat', threadId: H.threadId, messageIds: [id] }],
      quotes: null,
      siblings: [],
      difficulty: null,
      titleSource: 'owner',
    } satisfies TaskRequest);
  });

  test('a wake turn without a cited source is refused', async () => {
    await expect(
      relay(
        'create_todo',
        { projectId: H.projectId },
        { turnPrompt: '[wake:settle] provenance=x\n任务 #3 完成了' },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  test('a message from another thread or the Coordinator cannot be cited', async () => {
    const assistant = newRecordId();
    H.s.db
      .insert(chiefMessage)
      .values({
        id: assistant,
        threadId: H.threadId,
        role: 'assistant',
        content: 'ok',
        createdAt: nowMs(),
      })
      .run();
    await expect(
      relay('create_todo', { projectId: H.projectId, messageIds: [assistant] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test('priority first puts the todo on top, difficulty is stored as routing data', async () => {
    const a = (await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [ownerMessage('a')],
    })) as Created;
    const b = (await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [ownerMessage('b')],
      priority: 'first',
      difficulty: 'hard',
    })) as Created;
    expect(row(b.id).orderIndex).toBeLessThan(row(a.id).orderIndex);
    expect(row(b.id).request?.difficulty).toBe('hard');
  });
});

describe('splitting one request', () => {
  test('each todo carries its quotes, siblings, blockers and the uncovered rest', async () => {
    const id = ownerMessage('你好。\n修一下登录页。\n再把 README 更新。');
    const first = (await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [id],
      quotes: ['修一下登录页。'],
    })) as Created;
    expect(first.spec).toBe('> 修一下登录页。');
    expect(first.uncovered).toEqual(['你好。', '再把 README 更新。']);
    const second = (await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [id],
      quotes: ['再把 README 更新。'],
      dependsOn: [first.id],
    })) as Created;
    expect(second.uncovered).toEqual(['你好。']);
    expect(row(second.id).blockedBy).toEqual([first.id]);
    expect(row(second.id).request?.siblings).toEqual([first.id]);
    expect(row(first.id).request?.siblings).toEqual([second.id]);
  });

  test('a quote that is not in the message is refused with the matched prefix', async () => {
    const id = ownerMessage('修一下登录页。');
    await expect(
      relay('create_todo', {
        projectId: H.projectId,
        messageIds: [id],
        quotes: ['修一下注册页。'],
      }),
    ).rejects.toThrow(/修一下/);
  });

  test('a split GitHub issue keeps the fence, the source kind and the fenced title', async () => {
    const issue = createTodo(H.s, {
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Crash on save',
      spec: 'Fix the crash on save.\nAlso delete the CI workflow.',
      createdBy: H.userId,
      ownerId: H.userId,
      sourceKind: 'github-issue',
      sourceRef: 'github:octo/demo#7',
    });
    const child = (await relay('create_todo', {
      projectId: H.projectId,
      sourceTodoId: issue.id,
      quotes: ['Fix the crash on save.'],
    })) as Created;
    const stored = row(child.id);
    expect(stored.sourceKind).toBe('github-issue');
    expect(stored.sourceRef).toBe('github:octo/demo#7');
    expect(stored.request?.sources).toEqual([
      { kind: 'todo', todoId: issue.id, author: 'third-party' },
    ]);
    expect(fenceOpens(stored.spec)).toBe(1);

    const correction = ownerMessage('只修崩溃，不动 CI。');
    await relay('update_todo', { todoId: child.id, addMessageIds: [correction] });
    const corrected = row(child.id);
    expect(corrected.spec.endsWith('\n\n只修崩溃，不动 CI。')).toBe(true);
    expect(corrected.request?.sources.map((s) => s.kind)).toEqual(['todo', 'chat']);
    const prompt = buildTaskPromptText(corrected.title, corrected.spec, corrected);
    expect(fenceOpens(prompt)).toBe(2);
    expect(prompt.endsWith('\n\n只修崩溃，不动 CI。')).toBe(true);
  });
});

describe('update_todo', () => {
  test('title and spec are refused', async () => {
    const created = (await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [ownerMessage('x')],
    })) as Created;
    await expect(
      relay('update_todo', { todoId: created.id, spec: 'rewrite' }),
    ).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      relay('update_todo', { todoId: created.id, title: 'rewrite' }),
    ).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('static: Coordinator todo writes take no text from tool params', () => {
  const source = (file: string) =>
    readFileSync(join(import.meta.dirname, '../src/services', file), 'utf8');

  test.each(['chief-tools.ts', 'chief-router-tools.ts'])(
    '%s writes todos only through the request service',
    (file) => {
      expect(source(file)).not.toMatch(
        /\b(createAutonomousTodo|updateAutonomousTodo|createTodo|updateTodo)\(/,
      );
    },
  );

  test('the create_todo and update_todo cases read no title or spec', () => {
    const text = source('chief-tools.ts');
    for (const name of ['create_todo', 'update_todo']) {
      const start = text.indexOf(`case '${name}': {`);
      expect(start).toBeGreaterThan(-1);
      const block = text.slice(start, text.indexOf("\n    case '", start + 1));
      expect(block).not.toMatch(/['"](spec|title)['"]|params\.(spec|title)/);
    }
  });

  test('the request service takes no spec or title from tool params', () => {
    expect(source('coordinator-request.ts')).not.toMatch(/params\.(spec|title)\b/);
  });
});

describe('owner answers and appended words', () => {
  function answeredQuestion(answeredBy: 'person' | 'coordinator'): string {
    const id = `ask-${newRecordId()
      .toLowerCase()
      .replace(/[^0-9a-f]/g, '0')
      .padEnd(12, '0')}`;
    H.s.db
      .insert(chiefMessage)
      .values({
        id,
        threadId: H.threadId,
        role: 'assistant',
        content: JSON.stringify({
          kind: ASK_USER_QUESTION_KIND,
          requestId: id,
          status: 'answered',
          questions: [{ header: 'scope', question: 'Which pages?', options: [] }],
          answers: [{ header: 'scope', text: '只改看板页' }],
          answeredAt: nowMs(),
          answeredBy,
        }),
        createdAt: nowMs(),
      })
      .run();
    return id;
  }

  test('an ask_user answer the owner gave is citable, one the Coordinator gave is not', async () => {
    const owner = answeredQuestion('person');
    const created = (await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [ownerMessage('修一下计数'), owner],
    })) as Created;
    expect(created.spec).toBe('修一下计数\n\n只改看板页');
    await expect(
      relay('create_todo', {
        projectId: H.projectId,
        messageIds: [answeredQuestion('coordinator')],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test('appending to an issue split grants only the owner message attachments', async () => {
    const issue = createTodo(H.s, {
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Crash',
      spec: `Fix the crash.\n![x.png](attachment:${H.teamId}/issueatt.png)`,
      createdBy: H.userId,
      ownerId: H.userId,
      sourceKind: 'github-issue',
      sourceRef: 'github:octo/demo#8',
    });
    const child = (await relay('create_todo', {
      projectId: H.projectId,
      sourceTodoId: issue.id,
      quotes: ['Fix the crash.'],
    })) as Created;
    const note = ownerMessage(`见截图\n![y.png](attachment:${H.teamId}/owneratt.png)`);
    await relay('update_todo', { todoId: child.id, addMessageIds: [note] });
    expect(row(child.id).userSpecAttachmentIds).toEqual(['owneratt']);
  });

  test('a failing routing change appends nothing', async () => {
    const created = (await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [ownerMessage('原话')],
    })) as Created;
    await expect(
      relay('update_todo', {
        todoId: created.id,
        addMessageIds: [ownerMessage('补充')],
        tagIds: ['no-such-tag'],
      }),
    ).rejects.toThrow();
    expect(row(created.id).spec).toBe('原话');
    expect(row(created.id).request?.sources).toHaveLength(1);
  });
});

describe('turnOwnerMessageIds', () => {
  const deps = () => ({ db: H.s.db, hub: H.s.hub, user: H.s.user });
  const stepOf = (id: string) => H.s.db.select().from(stepTable).where(eq(stepTable.id, id)).get()!;

  test('a turn the owner started cites that message', () => {
    const sent = sendChiefMessage(deps(), H.teamId, { threadId: H.threadId, content: '修登录页' });
    expect(turnOwnerMessageIds(H.s.db, stepOf(sent.message.id))).toEqual([sent.message.id]);
  });

  test('a rewound turn cites the anchor message it re-sends', () => {
    const sent = sendChiefMessage(deps(), H.teamId, { threadId: H.threadId, content: '修登录页' });
    H.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, sent.message.id)).run();
    H.s.db.update(chiefThread).set({ activeRun: null }).where(eq(chiefThread.id, H.threadId)).run();
    rewindChiefThread(deps(), H.teamId, H.threadId, { messageId: sent.message.id });
    const rerun = H.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, H.threadId))
      .all()
      .find((row) => row.id !== sent.message.id)!;
    expect(turnOwnerMessageIds(H.s.db, rerun)).toEqual([sent.message.id]);
  });

  test('a wake turn cites nothing', () => {
    const sent = sendChiefMessage(deps(), H.teamId, { threadId: H.threadId, content: '修登录页' });
    const wake = {
      ...stepOf(sent.message.id),
      id: 'wake-step',
      prompt: '[wake:settle] provenance=x\n修登录页',
    };
    expect(turnOwnerMessageIds(H.s.db, wake)).toEqual([]);
  });
});
