import { createHash } from 'node:crypto';
import {
  REQUEST_SECRET_TOOL,
  SECRET_REQUEST_CANCELLED,
  SECRET_REQUEST_NOT_SAVED,
  SECRET_REQUEST_REFUSED_PREFIX,
  secretRequestSaved,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
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
import { coordinatorToolDefs } from '../src/services/coordinator-tool-defs.js';
import type { MachineDeps } from '../src/services/machine-deps.js';
import { executeRelayToolCall } from '../src/services/machine-relay.js';
import { holdSecretRequest } from '../src/services/secret-requests.js';
import { createSecret } from '../src/services/secrets.js';
import { bootServer, postProject, seedRoute, type TestServer } from './helpers.js';

vi.setConfig({ testTimeout: 30_000 });

const THREAD = 'chief-secret-thread';
const SENTINEL = 'secret-sentinel-5384-e1d2c3b4';
const NAME = 'ACME_API_KEY';
const FAST = { pollMs: 5, timeoutMs: 60_000 };
const TEAM_PARAMS = { name: NAME, scope: 'team', description: 'The Acme API key.' };

let server: TestServer | null = null;
afterEach(() => {
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
    .values({ id: chiefId, userId: s.svc.user.id, teamId: s.team.id, createdAt: 1 })
    .onConflictDoNothing()
    .run();
  s.db
    .insert(chiefThreadTable)
    .values({
      id: THREAD,
      chiefId,
      userId: s.svc.user.id,
      teamId: s.team.id,
      title: 'secret',
      createdAt: 1,
      updatedAt: 1,
      sessionId: '',
      sessionOpenedAt: 1,
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

function answer(
  s: TestServer,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return s.app.request(`/api/teams/${s.team.id}/secret-requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const save = (value: unknown, projectId: string | null = null) => ({
  decision: 'save',
  name: NAME,
  projectId,
  value,
});

function rows(s: TestServer) {
  return s.db.select().from(secret).where(eq(secret.name, NAME)).all();
}

function hold(s: TestServer, params: Record<string, unknown> = TEAM_PARAMS, opts = {}) {
  return holdSecretRequest(
    s.db,
    { teamId: s.team.id, stepId: 'step-a', params },
    {
      ...FAST,
      ...opts,
    },
  );
}

async function waitingOn(s: TestServer, body: Record<string, unknown>) {
  let res: Response | undefined;
  await vi.waitFor(async () => {
    res = await answer(s, body);
    expect(res.status).not.toBe(409);
  });
  return res!;
}

describe('answering a secret request from the chat card', () => {
  test('with no request waiting, the route writes nothing and answers 409', async () => {
    const { s } = boot();
    expect((await answer(s, save(SENTINEL))).status).toBe(409);
    expect((await answer(s, { decision: 'cancel', name: NAME, projectId: null })).status).toBe(409);
    expect(rows(s)).toEqual([]);
  });

  test('a save seals the trimmed value as a team secret, returns only its name and ends the hold', async () => {
    const { s } = boot();
    const pending = hold(s);
    const res = await waitingOn(s, save(`  ${SENTINEL}  `));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ name: NAME });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await pending).toBe(secretRequestSaved(NAME, 'team'));
    const [row] = rows(s);
    expect(row).toMatchObject({ projectId: null, delivery: 'plaintext' });
    expect(row?.valueCipher).not.toContain(SENTINEL);
    expect(s.secretBox.open(row!.valueCipher!)).toBe(SENTINEL);
  });

  test('a save replaces the value of an existing secret in the same scope', async () => {
    const { s, deps } = boot();
    createSecret(deps, { teamId: s.team.id, name: NAME, value: 'rejected-key' });
    const [first] = rows(s);
    const pending = hold(s);
    expect((await waitingOn(s, save('fresh-key'))).status).toBe(200);
    await pending;
    const all = rows(s);
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(first?.id);
    expect(all[0]?.policyRevision).toBeGreaterThan(first!.policyRevision);
    expect(s.secretBox.open(all[0]!.valueCipher!)).toBe('fresh-key');
  });

  test('a project request saves into that project only, and a team answer does not reach it', async () => {
    const { s } = boot();
    const projectId = await postProject(s.app, 'acme');
    const pending = hold(s, { ...TEAM_PARAMS, scope: 'project', projectId });
    await vi.waitFor(async () =>
      expect((await answer(s, save('x', projectId))).status).not.toBe(409),
    );
    expect(await pending).toBe(secretRequestSaved(NAME, 'project'));
    expect(rows(s).map((row) => row.projectId)).toEqual([projectId]);
    const again = hold(s, { ...TEAM_PARAMS, scope: 'project', projectId });
    expect((await answer(s, save('y'))).status).toBe(409);
    expect((await waitingOn(s, { decision: 'cancel', name: NAME, projectId })).status).toBe(200);
    expect(await again).toBe(SECRET_REQUEST_CANCELLED);
  });

  test('an empty, oversized or control-character value is refused without echoing it', async () => {
    const { s } = boot();
    const pending = hold(s);
    await vi.waitFor(async () =>
      expect((await answer(s, { decision: 'cancel', name: 'OTHER', projectId: null })).status).toBe(
        409,
      ),
    );
    for (const value of [
      '',
      '   ',
      'x'.repeat(4097),
      `${SENTINEL}\u0007`,
      `${SENTINEL}\nnext`,
      7,
    ]) {
      const res = await answer(s, save(value));
      expect(res.status, JSON.stringify(value)).toBe(400);
      expect(await res.text()).not.toContain(SENTINEL);
    }
    expect(rows(s)).toEqual([]);
    expect((await waitingOn(s, save('x'.repeat(4096)))).status).toBe(200);
    await pending;
  });

  test.each(['bearer', 'session'] as const)(
    'a paired %s can answer a secret request like the owner session',
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
      const pending = hold(s);
      await vi.waitFor(async () =>
        expect((await answer(s, save(SENTINEL), device)).status).toBe(200),
      );
      expect(await pending).toBe(secretRequestSaved(NAME, 'team'));
    },
  );
});

describe('request_secret holds the turn until the owner answers', () => {
  test('cancel returns the declined text and stores nothing', async () => {
    const { s, deps } = boot();
    const pending = executeRelayToolCall(
      deps,
      'sidecar',
      'step-a',
      REQUEST_SECRET_TOOL,
      TEAM_PARAMS,
    );
    expect((await waitingOn(s, { decision: 'cancel', name: NAME, projectId: null })).status).toBe(
      200,
    );
    expect(await pending).toBe(SECRET_REQUEST_CANCELLED);
    expect(rows(s)).toEqual([]);
  });

  test('the request ends unsaved when the time runs out, the turn ends or the call aborts', async () => {
    const { s } = boot();
    expect(await hold(s, TEAM_PARAMS, { timeoutMs: 20 })).toBe(SECRET_REQUEST_NOT_SAVED);
    const stopped = hold(s);
    s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, 'step-a')).run();
    expect(await stopped).toBe(SECRET_REQUEST_NOT_SAVED);
    s.db.update(stepTable).set({ status: 'claimed' }).where(eq(stepTable.id, 'step-a')).run();
    const controller = new AbortController();
    const aborted = hold(s, TEAM_PARAMS, { signal: controller.signal });
    controller.abort();
    expect(await aborted).toBe(SECRET_REQUEST_NOT_SAVED);
    expect((await answer(s, save(SENTINEL))).status).toBe(409);
  });

  test('bad parameters are refused at once without a card wait', async () => {
    const { s } = boot();
    for (const params of [
      { ...TEAM_PARAMS, name: 'lower_case' },
      { ...TEAM_PARAMS, scope: 'project' },
      { ...TEAM_PARAMS, scope: 'project', projectId: 'not-a-project' },
      { ...TEAM_PARAMS, projectId: 'p' },
      { ...TEAM_PARAMS, description: '' },
    ])
      expect(await hold(s, params)).toMatch(new RegExp(`^${SECRET_REQUEST_REFUSED_PREFIX}`));
  });

  test('every Coordinator is offered the tool, with or without a computer', () => {
    for (const options of [{}, { desktopTools: true }, { routerTools: false }])
      expect(coordinatorToolDefs(options).map((def) => def.name)).toContain(REQUEST_SECRET_TOOL);
    expect(coordinatorToolDefs({ desktopTools: true }).map((def) => def.name)).not.toContain(
      'request_cloak_license',
    );
  });
});
