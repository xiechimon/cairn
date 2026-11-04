import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeSlotPlaywrightConfig } from '../../../scripts/heavy-slots.mjs';

const root = resolve(process.env.HINT_BASELINE_ROOT || resolve(import.meta.dirname, '../../..'));
const webDir = resolve(root, 'apps/web');
const { path } = writeSlotPlaywrightConfig({
  slot: Number(process.env.CAIRN_HEAVY_SLOT ?? '1'),
  env: process.env,
  webDir,
});
const result = spawnSync(
  'pnpm',
  [
    'exec',
    'playwright',
    'test',
    '--config',
    path,
    'e2e/accent-typo.spec.ts',
    '--grep',
    'hint icon stays',
    '--workers=1',
  ],
  { cwd: webDir, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
