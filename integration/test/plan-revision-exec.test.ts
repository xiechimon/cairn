import { createServer } from 'node:http';
import { buildReplanPrompt, conversationBranch } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { project as projectTable } from '../../apps/server/src/db/schema.js';
import { repoDirFor } from '../../apps/server/src/services/git.js';
import {
  bootStack,
  disposeLeftovers,
  type RosterAgent,
  resetTurnState,
  type SeededWorld,
  type Stack,
  seedWorld,
} from '../eval/chief-dispatch/stack.mts';
import {
  createPlanningBuild,
  driveRevisionTurn,
  latestPlanContent,
  planFileAt,
  planVersions,
  seedPriorPlan,
} from '../eval/plan/revision-arm.mts';
import { gradeRevisionCase } from '../eval/plan/revision-grade.mts';

const ROSTER: RosterAgent[] = [
  {
    key: 'code',
    displayName: 'Code',
    modelId: 'glm-5.3',
    description: 'Owns server, daemon, and shared package implementation and fixes.',
  },
];

const PRIOR_PLAN = [
  '## Context',
  'Kind: fix',
  'Safari ignores the download attribute on a blob URL, so the export silently does nothing.',
  '',
  '## Changes',
  'Append more logging around the download path.',
  '',
  '## Edge cases',
  '- Empty export payload.',
  '',
  '## Verification',
  '- `apps/web/e2e/export-download.spec.ts` passes',
].join('\n');

const REVISED_PLAN = [
  '## Context',
  'Kind: fix',
  'Safari ignores the download attribute on a blob URL, so the export silently does nothing.',
  '',
  '## Changes',
  'Replace the download attribute with a blob URL plus an explicit anchor click.',
  '',
  '## Edge cases',
  '- Empty export payload.',
  '',
  '## Verification',
  '- `apps/web/e2e/export-download.spec.ts` passes',
].join('\n');

const FEEDBACK =
  'Find the cause. It is the download attribute on a blob URL, and adding logging does not fix it. Keep the existing verification step.';

const CASE = {
  id: 'revision-exec-001',
  tags: ['revision'],
  prompt: 'Export button does nothing on Safari.',
  priorPlan: PRIOR_PLAN,
  feedback: FEEDBACK,
  expect: {
    kind: 'revision' as const,
    defect: ['download attribute', 'blob url'],
    drop: ['logging'],
    keep: ['export-download.spec.ts'],
    minPlanChars: 120,
  },
};

const sse = (payload: object): string => `data: ${JSON.stringify(payload)}\n\n`;

function planWriteStream(plan: string): string {
  const base = { id: 'stub-plan', object: 'chat.completion.chunk', created: 0, model: 'glm-5.3' };
  return (
    sse({
      ...base,
      choices: [{ index: 0, delta: { role: 'assistant', content: plan }, finish_reason: null }],
    }) +
    sse({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
    }) +
    'data: [DONE]\n\n'
  );
}

