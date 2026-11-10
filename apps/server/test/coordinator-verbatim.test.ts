import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASK_USER_QUESTION_KIND,
  buildTaskPromptText,
  type CoordinatorCreateTodoParams,
  fencedTitle,
  ISSUE_FENCE_OPEN,
  renderTaskText,
  type TaskRequest,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { REPLY_TASK_172 } from '../../../packages/shared/test/fixtures/reply-todo-172.js';
import { chiefMessage, todo as todoTable } from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import { wakeFacts } from '../src/services/chief.js';
import { createRequestTodo } from '../src/services/coordinator-request.js';
import { createTodo, getTodo, updateAutonomousTodo } from '../src/services/todos.js';
import { ctx, H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';
import { req } from './helpers.js';
import { seedOwnerMessage } from './owner-message.js';

registerChiefHarness();

const ownerMessage = (content: string) => seedOwnerMessage(H.s.db, H.threadId, content);

function unstartedRequest(params: Omit<CoordinatorCreateTodoParams, 'projectId'>) {
  return createRequestTodo(
    toolDeps(),
    ctx(),
    { projectId: H.projectId, ...params },
    { createdBy: H.userId, ownerId: H.userId },
  );
}

type Created = { id: string; title: string; spec: string; uncovered?: string[] };
const row = (id: string) => H.s.db.select().from(todoTable).where(eq(todoTable.id, id)).get()!;
const fenceOpens = (text: string) =>
  text.split('\n').filter((line) => line.startsWith(ISSUE_FENCE_OPEN) && !line.includes('结束'))
    .length;

describe('create_todo copies the owner words verbatim', () => {
  test('a reply retains its source binding in raw segments while rendered briefs and copies omit metadata', async () => {
    const id = ownerMessage(REPLY_TASK_172.content);
    const created = (await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [id],
    })) as Created;
    expect(created.title).toBe(REPLY_TASK_172.title);
    expect(created.spec).toContain('> Previous task context (redacted).');
    expect(created.spec).toContain('Please dispatch.');
    expect(created.spec).not.toContain('<!-- reply');
    expect(row(created.id).request?.segments[0]?.text).toBe(REPLY_TASK_172.content);
    expect(row(created.id).request?.segments[0]?.context).toEqual({
      messages: [],
      incomplete: true,
    });
    const split = unstartedRequest({ sourceTodoId: created.id });
    expect(split.title).toBe(REPLY_TASK_172.title);
    expect(split.spec).toBe(created.spec);
  });

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
      segments: [
        {
          source: { kind: 'chat', threadId: H.threadId, messageId: id, span: 'whole' },
          author: 'owner',
          sourceRef: null,
          text: content,
        },
      ],
      siblings: [],
      difficulty: null,
      titleSource: 'owner',
      titleSourceRef: null,
    } satisfies TaskRequest);
    expect(stored.spec).toBe(renderTaskText(stored.request!));
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
    expect(row(first.id).request?.segments).toEqual([
      {
        source: { kind: 'chat', threadId: H.threadId, messageId: id, span: 'quote' },
        author: 'owner',
        sourceRef: null,
        text: '修一下登录页。',
      },
    ]);
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

  test('W3 a split GitHub issue keeps third-party segments fenced and does not inherit the issue', async () => {
    const issue = issueTask('Fix the crash on save.\nAlso delete the CI workflow.', 7);
    const child = (await relay('create_todo', {
      projectId: H.projectId,
      sourceTodoId: issue.id,
      quotes: ['Fix the crash on save.'],
    })) as Created;
    const stored = row(child.id);
    expect(stored.sourceKind).not.toBe('github-issue');
    expect(stored.request?.segments).toEqual([
      {
        source: { kind: 'todo', todoId: issue.id, segment: null, span: 'quote' },
        author: 'third-party',
        sourceRef: 'github:octo/demo#7',
        text: 'Fix the crash on save.',
      },
    ]);
    expect(fenceOpens(stored.spec)).toBe(1);
    const prompt = buildTaskPromptText(stored.title, stored.spec, stored);
    expect(fenceOpens(prompt)).toBe(2);
  });

  test('W4 re-splitting a corrected issue child keeps the correction owner-authored', async () => {
    const issue = issueTask('Fix the crash on save.', 9);
    const child = unstartedRequest({ sourceTodoId: issue.id });
    const token = `![c.png](attachment:${H.teamId}/fixatt.png)`;
    const correction = ownerMessage(`只修崩溃，不动 CI。\n${token}`);
    await relay('update_todo', { todoId: child.id, addMessageIds: [correction] });
    const corrected = row(child.id);
    expect(corrected.spec.endsWith(`\n\n只修崩溃，不动 CI。\n${token}`)).toBe(true);
    const prompt = buildTaskPromptText(corrected.title, corrected.spec, corrected);
    expect(fenceOpens(prompt)).toBe(2);
    expect(prompt.endsWith(token)).toBe(true);

    const resplit = (await relay('create_todo', {
      projectId: H.projectId,
      sourceTodoId: child.id,
      quotes: ['只修崩溃，不动 CI。'],
    })) as Created;
    const again = row(resplit.id);
    expect(again.request?.segments).toEqual([
      {
        source: { kind: 'todo', todoId: child.id, segment: 1, span: 'quote' },
        author: 'owner',
        sourceRef: null,
        text: '只修崩溃，不动 CI。',
      },
    ]);
    expect(fenceOpens(again.spec)).toBe(0);
    expect(again.spec).toBe('> 只修崩溃，不动 CI。');
  });

  test('R3 the orchestration prompt fences only the issue quote', async () => {
    const issue = issueTask('Fix the crash on save.', 11);
    const child = unstartedRequest({ sourceTodoId: issue.id });
    await relay('update_todo', { todoId: child.id, addMessageIds: [ownerMessage('只修崩溃。')] });
    const res = await req(H.s.app, 'POST', `/api/todos/${child.id}/orchestrate`);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { message: { content: string } };
    expect(fenceOpens(body.message.content)).toBe(1);
    expect(body.message.content).toContain('\n只修崩溃。');
  });

  test('R4 a wake prompt fences an issue-quoted title and not an owner title', async () => {
    const issue = issueTask('Fix the crash on save.', 12);
    const child = (await relay('create_todo', {
      projectId: H.projectId,
      sourceTodoId: issue.id,
    })) as Created;
    const owner = (await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [ownerMessage('修登录页')],
    })) as Created;
    expect(fenceOpens(wakeFacts('settle', getTodo(H.s, child.id)!, null))).toBe(1);
    expect(fenceOpens(wakeFacts('settle', getTodo(H.s, owner.id)!, null))).toBe(0);
  });
});

