import { spawnSync } from 'node:child_process';

const limit = process.argv[2] ?? process.env.MIGRATION_ORACLE_N;
const env = { ...process.env, MIGRATION_ORACLE_FULL: '1' };
if (limit !== undefined) env.MIGRATION_ORACLE_N = String(limit);
const result = spawnSync(
  'pnpm',
  [
    'exec',
    'vitest',
    'run',
    'apps/server/test/migration-0115-oracle.test.ts',
    '-t',
    'cross product',
  ],
  { stdio: 'inherit', env },
);
process.exit(result.status ?? 1);
