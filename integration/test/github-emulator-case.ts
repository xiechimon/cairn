import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { openDbWithHandle } from '../../apps/server/src/db/client.js';
import { build, project, threadPr, todo } from '../../apps/server/src/db/schema.js';
import { seed } from '../../apps/server/src/db/seed.js';
import {
  type FetchLike,
  githubMergePull,
  githubUserRepos,
} from '../../apps/server/src/lib/github.js';
import { githubPrFeedback } from '../../apps/server/src/lib/github-feedback.js';
import type { UserToken } from '../../apps/server/src/lib/github-token.js';
import { createEphemeralSecretBox } from '../../apps/server/src/lib/secret-box.js';
import { TeamStreamHub } from '../../apps/server/src/services/events.js';
import { upsertGithubConnection } from '../../apps/server/src/services/github-connection.js';
import { createPrWatch } from '../../apps/server/src/services/pr-watch.js';
import { makeTestTempDir, releaseTestTempDir } from '../../scripts/test-tmpdir.mjs';

export async function runGithubEmulatorCase() {
  const dir = makeTestTempDir('github-emulator-');
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  assert(address !== null && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve, reject) =>
    reservation.close((err) => (err ? reject(err) : resolve())),
  );
  const seedPath = join(dir, 'seed.json');
  await writeFile(
    seedPath,
    JSON.stringify({
      github: { users: [{ login: 'octo' }], repos: [{ owner: 'octo', name: 'demo' }] },
    }),
  );
  const opened = openDbWithHandle(':memory:');
  const child = spawn(
    'npx',
    [
      '--yes',
      '--ignore-scripts',
      'emulate@0.13.0',
      'start',
      '--service',
      'github',
      '--host',
      '127.0.0.1',
      '--port',
      String(address.port),
      '--seed',
      seedPath,
    ],
    {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        npm_config_cache: process.env.npm_config_cache ?? join(tmpdir(), 'cairn-emulate-npm-cache'),
      },
    },
  );
  let output = '';
  let spawnError: Error | undefined;
  child.on('error', (error) => {
    spawnError = error;
  });
  child.stdout.on('data', (data: Buffer) => {
    output += data.toString();
  });
  child.stderr.on('data', (data: Buffer) => {
    output += data.toString();
  });
  const previousBase = process.env.CAIRN_GITHUB_API_BASE_URL;
  const requests: {
    method: string;
    url: string;
    body: unknown;
    status: number;
    response: unknown;
  }[] = [];
  const wire: FetchLike = async (input, init) => {
    assert.equal(new URL(input).origin, base);
    const response = await fetch(input, init);
    requests.push({
      method: init?.method ?? 'GET',
      url: String(input),
      body: init?.body ? JSON.parse(init.body) : null,
      status: response.status,
      response: await response.clone().json(),
    });
    return response;
  };
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await wire(`${base}${path}`, {
      method,
      headers: { authorization: 'Bearer emulate-local-token', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await response.json()) as Record<string, unknown>;
    assert(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
    return data;
  };
  try {
    const deadline = Date.now() + 90_000;
    for (;;) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`emulate exited: ${output}`);
      try {
        const response = await fetch(`${base}/user`, {
          headers: { authorization: 'Bearer emulate-local-token' },
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) break;
      } catch {}
      assert(Date.now() < deadline, `emulate startup timeout: ${output}`);
      await setTimeout(100);
    }
    process.env.CAIRN_GITHUB_API_BASE_URL = base;
    const main = await api('GET', '/repos/octo/demo/git/ref/heads/main');
    const head = (main.object as { sha: string }).sha;
    await api('POST', '/repos/octo/demo/git/refs', { ref: 'refs/heads/evidence', sha: head });
    const content = await api('PUT', '/repos/octo/demo/contents/evidence.txt', {
      branch: 'evidence',
      message: 'Evidence commit',
      content: Buffer.from('D109 emulator evidence\n').toString('base64'),
    });
    const sha = (content.commit as { sha: string }).sha;
    const pull = await api('POST', '/repos/octo/demo/pulls', {
      title: 'D109 emulator evidence',
      head: 'evidence',
      base: 'main',
    });
    const number = pull.number as number;
    const prefix = `/repos/octo/demo/pulls/${number}`;
    for (const conclusion of ['success', 'failure']) {
      await api('POST', '/repos/octo/demo/check-runs', {
        name: conclusion,
        head_sha: sha,
        status: 'completed',
        conclusion,
      });
    }
    await api('POST', `${prefix}/reviews`, {
      event: 'REQUEST_CHANGES',
      body: 'Please add coverage.',
      commit_id: sha,
      comments: [{ path: 'evidence.txt', position: 1, body: 'Explain this change.' }],
    });
    const { db } = opened;
    const world = seed(db);
    const box = createEphemeralSecretBox();
    upsertGithubConnection(
      { db, box },
      { teamId: world.team.id, login: 'octo', accessToken: 'emulate-local-token', scope: 'repo' },
    );
    db.insert(project)
      .values({
        id: 'project',
        teamId: world.team.id,
        name: 'Emulator',
        repoKind: 'github',
        githubRepo: 'octo/demo',
      })
      .run();
    db.insert(todo)
      .values({
        id: 'thread',
        teamId: world.team.id,
        projectId: 'project',
        title: 'D109',
        phase: 'review',
        phaseAt: 1,
        seqNum: 1,
        latestBuildId: 'build',
      })
      .run();
    db.insert(build)
      .values({
        id: 'build',
        todoId: 'thread',
        createdAt: 1,
        withPlan: false,
        triggerSource: 'user',
        prNumber: number,
      })
      .run();
    const watch = createPrWatch(
      { db, box, user: world.user, hub: new TeamStreamHub() },
      { githubFetch: wire },
    );
    assert.equal(db.select().from(threadPr).all().length, 0);
    assert.equal((await watch.sweep(1_000)).created, 1);
    const open = db.select().from(threadPr).get();
    assert(open);
    assert.equal(open.head, sha);
    assert.equal(open.checksPassed, 1);
    assert.equal(open.checksFailed, 1);
    const feedback = await githubPrFeedback(wire, 'emulate-local-token', 'octo', 'demo', number);
    assert(
      feedback.comments.some((row) => row.kind === 'review' && row.body === 'Please add coverage.'),
    );
    assert(
      (await githubUserRepos(wire, 'emulate-local-token')).some(
        (repo) => repo.fullName === 'octo/demo',
      ),
    );
    const merge = await githubMergePull(
      wire,
      'emulate-local-token' as UserToken,
      'octo',
      'demo',
      number,
      {
        sha,
        commitTitle: 'D109 evidence',
        commitMessage: 'Local only',
      },
    );
    assert.equal(merge.kind, 'merged');
    await watch.sweep(70_000);
    const merged = db.select().from(threadPr).get();
    assert(merged);
    assert.equal(merged.state, 'merged');
    const before = requests.length;
    await watch.sweep(140_000);
    assert.equal(requests.length, before);
    db.update(build)
      .set({ prNumber: number + 999 })
      .run();
    const missing = createPrWatch(
      { db, box, user: world.user, hub: new TeamStreamHub() },
      { githubFetch: wire },
    );
    const { unreadable } = await missing.sweep(200_000);
    assert.equal(unreadable, 1);
    assert.equal(db.select().from(threadPr).get()?.state, 'merged');
    const result = {
      provider: 'GitHub emulator (emulate.dev)',
      version: '0.13.0',
      open,
      feedback,
      merged,
      unreadable,
      requests,
    };
    const evidence = process.env.VERIFY_EVIDENCE_DIR;
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
      await writeFile(join(evidence, 'emulate.txt'), output);
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        await page.route(`${base}/__evidence/swagger`, (route) =>
          route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><html><head><title>GitHub emulator API</title></head><body><div id="swagger-ui"></div></body></html>',
          }),
        );
        await page.goto(`${base}/__evidence/swagger`);
        await page.addStyleTag({ url: 'https://unpkg.com/swagger-ui-dist@5.34.1/swagger-ui.css' });
        await page.addScriptTag({
          url: 'https://unpkg.com/swagger-ui-dist@5.34.1/swagger-ui-bundle.js',
        });
        await page.evaluate(
          ({ base, sha }) => {
            const swagger = (
              globalThis as unknown as { SwaggerUIBundle: (options: unknown) => unknown }
            ).SwaggerUIBundle;
            swagger({
              dom_id: '#swagger-ui',
              spec: {
                openapi: '3.0.3',
                info: { title: 'GitHub emulator (emulate.dev 0.13.0)', version: 'D109' },
                servers: [{ url: base }],
                paths: {
                  [`/repos/octo/demo/commits/${sha}/check-runs`]: {
                    get: {
                      summary: 'Read the checks polled by Cairn PrWatch',
                      responses: { '200': { description: 'Stateful check runs' } },
                    },
                  },
                },
              },
            });
          },
          { base, sha },
        );
        await page.locator('.opblock-summary').click();
        await page.getByRole('button', { name: 'Try it out' }).click();
        const responsePromise = page.waitForResponse(
          `${base}/repos/octo/demo/commits/${sha}/check-runs`,
        );
        await page.getByRole('button', { name: 'Execute', exact: true }).click();
        assert.equal((await responsePromise).status(), 200);
        await page
          .locator('.responses-inner .response-col_status')
          .filter({ hasText: '200' })
          .first()
          .waitFor();
        await page.locator('.request-url').waitFor();
        await page.screenshot({ path: join(evidence, 'github-requests.png'), fullPage: true });
        await page.goto('https://emulate.dev/docs/github');
        await page.screenshot({ path: join(evidence, 'emulate-docs.png'), fullPage: true });
      } finally {
        await browser.close();
      }
    }
    return result;
  } finally {
    if (previousBase === undefined) delete process.env.CAIRN_GITHUB_API_BASE_URL;
    else process.env.CAIRN_GITHUB_API_BASE_URL = previousBase;
    opened.close();
    if (child.pid !== undefined && child.exitCode === null) {
      const exited = once(child, 'exit');
      process.kill(-child.pid, 'SIGTERM');
      await exited;
    }
    releaseTestTempDir(dir);
  }
}
