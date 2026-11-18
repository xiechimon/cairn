import type {
  GithubConnectionDevicePoll,
  GithubConnectionDeviceStart,
  SecretBox,
} from '@cairn/shared';
import type { Db } from '../db/client.js';
import { HttpError, notFound } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { upsertGithubConnection } from './github-connection.js';
import { pollGithubDeviceCode, requestGithubDeviceCode } from './github-device-core.js';

export interface GithubConnectionDeviceAttempt {
  teamId: string;
  userId: string;
  deviceCode: string;
  intervalSeconds: number;
  expiresAt: number;
  nextPollAt: number;
  polling: boolean;
  target?: unknown;
}

export interface GithubConnectionDeviceDeps {
  db: Db;
  box: SecretBox;
  fetch: FetchLike;
  app: Readonly<{ clientId: string; slug: string }> | null;
  attempts: Map<string, GithubConnectionDeviceAttempt>;
}

function requireApp(deps: GithubConnectionDeviceDeps) {
  if (deps.app === null) throw new HttpError(400, 'GitHub sign-in is not set up on this server');
  return deps.app;
}

export function githubConnectionInstallUrl(
  app: Readonly<{ clientId: string; slug: string }> | null,
): string | null {
  return app === null ? null : `https://github.com/apps/${app.slug}/installations/new`;
}

function sweep(attempts: Map<string, GithubConnectionDeviceAttempt>): void {
  const now = nowMs();
  for (const [id, attempt] of attempts) if (attempt.expiresAt <= now) attempts.delete(id);
}

export async function startGithubConnectionDevice(
  deps: GithubConnectionDeviceDeps,
  input: { teamId: string; userId: string; target?: unknown },
): Promise<GithubConnectionDeviceStart> {
  const app = requireApp(deps);
  const code = await requestGithubDeviceCode({ fetch: deps.fetch }, app.clientId);
  sweep(deps.attempts);
  for (const [id, attempt] of deps.attempts)
    if (attempt.teamId === input.teamId) deps.attempts.delete(id);
  const attemptId = newRecordId(32);
  const now = nowMs();
  deps.attempts.set(attemptId, {
    teamId: input.teamId,
    userId: input.userId,
    deviceCode: code.deviceCode,
    intervalSeconds: code.intervalSeconds,
    expiresAt: now + code.expiresInSeconds * 1000,
    nextPollAt: now + code.intervalSeconds * 1000,
    polling: false,
    ...(input.target !== undefined ? { target: input.target } : {}),
  });
  return {
    attemptId,
    userCode: code.userCode,
    verificationUri: code.verificationUri,
    intervalSeconds: code.intervalSeconds,
    expiresInSeconds: code.expiresInSeconds,
  };
}

function ownAttempt(
  deps: GithubConnectionDeviceDeps,
  input: { teamId: string; userId: string; attemptId: string },
): GithubConnectionDeviceAttempt {
  const attempt = deps.attempts.get(input.attemptId);
  if (!attempt || attempt.teamId !== input.teamId || attempt.userId !== input.userId)
    throw notFound('GitHub sign-in attempt');
  return attempt;
}

export function cancelGithubConnectionDevice(
  deps: GithubConnectionDeviceDeps,
  input: { teamId: string; userId: string; attemptId: string },
): void {
  ownAttempt(deps, input);
  deps.attempts.delete(input.attemptId);
}

export async function pollGithubConnectionDevice(
  deps: GithubConnectionDeviceDeps,
  input: { teamId: string; userId: string; attemptId: string },
): Promise<GithubConnectionDevicePoll> {
  const attempt = ownAttempt(deps, input);
  const now = nowMs();
  if (attempt.expiresAt <= now) {
    deps.attempts.delete(input.attemptId);
    return { status: 'expired' };
  }
  if (attempt.polling || now < attempt.nextPollAt)
    return { status: 'pending', intervalSeconds: attempt.intervalSeconds };
  const app = requireApp(deps);
  attempt.polling = true;
  let result: Awaited<ReturnType<typeof pollGithubDeviceCode>>;
  try {
    result = await pollGithubDeviceCode({ fetch: deps.fetch }, app.clientId, attempt.deviceCode);
  } finally {
    attempt.polling = false;
    attempt.nextPollAt = nowMs() + attempt.intervalSeconds * 1000;
  }
  if (deps.attempts.get(input.attemptId) !== attempt) return { status: 'expired' };
  if (result.status === 'pending')
    return { status: 'pending', intervalSeconds: attempt.intervalSeconds };
  if (result.status === 'slow_down') {
    attempt.intervalSeconds = result.intervalSeconds ?? attempt.intervalSeconds + 5;
    attempt.nextPollAt = nowMs() + attempt.intervalSeconds * 1000;
    return { status: 'pending', intervalSeconds: attempt.intervalSeconds };
  }
  deps.attempts.delete(input.attemptId);
  if (result.status !== 'complete') return { status: result.status };
  const done = nowMs();
  upsertGithubConnection(
    { db: deps.db, box: deps.box },
    {
      teamId: input.teamId,
      login: result.identity.login,
      githubUserId: result.identity.id,
      githubName: result.identity.name,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      accessTokenExpiresAt: done + result.expiresInSeconds * 1000,
      scope: result.scope,
      device: {
        clientId: app.clientId,
        refreshTokenExpiresAt: done + result.refreshTokenExpiresInSeconds * 1000,
      },
    },
  );
  return { status: 'complete', login: result.identity.login };
}
