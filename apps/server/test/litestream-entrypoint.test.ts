import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import { buildLitestreamConfig } from '../../../scripts/litestream-config.mjs';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';

const repoRoot = resolve(import.meta.dirname, '../../..');
const entrypointPath = join(repoRoot, 'scripts', 'docker-entrypoint.sh');
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix = 'cairn-litestream-'): string {
  const dir = makeTestTempDir(prefix);
  dirs.push(dir);
  return dir;
}

function writeFakeBinaries(
  binDir: string,
  options: { restoreExitCode?: number } = {},
): { logPath: string } {
  const logPath = join(binDir, 'invocations.log');
  const restoreExit = options.restoreExitCode ?? 0;
  const litestreamSh = join(binDir, 'litestream');
  const nodeSh = join(binDir, 'fake-node');
  writeFileSync(
    litestreamSh,
    `#!/bin/sh
set -eu
printf 'litestream %s\\n' "$*" >> "${logPath}"
if [ "\${1:-}" = "restore" ]; then
  if [ -n "\${3:-}" ] && [ -f "\${3:-}" ]; then
    cp "\${3}" "${binDir}/captured-restore.yml"
  fi
  exit ${restoreExit}
fi
if [ "\${1:-}" = "replicate" ]; then
  cfg=""
  exec_cmd=""
  prev=""
  for arg in "$@"; do
    if [ "$prev" = "-config" ]; then
      cfg="$arg"
      prev=""
      continue
    fi
    if [ "$prev" = "-exec" ]; then
      exec_cmd="$arg"
      prev=""
      continue
    fi
    if [ "$arg" = "-config" ] || [ "$arg" = "-exec" ]; then
      prev="$arg"
      continue
    fi
  done
  if [ -n "$cfg" ] && [ -f "$cfg" ]; then
    cp "$cfg" "${binDir}/captured-replicate.yml"
    printf 'config_mode=%s\\n' "$("${process.execPath}" -e "process.stdout.write((require('fs').statSync(process.argv[1]).mode & 0o777).toString(8))" "$cfg")" >> "${logPath}"
  fi
  printf 'replicate_exec=%s\\n' "$exec_cmd" >> "${logPath}"
  exit 0
fi
exit 2
`,
  );
  chmodSync(litestreamSh, 0o755);
  writeFileSync(
    nodeSh,
    `#!/bin/sh
if [ "\${1:-}" = "/app/litestream-config.mjs" ] || [ "\${1:-}" = "${join(repoRoot, 'scripts', 'litestream-config.mjs')}" ]; then
  exec "${process.execPath}" "$@"
fi
printf 'node %s\\n' "$*" >> "${logPath}"
if [ "\${CAIRN_REQUIRE_TOKEN:-}" = "1" ] && [ -z "\${CAIRN_TOKEN:-}" ] && [ ! -f "\${CAIRN_HOME}/token" ]; then
  printf 'CAIRN_REQUIRE_TOKEN is on but CAIRN_TOKEN is unset\\n' >&2
  exit 1
fi
exit 0
`,
  );
  chmodSync(nodeSh, 0o755);
  return { logPath };
}

function runEntrypoint(args: string[], env: Record<string, string | undefined>, binDir?: string) {
  const pathEnv = binDir ? `${binDir}:/usr/bin:/bin` : process.env.PATH;
  return spawnSync('sh', [entrypointPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      PATH: pathEnv,
      HOME: env.CAIRN_HOME ?? '/tmp',
      TMPDIR: env.TMPDIR ?? env.CAIRN_HOME ?? '/tmp',
      ...env,
    },
  });
}

