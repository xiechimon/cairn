import { describe, expect, test } from 'vitest';
import {
  build,
  chiefMessage,
  chiefTurnUsage,
  message,
  project,
  step,
  team,
  todo,
  todoTransition,
  tokenUsage,
} from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import { H, registerChiefHarness, relay } from './chief-harness.js';

registerChiefHarness();

const fakeKey = `sk-${'q'.repeat(28)}`;
const modelMissing = `404: {"message":"Model \\"glm-5.3\\" is not supported by any configured account in this group","type":"model_not_found"} key=${fakeKey}`;

function seedFailedBuild(teamId: string, projectId: string, suffix: string) {
  const now = nowMs();
  H.s.db
    .insert(todo)
    .values({
      id: `todo-${suffix}`,
      teamId,
      projectId,
      title: 'inspect me',
      phaseAt: now,
      seqNum: 7000 + suffix.length,
      latestBuildId: `build-${suffix}`,
    })
    .run();
  H.s.db
    .insert(build)
    .values({
      id: `build-${suffix}`,
      todoId: `todo-${suffix}`,
      withPlan: false,
      triggerSource: 'user',
      errorMessage: modelMissing,
      createdAt: now - 60_000,
    })
    .run();
  H.s.db
    .insert(step)
    .values({
      id: `step-${suffix}`,
      buildId: `build-${suffix}`,
      kind: 'build',
      status: 'failed',
      createdAt: now - 60_000,
      finishedAt: now - 30_000,
      fallback: {
        model: { provider: 'relay', modelId: 'glm-5.3' },
        tried: ['vani/sonnet', 'relay/glm-5.3'],
        zeroUsageRetried: false,
      },
    })
    .run();
  H.s.db
    .insert(message)
    .values({
      id: `call-${suffix}`,
      conversationId: `build-${suffix}`,
      role: 'assistant',
      content: {
        kind: 'toolcall',
        call: { name: 'Bash', arguments: { cmd: 'ls' }, isError: true },
      },
      createdAt: now - 40_000,
    })
    .run();
  H.s.db
    .insert(tokenUsage)
    .values({ buildId: `build-${suffix}`, model: 'relay/glm-5.3', input: 1200, costTotal: 0.25 })
    .run();
}

