import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { secret, step } from '../../src/db/schema.js';
import { req } from '../helpers.js';
import { boot, stub, world } from './runner-world.js';

const SENTINEL = 'sk-live-sentinel-5384-b7c1e9f04a';
const NAME = 'ACME_API_KEY';

function everyStoredRow(w: Awaited<ReturnType<typeof world>>): string {
  const tables = w.s.db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table'`,
  );
  expect(tables.map(({ name }) => name)).toEqual(
    expect.arrayContaining(['chief_message', 'secret', 'step']),
  );
  return JSON.stringify(tables.map(({ name }) => w.s.db.all(sql.raw(`SELECT * FROM "${name}"`))));
}

describe('request_secret in a Coordinator turn', () => {
  it('stores the pasted value sealed and keeps it out of the model messages, the transcript and the logs', async () => {
    const w = await world('set up the Acme integration');
    const { faux } = stub('unused');
    const nextRequests: unknown[] = [];
    faux.setResponses([
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall('request_secret', {
              name: NAME,
              scope: 'team',
              description: 'The Acme API key the integration calls with.',
            }),
          ],
          { stopReason: 'toolUse' },
        ),
      (context: { systemPrompt?: string; messages: unknown[] }) => {
        nextRequests.push(context);
        return fauxAssistantMessage('Saved, continuing.');
      },
    ]);
    const lines: string[] = [];
    const sink = (obj: object, message: string) => lines.push(`${JSON.stringify(obj)} ${message}`);
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });
    const coordinator = boot(w, faux, { logger: { info: sink, warn: sink, error: sink } });

    coordinator.wake(w.threadId);
    await vi.waitFor(
      async () => {
        const res = await req(w.s.app, 'POST', `/api/teams/${w.teamId}/secret-requests`, {
          decision: 'save',
          name: NAME,
          projectId: null,
          value: SENTINEL,
        });
        expect(res.status).toBe(200);
        const body = await res.text();
        expect(JSON.parse(body)).toEqual({ name: NAME });
      },
      { timeout: 10_000, interval: 50 },
    );
    await coordinator.idle();
    vi.restoreAllMocks();

    expect(
      w.s.db
        .select()
        .from(step)
        .all()
        .map((row) => row.status),
    ).toEqual(['done']);
    expect(nextRequests).toHaveLength(1);
    const modelSaw = JSON.stringify(nextRequests);
    expect(modelSaw).toContain('request_secret');
    expect(modelSaw).toContain(`The owner saved ${NAME}`);
    expect(modelSaw).not.toContain(SENTINEL);
    expect(everyStoredRow(w)).not.toContain(SENTINEL);
    expect(lines.join('\n')).not.toContain(SENTINEL);

    const row = w.s.db
      .select()
      .from(secret)
      .where(and(eq(secret.name, NAME), isNull(secret.projectId)))
      .get();
    expect(row?.valueCipher).toBeTruthy();
    expect(w.s.secretBox.open(row!.valueCipher!)).toBe(SENTINEL);
  });
});
