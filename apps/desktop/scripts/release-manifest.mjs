import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ARCHS = ['arm64', 'x64'];
const RUNNER_ARCHIVES = [
  { key: 'darwin-arm64', ext: 'tar.gz' },
  { key: 'darwin-x64', ext: 'tar.gz' },
  { key: 'linux-x64', ext: 'tar.gz' },
  { key: 'win-x64', ext: 'zip' },
];
const [version, releaseDir] = process.argv.slice(2);
if (version === undefined || releaseDir === undefined) {
  console.error('usage: node scripts/release-manifest.mjs <version> <release dir>');
  process.exit(2);
}

const files = Object.fromEntries(
  ARCHS.map((arch) => {
    const name = `Cairn-${version}-mac-${arch}.zip`;
    const path = join(releaseDir, name);
    const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
    return [arch, { name, size: statSync(path).size, sha256 }];
  }),
);
const winName = `Cairn-${version}-win-x64.exe`;
const winPath = join(releaseDir, winName);
if (existsSync(winPath)) {
  const sha256 = createHash('sha256').update(readFileSync(winPath)).digest('hex');
  files['win-x64'] = { name: winName, size: statSync(winPath).size, sha256 };
}
const target = join(releaseDir, 'desktop-latest.json');
writeFileSync(target, `${JSON.stringify({ version, files }, null, 2)}\n`);
console.log(`wrote ${target}`);

const runnerFiles = {};
for (const entry of RUNNER_ARCHIVES) {
  const name = `cairn-runner-${version}-${entry.key}.${entry.ext}`;
  const path = join(releaseDir, name);
  if (!existsSync(path)) continue;
  const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
  runnerFiles[entry.key] = { name, size: statSync(path).size, sha256 };
}
if (Object.keys(runnerFiles).length > 0) {
  const runnerTarget = join(releaseDir, 'runner-latest.json');
  writeFileSync(runnerTarget, `${JSON.stringify({ version, files: runnerFiles }, null, 2)}\n`);
  console.log(`wrote ${runnerTarget}`);
}
