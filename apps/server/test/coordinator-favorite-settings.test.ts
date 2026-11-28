import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  actionProposal,
  chiefMessage,
  step as stepTable,
  teamTopModels,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import { createDoubaoSubscription } from '../src/services/doubao-subscriptions.js';
import { createProvider } from '../src/services/providers.js';
import { readTopModels, writeTopModels } from '../src/services/top-models.js';
import { H, ownerTodo, registerChiefHarness, relay } from './chief-harness.js';
import { bootServer, insertMachine, req, seedRoute } from './helpers.js';

registerChiefHarness();

let lastCreatedAt = 0;

function frequentModels() {
  return (readTopModels(H.s.db, H.teamId).models ?? []).map(
    (model) => `${model.provider}/${model.modelId}`,
  );
}

function frequent(...models: { provider: string; modelId: string }[]) {
  writeTopModels(
    H.s.db,
    H.teamId,
    models.map((model) => ({ ...model, thinkingLevel: null })),
  );
}

function ownerMessage(words: string, ownerComposedAt: number | null): string {
  const id = newRecordId();
  lastCreatedAt = Math.max(nowMs(), lastCreatedAt + 1);
  H.s.db
    .insert(chiefMessage)
    .values({
      id,
      threadId: H.threadId,
      role: 'user',
      content: words,
      projectId: null,
      origin: 'user',
      ownerComposedAt,
      createdAt: lastCreatedAt,
    })
    .run();
  return id;
}

function doubaoMachine() {
  return insertMachine(H.s, {
    name: 'mac-mini',
    capabilities: {
      mcpServers: [],
      skills: [],
      executor: 'host',
      doubao: {
        installed: true,
        authenticated: true,
        platformSupported: true,
        version: '2.38.4',
        probedAt: Date.now(),
        models: [{ id: 'auto', name: 'Auto' }],
      },
    },
  });
}

function enableDoubaoAuto() {
  const machineId = doubaoMachine();
  createDoubaoSubscription({ db: H.s.db }, H.teamId, { label: 'Doubao', runnerId: machineId });
  frequent({ provider: 'devin', modelId: 'swe-2-1' });
  return machineId;
}

function provider(providerId: string, ...models: { id: string; name: string }[]) {
  createProvider(
    { db: H.s.db, box: H.s.secretBox },
    {
      teamId: H.teamId,
      createdBy: H.userId,
      body: {
        providerId,
        label: providerId,
        baseUrl: `http://127.0.0.1:9/${providerId}`,
        api: 'openai-completions',
        models,
      },
    },
  );
}

async function answerCard(proposalId: string, choice: string, origin = true) {
  return H.s.app.request(
    `/api/teams/${H.teamId}/chief/threads/${H.threadId}/questions/approval-${proposalId}/answer`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(origin ? { 'sec-fetch-site': 'same-origin' } : {}),
      },
      body: JSON.stringify({ answers: [{ header: '审批', choices: [choice] }] }),
    },
  );
}

function pendingProposal(proposalId: string) {
  return H.s.db.select().from(actionProposal).where(eq(actionProposal.id, proposalId)).get()!;
}

