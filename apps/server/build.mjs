import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { resolveBuildVersion } from './build-info-resolve.mjs';

const root = dirname(fileURLToPath(import.meta.url));

const bundleFormFlag = {
  name: 'cairn-bundle-form',
  setup(b) {
    b.onLoad({ filter: /src[\\/]bundle-form\.ts$/ }, () => ({
      contents: 'export const BUNDLED_FORM = true;',
      loader: 'js',
    }));
  },
};

function resolveBuildCommit() {
  const fromEnv = (
    process.env.CAIRN_BUILD_COMMIT ||
    process.env.RELEASE_SHA ||
    process.env.GITHUB_SHA ||
    ''
  ).trim();
  if (fromEnv !== '') return fromEnv.slice(0, 7);
  try {
    const head = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return head !== '' ? head : null;
  } catch {
    return null;
  }
}

const serverBuildInfoPlugin = {
  name: 'cairn-server-build-info',
  setup(b) {
    const version = resolveBuildVersion({ cwd: root });
    const commit = resolveBuildCommit();
    b.onLoad({ filter: /src[\\/]build-info\.ts$/ }, () => ({
      contents: [
        `export const SERVER_BUILD_VERSION = ${JSON.stringify(version)};`,
        `export const SERVER_BUILD_COMMIT = ${JSON.stringify(commit)};`,
      ].join('\n'),
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
  plugins: [bundleFormFlag, serverBuildInfoPlugin],
  banner: { js: banner },
  sourcemap: true,
  logLevel: 'info',
});

execFileSync(process.execPath, ['--check', resolve(root, 'dist/index.mjs')], { stdio: 'inherit' });

mkdirSync(resolve(root, 'dist'), { recursive: true });
const photonRequire = createRequire(
  createRequire(import.meta.url).resolve('@earendil-works/pi-durable/images'),
);
copyFileSync(
  photonRequire.resolve('@silvia-odwyer/photon/photon_rs_bg.wasm'),
  resolve(root, 'dist/photon_rs_bg.wasm'),
);
