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

const banner = [
  '#!/usr/bin/env node',
  "import { createRequire } from 'node:module';",
  'const require = createRequire(import.meta.url);',
].join('\n');

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['better-sqlite3'],
  plugins: [bundleFormFlag],
  banner: { js: banner },
  sourcemap: true,
  logLevel: 'info',
});
