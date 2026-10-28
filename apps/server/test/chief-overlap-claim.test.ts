import { claimedStepSchema } from '@cairn/shared';
import { expect, test } from 'vitest';
import { enqueueChiefStep } from '../src/services/chief.js';
import { AGENT_ID, H, registerChiefHarness } from './chief-harness.js';
import { bindAgentHome, issueApiKey, machineIdByName } from './helpers.js';

registerChiefHarness();

test.each(['user', 'settle'] as const)(
  'chief %s claims carry callable overlap instructions without changing the requested turn',
  async (trigger) => {
    const plain = await issueApiKey(H.s);
    const enrollment = await H.s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${plain}`, 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: H.teamId, name: 'overlap-claim', cliVersion: '0.1.0' }),
    });
    expect(enrollment.status).toBe(200);
    const { token } = (await enrollment.json()) as { token: string };
    bindAgentHome(H.s, AGENT_ID, machineIdByName(H.s, 'overlap-claim'));
    const prompt = 'Repeat pushes after temporary network failures.';
    enqueueChiefStep(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      H.threadId,
      { prompt, trigger },
    );
    const response = await H.s.app.request('/api/machine/tasks/claim', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { step: unknown };
    const claimed = claimedStepSchema.parse(body.step);
    expect(claimed.chief?.trigger).toBe(trigger);
    expect(claimed.instruction).toBe(trigger === 'user' ? prompt : `[wake:${trigger}] ${prompt}`);
    expect(claimed.chief?.systemPrompt).toContain('github_overlaps');
    expect(claimed.chief?.systemPrompt).toContain('open issues');
    expect(claimed.chief?.systemPrompt).toContain('same ask');
    expect(claimed.chief?.systemPrompt).not.toContain('node scripts/github-overlap.mjs');
    expect(claimed.remoteTools?.find((tool) => tool.name === 'github_overlaps')?.replaySafe).toBe(
      true,
    );
  },
);
