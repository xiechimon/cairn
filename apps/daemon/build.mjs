import { build } from 'esbuild';
import { EXTERNALS } from './externals.mjs';

// esbuild CJS wrapper leaves pino's top-level require without a real require in the bundle.
const banner = [
  '#!/usr/bin/env node',
  "import { createRequire } from 'node:module';",
  'const require = createRequire(import.meta.url);',
].join('\n');

await build({
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: EXTERNALS,
  banner: { js: banner },
  sourcemap: true,
  logLevel: 'info',
});
