import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ACCESS_TOKEN_FILE_NAME,
  ENV_VARS,
  formatAccessTokenFile,
  parseAccessTokenFile,
} from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { runTokenCommand } from '../src/token-command.js';

const homes: string[] = [];
afterEach(() => {
  delete process.env[ENV_VARS.token];
  delete process.env[ENV_VARS.home];
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'cairn-token-cmd-'));
  homes.push(home);
  return home;
}

interface Captured {
  code: number;
  out: string;
}

function run(opts: { rotate: boolean }, env: NodeJS.ProcessEnv): Captured {
  let out = '';
  const code = runTokenCommand(opts, {
    env,
    writeOut: (text) => {
      out += text;
    },
  });
  return { code, out };
}

function writeTokenFile(home: string, token: string): string {
  const path = join(home, ACCESS_TOKEN_FILE_NAME);
  writeFileSync(path, formatAccessTokenFile(token));
  return path;
}

describe('cairn token (print)', () => {
  test('failure mode 1: file only -> prints the file token and its path', () => {
    const home = scratchHome();
    const path = writeTokenFile(home, 'file-token-0123456789abcdef');
    const { code, out } = run({ rotate: false }, { [ENV_VARS.home]: home });
    expect(code).toBe(0);
    expect(out).toContain('file-token-0123456789abcdef');
    expect(out).toContain(path);
  });

  test('failure mode 2: env only -> prints the env token, attributed to the var', () => {
    const home = scratchHome();
    const { code, out } = run(
      { rotate: false },
      { [ENV_VARS.home]: home, [ENV_VARS.token]: 'env-token-0123456789abcdef' },
    );
    expect(code).toBe(0);
    expect(out).toContain('env-token-0123456789abcdef');
    expect(out).toContain(ENV_VARS.token);
  });

  test('failure mode 3: env + file -> env wins (the token the server enforces)', () => {
    const home = scratchHome();
    writeTokenFile(home, 'file-token-0123456789abcdef');
    const { code, out } = run(
      { rotate: false },
      { [ENV_VARS.home]: home, [ENV_VARS.token]: 'env-token-0123456789abcdef' },
    );
    expect(code).toBe(0);
    expect(out).toContain('env-token-0123456789abcdef');
    expect(out).not.toContain('file-token-0123456789abcdef');
  });

  test('failure mode 4: neither -> guidance, exit 0', () => {
    const home = scratchHome();
    const { code, out } = run({ rotate: false }, { [ENV_VARS.home]: home });
    expect(code).toBe(0);
    expect(out).toContain(ENV_VARS.token);
    expect(out).toContain(join(home, ACCESS_TOKEN_FILE_NAME));
  });

  test('failure mode 8: printed token equals the value the server config reads', () => {
    const home = scratchHome();
    writeTokenFile(home, 'shared-parser-token-0123456789ab');
    const { out } = run({ rotate: false }, { [ENV_VARS.home]: home });
    const onDisk = parseAccessTokenFile(readFileSync(join(home, ACCESS_TOKEN_FILE_NAME), 'utf8'));
    expect(onDisk).toBe('shared-parser-token-0123456789ab');
    expect(out).toContain(onDisk ?? '');
  });
});

describe('cairn token --rotate', () => {
  test('failure mode 5: env set -> refuses, exit 1, file untouched', () => {
    const home = scratchHome();
    const path = writeTokenFile(home, 'old-token-0123456789abcdef');
    const { code, out } = run(
      { rotate: true },
      { [ENV_VARS.home]: home, [ENV_VARS.token]: 'env-token-0123456789abcdef' },
    );
    expect(code).toBe(1);
    expect(out).toContain(ENV_VARS.token);
    expect(parseAccessTokenFile(readFileSync(path, 'utf8'))).toBe('old-token-0123456789abcdef');
  });

  test('failure mode 6: rotates -> new 64-hex token, mode 0600, old value gone', () => {
    const home = scratchHome();
    const path = writeTokenFile(home, 'old-token-0123456789abcdef');
    const { code, out } = run({ rotate: true }, { [ENV_VARS.home]: home });
    expect(code).toBe(0);
    const rotated = parseAccessTokenFile(readFileSync(path, 'utf8'));
    expect(rotated).toMatch(/^[0-9a-f]{64}$/);
    expect(rotated).not.toBe('old-token-0123456789abcdef');
    expect(out).toContain(rotated ?? '');
    expect(out).toContain(path);
    expect(readFileSync(path, 'utf8')).not.toContain('old-token-0123456789abcdef');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test('failure mode 7: creates a missing CAIRN_HOME', () => {
    const home = join(scratchHome(), 'nested', 'home');
    const { code } = run({ rotate: true }, { [ENV_VARS.home]: home });
    expect(code).toBe(0);
    expect(existsSync(join(home, ACCESS_TOKEN_FILE_NAME))).toBe(true);
  });
});