describe('buildLitestreamConfig', () => {
  test('generates singular replica config with optional endpoint and force-path-style without embedding secrets', () => {
    const yamlText = buildLitestreamConfig({
      dbPath: '/data/server/server.db',
      env: {
        CAIRN_LITESTREAM_BUCKET: 'cairn-wal-bucket',
        CAIRN_LITESTREAM_PATH: 'tenants/u1/server.db',
        CAIRN_LITESTREAM_ENDPOINT: 'https://s3.example.test:9000/',
        CAIRN_LITESTREAM_REGION: '',
        LITESTREAM_ACCESS_KEY_ID: 'SECRET_ACCESS_KEY_DO_NOT_EMBED',
        LITESTREAM_SECRET_ACCESS_KEY: 'SECRET_SECRET_KEY_DO_NOT_EMBED',
      },
    });
    expect(yamlText).not.toContain('SECRET_ACCESS_KEY_DO_NOT_EMBED');
    expect(yamlText).not.toContain('SECRET_SECRET_KEY_DO_NOT_EMBED');
    expect(yamlText).not.toContain('replicas:');
    const parsed = parse(yamlText) as {
      dbs: Array<{
        path: string;
        replica: {
          type: string;
          bucket: string;
          path: string;
          endpoint?: string;
          region?: string;
          'force-path-style'?: boolean;
        };
      }>;
    };
    expect(parsed.dbs).toEqual([
      {
        path: '/data/server/server.db',
        replica: {
          type: 's3',
          bucket: 'cairn-wal-bucket',
          path: 'tenants/u1/server.db',
          endpoint: 'https://s3.example.test:9000',
          region: 'auto',
          'force-path-style': true,
        },
      },
    ]);
  });

  test('buildLitestreamConfig rejects unsafe bucket, path, region, and endpoint values', () => {
    expect(() =>
      buildLitestreamConfig({
        dbPath: '/data/server/server.db',
        env: { CAIRN_LITESTREAM_BUCKET: 'bad/bucket' },
      }),
    ).toThrow(/bucket/i);
    expect(() =>
      buildLitestreamConfig({
        dbPath: '/data/server/server.db',
        env: { CAIRN_LITESTREAM_BUCKET: 'ok-bucket', CAIRN_LITESTREAM_PATH: '../escape' },
      }),
    ).toThrow(/path/i);
    expect(() =>
      buildLitestreamConfig({
        dbPath: '/data/server/server.db',
        env: { CAIRN_LITESTREAM_BUCKET: 'ok-bucket', CAIRN_LITESTREAM_PATH: '/abs/path' },
      }),
    ).toThrow(/path/i);
    expect(() =>
      buildLitestreamConfig({
        dbPath: '/data/server/server.db',
        env: { CAIRN_LITESTREAM_BUCKET: 'ok-bucket', CAIRN_LITESTREAM_PATH: 'ok\ninject: 1' },
      }),
    ).toThrow(/path/i);
    expect(() =>
      buildLitestreamConfig({
        dbPath: '/data/server/server.db',
        env: {
          CAIRN_LITESTREAM_BUCKET: 'ok-bucket',
          CAIRN_LITESTREAM_ENDPOINT: 'ftp://bad.example.com',
        },
      }),
    ).toThrow(/endpoint/i);
    expect(() =>
      buildLitestreamConfig({
        dbPath: '/data/server/server.db',
        env: {
          CAIRN_LITESTREAM_BUCKET: 'ok-bucket',
          CAIRN_LITESTREAM_ENDPOINT: 'https://user:pass@s3.example.com',
        },
      }),
    ).toThrow(/endpoint/i);
    expect(() =>
      buildLitestreamConfig({
        dbPath: '/data/server/server.db',
        env: {
          CAIRN_LITESTREAM_BUCKET: 'ok-bucket',
          CAIRN_LITESTREAM_REGION: 'us-east-1\nbad',
        },
      }),
    ).toThrow(/region/i);
  });
});