describe('the owner names a model that is not in 常用模型', () => {
  test('the named model is added to the list, reported once, and the task then runs', async () => {
    const machineId = enableDoubaoAuto();
    expect(frequentModels()).toEqual(['devin/swe-2-1']);
    const messageId = ownerMessage('在 Mac mini 上用豆包 Auto 整理文档', nowMs());
    const added = (await relay(
      'settings',
      { operation: 'addFavoriteModel', model: 'Auto', messageId, quote: '豆包 Auto' },
      { turnMessageIds: [messageId] },
    )) as { added: boolean; provider: string; modelId: string };
    expect(added).toMatchObject({ added: true, provider: 'doubao', modelId: 'auto' });
    expect(frequentModels()).toEqual(['devin/swe-2-1', 'doubao/auto']);
    const created = (await relay('create_todo', {
      ...ownerTodo('在 Mac mini 上用豆包 Auto 整理文档'),
      machine: machineId,
      model: 'doubao/auto',
    })) as { id: string; phase: string };
    expect(created.phase).toBe('queued');
    expect(
      H.s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get()?.request?.model,
    ).toEqual({ provider: 'doubao', modelId: 'auto', thinkingLevel: null });
  });

  test('the qualified model is refused for a task until it is in the list, and nothing is created', async () => {
    provider('stub-gw', { id: 'fast-model', name: 'Fast' });
    frequent({ provider: 'devin', modelId: 'swe-2-1' });
    await expect(
      relay('create_todo', { ...ownerTodo('写文档'), model: 'stub-gw/fast-model' }),
    ).rejects.toThrow(/is enabled but not in 常用模型/);
    expect(H.s.db.select().from(todoTable).all()).toEqual([]);
  });

  test('a message the server never marked as owner-typed cannot add a model', async () => {
    enableDoubaoAuto();
    const messageId = ownerMessage('用豆包 Auto 跑一个任务', null);
    await expect(
      relay(
        'settings',
        { operation: 'addFavoriteModel', model: 'Auto', messageId, quote: '豆包 Auto' },
        { turnMessageIds: [messageId] },
      ),
    ).rejects.toThrow(/was not typed by the owner/);
    expect(frequentModels()).toEqual(['devin/swe-2-1']);
  });

  test('a message outside the current turn cannot add a model', async () => {
    enableDoubaoAuto();
    const messageId = ownerMessage('用豆包 Auto 跑一个任务', nowMs());
    await expect(
      relay(
        'settings',
        { operation: 'addFavoriteModel', model: 'Auto', messageId, quote: '豆包 Auto' },
        { turnMessageIds: [] },
      ),
    ).rejects.toThrow(/did not start this turn/);
    expect(frequentModels()).toEqual(['devin/swe-2-1']);
  });

  test('a negated or hypothetical mention asks instead of adding', async () => {
    enableDoubaoAuto();
    const messageId = ownerMessage('别用豆包 Auto，还是用 Devin', nowMs());
    await expect(
      relay(
        'settings',
        { operation: 'addFavoriteModel', model: 'Auto', messageId, quote: '豆包 Auto' },
        { turnMessageIds: [messageId] },
      ),
    ).rejects.toThrow(/do not plainly ask/);
    expect(frequentModels()).toEqual(['devin/swe-2-1']);
  });

  test('a quote that is not an exact part of the message is refused', async () => {
    enableDoubaoAuto();
    const messageId = ownerMessage('用豆包 Auto 跑一个任务', nowMs());
    await expect(
      relay(
        'settings',
        { operation: 'addFavoriteModel', model: 'Auto', messageId, quote: '用豆包 Auto 建个报表' },
        { turnMessageIds: [messageId] },
      ),
    ).rejects.toThrow(/not an exact part of message/);
  });
});

