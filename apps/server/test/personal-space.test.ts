import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { ProjectRecord } from '@cairn/shared';
import { serve } from '@hono/node-server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { project, step } from '../src/db/schema.js';
import { runGit } from '../src/lib/git.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { issueStepGitCredential } from '../src/services/credentials.js';
import { repoDirFor } from '../src/services/git.js';
import { ensurePersonalSpace, PERSONAL_SPACE_NAME } from '../src/services/personal-space.js';
import {
  bootServer,
  insertGitApiKey,
  insertMachine,
  postProject,
  queueConnectorStep,
  req,
  type TestServer,
} from './helpers.js';

const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'space-probe',
  GIT_AUTHOR_EMAIL: 'probe@localhost',
  GIT_COMMITTER_NAME: 'space-probe',
  GIT_COMMITTER_EMAIL: 'probe@localhost',
};
const TEAM_KEY = 'cairn_ps_team_git_key_0000000000000000';

const dirs: string[] = [];
let s: TestServer;
let baseUrl: string;
let closeServer: () => Promise<void>;

beforeAll(async () => {
  s = bootServer();
  insertGitApiKey(s, TEAM_KEY);
  const server = serve({ fetch: s.app.fetch, port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closeServer = () => new Promise<void>((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await closeServer();
  s.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repoCtx() {
  return { db: s.db, reposDir: s.reposDir };
}

function spaceUrl(repoName: string, password?: string): string {
  const url = new URL(`${baseUrl}/git/${s.team.id}/${repoName}`);
  if (password !== undefined) {
    url.username = 'git';
    url.password = password;
  }
  return url.toString();
}

async function git(args: string[], cwd: string) {
  return runGit(args, { cwd, env: GIT_ENV, timeoutMs: 60_000 });
}

function claimedStepKey(projectId: string): string {
  const machineId = insertMachine(s);
  const stepId = queueConnectorStep(s, projectId, machineId);
  s.db.update(step).set({ status: 'claimed', machineId }).where(eq(step.id, stepId)).run();
  return issueStepGitCredential({ db: s.db }, { teamId: s.team.id, stepId }).password;
}

describe('personal space row and repository (docs/design/personal-space.md S1)', () => {
  test('first use creates one hidden hosted space per user, even when two callers race', async () => {
    const [a, b] = await Promise.all([
      ensurePersonalSpace(repoCtx(), s.team.id, s.user.id),
      ensurePersonalSpace(repoCtx(), s.team.id, s.user.id),
    ]);
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({
      name: PERSONAL_SPACE_NAME,
      repoKind: 'hosted',
      personalOwnerId: s.user.id,
    });
    const again = await ensurePersonalSpace(repoCtx(), s.team.id, s.user.id);
    expect(again.repoName).toBe(a.repoName);
    const spaces = s.db.select().from(project).where(eq(project.personalOwnerId, s.user.id)).all();
    expect(spaces).toHaveLength(1);
    const repos = readdirSync(join(s.reposDir, s.team.id)).filter((n) => n.startsWith('space-'));
    expect(repos).toEqual([`${a.repoName}.git`]);
    expect(existsSync(repoDirFor(s.reposDir, s.team.id, a.repoName!))).toBe(true);
  });

  test('project lists, the Coordinator and search never show a space', async () => {
    const space = await ensurePersonalSpace(repoCtx(), s.team.id, s.user.id);
    const listed = (await (await req(s.app, 'GET', '/api/projects')).json()) as ProjectRecord[];
    expect(listed.map((p) => p.id)).not.toContain(space.id);
    const tool = await executeChiefTool(
      {
        db: s.db,
        hub: s.hub,
        box: s.secretBox,
        user: s.user,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: s.skillsDir,
      },
      {
        teamId: s.team.id,
        userId: s.user.id,
        chiefId: 'chief-probe',
        threadId: 'thread-probe',
        chiefAgentId: null,
        conversationId: 'thread-probe',
      },
      'projects',
      {},
    );
    expect(tool).not.toContain(space.id);
    for (const q of [PERSONAL_SPACE_NAME, `project:${PERSONAL_SPACE_NAME}`]) {
      const found = await req(s.app, 'GET', `/api/search?q=${encodeURIComponent(q)}`);
      expect(found.status).toBe(200);
      expect(JSON.stringify(await found.json())).not.toContain(space.id);
    }
  });

  test('project routes cannot read, archive or delete a space (P11)', async () => {
    const space = await ensurePersonalSpace(repoCtx(), s.team.id, s.user.id);
    expect((await req(s.app, 'GET', `/api/projects/${space.id}/files`)).status).toBe(404);
    expect((await req(s.app, 'POST', `/api/projects/${space.id}/archive`)).status).toBe(404);
    expect((await req(s.app, 'DELETE', `/api/projects/${space.id}`)).status).toBe(404);
    expect(
      (await req(s.app, 'POST', `/api/projects/${space.id}/todos`, { title: 'x' })).status,
    ).toBe(404);
    const row = s.db.select().from(project).where(eq(project.id, space.id)).get()!;
    expect(row.archivedAt).toBeNull();
  });
});

describe('space git access (P4)', () => {
  test('only the build running a space task reads the space repository', async () => {
    const space = await ensurePersonalSpace(repoCtx(), s.team.id, s.user.id);
    const otherId = await postProject(s.app, 'site', { repoKind: 'hosted' });
    const other = s.db.select().from(project).where(eq(project.id, otherId)).get()!;
    const work = makeTestTempDir('cairn-space-');
    dirs.push(work);
    const repo = space.repoName!;
    expect((await git(['ls-remote', spaceUrl(repo)], work)).code).not.toBe(0);
    const teamKey = await git(['ls-remote', spaceUrl(repo, TEAM_KEY)], work);
    expect(teamKey.code).not.toBe(0);
    expect(teamKey.stderr.toString()).toContain('not found');
    const otherBuild = await git(['ls-remote', spaceUrl(repo, claimedStepKey(other.id))], work);
    expect(otherBuild.code).not.toBe(0);
    expect((await git(['ls-remote', spaceUrl(repo, claimedStepKey(space.id))], work)).code).toBe(0);
    expect((await git(['ls-remote', spaceUrl(other.repoName!, TEAM_KEY)], work)).code).toBe(0);
  });

  test('a push can add a branch but never move the default branch', async () => {
    const space = await ensurePersonalSpace(repoCtx(), s.team.id, s.user.id);
    const work = makeTestTempDir('cairn-space-push-');
    dirs.push(work);
    const url = spaceUrl(space.repoName!, claimedStepKey(space.id));
    expect((await git(['clone', '-q', url, 'w'], work)).code).toBe(0);
    const clone = join(work, 'w');
    writeFileSync(join(clone, 'note.md'), 'hello\n');
    await git(['add', 'note.md'], clone);
    expect((await git(['commit', '-qm', 'note'], clone)).code).toBe(0);
    const toMain = await git(['push', 'origin', 'HEAD:main'], clone);
    expect(toMain.code).not.toBe(0);
    expect(toMain.stderr.toString()).toContain('hidden ref');
    expect((await git(['push', 'origin', 'HEAD:refs/heads/task-1'], clone)).code).toBe(0);
  });
});