describe('docker-entrypoint.sh', () => {
  test('execs command directly without litestream when bucket is unset', () => {
    const dir = tempDir();
    const home = join(dir, 'home');
    const binDir = join(dir, 'bin');
    mkdirSync(home, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    const { logPath } = writeFakeBinaries(binDir);
    writeFileSync(join(binDir, 'node'), `#!/bin/sh\nexec "${join(binDir, 'fake-node')}" "$@"\n`);
    chmodSync(join(binDir, 'node'), 0o755);

    const res = runEntrypoint(
      ['node', 'dist/index.mjs'],
      { CAIRN_HOME: home, CAIRN_TOKEN: 'test-tok' },
      binDir,
    );
    expect(res.status).toBe(0);
    const log = readFileSync(logPath, 'utf8');
    expect(log).toContain('node dist/index.mjs');
    expect(log).not.toContain('litestream');
  });

  test('execs subcommands like node dist/index.mjs token directly without litestream', () => {
    const dir = tempDir();
    const home = join(dir, 'home');
    const binDir = join(dir, 'bin');
    mkdirSync(home, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    const { logPath } = writeFakeBinaries(binDir);
    writeFileSync(join(binDir, 'node'), `#!/bin/sh\nexec "${join(binDir, 'fake-node')}" "$@"\n`);
    chmodSync(join(binDir, 'node'), 0o755);

    const res = runEntrypoint(
      ['node', 'dist/index.mjs', 'token'],
      { CAIRN_HOME: home, CAIRN_TOKEN: 'test-tok', CAIRN_LITESTREAM_BUCKET: 'cairn-wal' },
      binDir,
    );
    expect(res.status).toBe(0);
    const log = readFileSync(logPath, 'utf8');
    expect(log).toContain('node dist/index.mjs token');
    expect(log).not.toContain('litestream');
  });

  test('defers to server refusal when CAIRN_REQUIRE_TOKEN lacks token everywhere', () => {
    const dir = tempDir();
    const home = join(dir, 'home');
    const binDir = join(dir, 'bin');
    mkdirSync(home, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    const { logPath } = writeFakeBinaries(binDir);
    writeFileSync(join(binDir, 'node'), `#!/bin/sh\nexec "${join(binDir, 'fake-node')}" "$@"\n`);
    chmodSync(join(binDir, 'node'), 0o755);

    const res = runEntrypoint(
      ['node', 'dist/index.mjs'],
      {
        CAIRN_HOME: home,
        CAIRN_REQUIRE_TOKEN: '1',
        CAIRN_TOKEN: '',
        CAIRN_LITESTREAM_BUCKET: 'cairn-wal',
      },
      binDir,
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('CAIRN_TOKEN');
    expect(readFileSync(logPath, 'utf8')).not.toContain('litestream');
    expect(existsSync(join(home, 'server'))).toBe(false);
  });

  test('uses litestream when CAIRN_REQUIRE_TOKEN=1 has token file', () => {
    const dir = tempDir();
    const home = join(dir, 'home');
    const binDir = join(dir, 'bin');
    mkdirSync(home, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(home, 'token'), 'CAIRN_TOKEN=file-token\n', { mode: 0o600 });
    const { logPath } = writeFakeBinaries(binDir);
    writeFileSync(join(binDir, 'node'), `#!/bin/sh\nexec "${join(binDir, 'fake-node')}" "$@"\n`);
    chmodSync(join(binDir, 'node'), 0o755);

    const res = runEntrypoint(
      ['node', 'dist/index.mjs'],
      {
        CAIRN_HOME: home,
        CAIRN_REQUIRE_TOKEN: '1',
        CAIRN_TOKEN: '',
        CAIRN_LITESTREAM_BUCKET: 'cairn-wal',
        CAIRN_LITESTREAM_ENDPOINT: 'http://127.0.0.1:9000',
        LITESTREAM_ACCESS_KEY_ID: 'minio-key',
        LITESTREAM_SECRET_ACCESS_KEY: 'minio-secret',
      },
      binDir,
    );
    expect(res.status).toBe(0);
    const log = readFileSync(logPath, 'utf8');
    expect(log).toContain('litestream restore -if-db-not-exists -if-replica-exists -config');
    expect(log).not.toContain('restore -v');
    expect(log).toContain('config_mode=600');
    expect(log).toContain('replicate_exec=node dist/index.mjs');
    const captured = readFileSync(join(binDir, 'captured-replicate.yml'), 'utf8');
    expect(captured).not.toContain('minio-key');
    expect(captured).not.toContain('minio-secret');
    expect(statSync(join(home, 'server')).isDirectory()).toBe(true);
  });

  test('fails fast when litestream restore exits non-zero', () => {
    const dir = tempDir();
    const home = join(dir, 'home');
    const binDir = join(dir, 'bin');
    mkdirSync(home, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    const { logPath } = writeFakeBinaries(binDir, { restoreExitCode: 23 });
    writeFileSync(join(binDir, 'node'), `#!/bin/sh\nexec "${join(binDir, 'fake-node')}" "$@"\n`);
    chmodSync(join(binDir, 'node'), 0o755);

    const res = runEntrypoint(
      ['node', 'dist/index.mjs'],
      {
        CAIRN_HOME: home,
        CAIRN_REQUIRE_TOKEN: '1',
        CAIRN_TOKEN: 'test-tok',
        CAIRN_LITESTREAM_BUCKET: 'cairn-wal',
      },
      binDir,
    );
    expect(res.status).toBe(23);
    const log = readFileSync(logPath, 'utf8');
    expect(log).toContain('litestream restore');
    expect(log).not.toContain('litestream replicate');
    expect(log).not.toContain('node dist/index.mjs');
  });
});
