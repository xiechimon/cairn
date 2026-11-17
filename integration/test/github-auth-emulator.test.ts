import { expect, test } from 'vitest';
import { runGithubAuthEmulatorCase } from './github-auth-emulator-case.js';

test('device sign-in completes against the fake GitHub over loopback HTTP', async () => {
  const result = await runGithubAuthEmulatorCase();
  expect(result.saved).toMatchObject({ login: 'octo', githubUserId: 42 });
  expect(result.requests.some((r) => r.url.endsWith('/login/device/code'))).toBe(true);
  expect(result.requests.some((r) => r.url.endsWith('/login/oauth/access_token'))).toBe(true);
  expect(result.requests.some((r) => r.url.endsWith('/user'))).toBe(true);
});
