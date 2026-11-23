import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { projectRepoRef } from '../src/services/git.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { bootServer, req } from './helpers.js';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string; when: number }[];
};

const s = bootServer({
  githubFetch: async () => new Response(JSON.stringify({ full_name: 'octo/app' }), { status: 200 }),
});
upsertGithubConnection(
  { db: s.db, box: s.secretBox },
  { teamId: s.team.id, login: 'octo', accessToken: 'ghp_no_local', scope: 'repo' },
);
afterAll(() => s.dispose());

test('a github project that had a local folder set runs from its GitHub clone after the upgrade', () => {
  const directory = makeTestTempDir('cairn-github-local-path-');
  const sqlite = new Database(join(directory, 'db.sqlite'));
  const db = drizzle(sqlite, { schema });
  try {
    const drop = journal.entries.findIndex((entry) =>
      readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8').includes(
        "SET `localPath` = NULL WHERE `repoKind` = 'github'",
      ),
    );
    const cut = drop === -1 ? journal.entries.length : drop;
    const prior = join(directory, 'prior');
    mkdirSync(join(prior, 'meta'), { recursive: true });
    const entries = journal.entries.slice(0, cut);
    writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) {
      copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(prior, `${entry.tag}.sql`));
    }
    migrate(db, { migrationsFolder: prior });
    sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('team', 'Team', 1)");
    sqlite.exec(
      "INSERT INTO project (id, name, teamId, repoKind, githubRepo, localPath) VALUES ('gh', 'gh', 'team', 'github', 'octo/app', '/Users/who/code/app'), ('lo', 'lo', 'team', 'local', NULL, '/Users/who/code/lo')",
    );
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const github = db.select().from(schema.project).where(eq(schema.project.id, 'gh')).get();
    const local = db.select().from(schema.project).where(eq(schema.project.id, 'lo')).get();
    expect(projectRepoRef(github, '')).toEqual({
      kind: 'github',
      cloneUrl: 'https://github.com/octo/app.git',
    });
    expect(local?.localPath).toBe('/Users/who/code/lo');
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('creating a GitHub project with a local folder rejects localPath before probing GitHub', async () => {
  const githubFetch = vi.fn(async () => new Response(null, { status: 404 }));
  const server = bootServer({ githubFetch });
  try {
    upsertGithubConnection(
      { db: server.db, box: server.secretBox },
      { teamId: server.team.id, login: 'octo', accessToken: 'test-access', scope: 'repo' },
    );
    const response = await req(server.app, 'POST', '/api/projects', {
      name: 'gh-invalid-folder',
      kind: 'github',
      githubRepo: 'octo/app',
      localPath: '/Users/who/code/app',
    });
    expect.soft(response.status).toBe(400);
    expect.soft(await response.json()).toMatchObject({
      error: 'invalid body at localPath: not allowed for kind "github"',
    });
    expect(githubFetch).not.toHaveBeenCalled();
  } finally {
    server.dispose();
  }
});

test('a github project refuses a local folder on create and on edit', async () => {
  const created = await req(s.app, 'POST', '/api/projects', {
    name: 'gh-with-folder',
    kind: 'github',
    githubRepo: 'octo/app',
    localPath: '/Users/who/code/app',
  });
  expect(created.status).toBe(400);
  const plain = await req(s.app, 'POST', '/api/projects', {
    name: 'gh-plain',
    kind: 'github',
    githubRepo: 'octo/app',
  });
  expect(plain.status).toBe(201);
  const id = String(((await plain.json()) as { id: string }).id);
  const patched = await req(s.app, 'PATCH', `/api/projects/${id}`, {
    localPath: '/Users/who/code/app',
  });
  expect(patched.status).toBe(400);
  const row = s.db.select().from(schema.project).where(eq(schema.project.id, id)).get();
  expect(row?.localPath).toBeNull();
});
