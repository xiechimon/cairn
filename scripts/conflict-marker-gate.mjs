import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const result = spawnSync('git', ['grep', '-nE', '^(<<<<<<< |>>>>>>> )', '--', '.'], {
  encoding: 'utf8',
});
if (result.status !== 0 && result.status !== 1) {
  console.error(result.stderr);
  process.exit(result.status ?? 1);
}
const marker = /^(?:<{7}|>{7}) /;
const untracked = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\0')
  .filter(Boolean);
const extra = untracked.flatMap((file) => {
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) => (marker.test(line) ? [`${file}:${index + 1}:${line}`] : []));
  } catch {
    return [];
  }
});
if (result.status === 0 || extra.length > 0) {
  process.stdout.write(result.stdout);
  if (extra.length > 0) process.stdout.write(`${extra.join('\n')}\n`);
  console.error('conflict-marker gate: unresolved merge markers in tracked or untracked files');
  process.exit(1);
}
console.log('conflict-marker gate: clean');