describe('a model the owner did not name goes through the approval card', () => {
  test('an unnamed model asks first, and only a page click on the card adds it', async () => {
    enableDoubaoAuto();
    const proposed = (await relay('settings', {
      operation: 'addFavoriteModel',
      model: 'doubao/auto',
    })) as { status: string; proposalId: string };
    expect(proposed.status).toBe('pending');
    expect(frequentModels()).toEqual(['devin/swe-2-1']);
    expect(pendingProposal(proposed.proposalId).actionId).toBe('settings.favorite-model.add');
    expect(await answerCard(proposed.proposalId, '不执行')).toHaveProperty('status', 200);
    expect(frequentModels()).toEqual(['devin/swe-2-1']);
    expect(pendingProposal(proposed.proposalId).status).toBe('refused');
  });

  test('a same-origin card click adds the model once and closes the proposal', async () => {
    enableDoubaoAuto();
    const proposed = (await relay('settings', {
      operation: 'addFavoriteModel',
      model: 'Auto',
    })) as { proposalId: string };
    const answered = await answerCard(proposed.proposalId, '批准执行');
    expect(answered.status).toBe(200);
    expect(frequentModels()).toEqual(['devin/swe-2-1', 'doubao/auto']);
    expect(pendingProposal(proposed.proposalId).status).toBe('executed');
    const again = (await relay('settings', {
      operation: 'addFavoriteModel',
      model: 'Auto',
    })) as { status?: string; added?: boolean; proposalId?: string };
    expect(again).toMatchObject({ added: false });
    expect(again.proposalId).toBeUndefined();
    expect(frequentModels()).toEqual(['devin/swe-2-1', 'doubao/auto']);
  });

  test('the generic proposal-answer route and a non-page card click cannot approve it', async () => {
    enableDoubaoAuto();
    const proposed = (await relay('settings', {
      operation: 'addFavoriteModel',
      model: 'Auto',
    })) as { proposalId: string };
    const generic = await req(
      H.s.app,
      'POST',
      `/api/actions/proposals/${proposed.proposalId}/answer`,
      {
        decision: 'allow-once',
      },
    );
    expect(generic.status).toBeGreaterThanOrEqual(400);
    const offPage = await answerCard(proposed.proposalId, '批准执行', false);
    expect(offPage.status).toBe(403);
    expect(frequentModels()).toEqual(['devin/swe-2-1']);
    expect(pendingProposal(proposed.proposalId).status).toBe('pending');
  });

  test('an expired card adds nothing', async () => {
    enableDoubaoAuto();
    const proposed = (await relay('settings', {
      operation: 'addFavoriteModel',
      model: 'Auto',
    })) as { proposalId: string };
    H.s.db
      .update(actionProposal)
      .set({ expiresAt: nowMs() - 1 })
      .where(eq(actionProposal.id, proposed.proposalId))
      .run();
    const answered = await answerCard(proposed.proposalId, '批准执行');
    expect(answered.status).toBe(409);
    expect(frequentModels()).toEqual(['devin/swe-2-1']);
  });

  test('the approval wake names the model and tells the Coordinator to continue', async () => {
    enableDoubaoAuto();
    const proposed = (await relay('settings', {
      operation: 'addFavoriteModel',
      model: 'Auto',
    })) as { proposalId: string };
    await answerCard(proposed.proposalId, '批准执行');
    const prompts = H.s.db.select({ prompt: stepTable.prompt }).from(stepTable).all();
    expect(prompts.some((row) => (row.prompt ?? '').includes('doubao/auto 加进常用模型'))).toBe(
      true,
    );
  });

  test('a queued task keeps its model after that model leaves the list', async () => {
    const machineId = enableDoubaoAuto();
    frequent({ provider: 'devin', modelId: 'swe-2-1' }, { provider: 'doubao', modelId: 'auto' });
    const created = (await relay('create_todo', {
      ...ownerTodo('在 Mac mini 上用豆包 Auto 跑一个只读任务'),
      machine: machineId,
      model: 'doubao/auto',
    })) as { id: string };
    frequent({ provider: 'devin', modelId: 'swe-2-1' });
    expect(
      H.s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get()?.request?.model,
    ).toEqual({ provider: 'doubao', modelId: 'auto', thinkingLevel: null });
  });

  test('a disabled model is refused before any card exists', async () => {
    provider('stub-gw', { id: 'fast-model', name: 'Fast' });
    frequent({ provider: 'devin', modelId: 'swe-2-1' });
    await expect(
      relay('settings', { operation: 'addFavoriteModel', model: 'stub-gw/missing-model' }),
    ).rejects.toThrow(/is not an enabled model/);
    expect(H.s.db.select().from(actionProposal).all()).toEqual([]);
  });
});

