import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it } from 'vitest';
import { openCoordinatorHarness } from '../../src/coordinator/runtime/harness.js';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
import {
  readThreadRows,
  SEED_ROW_MAX_CHARS,
  seedCoordinator,
  seedMessages,
} from '../../src/coordinator/runtime/seed.js';

const ctx = BACKGROUND_CONTEXT;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'coord-seed-'));
  dirs.push(dir);
  return dir;
}

function serverDb(dir: string): string {
  const path = join(dir, 'server.db');
  const db = new DatabaseSync(path);
  db.exec(
    'create table chief_message (id text primary key, threadId text, role text, content text, createdAt integer, projectId text)',
  );
  const insert = db.prepare('insert into chief_message values (?, ?, ?, ?, ?, null)');
  insert.run('old', 't1', 'user', JSON.stringify('folded already'), 10);
  insert.run('u1', 't1', 'user', JSON.stringify('[wake:failed] build 7 failed'), 20);
  insert.run('a1', 't1', 'assistant', JSON.stringify([{ type: 'text', text: 'looking' }]), 21);
  insert.run(
    'c1',
    't1',
    'assistant',
    JSON.stringify({
      kind: 'toolcall',
      call: { id: 'c1', name: 'todos', arguments: { q: 1 }, result: 'HUGE' },
    }),
    22,
  );
  insert.run(
    'a2',
    't1',
    'assistant',
    JSON.stringify([{ type: 'text', text: 'x'.repeat(SEED_ROW_MAX_CHARS + 50) }]),
    23,
  );
  insert.run('s1', 't1', 'system', JSON.stringify({ kind: 'skill_injection_check' }), 24);
  insert.run('other', 't2', 'user', JSON.stringify('another thread'), 25);
  db.close();
  return path;
}

describe('seeding the Coordinator store from the C2 summary', () => {
  it('reads only the thread rows after the summary, oldest first', () => {
    const rows = readThreadRows(serverDb(tempDir()), 't1', 10);
    expect(rows.map((r) => r.id)).toEqual(['u1', 'a1', 'c1', 'a2']);
  });

  it('renders rows like C3: events tagged, tool calls without results, long rows cut with a read_history pointer', () => {
    const messages = seedMessages(readThreadRows(serverDb(tempDir()), 't1', 10));
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0]?.text).toBe('[event] build 7 failed');
    expect(messages[1]?.text).toContain('looking\n\n[called todos {"q":1}]');
    expect(messages[1]?.text).not.toContain('HUGE');
    expect(messages[1]?.text).toContain('read_history ids ["a2"]');
  });

  it('writes the summary as the head of the context and refuses to seed twice', async () => {
    const dir = tempDir();
    const faux = fauxProvider({ provider: 'stub', models: [{ id: 'm', contextWindow: 200_000 }] });
    faux.setResponses([fauxAssistantMessage('ok')]);
    const models = createCoordinatorModels([faux.provider]);
    const harness = await openCoordinatorHarness(join(dir, 'c.sqlite'), models.models, ctx);
    const rows = readThreadRows(serverDb(dir), 't1', 10);
    await seedCoordinator(
      harness,
      'D56: keep the step claim',
      rows,
      { provider: 'stub', modelId: 'm' },
      ctx,
    );
    const view = await (await harness.root(ctx)).context(ctx);
    const first = view.messages[0];
    expect(first?.role).toBe('user');
    expect(JSON.stringify(first?.content)).toContain(
      '<summary>\\nD56: keep the step claim\\n</summary>',
    );
    expect(view.messages.map((m) => m.role)).toEqual(['user', 'user', 'assistant']);
    await expect(
      seedCoordinator(harness, 'again', rows, { provider: 'stub', modelId: 'm' }, ctx),
    ).rejects.toThrow(/already holds a conversation/);
    await harness.close(ctx);
  });
});
