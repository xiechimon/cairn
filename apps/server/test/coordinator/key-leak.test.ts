import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { chiefMessage, step } from '../../src/db/schema.js';
import { boot, KEY, stub, world } from './runner-world.js';

describe('Coordinator provider key', () => {
  it('appears in no row and no log line after a failing turn', async () => {
    const w = await world('fail please');
    const { faux } = stub('unused');
    faux.setResponses(
      Array(4).fill(() =>
        fauxAssistantMessage([], {
          stopReason: 'error',
          errorMessage: `401 incorrect API key provided: ${KEY}`,
        }),
      ),
    );
    const lines: string[] = [];
    const sink = (obj: object, message: string) => lines.push(`${JSON.stringify(obj)} ${message}`);
    const coordinator = boot(w, faux, { logger: { info: sink, warn: sink, error: sink } });

    coordinator.wake(w.threadId);
    await coordinator.idle();

    const steps = w.s.db.select().from(step).all();
    expect(steps.map((r) => r.status)).toEqual(['failed']);
    const rows = JSON.stringify([steps, w.s.db.select().from(chiefMessage).all()]);
    expect(rows).toContain('Coordinator turn ended');
    expect(rows).not.toContain(KEY);
    expect(lines.join('\n')).not.toContain(KEY);
  });
});
