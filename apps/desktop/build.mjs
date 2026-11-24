import { build } from 'esbuild';
import { acquireSlot } from '../../scripts/heavy-slots.mjs';
import { buildTrayHelpers } from './scripts/build-tray-helper.mjs';

await acquireSlot({ label: 'desktop:build' });

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};

await build({
  ...shared,
  entryPoints: ['src/main.ts', 'src/antigravity-login-worker.ts'],
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  format: 'esm',
});
await build({
  ...shared,
  entryPoints: ['src/preload.ts'],
  outfile: 'dist/preload.cjs',
  format: 'cjs',
});

if (process.platform === 'darwin') buildTrayHelpers();