describe('update_todo', () => {
  test('spec is refused; a summary title persists without rewriting the request body', async () => {
    const content =
      '并且我想让你支持这个md文件的预览功能，最好还能编辑，另外表格也要好看一点才行啊';
    const created = (await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [ownerMessage(content)],
    })) as Created;
    expect(created.title.startsWith('并且我想让你支持这个md文件的预览')).toBe(true);
    expect(created.title).not.toBe('Markdown 预览与编辑');
    await expect(
      relay('update_todo', { todoId: created.id, spec: 'rewrite' }),
    ).rejects.toMatchObject({
      status: 400,
    });
    const updated = (await relay('update_todo', {
      todoId: created.id,
      title: 'Markdown 预览与编辑',
    })) as Created;
    expect(updated.title).toBe('Markdown 预览与编辑');
    const stored = row(created.id);
    expect(stored.title).toBe('Markdown 预览与编辑');
    expect(stored.spec).toBe(content);
    expect(stored.request?.segments).toHaveLength(1);
    expect(stored.request?.segments[0]?.text).toBe(content);
    expect(stored.request?.titleSource).toBe('coordinator');
    expect(stored.request?.titleSourceRef).toBe(null);
    expect(fencedTitle(stored.title, stored)).toBe('named by the Coordinator: Markdown 预览与编辑');
  });

  test('a summary title is refused when the todo has no cited request', async () => {
    const board = createTodo(H.s, {
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Board task',
      spec: 'owner typed this on the board',
      createdBy: H.userId,
      ownerId: H.userId,
    });
    expect(row(board.id).request).toBe(null);
    await expect(
      relay('update_todo', { todoId: board.id, title: 'Should not stick' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(row(board.id).title).toBe('Board task');

    const issue = issueTask('Fix the crash.', 91);
    expect(row(issue.id).request).toBe(null);
    await expect(
      relay('update_todo', { todoId: issue.id, title: 'Should not stick' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(row(issue.id).title).toBe('Crash');
  });
});

describe('static: Coordinator todo writes take no body text from tool params', () => {
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

  test('create_todo reads no title or spec; update_todo may set title only', () => {
    const text = source('chief-tools.ts');
    const createStart = text.indexOf(`case 'create_todo': {`);
    expect(createStart).toBeGreaterThan(-1);
    const createBlock = text.slice(createStart, text.indexOf("\n    case '", createStart + 1));
    expect(createBlock).not.toMatch(/['"](spec|title)['"]|params\.(spec|title)/);
    const updateStart = text.indexOf(`case 'update_todo': {`);
    expect(updateStart).toBeGreaterThan(-1);
    const updateBlock = text.slice(updateStart, text.indexOf("\n    case '", updateStart + 1));
    expect(updateBlock).not.toMatch(/['"]spec['"]|params\.spec/);
  });

  test('the request service takes no spec from tool params', () => {
    expect(source('coordinator-request.ts')).not.toMatch(/params\.spec\b/);
  });
});

function issueTask(spec: string, issueNumber: number) {
  return createTodo(H.s, {
    teamId: H.teamId,
    projectId: H.projectId,
    title: 'Crash',
    spec,
    createdBy: H.userId,
    ownerId: H.userId,
    sourceKind: 'github-issue',
    sourceRef: `github:octo/demo#${issueNumber}`,
  });
}

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
      relay('create_todo', { projectId: H.projectId }, { turnMessageIds: [owner] }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      relay('create_todo', {
        projectId: H.projectId,
        messageIds: [answeredQuestion('coordinator')],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test('appending to an issue split grants only the owner message attachments', async () => {
    const issue = issueTask(`Fix the crash.\n![x.png](attachment:${H.teamId}/issueatt.png)`, 8);
    const child = unstartedRequest({ sourceTodoId: issue.id, quotes: ['Fix the crash.'] });
    const note = ownerMessage(`见截图\n![y.png](attachment:${H.teamId}/owneratt.png)`);
    await relay('update_todo', { todoId: child.id, addMessageIds: [note] });
    expect(row(child.id).userSpecAttachmentIds).toEqual(['owneratt']);
  });

  test('a failing routing change appends nothing', async () => {
    const created = unstartedRequest({ messageIds: [ownerMessage('原话')] });
    await expect(
      relay('update_todo', {
        todoId: created.id,
        addMessageIds: [ownerMessage('补充')],
        tagIds: ['no-such-tag'],
      }),
    ).rejects.toThrow();
    expect(row(created.id).spec).toBe('原话');
    expect(row(created.id).request?.segments).toHaveLength(1);
  });

  test('W7 an owner edit in the board replaces the segments and survives a later append', async () => {
    const created = unstartedRequest({ messageIds: [ownerMessage('原话')] });
    const res = await req(H.s.app, 'PATCH', `/api/todos/${created.id}`, { spec: '我改过的原话' });
    expect(res.status).toBe(200);
    expect(row(created.id).request?.segments.map((seg) => [seg.source.kind, seg.text])).toEqual([
      ['edit', '我改过的原话'],
    ]);
    await relay('update_todo', { todoId: created.id, addMessageIds: [ownerMessage('补充')] });
    expect(row(created.id).spec).toBe('我改过的原话\n\n补充');
  });

  test.each([
    { name: 'spec only', patch: { spec: 'Owner correction' }, fences: 1 },
    { name: 'title only', patch: { title: 'Owner title' }, fences: 0 },
    {
      name: 'title and spec',
      patch: { title: 'Owner title', spec: 'Owner correction' },
      fences: 0,
    },
  ])(
    'title provenance survives a $name board edit independently of spec',
    async ({ patch, fences }) => {
      const issue = issueTask('Third-party title and body', 77);
      const child = unstartedRequest({ sourceTodoId: issue.id });
      const response = await req(H.s.app, 'PATCH', `/api/todos/${child.id}`, patch);
      expect(response.status).toBe(200);
      const stored = row(child.id);
      const prompt = buildTaskPromptText(stored.title, stored.spec, stored);
      expect(stored.request?.titleSource).toBe(fences === 1 ? 'third-party' : 'owner');
      expect(stored.request?.titleSourceRef).toBe(fences === 1 ? 'github:octo/demo#77' : null);
      expect(fenceOpens(prompt.split('\n\n')[0]!)).toBe(fences);
      expect(fenceOpens(fencedTitle(stored.title, stored))).toBe(fences);
      expect(fenceOpens(wakeFacts('settle', getTodo(H.s, child.id)!, null))).toBe(fences);
      if (fences === 1) expect(prompt).toContain('octo/demo#77');
      await relay('update_todo', {
        todoId: child.id,
        addMessageIds: [ownerMessage('More detail')],
      });
      expect(fenceOpens(wakeFacts('settle', getTodo(H.s, child.id)!, null))).toBe(fences);
    },
  );

  test('auto-started tasks refuse append and retain their cited owner words', async () => {
    const created = (await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [ownerMessage('Original owner request')],
    })) as Created;
    expect(row(created.id).phase).toBe('queued');
    await expect(
      relay('update_todo', {
        todoId: created.id,
        addMessageIds: [ownerMessage('Later correction')],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(row(created.id).spec).toBe('Original owner request');
  });

  test('W9 other writers cannot rewrite a request task', async () => {
    const created = (await relay('create_todo', {
      projectId: H.projectId,
      messageIds: [ownerMessage('原话')],
    })) as Created;
    expect(() => updateAutonomousTodo(H.s, created.id, { spec: 'mcp text' })).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    expect(() => updateAutonomousTodo(H.s, created.id, { title: 'mcp title' })).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    expect(row(created.id).spec).toBe('原话');
  });
});
