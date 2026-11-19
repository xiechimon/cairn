import { type ToolCallRecord, toolCallRecordSchema } from '@cairn/shared';
import {
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type JsonObject,
} from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  actionJournal,
  actionProposal,
  chiefMessage,
  mcpConnector,
  step,
  team as teamTable,
} from '../../src/db/schema.js';
import { fakeMcp, insertConnector } from '../fake-mcp-connector.js';
import { req, type TestServer } from '../helpers.js';
import { boot, KEY, type World, world } from './runner-world.js';

function toolCallRecords(s: TestServer): ToolCallRecord[] {
  return s.db
    .select()
    .from(chiefMessage)
    .all()
    .map((row) => row.content)
    .flatMap((content) => {
      if (typeof content !== 'object' || content === null || !('call' in content)) return [];
      const parsed = toolCallRecordSchema.safeParse(content.call);
      return parsed.success ? [parsed.data] : [];
    });
}

function scriptedTurn(calls: Record<number, () => ReturnType<typeof fauxAssistantMessage>>) {
  const faux = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: 200_000 }],
    tokensPerSecond: 1e9,
  });
  let generation = 0;
  const responses: FauxResponseStep[] = Array(8).fill(() => {
    generation += 1;
    return calls[generation]?.() ?? fauxAssistantMessage('Done.');
  });
  faux.setResponses(responses);
  return faux;
}

const sayDone = () => fauxAssistantMessage('Done.');

const callConnector = (name: string, args: JsonObject) =>
  fauxAssistantMessage([fauxToolCall('call_tool', { name, arguments: args })], {
    stopReason: 'toolUse',
  });

async function runTurn(w: World, coordinator: ReturnType<typeof boot>) {
  coordinator.wake(w.threadId);
  await coordinator.idle();
}

describe('in-server Coordinator connector path', () => {
  it('dispatches an offered connector tool through the broker to its MCP upstream', async () => {
    const mcp = fakeMcp();
    const w = await world('check the inbox', KEY, { mcpFetch: mcp.fetch });
    insertConnector(w.s);
    const faux = scriptedTurn({
      1: () => callConnector('connector_gmail__GMAIL_FETCH', { max: 5 }),
    });
    const coordinator = boot(w, faux);

    await runTurn(w, coordinator);

    expect(mcp.calls).toMatchObject([{ name: 'GMAIL_FETCH', args: { max: 5 } }]);
    const record = toolCallRecords(w.s).find(
      (call) =>
        call.name === 'call_tool' &&
        (call.arguments as { name?: string }).name === 'connector_gmail__GMAIL_FETCH',
    );
    expect(record?.isError ?? false).toBe(false);
    expect(JSON.stringify(record?.result)).toContain('inbox-ok');
    expect(w.s.db.select().from(step).where(eq(step.id, w.stepId)).get()?.status).toBe('done');
    expect(w.s.db.select().from(actionJournal).all()).toMatchObject([
      { actionId: 'connector.gmail.GMAIL_FETCH', targetId: 'gmail', kind: 'run' },
    ]);
  }, 30_000);

  it('parks an unapproved connector call under guarded autonomy without touching the upstream', async () => {
    const mcp = fakeMcp();
    const w = await world('delete the mail', KEY, { mcpFetch: mcp.fetch });
    insertConnector(w.s);
    w.s.db.update(teamTable).set({ actionTier: 'guarded' }).run();
    const faux = scriptedTurn({
      1: () => callConnector('connector_gmail__GMAIL_DELETE', { id: 'm1' }),
      2: sayDone,
    });
    const coordinator = boot(w, faux);

    await runTurn(w, coordinator);

    expect(mcp.calls).toHaveLength(0);
    expect(w.s.db.select().from(actionProposal).all()).toMatchObject([
      { actionId: 'connector.gmail.GMAIL_DELETE', status: 'pending' },
    ]);
    const record = toolCallRecords(w.s).find(
      (call) =>
        call.name === 'call_tool' &&
        (call.arguments as { name?: string }).name === 'connector_gmail__GMAIL_DELETE',
    );
    expect(JSON.stringify(record?.result)).toContain('pending');
    expect(w.s.db.select().from(step).where(eq(step.id, w.stepId)).get()?.status).toBe('done');
  }, 30_000);

  it('lets the broker, not the stale offer, reject a connector that left connected', async () => {
    const mcp = fakeMcp();
    const w = await world('one', KEY, { mcpFetch: mcp.fetch });
    const connectorId = insertConnector(w.s);
    const faux = scriptedTurn({
      2: () => callConnector('connector_gmail__GMAIL_FETCH', {}),
      3: sayDone,
    });
    const coordinator = boot(w, faux);
    await runTurn(w, coordinator);

    w.s.db
      .update(mcpConnector)
      .set({ status: 'needs_auth' })
      .where(eq(mcpConnector.id, connectorId))
      .run();
    const again = await req(w.s.app, 'POST', `/api/conversations/${w.threadId}/messages`, {
      content: 'two',
    });
    expect(again.status).toBe(201);
    await runTurn(w, coordinator);

    expect(mcp.calls).toHaveLength(0);
    const record = toolCallRecords(w.s).find(
      (call) =>
        call.name === 'call_tool' &&
        (call.arguments as { name?: string }).name === 'connector_gmail__GMAIL_FETCH',
    );
    expect(record?.isError).toBe(true);
    expect(JSON.stringify(record?.result)).toContain('needs_auth');
    expect(
      w.s.db
        .select()
        .from(step)
        .all()
        .map((row) => row.status),
    ).toEqual(['done', 'done']);
  }, 30_000);
});