describe('the settings operation is narrow and idempotent', () => {
  test('an ambiguous display name lists the candidates and changes nothing', async () => {
    provider('alpha', { id: 'auto', name: 'Auto' });
    enableDoubaoAuto();
    await expect(
      relay('settings', { operation: 'addFavoriteModel', model: 'Auto' }),
    ).rejects.toThrow(/matches 2 models/);
    expect(frequentModels()).toEqual(['devin/swe-2-1']);
  });

  test('adding a model that is already listed is a no-op', async () => {
    enableDoubaoAuto();
    const messageId = ownerMessage('再用一次豆包 Auto', nowMs());
    await relay(
      'settings',
      { operation: 'addFavoriteModel', model: 'Auto', messageId, quote: '豆包 Auto' },
      { turnMessageIds: [messageId] },
    );
    const secondMessage = ownerMessage('再用豆包 Auto', nowMs());
    const second = (await relay(
      'settings',
      {
        operation: 'addFavoriteModel',
        model: 'Auto',
        messageId: secondMessage,
        quote: '豆包 Auto',
      },
      { turnMessageIds: [secondMessage] },
    )) as { added: boolean };
    expect(second.added).toBe(false);
    expect(frequentModels()).toEqual(['devin/swe-2-1', 'doubao/auto']);
  });

  test('the list keeps its order and unrelated entries', async () => {
    enableDoubaoAuto();
    provider('stub-gw', { id: 'fast-model', name: 'Fast' });
    frequent(
      { provider: 'stub-gw', modelId: 'fast-model' },
      { provider: 'devin', modelId: 'swe-2-1' },
    );
    const messageId = ownerMessage('用豆包 Auto', nowMs());
    await relay(
      'settings',
      { operation: 'addFavoriteModel', model: 'Auto', messageId, quote: '豆包 Auto' },
      { turnMessageIds: [messageId] },
    );
    expect(frequentModels()).toEqual(['stub-gw/fast-model', 'devin/swe-2-1', 'doubao/auto']);
  });

  test('an unknown operation is refused', async () => {
    await expect(relay('settings', { operation: 'setTheme', model: 'Auto' })).rejects.toThrow(
      /not supported/,
    );
  });

  test('an expressly named model appends against an empty list', async () => {
    enableDoubaoAuto();
    frequent();
    const messageId = ownerMessage('用豆包 Auto 跑一个只读任务', nowMs());
    const added = (await relay(
      'settings',
      { operation: 'addFavoriteModel', model: 'Auto', messageId, quote: '豆包 Auto' },
      { turnMessageIds: [messageId] },
    )) as { added: boolean };
    expect(added.added).toBe(true);
    expect(frequentModels()).toEqual(['doubao/auto']);
  });

  test('a stored list that cannot be parsed is never overwritten', async () => {
    enableDoubaoAuto();
    H.s.db
      .insert(teamTopModels)
      .values({ teamId: H.teamId, models: 'not json', updatedAt: nowMs() })
      .onConflictDoUpdate({
        target: teamTopModels.teamId,
        set: { models: 'not json', updatedAt: nowMs() },
      })
      .run();
    const messageId = ownerMessage('用豆包 Auto 跑一个只读任务', nowMs());
    await expect(
      relay(
        'settings',
        { operation: 'addFavoriteModel', model: 'Auto', messageId, quote: '豆包 Auto' },
        { turnMessageIds: [messageId] },
      ),
    ).rejects.toThrow(/损坏/);
    expect(
      H.s.db
        .select({ models: teamTopModels.models })
        .from(teamTopModels)
        .where(eq(teamTopModels.teamId, H.teamId))
        .get()?.models,
    ).toBe('not json');
  });

  test('a Settings save from a stale list is refused instead of overwriting the chat append', async () => {
    enableDoubaoAuto();
    const loaded = (await H.s.app.request(`/api/teams/${H.teamId}/top-models`)) as Response;
    const { updatedAt } = (await loaded.json()) as { updatedAt: number | null };
    const messageId = ownerMessage('用豆包 Auto 跑一个只读任务', nowMs());
    await relay(
      'settings',
      { operation: 'addFavoriteModel', model: 'Auto', messageId, quote: '豆包 Auto' },
      { turnMessageIds: [messageId] },
    );
    const stale = await H.s.app.request(`/api/teams/${H.teamId}/top-models`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({
        models: [{ provider: 'devin', modelId: 'swe-2-1', thinkingLevel: null }],
        updatedAt,
      }),
    });
    expect(stale.status).toBe(409);
    expect(frequentModels()).toEqual(['devin/swe-2-1', 'doubao/auto']);
  });
});

