import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openSync, existsSync, readFileSync, rmSync } from 'node:fs';
const scratch = `${process.env.HOME}/.cache/codex-scratch/pi-168`;
const phase = process.argv[2];
const env = { ...process.env, VERIFY_RUN_DIR: `${scratch}/stack`, VERIFY_PORT: '18868', VERIFY_WEB_PORT: '18869' };
const scripts = '.claude/skills/verify-cairn/scripts';
const log = openSync(`${scratch}/${phase}-stack.txt`, 'a');
const launch = spawn(process.execPath, [`${scripts}/launch.mjs`], { env, stdio: ['ignore', log, log] });
let code = 1;
try {
  const deadline = Date.now() + 90000;
  while (!existsSync(`${scratch}/stack/ports.json`)) {
    if (launch.exitCode !== null || Date.now() > deadline) throw new Error('Stack did not start');
    await new Promise((r) => setTimeout(r, 200));
  }
  if (existsSync(`${scratch}/${phase}-ids.json`)) rmSync(`${scratch}/${phase}-ids.json`);
  const probe = spawn(process.execPath, [`${scratch}/probe.mjs`, phase], { env, stdio: 'inherit' });
  [code] = await once(probe, 'exit');
} finally {
  if (existsSync(`${scratch}/stack/ports.json`)) {
    const ports = JSON.parse(readFileSync(`${scratch}/stack/ports.json`, 'utf8'));
    console.log(`Cleaning own stack supervisor=${ports.supervisorPid}, server=${ports.serverPid}, web=${ports.webPid}, root=${ports.root}`);
    const cleanup = spawn(process.execPath, [`${scripts}/cleanup.mjs`], { env, stdio: ['ignore', log, log] });
    await once(cleanup, 'exit');
  } else console.error('Launch failed; its own stopStack handler reclaimed its children');
}
process.exitCode = code;
