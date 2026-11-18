import type { ClaudeCodeReport } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import { claimStep } from '../src/services/machines.js';
import {
  bootServer,
  insertClaudeSubscription,
  insertMachine,
  seedRoute,
  type TestServer,
} from './helpers.js';

let server: TestServer | null = null;
afterEach(() => {
  server?.dispose();
  server = null;
});

const DESKTOP_TOOLS = ['computer_observe', 'computer_act', 'desktop_snapshot', 'desktop_act'];
const VM_TOOLS = ['shell', 'install_packages'];
const OWN_TOOLS = ['user_computer_shell', 'user_computer_observe', 'user_computer_act'];

function boot(): TestServer {
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  server = s;
  insertClaudeSubscription(s);
  const machineId = insertMachine(s, {
    name: 'runner',
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
    .values({ id: 'c1', userId: s.svc.user.id, teamId: s.team.id, charter: '', createdAt: 1 })
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
    .values({
      id: 's1',
      buildId: 't1',
      kind: 'chief',
      status: 'pending',
      ownerMessageIds: ['m1'],
      createdAt: 3,
    })
    .run();
  return s;
}

async function toolNames(s: TestServer): Promise<string[]> {
  const claimed = await claimStep(
    {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir: s.skillsDir,
    },
    'machine-runner',
    s.team.id,
    10,
    'http://localhost',
  );
  return (claimed?.remoteTools ?? []).map((tool) => tool.name);
}

function addVm(s: TestServer, opts: { kind?: 'vm' | 'host'; desktopOff?: boolean } = {}) {
  const id = insertMachine(s, {
    name: `computer-${opts.kind ?? 'vm'}`,
    capabilities: {
      mcpServers: [],
      skills: [],
      computer: true,
      browser: true,
      computerKind: opts.kind ?? 'vm',
    },
  });
  if (opts.desktopOff === true) {
    s.db.update(machineTable).set({ desktopOverride: false }).where(eq(machineTable.id, id)).run();
  }
  return id;
}

describe('a Runner-claimed chief turn offers the computer tools the grants allow', () => {
  test('a capable VM machine puts the desktop and VM tools on the claim payload', async () => {
    const s = boot();
    addVm(s);
    const names = await toolNames(s);
    for (const name of [...DESKTOP_TOOLS, ...VM_TOOLS]) expect(names).toContain(name);
  });

  test('the desktop grant being off withholds the desktop and VM tools', async () => {
    const s = boot();
    addVm(s, { desktopOff: true });
    const names = await toolNames(s);
    for (const name of [...DESKTOP_TOOLS, ...VM_TOOLS]) expect(names).not.toContain(name);
    expect(names).toContain('browser_navigate');
  });

  test('a host-kind computer offers the desktop tools but not the VM tools', async () => {
    const s = boot();
    addVm(s, { kind: 'host' });
    const names = await toolNames(s);
    for (const name of DESKTOP_TOOLS) expect(names).toContain(name);
    for (const name of VM_TOOLS) expect(names).not.toContain(name);
  });

  test("an enabled owner Mac puts the user's own-Mac tools on the claim payload", async () => {
    const s = boot();
    insertMachine(s, {
      name: 'ians-mac',
      capabilities: {
        mcpServers: [],
        skills: [],
        ownComputer: true,
        ownComputerShell: true,
      },
    });
    s.db
      .update(machineTable)
      .set({ ownComputerEnabled: true })
      .where(eq(machineTable.id, 'machine-ians-mac'))
      .run();
    const names = await toolNames(s);
    for (const name of OWN_TOOLS) expect(names).toContain(name);
  });
});
