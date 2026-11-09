import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openSync, existsSync } from 'node:fs';
const scratch = `${process.env.HOME}/.cache/codex-scratch/pi-168`;
const env = { ...process.env, VERIFY_RUN_DIR: `${scratch}/atomicity-stack`, VERIFY_PORT: '18868', VERIFY_WEB_PORT: '18869' };
const scripts = '.claude/skills/verify-cairn/scripts';
const log = openSync(`${scratch}/atomicity-stack.txt`, 'a');
const launch = spawn(process.execPath, [`${scripts}/launch.mjs`], { env, stdio: ['ignore', log, log] });
let code = 1;
try {
  const deadline = Date.now() + 90000;
  while (!existsSync(`${scratch}/atomicity-stack/ports.json`)) {
    if (launch.exitCode !== null || Date.now() > deadline) throw new Error('Stack did not start');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const probe = spawn(process.execPath, [`${scratch}/atomicity-probe.mjs`], { env, stdio: 'inherit' });
  [code] = await once(probe, 'exit');
} finally {
  const cleanup = spawn(process.execPath, [`${scripts}/cleanup.mjs`], { env, stdio: ['ignore', log, log] });
  await once(cleanup, 'exit');
}
process.exitCode = code;
