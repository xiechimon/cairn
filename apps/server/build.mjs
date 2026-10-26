import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const bundleFormFlag = {
  name: 'cairn-bundle-form',
  setup(b) {
    b.onLoad({ filter: /src[\\/]bundle-form\.ts$/ }, () => ({
      contents: 'export const BUNDLED_FORM = true;',
      loader: 'js',
    }));
  },
};

export const serverBundleBanner = [
  '#!/usr/bin/env node',
  "import { createRequire } from 'node:module';",
  'const require = createRequire(import.meta.url);',
  'const __filename = import.meta.filename;',
  'const __dirname = import.meta.dirname;',
].join('\n');

const entryArg = process.argv[1];
const ranAsCli =
  entryArg !== undefined && import.meta.url === pathToFileURL(realpathSync(entryArg)).href;

if (ranAsCli) {
  await build({
    entryPoints: ['src/index.ts'],
    outfile: 'dist/index.mjs',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    external: ['better-sqlite3'],
    plugins: [bundleFormFlag],
    banner: { js: serverBundleBanner },
    sourcemap: true,
    logLevel: 'info',
  });
}