describe('inspect_run', () => {
  test('a task id resolves to its latest build, names the cause with redacted evidence, and stays inside the team', async () => {
    seedFailedBuild(H.teamId, H.projectId, 'mine');
    H.s.db.insert(team).values({ id: 'team-other', name: 'Other', createdAt: 1 }).run();
    H.s.db
      .insert(project)
      .values({ id: 'project-other', name: 'other', teamId: 'team-other' })
      .run();
    seedFailedBuild('team-other', 'project-other', 'theirs');
    H.s.db
      .insert(todoTransition)
      .values({
        id: 'transition-mine',
        todoId: 'todo-mine',
        fromPhase: 'queued',
        toPhase: 'failed',
        cause: null,
        at: 1,
      })
      .run();

    const body = (await relay('inspect_run', { id: 'todo-mine' })) as Record<string, unknown>;
    expect(body).toMatchObject({
      kind: 'build',
      build: { id: 'build-mine' },
      cause: 'model-config',
      steps: [{ id: 'step-mine', status: 'failed', fallback: { model: 'relay/glm-5.3' } }],
      recentToolCalls: [{ name: 'Bash', isError: true }],
      phaseHistory: [{ from: 'queued', to: 'failed', cause: null }],
      usage: { costTotal: 0.25 },
      trust: 'untrusted-run-record',
    });
    const evidence = (body.evidence as { text: string }).text;
    expect(evidence).toContain('is not supported by any configured account');
    expect(JSON.stringify(body)).not.toContain(fakeKey);

    for (const id of ['todo-theirs', 'build-theirs', 'step-theirs', 'no-such-run']) {
      await expect(relay('inspect_run', { id })).rejects.toMatchObject({
        status: 404,
        message: `run ${id}`,
      });
    }
  });

  test('a Coordinator thread shows its failed turn with time to first token', async () => {
    const now = nowMs();
    H.s.db
      .insert(step)
      .values([
        {
          id: 'turn-ok',
          buildId: H.threadId,
          kind: 'chief',
          status: 'done',
          createdAt: now - 9000,
        },
        {
          id: 'turn-bad',
          buildId: H.threadId,
          kind: 'chief',
          status: 'failed',
          createdAt: now - 1000,
        },
      ])
      .run();
    H.s.db
      .insert(chiefMessage)
      .values({
        id: 'chief-err-turn-bad',
        threadId: H.threadId,
        role: 'system',
        content: JSON.stringify({ kind: 'chief_turn_error', message: 'Connection error.' }),
        createdAt: now,
      })
      .run();
    H.s.db
      .insert(chiefTurnUsage)
      .values({
        stepId: 'turn-ok',
        threadId: H.threadId,
        model: 'stub-gw/stub-model',
        input: 50,
        ttftMs: 1834,
        createdAt: now - 8000,
      })
      .run();

    const body = (await relay('inspect_run', { id: H.threadId })) as {
      cause: string;
      evidence: { text: string };
      turns: { id: string; cause: string; usage: { ttftMs: number | null }[] }[];
    };
    expect(body.cause).toBe('provider-network');
    expect(body.evidence.text).toBe('Connection error.');
    expect(body.turns.map((t) => [t.id, t.cause])).toEqual([
      ['turn-bad', 'provider-network'],
      ['turn-ok', 'done'],
    ]);
    expect(body.turns[1]?.usage[0]?.ttftMs).toBe(1834);
  });

  test('redacts secrets before clipping across the 400-char line boundary and 160-char tool-args boundary', async () => {
    const now = nowMs();
    const skKey = `sk-${'k'.repeat(28)}`;
    const ghpKey = `ghp_${'p'.repeat(36)}`;
    const linePrefix = 'x'.repeat(388);
    const tailPrefix = 'z'.repeat(395);
    const cmdPrefix = 'y'.repeat(140);

    H.s.db
      .insert(todo)
      .values({
        id: 'todo-clip',
        teamId: H.teamId,
        projectId: H.projectId,
        title: 'clip redaction',
        phaseAt: now,
        seqNum: 7100,
        latestBuildId: 'build-clip',
      })
      .run();
    H.s.db
      .insert(build)
      .values({
        id: 'build-clip',
        todoId: 'todo-clip',
        withPlan: false,
        triggerSource: 'user',
        errorMessage: `${linePrefix}${skKey}`,
        createdAt: now - 10_000,
      })
      .run();
    H.s.db
      .insert(step)
      .values({
        id: 'step-clip',
        buildId: 'build-clip',
        kind: 'build',
        status: 'failed',
        holdReason: `${tailPrefix}${skKey}`,
        createdAt: now - 10_000,
        finishedAt: now - 5_000,
      })
      .run();
    H.s.db
      .insert(message)
      .values({
        id: 'call-clip',
        conversationId: 'build-clip',
        role: 'assistant',
        content: {
          kind: 'toolcall',
          call: {
            name: 'Bash',
            arguments: { cmd: `${cmdPrefix}${ghpKey}` },
            isError: true,
          },
        },
        createdAt: now - 8_000,
      })
      .run();

    const body = (await relay('inspect_run', { id: 'todo-clip' })) as {
      evidence: { text: string };
      steps: { holdReason: string | null }[];
      recentToolCalls: { arguments: string }[];
    };

    expect(body.evidence.text).toBe(`${linePrefix}[REDACTED]`);
    expect(body.evidence.text).not.toContain('sk-');
    expect(body.steps[0]?.holdReason).toBe(`${tailPrefix}[REDA…`);
    expect(body.steps[0]?.holdReason).not.toContain('sk-');
    expect(body.recentToolCalls[0]?.arguments).toBe(`{"cmd":"${cmdPrefix}[REDACTED]"}`);
    expect(body.recentToolCalls[0]?.arguments).not.toContain('ghp_');
  });
});
