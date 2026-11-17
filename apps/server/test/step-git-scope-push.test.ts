import { rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { conversationBranch } from '@cairn/shared';
import { serve } from '@hono/node-server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { step } from '../src/db/schema.js';
import { runGit } from '../src/lib/git.js';
import { issueStepGitCredential } from '../src/services/credentials.js';
import {
  bootServer,
  insertMachine,
  postProject,
  queueConnectorStep,
  type TestServer,
} from './helpers.js';

const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'probe',
  GIT_AUTHOR_EMAIL: 'probe@localhost',
  GIT_COMMITTER_NAME: 'probe',
  GIT_COMMITTER_EMAIL: 'probe@localhost',
};

let s: TestServer;
let baseUrl: string;
let closeServer: () => Promise<void>;
const dirs: string[] = [];

beforeAll(async () => {
  s = bootServer();
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

const git = (args: string[], cwd: string) => runGit(args, { cwd, env: GIT_ENV, timeoutMs: 60_000 });

test('the runner clones the hosted repo and pushes its own work branch with the step key, and only that branch', async () => {
  const projectId = await postProject(s.app, 'scope-repo', { repoKind: 'hosted' });
  const machineId = insertMachine(s);
  const stepId = queueConnectorStep(s, projectId, machineId);
  s.db.update(step).set({ status: 'claimed', machineId }).where(eq(step.id, stepId)).run();
  const stepRow = s.db.select().from(step).where(eq(step.id, stepId)).get()!;
  const { password } = issueStepGitCredential(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, stepId, claimedAt: stepRow.claimedAt },
  );
  const url = new URL(`${baseUrl}/git/${s.team.id}/scope-repo`);
  url.username = 'git';
  url.password = password;
  const dir = makeTestTempDir('cairn-step-scope-');
  dirs.push(dir);
  expect((await git(['clone', '-q', url.toString(), 'w'], dir)).code).toBe(0);
  const clone = join(dir, 'w');
  writeFileSync(join(clone, 'note.md'), 'hello\n');
  await git(['add', 'note.md'], clone);
  expect((await git(['commit', '-qm', 'note'], clone)).code).toBe(0);
  const toMain = await git(['push', 'origin', 'HEAD:refs/heads/main'], clone);
  expect(toMain.code).not.toBe(0);
  const work = `refs/heads/${conversationBranch(stepRow.buildId)}`;
  const pushed = await git(['push', 'origin', `HEAD:${work}`], clone);
  expect(pushed.stderr.toString()).not.toMatch(/returned error: 403\b/);
  expect(pushed.code, pushed.stderr.toString()).toBe(0);
  expect((await git(['ls-remote', 'origin', work], clone)).stdout.toString()).toContain(work);
  expect((await git(['push', 'origin', 'HEAD:refs/heads/other'], clone)).code).not.toBe(0);
});
