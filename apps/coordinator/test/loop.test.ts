import { describe, expect, it } from 'vitest';
import { chiefStep, fakeMachineApi } from '../../server/test/coordinator/fake-machine-api.js';
import { claimLoop } from '../src/loop.js';

describe('claimLoop', () => {
  it('runs claimed turns in order and backs off after errors', async () => {
    const api = fakeMachineApi();
    api.queue.push(chiefStep('a', 'one'), chiefStep('b', 'two'));
    const ran: string[] = [];
    const sleeps: number[] = [];
    let calls = 0;
    const realClaim = api.claim;
    api.claim = async () => {
      calls += 1;
      if (calls === 2) throw new Error('server restarting');
      return realClaim();
    };
    await claimLoop({
      api,
      runTurn: async (claimed) => {
        ran.push(claimed.step.id);
        return { status: 'success' };
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      log: () => {},
      stopped: () => calls >= 5,
    });
    expect(ran).toEqual(['a', 'b']);
    expect(sleeps).toEqual([1000]);
  });
});
