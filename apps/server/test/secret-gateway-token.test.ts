import type { MachineCapabilities, MachineTokenResponse } from '@cairn/shared';
import { parseReportedCapabilities, parseSecretSurface } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { machine as machineTable, step as stepTable } from '../src/db/schema.js';
import { startBuilds } from '../src/services/builds.js';
import { resolveStepCredentials } from '../src/services/credentials.js';
import { stepToken } from '../src/services/machine-step-token.js';
import { createSecret, openSecretGrants } from '../src/services/secrets.js';
import {
  bootServer,
  insertMachine,
  postProject,
  req,
  seedSessionRoute,
  type TestServer,
} from './helpers.js';

const policy = {
  origin: 'https://api.example.com',
  header: 'Authorization',
  template: 'Bearer {secret}',
};
const GATEWAY: MachineCapabilities = {
  mcpServers: [],
  skills: [],
  executor: 'orb',
  secretGateway: true,
};

let s: TestServer;
let stepId: string;
let machineId: string;
let projectId: string;
let httpId: string;
let plainId: string;

const keys = () => ({ db: s.db, box: s.secretBox });
const machineDeps = () => ({
  ...s.svc,
  box: s.secretBox,
  reposDir: s.reposDir,
  attachmentsDir: s.attachmentsDir,
  skillsDir: s.skillsDir,
});

function setCapabilities(capabilities: MachineCapabilities | null): void {
  s.db.update(machineTable).set({ capabilities }).where(eq(machineTable.id, machineId)).run();
}

function setStatus(status: 'claimed' | 'done'): void {
  s.db.update(stepTable).set({ status, machineId }).where(eq(stepTable.id, stepId)).run();
}

const token = (surface?: 'orb' | 'host'): Promise<MachineTokenResponse> =>
  stepToken(machineDeps(), machineId, stepId, surface);

beforeEach(async () => {
  s = bootServer();
  plainId = createSecret(keys(), { teamId: s.team.id, name: 'PLAIN', value: 'p' }).id;
  httpId = createSecret(keys(), {
    teamId: s.team.id,
    name: 'API_TOKEN',
    value: 'gateway-only-value',
    delivery: 'http',
    http: policy,
  }).id;
  seedSessionRoute(s, { secrets: [plainId, httpId] });
  projectId = await postProject(s.app);
  const todoDoc = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 't', spec: '' })
  ).json()) as { id: string };
  machineId = insertMachine(s, { name: 'gateway' });
  const [built] = startBuilds(
    { db: s.db, hub: s.hub, user: s.user },
    { projectId, todoIds: [todoDoc.id] },
  );
  if (!built) throw new Error('no build');
  const stepRow = s.db.select().from(stepTable).where(eq(stepTable.buildId, built.id)).all()[0];
  if (!stepRow) throw new Error('no step');
  stepId = stepRow.id;
  setStatus('claimed');
  setCapabilities(GATEWAY);
});

afterEach(() => s.dispose());

describe('secret gateway token rule', () => {
  test('a claimed step on a gateway orb machine asking with orb receives the http grant', async () => {
    const body = await token('orb');
    expect(body.secrets).toEqual({ PLAIN: 'p' });
    expect(body.httpSecrets).toEqual([
      {
        id: httpId,
        name: 'API_TOKEN',
        revision: 1,
        ...policy,
        value: 'gateway-only-value',
      },
    ]);
    expect(body).not.toHaveProperty('withheldSecrets');
  });

  test.each([
    ['no surface', undefined, GATEWAY, 'claimed'],
    ['the host surface', 'host', GATEWAY, 'claimed'],
    ['no gateway capability', 'orb', { ...GATEWAY, secretGateway: undefined }, 'claimed'],
    ['a host executor', 'orb', { ...GATEWAY, executor: 'host' }, 'claimed'],
    ['no reported capabilities', 'orb', null, 'claimed'],
    ['a step that is no longer claimed', 'orb', GATEWAY, 'done'],
  ] as const)(
    'withholds the http secret by name with %s',
    async (_label, surface, caps, status) => {
      setCapabilities(caps as MachineCapabilities | null);
      setStatus(status);
      const body = await token(surface);
      expect(body.secrets).toEqual({ PLAIN: 'p' });
      expect(body).not.toHaveProperty('httpSecrets');
      expect(body.withheldSecrets).toEqual(['API_TOKEN']);
      expect(JSON.stringify(body)).not.toContain('gateway-only-value');
    },
  );

  test('a step kind that takes no team secrets gets neither field', async () => {
    s.db.update(stepTable).set({ kind: 'review' }).where(eq(stepTable.id, stepId)).run();
    const body = await token('orb');
    expect(body.secrets).toEqual({});
    expect(body).not.toHaveProperty('httpSecrets');
    expect(body).not.toHaveProperty('withheldSecrets');
  });

  test('the route reads the surface query parameter and treats anything else as host', async () => {
    expect(parseSecretSurface('orb')).toBe('orb');
    expect(parseSecretSurface('host')).toBe('host');
    expect(parseSecretSurface('ORB')).toBe('host');
    expect(parseSecretSurface(undefined)).toBe('host');
  });

  test('a reported secretGateway capability survives parsing only as literal true', () => {
    const base = { mcpServers: [], skills: [] };
    expect(parseReportedCapabilities({ ...base, secretGateway: true })?.secretGateway).toBe(true);
    expect(parseReportedCapabilities({ ...base, secretGateway: 'yes' })).not.toHaveProperty(
      'secretGateway',
    );
  });

  test('an http project row is the effective grant, with its own id and revision', () => {
    const projectRow = createSecret(keys(), {
      teamId: s.team.id,
      name: 'PLAIN',
      value: 'project-http',
      projectId,
      delivery: 'http',
      http: { ...policy, header: 'X-Api-Key', template: '{secret}' },
    });
    const grants = openSecretGrants(keys(), s.team.id, [plainId, httpId], projectId);
    expect(grants.values).toEqual({});
    expect(grants.http.map((row) => [row.id, row.name, row.revision])).toEqual([
      [httpId, 'API_TOKEN', 1],
      [projectRow.id, 'PLAIN', 1],
    ]);
  });

  test('the credential bundle keeps http rows sealed', () => {
    const bundle = resolveStepCredentials(keys(), stepId);
    expect(bundle.secrets).toEqual({ PLAIN: 'p' });
    expect(JSON.stringify(bundle)).not.toContain('gateway-only-value');
    expect(bundle.httpSecrets.map((row) => row.name)).toEqual(['API_TOKEN']);
  });
});
