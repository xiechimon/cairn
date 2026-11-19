import type { ClaudeCodeReport } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { coordinatorToolsExtension, createStepGate } from '../src/coordinator/runtime/tools.js';
import {
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  step as stepTable,
} from '../src/db/schema.js';
import { claimStep } from '../src/services/machines.js';
import { fakeMachineApi } from './coordinator/fake-machine-api.js';
import { bootServer, insertClaudeSubscription, insertMachine, seedRoute } from './helpers.js';

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d();
});

describe('the Coordinator tool table is the same on the in-server runtime and on a Runner', () => {
  test('a Runner claim offers exactly the tools the in-server runtime registers, with the same descriptions and schemas', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    insertClaudeSubscription(s);
    disposables.push(() => s.dispose());
    const machineId = insertMachine(s, {
      name: 'parity',
      claudeCodeReport: {
        installed: true,
        hostname: 'omarchy',
        models: [{ id: 'sonnet', name: 'sonnet' }],
        auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
      } as ClaudeCodeReport,
    });
    seedRoute(s, 'coordinator', {
      provider: 'claude-code',
      modelId: 'sonnet',
      thinkingLevel: 'off',
      machineId,
    });
    s.db
      .insert(chiefTable)
      .values({ id: 'c1', userId: s.svc.user.id, teamId: s.team.id, createdAt: 1 })
      .run();
    s.db
      .insert(chiefThreadTable)
      .values({
        id: 't1',
        chiefId: 'c1',
        userId: s.svc.user.id,
        teamId: s.team.id,
        title: 'x',
        createdAt: 2,
        updatedAt: 2,
        sessionId: '',
        sessionOpenedAt: 2,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({ id: 's1', buildId: 't1', kind: 'chief', status: 'pending', createdAt: 3 })
      .run();
    const claimed = await claimStep(
      {
        ...s.svc,
        box: s.secretBox,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: s.skillsDir,
      },
      machineId,
      s.team.id,
      10,
      'http://localhost',
    );
    const offered = (claimed?.remoteTools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? { type: 'object', properties: {} },
    }));
    expect(offered.length).toBeGreaterThan(0);

    const registered = (
      coordinatorToolsExtension(fakeMachineApi(), createStepGate()).tools ?? []
    ).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    expect(offered.sort(byName)).toEqual(registered.sort(byName));
  });
});
