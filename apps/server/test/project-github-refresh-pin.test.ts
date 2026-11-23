import { setImmediate } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { openDbWithHandle } from '../src/db/client.js';
import { team } from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import type { FetchLike } from '../src/lib/github.js';
import { createEphemeralSecretBox } from '../src/lib/secret-box.js';
import { connectionToken, upsertGithubConnection } from '../src/services/github-connection.js';
import { assertGithubRepoReachable } from '../src/services/projects.js';

test('a binding probe refreshes only its pinned GitHub connection', async () => {
  const { db, close } = openDbWithHandle(':memory:');
  const teamId = 'binding-team';
  const now = Date.now();
  db.insert(team).values({ id: teamId, name: 'Binding team', createdAt: now }).run();

  let finishRetiredRefresh = () => {};
  const retiredRefresh = new Promise<Response>((resolve) => {
    finishRetiredRefresh = () => resolve(new Response(null, { status: 502 }));
  });
  const refreshGrants: (string | null)[] = [];
  const probeBearers: (string | undefined)[] = [];
  const githubFetch: FetchLike = async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/login/oauth/access_token') {
      const grant = new URLSearchParams(init?.body).get('refresh_token');
      refreshGrants.push(grant);
      if (grant === 'retired-grant') return retiredRefresh;
      if (grant === 'replacement-grant') {
        return Response.json({
          access_token: 'replacement-rotated',
          refresh_token: 'replacement-next-grant',
          expires_in: 3600,
          refresh_token_expires_in: 7200,
        });
      }
    }
    if (path === '/repos/owner/repo') {
      const bearer = init?.headers?.authorization;
      probeBearers.push(bearer);
      if (bearer === 'Bearer replacement-access') return new Response(null, { status: 401 });
      if (bearer === 'Bearer replacement-rotated') return new Response(null, { status: 404 });
      if (bearer === 'Bearer retired-access') return Response.json({ full_name: 'owner/repo' });
    }
    throw new Error(`Unexpected GitHub request: ${path}`);
  };
  const deps = { db, box: createEphemeralSecretBox(), githubFetch };
  const device = { clientId: 'test-device-client', refreshTokenExpiresAt: now + 7_200_000 };
  upsertGithubConnection(deps, {
    teamId,
    login: 'retired',
    accessToken: 'retired-access',
    refreshToken: 'retired-grant',
    accessTokenExpiresAt: now - 1,
    scope: 'repo',
    device,
  });
  const oldAccess = connectionToken(deps, teamId);
  try {
    expect(refreshGrants).toEqual(['retired-grant']);
    upsertGithubConnection(deps, {
      teamId,
      login: 'replacement',
      accessToken: 'replacement-access',
      refreshToken: 'replacement-grant',
      accessTokenExpiresAt: now + 3_600_000,
      scope: 'repo',
      device,
    });
    const status = assertGithubRepoReachable(deps, teamId, 'owner/repo').then(
      () => 200,
      (error: unknown) => {
        if (error instanceof HttpError) return error.status;
        throw error;
      },
    );
    await setImmediate();
    finishRetiredRefresh();
    expect(await status).toBe(400);
    expect(refreshGrants).toEqual(['retired-grant', 'replacement-grant']);
    expect(probeBearers).toEqual(['Bearer replacement-access', 'Bearer replacement-rotated']);
  } finally {
    finishRetiredRefresh();
    await oldAccess;
    close();
  }
});
