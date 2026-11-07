import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { step } from '../../src/db/schema.js';
import { boot, world } from './runner-world.js';

describe('Coordinator work beside the HTTP server', () => {
  it('keeps API p99 under 200 ms through a turn and its summarization', async () => {
    const w = await world(`context ${'lorem ipsum '.repeat(8_000)}`);
    const faux = fauxProvider({
      provider: 'stub',
      models: [{ id: 'm', contextWindow: 40_000 }],
      tokensPerSecond: 2_000,
    });
    let requests = 0;
    faux.setResponses(
      Array(6).fill(() => {
        requests++;
        return fauxAssistantMessage(`reply ${requests} ${'text '.repeat(80)}`);
      }),
    );
    const coordinator = boot(w, faux);
    const samples: number[] = [];
    let running = true;
    const probe = (async () => {
      while (running) {
        const started = performance.now();
        const res = await w.s.app.request(`/api/teams/${w.teamId}/chief/threads`);
        await res.text();
        samples.push(performance.now() - started);
        await new Promise((r) => setTimeout(r, 1));
      }
    })();

    coordinator.wake(w.threadId);
    await coordinator.idle();
    running = false;
    await probe;

    expect(w.s.db.select().from(step).get()?.status).toBe('done');
    expect(requests).toBeGreaterThanOrEqual(2);
    expect(samples.length).toBeGreaterThan(10);
    const sorted = [...samples].sort((a, b) => a - b);
    const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;
    expect(p99).toBeLessThan(200);
  });
});
