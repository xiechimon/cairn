import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { chromium, expect } from '@playwright/test';

assert.equal(process.platform, 'win32', 'This probe must run on Windows');
const root = process.env.WINDOWS_ACCEPT_ROOT;
assert(root, 'WINDOWS_ACCEPT_ROOT is required');
const winpty = process.env.WINDOWS_ACCEPT_WINPTY;
assert(winpty, 'WINDOWS_ACCEPT_WINPTY is required for an interactive server terminal');
const evidence = join(root, 'evidence');
const home = join(root, 'state');
const port = '8787';
const localOrigin = `http://127.0.0.1:${port}`;
const address = Object.values(networkInterfaces())
  .flat()
  .find((entry) => entry?.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.'))
  ?.address;
assert(address, 'Windows needs a non-loopback IPv4 address for the office browser');
const officeOrigin = `http://${address}:${port}`;
const env = { ...process.env, CAIRN_HOME: home };
const children = [];
const timeout = 45_000;

function start(packageName, entry, args, extraEnv, name, terminal = false) {
  const cwd = join(root, packageName);
  const command = [
    process.execPath,
    join(cwd, 'node_modules', '@xiechimon', packageName, 'dist', entry),
    ...args,
  ];
  const child = spawn(
    terminal ? winpty : command[0],
    terminal ? ['-Xallow-non-tty', '-Xplain', ...command] : command.slice(1),
    { cwd, env: { ...env, ...extraEnv }, windowsHide: true },
  );
  const log = createWriteStream(join(evidence, `${name}.log`));
  const proc = { child, enrollmentUrl: undefined, ownerUrl: undefined, exited: false };
  children.push(proc);
  child.once('error', (error) => log.write(`Process error: ${error.message}\n`));
  child.once('close', (code, signal) => {
    proc.exited = true;
    log.end(`Process exit: ${code ?? signal}\n`);
  });
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    let ownerPrefix = '';
    let ownerCode = '';
    stream.setEncoding('utf8');
    const writeLine = (raw) => {
      const line = stripVTControlCharacters(raw);
      const ownerLink = line.match(/^Open Cairn: (http:\/\/127\.0\.0\.1:\d+\/app\/sign-in#code=)([\w-]*)/u);
      if (ownerLink) {
        [, ownerPrefix, ownerCode] = ownerLink;
        log.write('Open Cairn: [redacted]\n');
      } else if (ownerPrefix) {
        ownerCode += line.trim().match(/^[\w-]*/u)[0];
      }
      if (ownerPrefix) {
        if (ownerCode.length >= 43) {
          proc.ownerUrl = `${ownerPrefix}${ownerCode.slice(0, 43)}`;
          ownerPrefix = '';
          ownerCode = '';
        }
        return;
      }
      const enrollment = line.match(/https?:\/\/\S+\/app\/machines\/authorize\?enroll=[\w-]+/u);
      if (enrollment) proc.enrollmentUrl = enrollment[0];
      const redacted = line
        .replace(/([?#](?:enroll|owner|pair|code)=)[^\s"&]+/gu, '$1[redacted]')
        .replace(/approval code \S+/giu, 'approval code [redacted]');
      log.write(`${redacted}\n`);
    };
    stream.on('data', (chunk) => {
      const lines = (pending + chunk).split(/\r?\n/u);
      pending = lines.pop() ?? '';
      for (const line of lines) writeLine(line);
    });
    stream.on('end', () => {
      if (pending) writeLine(pending);
    });
  }
  return proc;
}

async function seedAcpFixture() {
  const version = 'windows-accept';
  const directory = join(home, 'tools', 'gemini', 'versions', version);
  await mkdir(directory, { recursive: true });
  const entry = 'acp-agent.mjs';
  const fixture = fileURLToPath(new URL('../../apps/daemon/test/fixtures/acp-agent.mjs', import.meta.url));
  const installed = join(directory, entry);
  await copyFile(fixture, installed);
  await writeFile(
    join(directory, '.install-complete'),
    JSON.stringify({
      version,
      url: 'fixture:acp-agent',
      binRelPath: entry,
      binSha256: createHash('sha256').update(await readFile(installed)).digest('hex'),
      args: ['complete'],
      installedAt: Date.now(),
    }),
  );
}

async function browserRequest(page, path, { method = 'GET', body, status = 200 } = {}) {
  const result = await page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, {
      method,
      headers: {
        'x-cairn-browser-auth': '1',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = response.ok && response.status !== 204 ? await response.json() : null;
    return { status: response.status, data };
  }, { path, method, body });
  assert.equal(result.status, status, `${method} ${path} from the browser`);
  return result.data;
}

async function runTask(page, projectId, machineId, name) {
  const origin = new URL(page.url()).origin;
  const title = `Hello from Windows ${name}`;
  const todo = await browserRequest(page, `/api/projects/${projectId}/todos`, {
    method: 'POST', status: 201, body: { title, spec: 'Hello from Windows. Reply with a short greeting.' },
  });
  const { builds: [build] } = await browserRequest(page, `/api/projects/${projectId}/builds`, {
    method: 'POST', status: 201, body: { todoIds: [todo.id], routeOverride: { machineId } },
  });
  await page.goto(`${origin}/app/todo/${todo.id}`, { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => {
    const steps = await browserRequest(page, `/api/builds/${build.id}/steps`);
    return steps.find((step) => step.kind === 'session');
  }, { timeout, message: `${name} task must finish on the customer Runner` }).toMatchObject({
    machineId, status: 'done',
  });
  await expect(page.getByText('Hello Thread', { exact: true }).first()).toBeVisible({ timeout });
  await page.screenshot({ path: join(evidence, `${name}-task-done.png`) });
  console.log(`${name} task finished on the customer Runner`);
  return todo.id;
}

let browser;
let owner;
let office;
try {
  await seedAcpFixture();
  const server = start('cairn', 'index.mjs', [], {
    HOST: '0.0.0.0', PORT: port, CAIRN_TOKEN: randomBytes(32).toString('hex'),
  }, 'server', true);
  await expect.poll(async () => {
    assert(!server.exited, 'Packaged server exited; see server.log');
    try {
      return (await fetch(`${localOrigin}/app`, { signal: AbortSignal.timeout(2000) })).status;
    } catch {
      return 0;
    }
  }, { timeout, message: 'Packaged server must serve the web app' }).toBe(200);
  await expect.poll(() => server.ownerUrl !== undefined, {
    timeout, message: 'Packaged server must print a sign-in link in its terminal; see server.log',
  }).toBe(true);
  const runner = start('cairn-cli', 'cli.mjs', ['start', '--foreground', '--server', localOrigin], {}, 'runner');
  await expect.poll(() => runner.enrollmentUrl ?? (runner.exited ? 'Runner exited' : ''), {
    timeout, message: 'Packaged Runner must print its enrollment URL; see runner.log',
  }).toMatch(/^http:\/\/127\.0\.0\.1:/u);

  browser = await chromium.launch({ channel: 'msedge', headless: true });
  owner = await (await browser.newContext({ locale: 'en-US' })).newPage();
  await owner.goto(`${localOrigin}/app`, { waitUntil: 'domcontentloaded' });
  await expect(owner.locator('#cairn-pair-input')).toBeVisible({ timeout });
  await browserRequest(owner, '/api/remote/pairing', { status: 401 });
  await owner.screenshot({ path: join(evidence, 'local-owner-signed-out.png') });

  const redeemed = owner.waitForResponse((response) => response.url().endsWith('/api/auth/owner-link/redeem'));
  try {
    await owner.goto(server.ownerUrl, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    if (!String(error).includes('ERR_ABORTED')) throw new Error('Could not navigate to the owner sign-in page');
  }
  assert.equal((await redeemed).status(), 200, 'Printed link must create an owner session');
  await owner.waitForURL(`${localOrigin}/app`, { timeout });
  await expect(owner.getByTestId('home-c')).toBeVisible({ timeout });
  await browserRequest(owner, '/api/remote/pairing');
  await expect(owner.locator('.token-gate')).toHaveCount(0);
  await owner.screenshot({ path: join(evidence, 'local-owner.png') });
  console.log('Local browser acquired owner access without a bearer token');

  await owner.goto(runner.enrollmentUrl, { waitUntil: 'domcontentloaded' });
  const approved = owner.waitForResponse((response) => response.url().endsWith('/api/machine/enroll/confirm'));
  await owner.getByRole('button', { name: /confirm authorization|^authorize$|确认授权/i }).click({ timeout });
  const approval = await approved;
  assert.equal(approval.status(), 200, 'Local owner must confirm Runner enrollment');
  const { machine: { machineId } } = await approval.json();
  await expect(owner.getByText(/^(Authorized —|授权完成)/).first()).toBeVisible({ timeout });
  await owner.screenshot({ path: join(evidence, 'runner-approved.png') });
  const [team] = await browserRequest(owner, '/api/teams');
  await expect.poll(async () => {
    const machines = await browserRequest(owner, `/api/teams/${team.id}/machines`);
    return machines.find((machine) => machine.id === machineId);
  }, { timeout, message: 'Approved local Runner must send a heartbeat' }).toMatchObject({ kind: 'local', online: true });
  await owner.goto(`${localOrigin}/app/resources/machines`, { waitUntil: 'domcontentloaded' });
  await expect(owner.locator(`[data-machine-id="${machineId}"]`).getByTestId('machine-item-status'))
    .toHaveText(/^(Online|在线)$/i, { timeout });
  await owner.screenshot({ path: join(evidence, 'runner-online.png') });
  console.log('Local Runner was approved and is online');

  await browserRequest(owner, `/api/teams/${team.id}/routing-rules/session`, {
    method: 'PATCH', body: { provider: 'gemini', modelId: 'stub-model', machineId },
  });
  const project = await browserRequest(owner, '/api/projects', {
    method: 'POST', status: 201, body: { name: 'Windows acceptance' },
  });
  await runTask(owner, project.id, machineId, 'local');

  office = await (await browser.newContext({ locale: 'en-US' })).newPage();
  await office.goto(`${officeOrigin}/app`, { waitUntil: 'domcontentloaded' });
  const pairingInput = office.locator('#cairn-pair-input');
  await expect(pairingInput).toBeVisible({ timeout });
  await browserRequest(office, '/api/user/me', { status: 401 });
  await office.screenshot({ path: join(evidence, 'office-pairing-gate.png') });
  const { code } = await browserRequest(owner, '/api/remote/pairing', { method: 'POST', status: 201 });
  await pairingInput.fill(code);
  await pairingInput.press('Enter');
  await expect(office.locator('.token-gate')).toHaveCount(0, { timeout });
  await expect(office.getByTestId('home-c')).toBeVisible({ timeout });
  await browserRequest(office, '/api/remote/pairing', { status: 403 });
  await browserRequest(office, '/api/remote/pairing', { method: 'POST', status: 403 });
  console.log('Paired office browser cannot manage pairing');
  const remoteTodoId = await runTask(office, project.id, machineId, 'office');
  await owner.goto(`${localOrigin}/app/todo/${remoteTodoId}`, { waitUntil: 'domcontentloaded' });
  await expect(owner.getByText('Hello Thread', { exact: true }).first()).toBeVisible({ timeout });
  await owner.screenshot({ path: join(evidence, 'office-task-seen-locally.png') });
} catch (error) {
  for (const [page, name] of [[owner, 'local'], [office, 'office']]) {
    if (page) {
      await page.screenshot({ path: join(evidence, `${name}-failure.png`), timeout: 5000 }).catch(() => {});
    }
  }
  throw error;
} finally {
  await browser?.close();
  for (const { child, exited } of children) if (!exited) child.kill();
}
