import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCESS_TOKEN_FILE_NAME, ENV_VARS, formatAccessTokenFile } from '@cairn/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { runTokenCommand } from '../../daemon/src/token-command.js';
import { consumeLoginFragment, TOKEN_STORAGE_KEY } from '../src/api/auth.js';

const homes: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const home of homes.splice(0)) releaseTestTempDir(home);
});

test.each(['environment', 'file'])(
  'login links round-trip reserved characters from %s',
  async (source) => {
    const home = makeTestTempDir('cairn-login-roundtrip-');
    homes.push(home);
    const token = 'synthetic token+&=%#';
    const env: NodeJS.ProcessEnv = { [ENV_VARS.home]: home };
    if (source === 'environment') env[ENV_VARS.token] = token;
    else writeFileSync(join(home, ACCESS_TOKEN_FILE_NAME), formatAccessTokenFile(token));
    let output = '';
    expect(
      runTokenCommand(
        { rotate: false },
        {
          env,
          writeOut: (text) => {
            output += text;
          },
        },
      ),
    ).toBe(0);
    const link = output.match(/Login link: (.+)/)?.[1];
    expect(link).toBeDefined();
    const location = new URL(link ?? 'http://invalid');
    const replaceState = vi.fn();
    const setItem = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('window', { location, history: { replaceState } });
    vi.stubGlobal('localStorage', { setItem });
    vi.stubGlobal('fetch', fetch);

    await consumeLoginFragment();

    expect(fetch).toHaveBeenNthCalledWith(2, '/api/teams', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(setItem).toHaveBeenCalledWith(TOKEN_STORAGE_KEY, token);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/app');
  },
);
