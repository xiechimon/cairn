import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCESS_TOKEN_FILE_NAME, ENV_VARS, formatAccessTokenFile } from '@cairn/shared';
import { afterEach, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { runTokenCommand } from '../../daemon/src/token-command.js';

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) releaseTestTempDir(home);
});

test.each(['environment', 'file'])(
  'owner token output from %s does not include a login fragment',
  (source) => {
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
    expect(output).toContain(token);
    expect(output).not.toContain('#token=');
    expect(output).not.toContain('Login link:');
  },
);
