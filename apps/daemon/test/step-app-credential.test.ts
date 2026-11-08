import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { runtimeChildEnv } from '../src/backend/otel.js';
import { gitCredentialEnv, runGitOk } from '../src/git.js';
import { StepAppCredential } from '../src/step-app-credential.js';
import { testTempDir } from './test-temp-dir.js';

afterEach(() => vi.useRealTimers());

test('App shell credentials use private files read afresh by git and gh', async () => {
  const dir = join(testTempDir('step-app-'), 'private');
  const credential = {
    kind: 'app' as const,
    username: 'x-access-token',
    password: 'fixture-old',
    url: 'https://github.com/o/r.git',
    expiresAt: Date.now() + 3600000,
  };
  const values: string[] = [];
  const holder = new StepAppCredential(
    dir,
    credential,
    async () => ({ ...credential, password: 'fixture-new' }),
    (value) => values.push(value),
  );
  try {
    const env = holder.env();
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.CAIRN_GIT_CRED_PASSWORD).toBeUndefined();
    expect(statSync(env.CAIRN_GIT_CRED_FILE!).mode & 0o777).toBe(0o600);
    expect(statSync(join(env.GH_CONFIG_DIR!, 'hosts.yml')).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const childEnv = runtimeChildEnv({
      ...env,
      GH_TOKEN: 'inherited',
      GITHUB_TOKEN: 'inherited',
      CAIRN_GIT_CRED_PASSWORD: 'inherited',
    });
    expect(childEnv.GH_TOKEN).toBeUndefined();
    expect(childEnv.GITHUB_TOKEN).toBeUndefined();
    expect(childEnv.CAIRN_GIT_CRED_PASSWORD).toBeUndefined();
    const fill = () =>
      runGitOk(['credential', 'fill'], {
        env: gitCredentialEnv(holder.current()),
        input: 'protocol=https\nhost=github.com\n\n',
      });
    expect(
      (await fill()).includes(`password=${readFileSync(env.CAIRN_GIT_CRED_FILE!, 'utf8')}`),
    ).toBe(true);
    await holder.refresh();
    expect((await fill()).includes('password=fixture-new')).toBe(true);
    expect(
      readFileSync(join(env.GH_CONFIG_DIR!, 'hosts.yml'), 'utf8').includes('fixture-new'),
    ).toBe(true);
    expect(values).toEqual(['fixture-old', 'fixture-new']);
  } finally {
    holder.dispose();
  }
  expect(existsSync(dir)).toBe(false);
});

test('timer refresh replaces both files before expiry and cannot recreate them after cleanup', async () => {
  vi.useFakeTimers();
  const dir = join(testTempDir('step-app-timer-'), 'private');
  const credential = {
    kind: 'app' as const,
    username: 'x-access-token',
    password: 'fixture-old',
    url: 'https://github.com/o/r.git',
    expiresAt: Date.now() + 3600000,
  };
  const refresh = vi.fn(async () => ({
    ...credential,
    password: 'fixture-new',
    expiresAt: Date.now() + 3600000,
  }));
  const holder = new StepAppCredential(dir, credential, refresh, () => undefined);
  await vi.advanceTimersByTimeAsync(46 * 60000);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(readFileSync(holder.env().CAIRN_GIT_CRED_FILE!, 'utf8') === 'fixture-new').toBe(true);
  holder.dispose();
  await vi.advanceTimersByTimeAsync(3600000);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(existsSync(dir)).toBe(false);
});

test('credential initialization failure removes a token already written to the private directory', () => {
  const root = testTempDir('step-app-failed-init-');
  const dir = join(root, 'private');
  const target = join(root, 'unmanaged');
  mkdirSync(join(dir, 'gh'), { recursive: true });
  writeFileSync(target, 'preserved');
  symlinkSync(target, join(dir, 'gh', 'hosts.yml'));
  expect(
    () =>
      new StepAppCredential(
        dir,
        {
          kind: 'app',
          username: 'x-access-token',
          password: 'fixture-app',
          url: 'https://github.com/o/r.git',
        },
        async () => {
          throw new Error('unused');
        },
        () => undefined,
      ),
  ).toThrow('symlink');
  expect(existsSync(dir)).toBe(false);
  expect(readFileSync(target, 'utf8')).toBe('preserved');
});
