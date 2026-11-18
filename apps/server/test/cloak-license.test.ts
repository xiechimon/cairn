import { createHash } from 'node:crypto';
import {
  CLOAK_LICENSE_NOT_SAVED,
  CLOAK_LICENSE_SAVED,
  CLOAK_LICENSE_SECRET,
  REQUEST_CLOAK_LICENSE_TOOL,
} from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  pairedDevice,
  secret,
  step as stepTable,
} from '../src/db/schema.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import { composeChiefSystemPrompt } from '../src/services/chief.js';
import { holdCloakLicense, teamHasVmComputer } from '../src/services/cloak-license.js';
import { coordinatorToolDefs } from '../src/services/coordinator-tool-defs.js';
import type { MachineDeps } from '../src/services/machine-deps.js';
import { executeRelayToolCall } from '../src/services/machine-relay.js';
import { bootServer, seedRoute, type TestServer } from './helpers.js';

vi.setConfig({ testTimeout: 30_000 });

const THREAD = 'chief-cloak-thread';
const SENTINEL = 'cloak-sentinel-7f3a9c2e-license';
const FAST = { pollMs: 5, timeoutMs: 60_000 };

let server: TestServer | null = null;
afterEach(() => {
  vi.restoreAllMocks();
  server?.dispose();
  server = null;
});

function boot(authToken: string | null = null) {
  const s = bootServer({ authToken });
  server = s;
  const chiefId = `chief-${s.svc.user.id}-${s.team.id}`;
  s.db
    .insert(machineTable)
    .values({
      id: 'sidecar',
      teamId: s.team.id,
      name: 'sidecar',
      online: true,
      lastSeenAt: 1,
      capabilities: { mcpServers: [], skills: [] },
    })
    .run();
  seedRoute(s, 'coordinator', { provider: 'stub-gw', modelId: 'stub-model', machineId: 'sidecar' });
  s.db
    .insert(chiefTable)
    .values({ id: chiefId, userId: s.svc.user.id, teamId: s.team.id, charter: '', createdAt: 1 })
    .onConflictDoNothing()
    .run();
  s.db
    .insert(chiefThreadTable)
    .values({
      id: THREAD,
      chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      title: 'cloak',
      createdAt: 1,
      updatedAt: 1,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: 1,
      pendingSessionResumeAt: null,
      toolDefHashes: {},
      toolResultHashes: {},
      activeRun: null,
      archivedAt: 1,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: 'step-a',
      buildId: THREAD,
      kind: 'chief',
      machineId: 'sidecar',
      status: 'claimed',
      prompt: 'work',
      createdAt: 2,
    })
    .run();
  const deps: MachineDeps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
  return { s, deps };
}

function addVmMachine(s: TestServer, computerKind: 'vm' | 'host' = 'vm') {
  s.db
    .insert(machineTable)
    .values({
      id: `mac-${computerKind}`,
      teamId: s.team.id,
      name: `mac-${computerKind}`,
      online: true,
      lastSeenAt: 2,
      capabilities: {
        mcpServers: [],
        skills: [],
        computer: true,
        browser: true,
        stealthBrowser: true,
        computerKind,
      },
    })
    .run();
}

function save(s: TestServer, value: unknown, headers: Record<string, string> = {}) {
  return s.app.request(`/api/teams/${s.team.id}/cloak-license`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ value }),
  });
}

function licenseRows(s: TestServer) {
  return s.db.select().from(secret).where(eq(secret.name, CLOAK_LICENSE_SECRET)).all();
}

function everyStoredRow(s: TestServer): string {
  const tables = s.db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table'`,
  );
  expect(tables.map(({ name }) => name)).toEqual(
    expect.arrayContaining(['chief_message', 'computer_call', 'secret', 'step']),
  );
  return JSON.stringify(tables.map(({ name }) => s.db.all(sql.raw(`SELECT * FROM "${name}"`))));
}

