import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';
import { mainWindow } from './main-window.mjs';

const [binary, screenshot] = process.argv.slice(2);
assert.ok(binary, 'usage: node scripts/smoke-linux.mjs <extracted cairn binary> [screenshot.png]');
assert.equal(process.platform, 'linux');
const root = await mkdtemp(join(tmpdir(), 'cairn-linux-smoke-'));
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) =>
      !/^(CAIRN_|ANTHROPIC_|OPENAI_|CLAUDE_|CODEX_|PI_|OTEL_|LANGFUSE_|ELECTRON_)/.test(name) &&
      !/(_API_KEY|_TOKEN|_SECRET)$/.test(name),
  ),
);
Object.assign(env, {
  HOME: join(root, 'home'),
  XDG_CONFIG_HOME: join(root, 'config'),
  XDG_CACHE_HOME: join(root, 'cache'),
});
await mkdir(env.HOME, { recursive: true });
let desktop;
let origin;
let unit;
try {
  desktop = await electron.launch({ executablePath: resolve(binary), env, timeout: 90_000 });
  const page = await mainWindow(desktop, 90_000);
  await page.waitForLoadState('load');
  origin = new URL(page.url()).origin;
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  assert.equal(await page.evaluate(async () => (await fetch('/api/teams')).status), 200);
  await page.locator('[data-testid="first-run-setup"]:visible').waitFor();
  const machine = await page.evaluate(async () => {
    const teams = await (await fetch('/api/teams')).json();
    const teamId = (teams.teams ?? teams)[0].id;
    const deadline = Date.now() + 60_000;
    let machines = [];
    while (Date.now() < deadline) {
      const body = await (await fetch(`/api/teams/${teamId}/machines`)).json();
      machines = body.machines ?? body;
      const ready = machines.find((entry) => entry.online);
      if (ready) return ready;
      await new Promise((wake) => setTimeout(wake, 500));
    }
    throw new Error(`no online Runner: ${JSON.stringify(machines)}`);
  });
  assert.equal(machine.kind, 'local');
  assert.ok(machine.enabledRuntimes.includes('pi'));
  const children = execFileSync(
    'systemctl',
    ['--user', 'list-units', '--no-legend', '--plain', 'cairn-desktop-runner-*.service'],
    { encoding: 'utf8' },
  );
  for (const line of children.split('\n')) {
    const name = line.trim().split(/\s+/)[0];
    if (!name) continue;
    const cwd = execFileSync(
      'systemctl',
      ['--user', 'show', '--property=WorkingDirectory', '--value', name],
      { encoding: 'utf8' },
    ).trim();
    if (cwd.startsWith(`${root}/`)) unit = name;
  }
  assert.ok(unit, 'the Runner has no owned user service');
  const pid = execFileSync('systemctl', ['--user', 'show', '--property=MainPID', '--value', unit], {
    encoding: 'utf8',
  }).trim();
  assert.match(
    await readFile(`/proc/${pid}/cgroup`, 'utf8'),
    new RegExp(`${unit.replaceAll('.', '\\.')}\\s*$`),
  );
  if (screenshot) {
    await mkdir(dirname(resolve(screenshot)), { recursive: true });
    await page.screenshot({ path: resolve(screenshot) });
  }
  await desktop.close();
  desktop = undefined;
  assert.equal(
    await fetch(origin).then(
      () => true,
      () => false,
    ),
    false,
    'server outlived app',
  );
  assert.notEqual(spawnSync('systemctl', ['--user', 'is-active', unit]).status, 0);
  console.log(
    'Linux package smoke passed: fresh onboarding, owner session, pi Runner ready, quit stopped server and Runner',
  );
} finally {
  await desktop?.close();
  if (unit) {
    try {
      execFileSync('systemctl', ['--user', 'stop', unit]);
    } catch {}
  }
  await rm(root, { recursive: true, force: true });
}
