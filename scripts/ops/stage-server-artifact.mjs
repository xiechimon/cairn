import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const [checkout, finalRelease, sha] = process.argv.slice(2);
if (!checkout || !finalRelease || !/^[0-9a-f]{40}$/.test(sha ?? '')) {
  console.error('usage: stage-server-artifact.mjs <checkout> <release> <40hex sha>');
  process.exit(2);
}
const temp = `${finalRelease}.staging-${process.pid}`;
rmSync(temp, { recursive: true, force: true });
if (existsSync(finalRelease)) {
  console.error(`release already exists: ${finalRelease}`);
  process.exit(1);
}

function copy(relative, destination) {
  const source = join(checkout, relative);
  if (!existsSync(source)) throw new Error(`missing build artifact ${relative}`);
  cpSync(source, destination, { recursive: true, verbatimSymlinks: false });
}

function copyPackage(name, baseNodeModules, resolutionStart, seen = new Set()) {
  const require = createRequire(join(resolutionStart, 'index.js'));
  const packageJsonPath = require.resolve(`${name}/package.json`);
  const packageDir = dirname(packageJsonPath);
  const key = `${name}:${packageDir}:${baseNodeModules}`;
  if (seen.has(key)) return;
  seen.add(key);
  const destination = join(baseNodeModules, ...name.split('/'));
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(packageDir, destination, { recursive: true, verbatimSymlinks: false });
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const dependencies = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  };
  for (const dependency of Object.keys(dependencies)) {
    try {
      copyPackage(dependency, join(destination, 'node_modules'), packageDir, seen);
    } catch (error) {
      if (!(dependency in (manifest.optionalDependencies ?? {}))) throw error;
    }
  }
}

try {
  mkdirSync(temp, { recursive: true });
  copy('apps/server/dist', join(temp, 'dist'));
  copy('apps/web/dist', join(temp, 'web'));
  copy('apps/server/drizzle', join(temp, 'drizzle'));
  const buildSource = readFileSync(join(checkout, 'apps/server/build.mjs'), 'utf8');
  const externalMatch = /external:\s*\[([^\]]*)\]/.exec(buildSource);
  const externals = [...(externalMatch?.[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  mkdirSync(join(temp, 'node_modules'), { recursive: true });
  for (const name of externals)
    copyPackage(name, join(temp, 'node_modules'), join(checkout, 'apps/server'));
  writeFileSync(join(temp, 'DEPLOYED_SHA'), `${sha}\n`, { mode: 0o600 });
  for (const required of [
    'dist/index.mjs',
    'dist/photon_rs_bg.wasm',
    'web/index.html',
    'drizzle/meta/_journal.json',
    'DEPLOYED_SHA',
  ]) {
    if (!existsSync(join(temp, required))) throw new Error(`staged release misses ${required}`);
  }
  renameSync(temp, finalRelease);
  rmSync(temp, { recursive: true, force: true });
} catch (error) {
  rmSync(temp, { recursive: true, force: true });
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
