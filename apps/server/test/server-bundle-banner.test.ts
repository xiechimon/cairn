import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, test } from 'vitest';
import { serverBundleBanner } from '../build.mjs';

const serverDir = fileURLToPath(new URL('..', import.meta.url));

describe('server bundle banner', () => {
  test('the bundled Feishu SDK evaluates in the ESM server bundle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-feishu-bundle-'));
    const outfile = join(dir, 'out.mjs');
    try {
      await build({
        stdin: {
          contents:
            "import * as lark from '@larksuiteoapi/node-sdk';\nif (typeof lark.Client !== 'function') throw new Error('feishu sdk client missing');\n",
          resolveDir: serverDir,
          sourcefile: 'feishu-bundle-entry.js',
        },
        outfile,
        bundle: true,
        platform: 'node',
        target: 'node22',
        format: 'esm',
        external: ['better-sqlite3'],
        banner: { js: serverBundleBanner },
        logLevel: 'silent',
      });
      expect(() => execFileSync(process.execPath, [outfile], { stdio: 'pipe' })).not.toThrow();
      const serverOut = join(dir, 'server.mjs');
      await build({
        entryPoints: [join(serverDir, 'src/index.ts')],
        outfile: serverOut,
        bundle: true,
        platform: 'node',
        target: 'node22',
        format: 'esm',
        external: ['better-sqlite3'],
        banner: { js: serverBundleBanner },
        logLevel: 'silent',
      });
      expect(() =>
        execFileSync(process.execPath, ['--check', serverOut], { stdio: 'pipe' }),
      ).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