async function listenStub(
  respond: (body: string) => string,
): Promise<{ url: string; calls: string[]; close: () => Promise<void> }> {
  const calls: string[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    for await (const chunk of request) body += String(chunk);
    calls.push(body);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(respond(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('stub has no port');
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function userPrompts(body: string): string[] {
  const parsed = JSON.parse(body) as { messages?: { role?: string; content?: unknown }[] };
  return (parsed.messages ?? [])
    .filter((row) => row.role === 'user')
    .map((row) => {
      if (typeof row.content === 'string') return row.content;
      if (!Array.isArray(row.content)) return '';
      return row.content
        .map((part) =>
          typeof part === 'object' && part !== null && 'text' in part
            ? String((part as { text: unknown }).text)
            : '',
        )
        .join('');
    });
}

function projectRepo(stack: Stack, projectId: string): string {
  const row = stack.server.db.select({ repoName: projectTable.repoName }).from(projectTable).get();
  if (!row?.repoName) throw new Error(`project ${projectId} has no repoName`);
  return repoDirFor(stack.server.reposDir, stack.server.teamId, row.repoName);
}

afterEach(() => {
  disposeLeftovers();
});

async function withWorld(
  relay: string,
  body: (stack: Stack, world: SeededWorld) => Promise<void>,
): Promise<void> {
  const stack = await bootStack();
  try {
    const world = await seedWorld(stack, {
      relayBaseUrl: relay,
      relayKey: 'nonsecret-plan-revision',
      roster: ROSTER,
      chiefModelId: 'glm-5.3',
    });
    resetTurnState(stack);
    await body(stack, world);
  } finally {
    await stack.close();
  }
}

describe('plan revision through the real build step path', () => {
  test('the prior plan is agent-visible state and the rejection feedback arrives as the replan prompt', async () => {
    const stub = await listenStub((body) => {
      const last = userPrompts(body).at(-1) ?? '';
      return planWriteStream(last.startsWith('Find the cause') ? REVISED_PLAN : PRIOR_PLAN);
    });
    try {
      await withWorld(stub.url, async (stack, world) => {
        const { buildId } = await createPlanningBuild(stack, world, {
          title: 'Fix the Safari export download',
          spec: 'The export button does nothing on Safari. Ship it with a regression test.',
        });
        await seedPriorPlan(stack, {
          projectId: world.projectId,
          buildId,
          priorPlan: PRIOR_PLAN,
        });

        expect(planVersions(stack, buildId)).toEqual([1]);
        expect(latestPlanContent(stack, buildId)).toBe(PRIOR_PLAN);

        const repo = projectRepo(stack, world.projectId);
        const branch = conversationBranch(buildId);
        expect(planFileAt(repo, branch)?.trim()).toBe(PRIOR_PLAN.trim());

        const arm = await driveRevisionTurn(stack, {
          projectId: world.projectId,
          buildId,
          arms: { priorPlan: PRIOR_PLAN, feedback: FEEDBACK },
          timeoutMs: 180_000,
        });

        expect(arm.rejection.priorPlanVersion).toBe(1);
        expect(arm.revision.planVersions).toEqual([1, 2]);

        const delivered = stub.calls.flatMap(userPrompts);
        const replanPrompt = buildReplanPrompt(FEEDBACK);
        expect(delivered.some((prompt) => prompt.includes(replanPrompt))).toBe(true);
        expect(delivered.some((prompt) => prompt.includes(FEEDBACK))).toBe(true);
      });
    } finally {
      await stub.close();
    }
  }, 300_000);
});

describe('paired revision run', () => {
  test('the feedback arm revises and the no-feedback control fails the same requirements', async () => {
    const stub = await listenStub((body) => {
      const sawFeedback = userPrompts(body).some((prompt) => prompt.includes('Find the cause'));
      return planWriteStream(sawFeedback ? REVISED_PLAN : PRIOR_PLAN);
    });
    try {
      const world = await seedWorldForArms(stub.url);
      expect(world.arms).toHaveLength(2);
      const [feedbackArm, controlArm] = world.arms;
      if (feedbackArm === undefined || controlArm === undefined)
        throw new Error('the paired run returned fewer than two arms');
      for (const arm of [feedbackArm, controlArm]) {
        expect(arm.rejection.priorPlanVersion).toBe(1);
        expect(arm.rejection.phase).toBe('confirm');
        expect(arm.revision.planVersions).toEqual([1, 2]);
        expect(arm.revision.stepStatus).toBe('done');
        expect(arm.revision.usage.input).toBeGreaterThan(0);
        expect(arm.revision.usage.output).toBeGreaterThan(0);
      }

      const feedbackPrompts = feedbackPromptsDelivered(stub.calls);
      expect(feedbackPrompts.some((prompt) => prompt.includes(FEEDBACK))).toBe(true);
      expect(feedbackPrompts.filter((prompt) => prompt.includes(FEEDBACK))).toHaveLength(1);
      expect(feedbackArm.revision.prompt ?? '').toContain(FEEDBACK.slice(0, 40));
      expect(controlArm.revision.prompt ?? '').not.toContain(FEEDBACK.slice(0, 40));

      const sameReasoningBothWays = gradeRevisionCase(CASE, {
        feedbackArm: { planContent: REVISED_PLAN, stepStatus: 'done' },
        controlArm: { planContent: PRIOR_PLAN, stepStatus: 'done' },
      });
      expect(sameReasoningBothWays.grade.revision_ok).toBe(1);
      expect(sameReasoningBothWays.grade.control_flipped).toBe(1);
    } finally {
      await stub.close();
    }
  }, 300_000);
});

function feedbackPromptsDelivered(calls: string[]): string[] {
  return calls.flatMap(userPrompts);
}

async function runArmInFreshWorld(
  relay: string,
  withholdFeedback: boolean,
): Promise<Awaited<ReturnType<typeof driveRevisionTurn>>> {
  const stack = await bootStack();
  try {
    const world = await seedWorld(stack, {
      relayBaseUrl: relay,
      relayKey: 'nonsecret-plan-revision',
      roster: ROSTER,
      chiefModelId: 'glm-5.3',
    });
    resetTurnState(stack);
    const created = await createPlanningBuild(stack, world, {
      title: 'Fix the Safari export download',
      spec: 'The export button does nothing on Safari. Ship it with a regression test.',
    });
    await seedPriorPlan(stack, {
      projectId: world.projectId,
      buildId: created.buildId,
      priorPlan: PRIOR_PLAN,
    });
    return await driveRevisionTurn(stack, {
      projectId: world.projectId,
      buildId: created.buildId,
      arms: { priorPlan: PRIOR_PLAN, feedback: FEEDBACK },
      timeoutMs: 180_000,
      withholdFeedback,
    });
  } finally {
    await stack.close();
  }
}

async function seedWorldForArms(relay: string) {
  const arms = [];
  for (const withholdFeedback of [false, true]) {
    arms.push(await runArmInFreshWorld(relay, withholdFeedback));
  }
  return { arms };
}