describe('saving the CloakBrowser license from the chat card', () => {
  test('the owner saves the key as a sealed team secret and gets only its name back', async () => {
    const { s } = boot();
    const res = await save(s, `  ${SENTINEL}  `);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ name: CLOAK_LICENSE_SECRET });
    expect(text).not.toContain(SENTINEL);
    const [row] = licenseRows(s);
    expect(row).toMatchObject({ projectId: null, delivery: 'plaintext', envSeal: null });
    expect(row?.valueCipher).not.toContain(SENTINEL);
    expect(s.secretBox.open(row!.valueCipher!)).toBe(SENTINEL);
  });

  test('saving again replaces the value of the same secret', async () => {
    const { s } = boot();
    expect((await save(s, 'first-key')).status).toBe(200);
    const [first] = licenseRows(s);
    expect((await save(s, 'second-key')).status).toBe(200);
    const rows = licenseRows(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first?.id);
    expect(rows[0]?.policyRevision).toBeGreaterThan(first!.policyRevision);
    expect(s.secretBox.open(rows[0]!.valueCipher!)).toBe('second-key');
  });

  test('an empty, oversized or control-character key is refused without echoing it', async () => {
    const { s } = boot();
    for (const value of ['', '   ', 'x'.repeat(513), `${SENTINEL}\u0007`, `${SENTINEL}\nnext`, 7]) {
      const res = await save(s, value);
      expect(res.status, JSON.stringify(value)).toBe(400);
      expect(await res.text()).not.toContain(SENTINEL);
    }
    expect((await save(s, 'x'.repeat(512))).status).toBe(200);
    expect(licenseRows(s)).toHaveLength(1);
  });

  test.each(['bearer', 'session'] as const)(
    'a paired %s cannot save the key, the owner can',
    async (kind) => {
      const ownerToken = 'synthetic-owner-token';
      const deviceToken = 'cairn_dev_synthetic-device-token';
      const { s } = boot(ownerToken);
      s.db
        .insert(pairedDevice)
        .values({
          id: 'paired-phone',
          teamId: s.team.id,
          name: 'phone',
          tokenHash: createHash('sha256').update(deviceToken).digest('hex'),
          masked: 'synthetic-device',
          createdAt: Date.now(),
        })
        .run();
      const device: Record<string, string> =
        kind === 'bearer'
          ? { authorization: `Bearer ${deviceToken}` }
          : {
              cookie: `cairn_auth=${issueBrowserSession(s.db, 'device', 'paired-phone').token}`,
              'sec-fetch-site': 'same-origin',
            };
      expect((await save(s, SENTINEL, device)).status).toBe(403);
      expect(licenseRows(s)).toEqual([]);
      const owner: Record<string, string> =
        kind === 'bearer'
          ? { authorization: `Bearer ${ownerToken}` }
          : {
              cookie: `cairn_auth=${issueBrowserSession(s.db, 'owner').token}`,
              'sec-fetch-site': 'same-origin',
            };
      expect((await save(s, SENTINEL, owner)).status).toBe(200);
      expect(licenseRows(s)).toHaveLength(1);
    },
  );
});

