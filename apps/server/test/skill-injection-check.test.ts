import type { MachineDoneBody, SkillInjectionRecord } from '@cairn/shared';
import { SKILL_INJECTION_CHECK_KIND } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  message as messageTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import { finishStep, type MachineDeps } from '../src/services/machines.js';
import { bootServer, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

interface World {
  s: TestServer;
  deps: MachineDeps;
  machineId: string;
  buildId: string;
  stepId: string;
}

function makeWorld(opts: {
  skillsAllowlist: string[] | null;
  skillInjection: SkillInjectionRecord | null;
  toolContent?: unknown;
}): World {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const suffix = Math.random().toString(36).slice(2);
  const base = nowMs();
  const projectId = `proj-${suffix}`;
  const agentId = `agent-${suffix}`;
  const machineId = `machine-${suffix}`;
  const todoId = `todo-${suffix}`;
  const buildId = `build-${suffix}`;
  const stepId = `step-${suffix}`;
  s.db
    .insert(projectTable)
    .values({
      id: projectId,
      name: `inj-${suffix}`,
      teamId: s.team.id,
      repoKind: 'local',
    })
    .run();
  s.db
    .insert(machineTable)
    .values({
      id: machineId,
      teamId: s.team.id,
      name: `inj-m-${suffix}`,
      online: true,
      enabledRuntimes: ['pi'],
    })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: agentId,
      teamId: s.team.id,
      displayName: 'injection-probe',
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId,
      skillsAllowlist: opts.skillsAllowlist,
      tools: [],
    })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: '注入断言',
      spec: '用 demo-skill。',
      phase: 'building',
      phaseAt: base,
      seqNum: 1,
      assignment: { plan: null, build: { agentId } },
      hasPlan: false,
      latestBuildId: buildId,
      v: 1,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      prevPhase: 'building',
      triggerSource: 'user',
      planDocId: null,
      errorMessage: null,
      prUrl: null,
      prNumber: null,
      changes: null,
      diffHash: null,
      createdAt: base,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId,
      kind: 'build',
      status: 'claimed',
      machineId,
      createdAt: base,
      skillInjection: opts.skillInjection,
    })
    .run();
  if (opts.toolContent !== undefined) {
    s.db
      .insert(messageTable)
      .values({
        id: `msg-${suffix}`,
        conversationId: buildId,
        role: 'assistant',
        content: opts.toolContent,
        createdAt: base,
      })
      .run();
  }
  const deps: MachineDeps = {
    ...s.svc,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    box: s.secretBox,
  };
  return { s, deps, machineId, buildId, stepId };
}

function doneBody(facts: MachineDoneBody['skillInjectionFacts']): MachineDoneBody {
  return {
    status: 'failed',
    errorMessage: 'probe failure',
    ...(facts !== undefined ? { skillInjectionFacts: facts } : {}),
  };
}

function checkRow(w: World): {
  kind: string;
  level: string;
  reds: { code: string; skill?: string }[];
  yellows: { code: string; skill: string }[];
  injected: string[];
} {
  const rows = w.s.db
    .select()
    .from(messageTable)
    .where(eq(messageTable.conversationId, w.buildId))
    .all();
  const row = rows.find((m) => m.id === `skill-injection-${w.stepId}`);
  expect(row).toBeDefined();
  const content = typeof row?.content === 'string' ? row.content : JSON.stringify(row?.content);
  return JSON.parse(content) as {
    kind: string;
    level: string;
    reds: { code: string; skill?: string }[];
    yellows: { code: string; skill: string }[];
    injected: string[];
  };
}

describe('the finishStep skill-injection assertion (#1186)', () => {
  test('S1 injected but never read -> yellow, the step still failed', async () => {
    const w = makeWorld({
      skillsAllowlist: ['demo-skill'],
      skillInjection: {
        hits: [{ id: 'demo-skill', rule: 'explicit-mention', reason: '点名' }],
      },
    });
    await finishStep(
      w.deps,
      w.machineId,
      w.stepId,
      doneBody({ injected: ['demo-skill'], omitted: [], unrendered: [] }),
    );
    const got = checkRow(w);
    expect(got.kind).toBe(SKILL_INJECTION_CHECK_KIND);
    expect(got.level).toBe('yellow');
    expect(got.reds).toEqual([]);
    expect(got.yellows.map((y) => y.code)).toEqual(['injected-unread']);
    expect(got.injected).toEqual(['demo-skill']);
    const step = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get();
    expect(step?.status).toBe('failed');
  });

  test('S2 allowlist [] -> red allowlist-closed, the step still failed', async () => {
    const w = makeWorld({
      skillsAllowlist: [],
      skillInjection: { hits: [] },
    });
    await finishStep(
      w.deps,
      w.machineId,
      w.stepId,
      doneBody({ injected: [], omitted: [], unrendered: [] }),
    );
    const got = checkRow(w);
    expect(got.level).toBe('red');
    expect(got.reds.map((r) => r.code)).toContain('allowlist-closed');
    expect(got.injected).toEqual([]);
    const step = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get();
    expect(step?.status).toBe('failed');
  });

  test('S3 SKILL.md read -> ok', async () => {
    const w = makeWorld({
      skillsAllowlist: ['demo-skill'],
      skillInjection: {
        hits: [{ id: 'demo-skill', rule: 'explicit-mention', reason: '点名' }],
      },
      toolContent: {
        kind: 'toolcall',
        call: {
          id: 'call-1',
          name: 'read',
          arguments: { path: '/skills/demo-skill/SKILL.md' },
          result: 'skill body',
        },
      },
    });
    await finishStep(
      w.deps,
      w.machineId,
      w.stepId,
      doneBody({ injected: ['demo-skill'], omitted: [], unrendered: [] }),
    );
    const got = checkRow(w);
    expect(got.level).toBe('ok');
    expect(got.reds).toEqual([]);
    expect(got.yellows).toEqual([]);
  });
});
