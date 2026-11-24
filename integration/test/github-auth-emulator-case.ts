import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { openDbWithHandle } from '../../apps/server/src/db/client.js';
import { githubConnection } from '../../apps/server/src/db/schema.js';
import { seed } from '../../apps/server/src/db/seed.js';
import { githubAppUserRepos } from '../../apps/server/src/lib/github.js';
import { createEphemeralSecretBox } from '../../apps/server/src/lib/secret-box.js';
import { githubTokenOrNull } from '../../apps/server/src/services/github-connection.js';
import {
  type GithubConnectionDeviceAttempt,
  pollGithubConnectionDevice,
  startGithubConnectionDevice,
} from '../../apps/server/src/services/github-connection-device.js';
import { adoptGithubProfile } from '../../apps/server/src/services/github-profile.js';
import { githubAuthFake } from '../../apps/server/test/fakes/github-auth.js';
import { makeTestTempDir, releaseTestTempDir } from '../../scripts/test-tmpdir.mjs';

const APP = { clientId: 'Iv23shared', slug: 'cairnwright' };

export async function runGithubAuthEmulatorCase() {
  const dir = makeTestTempDir('github-auth-emulator-');
  const fake = githubAuthFake();
  const served = await fake.serve();
  const previousApi = process.env.CAIRN_GITHUB_API_BASE_URL;
  const previousOauth = process.env.CAIRN_GITHUB_OAUTH_BASE_URL;
  process.env.CAIRN_GITHUB_API_BASE_URL = served.url;
  process.env.CAIRN_GITHUB_OAUTH_BASE_URL = served.url;
  const opened = openDbWithHandle(':memory:');
  const requests: { method: string; url: string; form: Record<string, string> }[] = [];
  fake.setOnRequest((call) => {
    requests.push({
      method: call.method,
      url: call.url,
      form: Object.fromEntries(call.form),
    });
  });
  try {
    const { db } = opened;
    const world = seed(db);
    const box = createEphemeralSecretBox();
    const attempts = new Map<string, GithubConnectionDeviceAttempt>();
    const deps = {
      db,
      box,
      fetch: globalThis.fetch,
      app: APP,
      attempts,
    };

    const started = await startGithubConnectionDevice(deps, {
      teamId: world.team.id,
      userId: world.user.id,
    });
    assert.match(started.userCode, /^FAKE-/);
    assert.equal(started.verificationUri, `${served.url}/login/device`);
    assert.equal(
      (
        await pollGithubConnectionDevice(deps, {
          teamId: world.team.id,
          userId: world.user.id,
          attemptId: started.attemptId,
        })
      ).status,
      'pending',
    );

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(started.verificationUri);
      await page.locator('input[name="user_code"]').fill(started.userCode);
      await page.getByRole('button', { name: 'Authorize' }).click();
      await page.getByText('authorized').waitFor();
    } finally {
      await browser.close();
    }

    await new Promise((r) => setTimeout(r, started.intervalSeconds * 1000));
    const done = await pollGithubConnectionDevice(deps, {
      teamId: world.team.id,
      userId: world.user.id,
      attemptId: started.attemptId,
    });
    assert.deepEqual(done, { status: 'complete', login: 'octo' });
    const saved = db
      .select()
      .from(githubConnection)
      .where(eq(githubConnection.teamId, world.team.id))
      .get();
    assert.equal(saved?.login, 'octo');
    assert.equal(saved?.githubUserId, 42);
    assert.equal(saved?.appClientId, APP.clientId);
    adoptGithubProfile({ db, user: world.user }, world.team.id);
    assert.equal(world.user.displayName, 'Octo Cat');
    assert.equal(world.user.avatarUrl, 'https://avatars.githubusercontent.com/u/42?v=4');

    const token = await githubTokenOrNull(
      { db, box, githubFetch: globalThis.fetch },
      world.team.id,
    );
    assert.match(token ?? '', /^ghu_/);
    const repoList = await githubAppUserRepos(globalThis.fetch, token ?? '');
    assert(repoList.repos.some((r) => r.fullName === 'octo/demo'));

    db.update(githubConnection)
      .set({ accessTokenExpiresAt: Date.now() + 30_000 })
      .where(eq(githubConnection.teamId, world.team.id))
      .run();
    const rotated = await githubTokenOrNull(
      { db, box, githubFetch: globalThis.fetch },
      world.team.id,
    );
    assert(rotated !== null && rotated !== token && rotated.startsWith('ghu_'));

    const grant = fake.grants.get(rotated);
    assert(grant !== undefined);
    fake.revoke(grant.refreshToken);
    db.update(githubConnection)
      .set({ accessTokenExpiresAt: Date.now() + 30_000 })
      .where(eq(githubConnection.teamId, world.team.id))
      .run();
    assert.equal(
      await githubTokenOrNull({ db, box, githubFetch: globalThis.fetch }, world.team.id),
      null,
    );
    assert.equal(
      db.select().from(githubConnection).get()?.disconnectedReason,
      'GitHub authorization expired',
    );

    const result = {
      provider: 'cairn githubAuthFake over loopback HTTP',
      saved,
      repos: repoList.repos,
      requests,
    };
    const evidence = process.env.VERIFY_EVIDENCE_DIR;
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
    }
    return result;
  } finally {
    if (previousApi === undefined) delete process.env.CAIRN_GITHUB_API_BASE_URL;
    else process.env.CAIRN_GITHUB_API_BASE_URL = previousApi;
    if (previousOauth === undefined) delete process.env.CAIRN_GITHUB_OAUTH_BASE_URL;
    else process.env.CAIRN_GITHUB_OAUTH_BASE_URL = previousOauth;
    opened.close();
    await served.close();
    releaseTestTempDir(dir);
  }
}
