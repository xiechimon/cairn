import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';
import { mailAccount, secret } from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import { issuePairingGrant, pairFromGrant } from '../src/services/paired-devices.js';
import {
  createSecret,
  listSecrets,
  openSecretGrants,
  updateSecret,
} from '../src/services/secrets.js';
import { bootServer, req, type TestServer } from './helpers.js';

const SENTINEL = 'plain-sentinel-7f3a';
const OWNER = 'secret-env-owner-credential-0123456789';
const policy = {
  origin: 'https://api.example.com',
  header: 'Authorization',
  template: 'Bearer {secret}',
};

let s: TestServer;
const deps = () => ({ db: s.db, box: s.secretBox });
const path = (rest = '') => `/api/teams/${s.team.id}/secrets${rest}`;
const row = (id: string) => s.db.select().from(secret).where(eq(secret.id, id)).get();

type Entry = { id: string; name: string; kind?: string; value?: string };

async function list(): Promise<Entry[]> {
  return (await (await req(s.app, 'GET', path())).json()) as Entry[];
}

function linkMail(secretId: string): void {
  s.db
    .insert(mailAccount)
    .values({
      id: newRecordId(),
      teamId: s.team.id,
      userId: s.user.id,
      provider: 'imap',
      mailbox: 'INBOX',
      status: 'watching',
      generation: 1,
      secretId,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
}

function simulateOldBinaryValueWrite(id: string, value: string): void {
  s.db
    .update(secret)
    .set({ valueCipher: s.secretBox.seal(value) })
    .where(eq(secret.id, id))
    .run();
}

async function createProject(): Promise<string> {
  const res = await req(s.app, 'POST', '/api/projects', { name: 'cairn' });
  return ((await res.json()) as { id: string }).id;
}

describe('environment variables next to secrets', () => {
  beforeEach(() => {
    s = bootServer();
  });

  test('a migrated row and a new default row are secrets; an env row lists its value', async () => {
    const legacy = createSecret(deps(), { teamId: s.team.id, name: 'LEGACY', value: 'hidden' });
    s.db.update(secret).set({ envSeal: null }).where(eq(secret.id, legacy.id)).run();
    const created = await req(s.app, 'POST', path(), {
      name: 'PUBLIC_URL',
      value: SENTINEL,
      kind: 'env',
    });
    expect(created.status).toBe(201);
    expect(JSON.stringify(await created.json())).not.toContain(SENTINEL);
    const res = await req(s.app, 'GET', path());
    expect(res.headers.get('cache-control')).toBe('no-store');
    const rows = (await res.json()) as Entry[];
    expect(rows.find((r) => r.name === 'LEGACY')).toMatchObject({ kind: 'secret' });
    expect(rows.find((r) => r.name === 'LEGACY')).not.toHaveProperty('value');
    expect(rows.find((r) => r.name === 'PUBLIC_URL')).toMatchObject({
      kind: 'env',
      value: SENTINEL,
    });
  });

  test('names must look like MY_KEY on create and rename, mail. names included', async () => {
    for (const name of [
      'lower',
      '1KEY',
      'MY-KEY',
      'mail.gmail',
      'MAIL.X',
      'ｍａｉｌ.x',
      'm\u200bail.x',
    ]) {
      expect((await req(s.app, 'POST', path(), { name, value: 'v' })).status).toBe(400);
    }
    const ok = (await (
      await req(s.app, 'POST', path(), { name: 'OK_1', value: 'v' })
    ).json()) as Entry;
    expect((await req(s.app, 'PATCH', path(`/${ok.id}`), { name: 'mail.x' })).status).toBe(400);
    const legacy = createSecret(deps(), {
      teamId: s.team.id,
      name: 'mail.gmail.refresh',
      value: 'a',
    });
    expect((await req(s.app, 'PATCH', path(`/${legacy.id}`), { value: 'b' })).status).toBe(200);
    expect(s.secretBox.open(row(legacy.id)?.valueCipher ?? '')).toBe('b');
  });

  test('a secret needs a value, an env does not, and an env cannot use http delivery', async () => {
    expect((await req(s.app, 'POST', path(), { name: 'EMPTY', value: '' })).status).toBe(400);
    expect(
      (await req(s.app, 'POST', path(), { name: 'EMPTY', value: '', kind: 'env' })).status,
    ).toBe(201);
    const http = { name: 'HTTP_ENV', value: 'v', kind: 'env', delivery: 'http', http: policy };
    expect((await req(s.app, 'POST', path(), http)).status).toBe(400);
  });

  test('convert to secret is one-way, needs a value, and wins over a value edit', async () => {
    const env = createSecret(deps(), { teamId: s.team.id, name: 'E', value: '', kind: 'env' });
    expect((await req(s.app, 'PATCH', path(`/${env.id}`), { kind: 'env' })).status).toBe(400);
    expect((await req(s.app, 'PATCH', path(`/${env.id}`), { kind: 'secret' })).status).toBe(400);
    const res = await req(s.app, 'PATCH', path(`/${env.id}`), { value: SENTINEL, kind: 'secret' });
    expect(await res.json()).toMatchObject({ kind: 'secret' });
    expect(row(env.id)?.envSeal).toBeNull();
    expect(JSON.stringify(await list())).not.toContain(SENTINEL);
    const before = row(env.id)?.updatedAt ?? 0;
    expect((await req(s.app, 'PATCH', path(`/${env.id}`), { value: 'new' })).status).toBe(200);
    expect(row(env.id)?.envSeal).toBeNull();
    expect(row(env.id)?.updatedAt ?? 0).toBeGreaterThanOrEqual(before);
  });

  test('an env value edit keeps it an env; an old-binary value write makes it a secret for good', async () => {
    const env = createSecret(deps(), { teamId: s.team.id, name: 'E', value: 'a', kind: 'env' });
    updateSecret(deps(), s.team.id, env.id, { value: 'b' });
    expect((await list())[0]).toMatchObject({ kind: 'env', value: 'b' });
    simulateOldBinaryValueWrite(env.id, SENTINEL);
    expect((await list())[0]).toMatchObject({ kind: 'secret' });
    expect(JSON.stringify(await list())).not.toContain(SENTINEL);
    updateSecret(deps(), s.team.id, env.id, { value: 'c' });
    expect((await list())[0]).not.toHaveProperty('value');
  });

  test('a row that ends up a secret with an empty stored value is refused, whatever the patch', async () => {
    const env = createSecret(deps(), { teamId: s.team.id, name: 'E', value: '', kind: 'env' });
    simulateOldBinaryValueWrite(env.id, '');
    expect((await list())[0]).toMatchObject({ kind: 'secret' });
    expect((await req(s.app, 'PATCH', path(`/${env.id}`), { kind: 'secret' })).status).toBe(400);
    expect((await req(s.app, 'PATCH', path(`/${env.id}`), { description: 'd' })).status).toBe(400);
    expect((await req(s.app, 'PATCH', path(`/${env.id}`), { value: 'filled' })).status).toBe(200);
    const stillEnv = createSecret(deps(), { teamId: s.team.id, name: 'F', value: '', kind: 'env' });
    expect((await req(s.app, 'PATCH', path(`/${stillEnv.id}`), { description: 'd' })).status).toBe(
      200,
    );
  });

  test('an old-binary switch to http delivery hides the value', async () => {
    const env = createSecret(deps(), {
      teamId: s.team.id,
      name: 'E',
      value: SENTINEL,
      kind: 'env',
    });
    s.db
      .update(secret)
      .set({
        delivery: 'http',
        httpOrigin: policy.origin,
        httpHeader: policy.header,
        httpTemplate: policy.template,
      })
      .where(eq(secret.id, env.id))
      .run();
    expect((await list())[0]).toMatchObject({ kind: 'secret' });
    expect(JSON.stringify(await list())).not.toContain(SENTINEL);
    updateSecret(deps(), s.team.id, env.id, { delivery: 'plaintext', value: 'fresh' });
    expect((await list())[0]).toMatchObject({ kind: 'secret' });
  });

  test('a mail-linked row is never listed with its value or delivered, project overrides included', async () => {
    const linked = createSecret(deps(), {
      teamId: s.team.id,
      name: 'GMAIL_APP_PASSWORD',
      value: SENTINEL,
      kind: 'env',
    });
    linkMail(linked.id);
    expect((await list())[0]).toMatchObject({ kind: 'secret' });
    expect(JSON.stringify(await list())).not.toContain(SENTINEL);
    expect(openSecretGrants(deps(), s.team.id, [linked.id], null).values).toEqual({});

    const projectId = await createProject();
    const team = createSecret(deps(), { teamId: s.team.id, name: 'TOKEN', value: 'team' });
    for (const delivery of ['plaintext', 'http'] as const) {
      const project = createSecret(deps(), {
        teamId: s.team.id,
        name: 'TOKEN',
        value: 'project',
        projectId,
        delivery,
        ...(delivery === 'http' ? { http: policy } : {}),
      });
      linkMail(project.id);
      const grants = openSecretGrants(deps(), s.team.id, [team.id], projectId);
      expect(grants.values).toEqual({ TOKEN: 'team' });
      expect(grants.http).toEqual([]);
      s.db
        .update(mailAccount)
        .set({ secretId: null })
        .where(eq(mailAccount.secretId, project.id))
        .run();
      s.db.delete(secret).where(eq(secret.id, project.id)).run();
    }
  });

  test('a project env overrides a team secret at runtime without revealing it', async () => {
    const projectId = await createProject();
    const team = createSecret(deps(), { teamId: s.team.id, name: 'TOKEN', value: SENTINEL });
    createSecret(deps(), {
      teamId: s.team.id,
      name: 'TOKEN',
      value: 'open',
      projectId,
      kind: 'env',
    });
    expect(openSecretGrants(deps(), s.team.id, [team.id], projectId).values).toEqual({
      TOKEN: 'open',
    });
    expect(JSON.stringify(await list())).not.toContain(SENTINEL);
    expect(JSON.stringify(listSecrets(deps(), s.team.id))).not.toContain('open');
  });
});

describe('who sees env values', () => {
  test('owner token and owner session see values; paired device token and device session do not', async () => {
    s = bootServer({ authToken: OWNER });
    createSecret(deps(), { teamId: s.team.id, name: 'E', value: SENTINEL, kind: 'env' });
    const grant = issuePairingGrant(s.db);
    const paired = pairFromGrant(s.db, { code: grant.code, teamId: s.team.id, name: 'phone' });
    if (!paired) throw new Error('pairing failed');
    const ownerSession = issueBrowserSession(s.db, 'owner').token;
    const callers: [string, Record<string, string>, boolean][] = [
      ['owner token', { authorization: `Bearer ${OWNER}` }, true],
      ['owner session', { cookie: `cairn_auth=${ownerSession}` }, true],
      ['paired token', { authorization: `Bearer ${paired.token}` }, false],
      ['device session', { cookie: `cairn_auth=${paired.sessionToken}` }, false],
    ];
    for (const [label, headers, sees] of callers) {
      const res = await s.app.request(path(), { headers });
      expect(res.status, label).toBe(200);
      const entries = (await res.json()) as Array<{
        kind?: string;
        value?: string;
        redacted?: boolean;
      }>;
      const body = JSON.stringify(entries);
      expect(body.includes(SENTINEL), label).toBe(sees);
      expect(body, label).toContain('"kind":"env"');
      if (sees) {
        expect(entries[0]?.redacted, label).toBeUndefined();
      } else {
        expect(entries[0]?.value, label).toBeUndefined();
        expect(entries[0]?.redacted, label).toBe(true);
      }
    }
  });
});
