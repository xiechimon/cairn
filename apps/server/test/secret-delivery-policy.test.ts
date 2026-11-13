import { beforeEach, describe, expect, test } from 'vitest';
import { mailAccount, secret, user } from '../src/db/schema.js';
import { createSecret, openSecretValues, updateSecret } from '../src/services/secrets.js';
import { bootServer, req, type TestServer } from './helpers.js';

let s: TestServer;

const deps = () => ({ db: s.db, box: s.secretBox });
const policy = {
  origin: 'https://api.example.com',
  header: 'Authorization',
  template: 'Bearer {secret}',
};
const secrets = () => `/api/teams/${s.team.id}/secrets`;
const post = (body: Record<string, unknown>) => req(s.app, 'POST', secrets(), body);
const patch = (id: string, body: Record<string, unknown>) =>
  req(s.app, 'PATCH', `${secrets()}/${id}`, body);

async function createHttp(name = 'API_TOKEN'): Promise<string> {
  const res = await post({ name, value: 'v1', delivery: 'http', http: policy });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function createProject(): Promise<string> {
  const res = await req(s.app, 'POST', '/api/projects', { name: 'cairn' });
  return ((await res.json()) as { id: string }).id;
}

beforeEach(() => {
  s = bootServer();
});

describe('secret delivery policy', () => {
  test('a secret without a policy is plaintext at revision 1', async () => {
    const res = await post({ name: 'PLAIN', value: 'v' });
    expect(await res.json()).toMatchObject({
      delivery: 'plaintext',
      http: null,
      policyRevision: 1,
    });
  });

  test('an http secret stores its normalized policy', async () => {
    const res = await post({
      name: 'API_TOKEN',
      value: 'v1',
      delivery: 'http',
      http: { ...policy, origin: 'https://API.example.com:443' },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ delivery: 'http', http: policy, policyRevision: 1 });
  });

  test.each([
    ['http origin', { origin: 'http://api.example.com' }],
    ['origin with a path', { origin: 'https://api.example.com/v1' }],
    ['origin with userinfo', { origin: 'https://user@api.example.com' }],
    ['wildcard origin', { origin: 'https://*.example.com' }],
    ['IPv4 origin', { origin: 'https://203.0.113.7' }],
    ['IPv6 origin', { origin: 'https://[2001:db8::1]' }],
    ['other port', { origin: 'https://api.example.com:8443' }],
    ['hop-by-hop header', { header: 'Connection' }],
    ['Host header', { header: 'host' }],
    ['proxy header', { header: 'Proxy-Authorization' }],
    ['header outside the token set', { header: 'X Key' }],
    ['template without a slot', { template: 'Bearer' }],
    ['template with two slots', { template: '{secret} {secret}' }],
    ['template with a line break', { template: 'Bearer {secret}\r\nX: 1' }],
  ])('refuses %s', async (_label, change) => {
    const res = await post({
      name: 'T',
      value: 'v',
      delivery: 'http',
      http: { ...policy, ...change },
    });
    expect(res.status).toBe(400);
  });

  test('refuses an http secret without a policy and a plaintext secret with one', async () => {
    expect((await post({ name: 'A', value: 'v', delivery: 'http' })).status).toBe(400);
    expect((await post({ name: 'B', value: 'v', http: policy })).status).toBe(400);
  });

  test.each([
    ['trailing newline', 'value\n'],
    ['PEM block', '-----BEGIN KEY-----\nabc\n-----END KEY-----'],
    ['empty', ''],
  ])('refuses an http value with %s', async (_label, value) => {
    const res = await post({ name: 'T', value, delivery: 'http', http: policy });
    expect(res.status).toBe(400);
  });

  test.each(['EXA_API_KEY', 'BRAVE_SEARCH_API_KEY'])(
    'refuses http delivery for %s, which the daemon reads itself',
    async (name) => {
      expect((await post({ name, value: 'v', delivery: 'http', http: policy })).status).toBe(400);
    },
  );

  test('renaming an http secret to a daemon-read name is refused', async () => {
    const id = await createHttp();
    expect((await patch(id, { name: 'EXA_API_KEY' })).status).toBe(400);
  });

  test('switching plaintext to http keeps the value when it is valid and bumps the revision', async () => {
    const id = ((await (await post({ name: 'T', value: 'v1' })).json()) as { id: string }).id;
    const res = await patch(id, { delivery: 'http', http: policy });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ delivery: 'http', http: policy, policyRevision: 2 });
  });

  test('switching plaintext to http is refused when the stored value has a line break', async () => {
    const id = ((await (await post({ name: 'T', value: 'a\nb' })).json()) as { id: string }).id;
    expect((await patch(id, { delivery: 'http', http: policy })).status).toBe(400);
  });

  test.each([
    ['origin', { http: { ...policy, origin: 'https://other.example.com' } }],
    ['header', { http: { ...policy, header: 'X-Api-Key' } }],
    ['template', { http: { ...policy, template: '{secret}' } }],
    ['delivery back to plaintext', { delivery: 'plaintext' }],
  ])('changing the %s of an http secret needs a new value', async (_label, change) => {
    const id = await createHttp();
    expect((await patch(id, change)).status).toBe(400);
    const res = await patch(id, { ...change, value: 'v2' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ policyRevision: 2 });
  });

  test('a description edit keeps the revision; a value edit bumps it', async () => {
    const id = await createHttp();
    expect(await (await patch(id, { description: 'note' })).json()).toMatchObject({
      policyRevision: 1,
    });
    expect(await (await patch(id, { http: policy })).json()).toMatchObject({ policyRevision: 1 });
    expect(await (await patch(id, { value: 'v2' })).json()).toMatchObject({ policyRevision: 2 });
  });

  test('a secret linked to a mail account cannot become http', async () => {
    const id = ((await (await post({ name: 'T', value: 'v1' })).json()) as { id: string }).id;
    const owner = s.db.select().from(user).all()[0];
    if (!owner) throw new Error('test server has no user');
    s.db
      .insert(mailAccount)
      .values({
        id: 'mail-1',
        teamId: s.team.id,
        userId: owner.id,
        provider: 'imap',
        mailbox: 'inbox@example.com',
        status: 'disconnected',
        secretId: id,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    expect((await patch(id, { delivery: 'http', http: policy })).status).toBe(400);
  });

  test('the table refuses a row whose columns disagree with its delivery', () => {
    const row = { id: 'bad', teamId: s.team.id, name: 'BAD', valueCipher: null };
    expect(() =>
      s.db
        .insert(secret)
        .values({ ...row, delivery: 'http' })
        .run(),
    ).toThrow();
    expect(() =>
      s.db
        .insert(secret)
        .values({ ...row, httpOrigin: 'https://api.example.com' })
        .run(),
    ).toThrow();
  });

  test('an http secret is never opened as a plaintext value', async () => {
    const id = await createHttp();
    const plain = createSecret(deps(), { teamId: s.team.id, name: 'PLAIN', value: 'p' });
    expect(openSecretValues(deps(), s.team.id, [id, plain.id], null)).toEqual({ PLAIN: 'p' });
  });

  test('the effective row decides: an http project row withholds the team value of that name', async () => {
    const projectId = await createProject();
    const team = createSecret(deps(), { teamId: s.team.id, name: 'TOKEN', value: 'team' });
    createSecret(deps(), {
      teamId: s.team.id,
      name: 'TOKEN',
      value: 'proj',
      projectId,
      delivery: 'http',
      http: policy,
    });
    expect(openSecretValues(deps(), s.team.id, [team.id], projectId)).toEqual({});
    expect(openSecretValues(deps(), s.team.id, [team.id], null)).toEqual({ TOKEN: 'team' });
  });

  test('a plaintext project row over an http team row stays the effective plaintext value', async () => {
    const projectId = await createProject();
    const team = createSecret(deps(), {
      teamId: s.team.id,
      name: 'TOKEN',
      value: 'team',
      delivery: 'http',
      http: policy,
    });
    createSecret(deps(), { teamId: s.team.id, name: 'TOKEN', value: 'proj', projectId });
    expect(openSecretValues(deps(), s.team.id, [team.id], projectId)).toEqual({ TOKEN: 'proj' });
    expect(updateSecret(deps(), s.team.id, team.id, { description: 'd' }).delivery).toBe('http');
  });
});