describe('request_cloak_license holds the turn until the owner saves', () => {
  test('saving through the card returns the retry instruction and the key is stored nowhere else', async () => {
    const { s, deps } = boot();
    const written: string[] = [];
    const capture = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture);
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        written.push(args.map(String).join(' '));
      });
    const pending = executeRelayToolCall(
      deps,
      'sidecar',
      'step-a',
      REQUEST_CLOAK_LICENSE_TOOL,
      { reason: 'CloakBrowser license denied or unavailable' },
      'tc-cloak',
    );
    expect((await save(s, SENTINEL)).status).toBe(200);
    const result = await pending;
    expect(result).toBe(CLOAK_LICENSE_SAVED);
    expect(result).not.toContain(SENTINEL);
    expect(everyStoredRow(s)).not.toContain(SENTINEL);
    expect(written.join('\n')).not.toContain(SENTINEL);
  });

  test('a key saved before the card does not count; a replaced key does', async () => {
    const { s, deps } = boot();
    expect((await save(s, 'rejected-key')).status).toBe(200);
    let settled: string | null = null;
    const pending = holdCloakLicense(deps, { stepId: 'step-a' }, FAST).then((text) => {
      settled = text;
      return text;
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(settled).toBeNull();
    expect((await save(s, 'fresh-key')).status).toBe(200);
    expect(await pending).toBe(CLOAK_LICENSE_SAVED);
  });

  test('the card expires unsaved when the time runs out or the turn ends', async () => {
    const { s, deps } = boot();
    expect(await holdCloakLicense(deps, { stepId: 'step-a' }, { pollMs: 5, timeoutMs: 20 })).toBe(
      CLOAK_LICENSE_NOT_SAVED,
    );
    const pending = holdCloakLicense(deps, { stepId: 'step-a' }, FAST);
    s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, 'step-a')).run();
    expect(await pending).toBe(CLOAK_LICENSE_NOT_SAVED);
    const controller = new AbortController();
    s.db.update(stepTable).set({ status: 'claimed' }).where(eq(stepTable.id, 'step-a')).run();
    const aborted = holdCloakLicense(
      deps,
      { stepId: 'step-a' },
      { ...FAST, signal: controller.signal },
    );
    controller.abort();
    expect(await aborted).toBe(CLOAK_LICENSE_NOT_SAVED);
  });
});

describe('request_cloak_license is offered only with a VM computer', () => {
  const names = (vmComputer: boolean) => coordinatorToolDefs({ vmComputer }).map((def) => def.name);

  test('the tool list carries it only when asked', () => {
    expect(names(true)).toContain(REQUEST_CLOAK_LICENSE_TOOL);
    expect(names(false)).not.toContain(REQUEST_CLOAK_LICENSE_TOOL);
  });

  test('a team has a VM computer only when a machine reports computerKind vm', () => {
    const { s } = boot();
    expect(teamHasVmComputer(s.db, s.team.id)).toBe(false);
    addVmMachine(s, 'host');
    expect(teamHasVmComputer(s.db, s.team.id)).toBe(false);
    addVmMachine(s, 'vm');
    expect(teamHasVmComputer(s.db, s.team.id)).toBe(true);
  });

  test('a VM machine without the computer capability or with the desktop grant off has no VM computer', () => {
    const { s } = boot();
    s.db
      .insert(machineTable)
      .values({
        id: 'mac-kind-only',
        teamId: s.team.id,
        name: 'mac-kind-only',
        online: true,
        lastSeenAt: 2,
        capabilities: { mcpServers: [], skills: [], computerKind: 'vm' },
      })
      .run();
    expect(teamHasVmComputer(s.db, s.team.id)).toBe(false);
    addVmMachine(s, 'vm');
    expect(teamHasVmComputer(s.db, s.team.id)).toBe(true);
    s.db
      .update(machineTable)
      .set({ desktopOverride: false })
      .where(eq(machineTable.id, 'mac-vm'))
      .run();
    expect(teamHasVmComputer(s.db, s.team.id)).toBe(false);
    s.db
      .update(machineTable)
      .set({ desktopOverride: null })
      .where(eq(machineTable.id, 'mac-vm'))
      .run();
    expect(teamHasVmComputer(s.db, s.team.id)).toBe(true);
    s.db
      .update(machineTable)
      .set({ desktopOverride: true })
      .where(eq(machineTable.id, 'mac-vm'))
      .run();
    expect(teamHasVmComputer(s.db, s.team.id)).toBe(true);
  });

  test('the prompt sends a missing or rejected key to the card only with a VM computer', () => {
    const { s, deps } = boot();
    const prompt = () => composeChiefSystemPrompt(deps, s.team.id, THREAD);
    expect(prompt()).not.toContain(REQUEST_CLOAK_LICENSE_TOOL);
    addVmMachine(s, 'vm');
    const withVm = prompt();
    expect(withVm).toContain(
      '工具说没有 CloakBrowser 许可时，调 request_cloak_license 在对话里发许可证卡',
    );
    expect(withVm).toContain('不要让用户去设置页');
    expect(withVm).toContain('原样重试刚才那次调用');
    expect(withVm).toContain('把 CloakBrowser 给的原因填进 reason');
  });
});
