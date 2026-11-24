import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { testTempDir } from './test-temp-dir.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const stepEnv = new URL('../src/step-env.ts', import.meta.url).href;
const parentWatch = new URL('../../../packages/shared/src/node/parent-watch.ts', import.meta.url)
  .href;
const profiles = new URL('../../../packages/shared/src/node/credential-profile.ts', import.meta.url)
  .href;

function node(script: string, data: string, scratch: string, tz: string) {
  return spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, data], {
    cwd: repo,
    env: { ...process.env, CAIRN_TEST_TEMP_ROOT: scratch, TZ: tz },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test.each(['current', 'legacy'] as const)(
  'cross-timezone restart preserves a live %s OAuth profile and reaps it after SIGKILL',
  async (format) => {
    const root = testTempDir('credential-profile-restart-');
    const data = join(root, 'daemon');
    const scratch = join(root, 'scratch');
    const owner = node(
      `
    import { execFileSync } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    import { dirname, join } from 'node:path';
    import { prepareStepEnv } from ${JSON.stringify(stepEnv)};
    import { processStartTime } from ${JSON.stringify(parentWatch)};
    const prepared = prepareStepEnv({
      git: null, readonlyGit: false, runtimeId: 'antigravity',
      agentConfig: { cairnHome: process.argv[1] },
      antigravityToken: JSON.stringify({ kind: 'oauth-personal', token: 'ya29.fixture-oauth-credential', expiresAt: Date.now() + 60000 }),
    }, []);
    if ('error' in prepared) throw new Error(prepared.error);
    if (${JSON.stringify(format)} === 'legacy') {
      const startTime = process.platform === 'darwin'
        ? execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(process.pid)], {
            encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' },
          }).trim()
        : processStartTime(process.pid);
      writeFileSync(join(dirname(prepared.env.HOME), 'owner.json'), JSON.stringify({ pid: process.pid, startTime }));
    }
    console.log(prepared.env.HOME);
    setInterval(() => {}, 1000);
  `,
      data,
      scratch,
      'Asia/Tokyo',
    );
    const closed = once(owner, 'close');
    const lines = createInterface({ input: owner.stdout });
    const stderr: Buffer[] = [];
    owner.stderr.on('data', (data: Buffer) => stderr.push(data));
    const sweep = async () => {
      const restart = node(
        `
      import { reapCredentialProfiles } from ${JSON.stringify(profiles)};
      reapCredentialProfiles(process.argv[1]);
    `,
        data,
        scratch,
        'America/New_York',
      );
      const errors: Buffer[] = [];
      restart.stderr.on('data', (data: Buffer) => errors.push(data));
      const [code] = await once(restart, 'close');
      expect(code, Buffer.concat(errors).toString()).toBe(0);
    };
    let profile: string;
    try {
      const line = await Promise.race([
        once(lines, 'line').then(([value]) => String(value)),
        closed.then(() => null),
      ]);
      if (line === null) throw new Error(Buffer.concat(stderr).toString());
      profile = line;
      expect(existsSync(join(profile, '.gemini/antigravity-acp/antigravity-oauth-token'))).toBe(
        true,
      );
      await sweep();
      expect(existsSync(profile)).toBe(true);
    } finally {
      lines.close();
      owner.kill('SIGKILL');
      await closed;
    }
    expect(existsSync(profile)).toBe(true);
    await sweep();
    expect(existsSync(profile)).toBe(false);
  },
  30_000,
);