describe('an owner message that only mentions the model does not grant an add', () => {
  test('a statement or a longer word containing the id asks instead of adding', async () => {
    enableDoubaoAuto();
    provider('stub-automation', { id: 'automation', name: 'Automation' });
    const statement = ownerMessage('Automation 太慢了', nowMs());
    await expect(
      relay(
        'settings',
        {
          operation: 'addFavoriteModel',
          model: 'Automation',
          messageId: statement,
          quote: 'Automation',
        },
        { turnMessageIds: [statement] },
      ),
    ).rejects.toThrow(/do not plainly ask/);
    const longer = ownerMessage('用 myautomation 跑一个任务', nowMs());
    await expect(
      relay(
        'settings',
        {
          operation: 'addFavoriteModel',
          model: 'automation',
          messageId: longer,
          quote: 'automation',
        },
        { turnMessageIds: [longer] },
      ),
    ).rejects.toThrow(/do not plainly ask/);
    const opinion = ownerMessage('豆包 Auto 就是慢', nowMs());
    await expect(
      relay(
        'settings',
        { operation: 'addFavoriteModel', model: 'Auto', messageId: opinion, quote: '豆包 Auto' },
        { turnMessageIds: [opinion] },
      ),
    ).rejects.toThrow(/do not plainly ask/);
    const otherProblem = ownerMessage('还是 Auto 的问题', nowMs());
    await expect(
      relay(
        'settings',
        { operation: 'addFavoriteModel', model: 'Auto', messageId: otherProblem, quote: 'Auto' },
        { turnMessageIds: [otherProblem] },
      ),
    ).rejects.toThrow(/do not plainly ask/);
    expect(frequentModels()).toEqual(['devin/swe-2-1']);
  });

  test('switching to the named model in the owner words is permission', async () => {
    enableDoubaoAuto();
    const switchTo = ownerMessage('换成豆包 Auto 跑这个只读任务', nowMs());
    const added = (await relay(
      'settings',
      { operation: 'addFavoriteModel', model: 'Auto', messageId: switchTo, quote: '豆包 Auto' },
      { turnMessageIds: [switchTo] },
    )) as { added: boolean };
    expect(added.added).toBe(true);
  });
});

describe('the chat ingress marks only text the owner typed in their own window', () => {
  test('a same-origin composer send carries the marker, an unproven send does not', async () => {
    const send = async (headers: Record<string, string>) => {
      const res = await H.s.app.request(`/api/conversations/${H.threadId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ content: '用豆包 Auto 跑一个只读任务' }),
      });
      return (await res.json()) as { message: { id: string } };
    };
    const marked = await send({ 'sec-fetch-site': 'same-origin' });
    const plain = await send({});
    const markerOf = (id: string) =>
      H.s.db.select().from(chiefMessage).where(eq(chiefMessage.id, id)).get()?.ownerComposedAt;
    expect(markerOf(marked.message.id)).toEqual(expect.any(Number));
    expect(markerOf(plain.message.id) ?? null).toBeNull();
    const created = await H.s.app.request(`/api/teams/${H.teamId}/chief/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ content: '用豆包 Auto 跑一个只读任务' }),
    });
    expect(created.status).toBe(201);
    const threadMessage = (await created.json()) as {
      thread: { id: string };
      message: { id: string };
    };
    expect(markerOf(threadMessage.message.id)).toEqual(expect.any(Number));
    const turn = H.s.db
      .select()
      .from(stepTable)
      .all()
      .find((row) => row.kind === 'chief' && row.ownerMessageIds?.includes(marked.message.id));
    expect(turn).toBeDefined();
  });

  test('a Bearer-token client does not get the owner-composed marker', async () => {
    const token = 'owner-token-0123456789abcdef';
    const s = await bootServer({ authToken: token });
    try {
      seedRoute(s, 'coordinator');
      const created = await s.app.request(`/api/teams/${s.team.id}/chief/threads`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify({ content: '用豆包 Auto 跑一个只读任务' }),
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const body = (await created.json()) as { message: { id: string } };
      expect(
        s.db.select().from(chiefMessage).where(eq(chiefMessage.id, body.message.id)).get()
          ?.ownerComposedAt,
      ).toBeNull();
    } finally {
      s.dispose();
    }
  });
});
