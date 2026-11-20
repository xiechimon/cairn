import { spawnSync } from 'node:child_process';

const status = spawnSync('git', ['status', '--porcelain', '--', 'apps/server/drizzle'], {
  encoding: 'utf8',
});
if (status.status !== 0) {
  console.error(status.stderr);
  process.exit(status.status ?? 1);
}
if (status.stdout.trim() !== '') {
  process.stdout.write(status.stdout);
  console.error(
    'drizzle-drift gate: apps/server/drizzle has uncommitted output; run pnpm --filter @xiechimon/cairn db:generate and commit the result',
  );
  process.exit(1);
}
console.log('drizzle-drift gate: committed output matches the schema');
