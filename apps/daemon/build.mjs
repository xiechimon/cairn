import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { resolveBuildVersion } from '../server/build-info-resolve.mjs';
import { EXTERNALS } from './externals.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const releaseVersionPlugin = {
  name: 'cairn-daemon-build-info',
  setup(b) {
    const version = resolveBuildVersion({ cwd: root });
    b.onLoad({ filter: /src[\\/]build-info\.ts$/ }, () => ({
      contents: `export const DAEMON_BUILD_RELEASE_VERSION = ${JSON.stringify(version)};\n`,
      loader: 'js',
    }));
  },
};

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
  plugins: [releaseVersionPlugin],
  banner: { js: banner },
  sourcemap: true,
  logLevel: 'info',
});
