import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { expect, onTestFinished, test, vi } from 'vitest';
import { migrateDatabase } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { hashCredential } from '../src/lib/hash.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { createPairedDevice } from '../src/services/paired-devices.js';
import { bootServer } from './helpers.js';

function setup(credentialTable: 'machine' | 'paired_device') {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  onTestFinished(() => {
    sqlite.close();
  });
  const events: { kind: string; inTransaction: boolean }[] = [];
  const db = drizzle(sqlite, {
    schema,
    logger: {
      logQuery(query) {
        if (events.length === 0) return;
        if (query.startsWith('select') && query.includes(`from "${credentialTable}"`)) {
          if (sqlite.inTransaction) events.push({ kind: 'credential', inTransaction: true });
        }
        if (/^(insert into|update) "project" /.test(query)) {
          events.push({ kind: 'write', inTransaction: sqlite.inTransaction });
        }
      },
    },
  });
  migrateDatabase(db, sqlite);
  const githubFetch = vi.fn<FetchLike>(async () => {
    events.push({ kind: 'probe', inTransaction: sqlite.inTransaction });
    return Response.json({ full_name: 'octo/demo' });
  });
  const root = join(tmpdir(), 'unused-project-binding-roots');
  const s = bootServer({
    db,
    githubFetch,
    authToken: 'fixture-owner-token',
    reposDir: join(root, 'repos'),
    attachmentsDir: join(root, 'attachments'),
    skillsDir: join(root, 'skills'),
    skillSourcesPath: join(root, 'skill-sources.json'),
    homeDir: join(root, 'home'),
    dataDir: join(root, 'data'),
    workspacesDir: join(root, 'workspaces'),
  });
  upsertGithubConnection(
    { db, box: s.secretBox },
    { teamId: s.team.id, login: 'octo', accessToken: 'fixture-github-access', scope: 'repo' },
  );
  return { s, db, events };
}

function expectCommitAuthorization(events: ReturnType<typeof setup>['events']) {
  expect(events[0]).toEqual({ kind: 'probe', inTransaction: false });
  expect(events.at(-1)).toEqual({ kind: 'write', inTransaction: true });
  expect(events.length).toBeGreaterThanOrEqual(3);
  expect(
    events.slice(1, -1).every((event) => event.kind === 'credential' && event.inTransaction),
  ).toBe(true);
}

test('Runner repository binding checks the submitting credential in the write transaction', async () => {
  const { s, db, events } = setup('machine');
  const token = 'fixture-runner-credential';
  const teamId = s.team.id;
  const userId = s.user.id;
  db.insert(schema.machine)
    .values({ id: 'runner', teamId, name: 'Runner', tokenHash: hashCredential(token) })
    .run();
  db.insert(schema.chief).values({ id: 'chief', teamId, userId, createdAt: 1 }).run();
  db.insert(schema.chiefThread)
    .values({
      id: 'chief-binding-thread',
      chiefId: 'chief',
      teamId,
      userId,
      title: 'Repository binding',
      createdAt: 1,
      updatedAt: 1,
      sessionId: '',
      sessionOpenedAt: 1,
    })
    .run();
  db.insert(schema.step)
    .values({
      id: 'binding-step',
      buildId: 'chief-binding-thread',
      kind: 'chief',
      machineId: 'runner',
      status: 'claimed',
      claimedAt: 2,
      createdAt: 1,
    })
    .run();
  db.insert(schema.project).values({ id: 'project', teamId, name: 'Project' }).run();

  const response = await s.app.request('/api/machine/tool/binding-step', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'connect_repo',
      params: { projectId: 'project', githubRepo: 'octo/demo' },
    }),
  });

  expect(response.status).toBe(200);
  expectCommitAuthorization(events);
});

test.each(['create', 'retarget', 'convert'] as const)(
  'paired-device GitHub %s checks the device in the write transaction',
  async (operation) => {
    const { s, db, events } = setup('paired_device');
    const teamId = s.team.id;
    const { token } = createPairedDevice(db, { teamId, name: 'Phone' });
    if (operation !== 'create') {
      db.insert(schema.project)
        .values({
          id: 'project',
          teamId,
          name: 'Project',
          ...(operation === 'retarget'
            ? { repoKind: 'github', githubRepo: 'octo/previous' }
            : { repoKind: 'local' }),
        })
        .run();
    }

    const response = await s.app.request(
      operation === 'create' ? '/api/projects' : '/api/projects/project',
      {
        method: operation === 'create' ? 'POST' : 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          githubRepo: 'octo/demo',
          ...(operation === 'create' ? { name: 'Project', kind: 'github' } : {}),
          ...(operation === 'convert' ? { repoKind: 'github' } : {}),
        }),
      },
    );

    expect(response.status).toBe(operation === 'create' ? 201 : 200);
    expectCommitAuthorization(events);
  },
);
