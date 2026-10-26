import { spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStubLlm } from '../../../integration/test/stub-llm.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const FLOW = join(REPO_ROOT, '.claude/hillclimb/chief-dispatch');
const VARIANT = 'v9';

const stub = await startStubLlm([{ content: '已收到，稍后汇报。' }]);
const args = [
  'exec',
  'tsx',
  'eval/chief-dispatch/run-eval.mts',
  '--flow',
  '.claude/hillclimb/chief-dispatch',
  '--variant',
  VARIANT,
  '--case',
  'd01',
  '--reps',
  '1',
  '--prompt-set',
  'cut',
  '--approve-harness',
];
const run = spawn('pnpm', args, {
  cwd: join(REPO_ROOT, 'integration'),
  env: {
    ...process.env,
    CAIRN_EVAL_RELAY_URL: stub.url,
    CAIRN_EVAL_RELAY_KEY: 'sk-stub-eval',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const code = await new Promise<number>((resolveCode) => {
  run.on('exit', (c) => resolveCode(c ?? 1));
});
const flat = JSON.stringify(stub.requests);
const sawCutRules = flat.includes('交付物优先于路径');
const sawDroppedRules = ['ADR 0026', 'confirm 关口自动确认'].filter((m) => flat.includes(m));
await stub.close();
if (code !== 0) {
  console.error(`runner exited ${code}`);
  process.exit(1);
}
if (!sawCutRules || sawDroppedRules.length > 0) {
  console.error(
    `stub session wrong: sawCutRules=${sawCutRules} dropped=[${sawDroppedRules.join(', ')}]`,
  );
  process.exit(1);
}
console.log(
  `stub session carried the cut rules (kept marker present, dropped markers [${sawDroppedRules.join(', ') || 'none'}])`,
);

const rows = readFileSync(join(FLOW, VARIANT, 'results.jsonl'), 'utf8').trim().split('\n');
const parsed = rows.map((line) => JSON.parse(line) as { meta?: { prompt_set?: string } });
for (const row of parsed) {
  console.log(`row meta.prompt_set=${row.meta?.prompt_set ?? '(missing)'}`);
}
if (parsed.length !== 1 || parsed[0]?.meta?.prompt_set !== 'cut') {
  console.error('expected exactly one row with meta.prompt_set=cut');
  process.exit(1);
}
rmSync(join(FLOW, VARIANT), { recursive: true, force: true });
console.log('runner switch verified on the real runner path (stub relay); scratch variant removed');
