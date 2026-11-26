import { DatabaseSync } from 'node:sqlite';
import { CHIEF_TURN_STOPPED_KIND, dropMailFence, shortEvent } from '@cairn/shared';
import type { Context } from '@earendil-works/chord/context';
import type { Message } from '@earendil-works/pi-ai';
import { AssistantEntry, type Harness, UserEntry } from '@earendil-works/pi-durable';
import { stoppedNote } from './stopped-turn.js';

export const SEED_MAX_ROWS = 100;
export const SEED_ROW_MAX_CHARS = 8_000;
const TOOL_ARGS_CHARS = 200;

export interface SeedRow {
  id: string;
  role: string;
  content: string;
  createdAt: number;
  stoppedRequests?: readonly (string | null)[];
}

function blocksText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .flatMap((block) =>
      block !== null &&
      typeof block === 'object' &&
      'text' in block &&
      typeof block.text === 'string'
        ? [block.text]
        : [],
    )
    .join('\n');
}

export function seedMessageText(row: SeedRow): { role: 'user' | 'assistant'; text: string } | null {
  let content: unknown;
  try {
    content = JSON.parse(row.content);
  } catch {
    content = row.content;
  }
  let role: 'user' | 'assistant';
  let text: string;
  if (content !== null && typeof content === 'object' && !Array.isArray(content)) {
    const { kind, call } = content as {
      kind?: unknown;
      call?: { name?: unknown; arguments?: unknown };
    };
    if (kind === CHIEF_TURN_STOPPED_KIND)
      return row.stoppedRequests?.length
        ? { role: 'assistant', text: stoppedNote(row.stoppedRequests) }
        : null;
    if (kind !== 'toolcall' || typeof call?.name !== 'string') return null;
    role = 'assistant';
    text = `[called ${call.name} ${JSON.stringify(call.arguments ?? {}).slice(0, TOOL_ARGS_CHARS)}]`;
  } else {
    text = blocksText(content).trim();
    if (text === '' || text.startsWith('{')) return null;
    if (row.role === 'assistant') role = 'assistant';
    else if (row.role === 'user') {
      role = 'user';
      text = shortEvent(text, row.id) ?? text;
    } else return null;
    text = dropMailFence(text);
  }
  if (text.length > SEED_ROW_MAX_CHARS) {
    text = `${text.slice(0, SEED_ROW_MAX_CHARS)}\n[cut: ${text.length} characters in all; read_history ids ["${row.id}"] offset ${SEED_ROW_MAX_CHARS} reads on]`;
  }
  return { role, text };
}

export function seedMessages(
  rows: readonly SeedRow[],
): { role: 'user' | 'assistant'; text: string }[] {
  const out: { role: 'user' | 'assistant'; text: string }[] = [];
  for (const row of rows) {
    const message = seedMessageText(row);
    if (message === null) continue;
    const last = out.at(-1);
    if (last?.role === message.role) last.text = `${last.text}\n\n${message.text}`;
    else out.push({ ...message });
  }
  while (out[0]?.role === 'assistant') out.shift();
  return out;
}

export function readThreadRows(dbPath: string, threadId: string, after: number): SeedRow[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `select id, role, content, createdAt from chief_message
         where threadId = ? and role != 'system' and createdAt > ?
           and id not like 'chief-digest-%' and id not like 'chief-report-%'
         order by createdAt desc, rowid desc limit ?`,
      )
      .all(threadId, after, SEED_MAX_ROWS) as unknown as SeedRow[];
    return rows.reverse();
  } finally {
    db.close();
  }
}

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export async function seedCoordinator(
  harness: Harness,
  rows: readonly SeedRow[],
  model: { provider: string; modelId: string },
  context: Context,
): Promise<{ messages: number }> {
  const root = await harness.root(context, { agent: { model } });
  const existing = await root.entries({}, 1, undefined, context);
  if (existing.items.length > 0)
    throw new Error('the Coordinator store already holds a conversation');
  const messages = seedMessages(rows);
  const now = Date.now();
  await root.commit(async (tx) => {
    for (const message of messages) {
      if (message.role === 'user')
        await tx.appendEntry(UserEntry, root.id, {
          model: [{ role: 'user', content: message.text, timestamp: now } satisfies Message],
        });
      else
        await tx.appendEntry(AssistantEntry, root.id, {
          model: [
            {
              role: 'assistant',
              content: [{ type: 'text', text: message.text }],
              api: 'anthropic-messages',
              provider: model.provider,
              model: model.modelId,
              usage,
              stopReason: 'stop',
              timestamp: now,
            } satisfies Message,
          ],
        });
    }
  }, context);
  return { messages: messages.length };
}
