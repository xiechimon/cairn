import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:net';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('cloakbrowser', () => ({
  binaryInfo: () => ({ installed: true, binaryPath: '/fake/cloak', version: '156' }),
  ensureBinary: () => {
    throw new Error('Unexpected download');
  },
  getDefaultStealthArgs: () => [
    '--no-sandbox',
    '--fingerprint=12345',
    '--fingerprint-platform=windows',
  ],
  licenseErrorFrom: () => null,
}));

import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { CloakBrowser, type CloakSdk } from '../src/computer/cloak-browser.js';
import {
  type CommandRunner,
  HOST_DESKTOP_PROGRAMS,
  HostDesktops,
} from '../src/computer/host-desktop.js';
import { ComputerRefusal } from '../src/computer/provider.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function workspace(programs: readonly string[]) {
  const root = makeTestTempDir('host-desktop-');
  cleanups.push(() => releaseTestTempDir(root));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const name of programs) {
    writeFileSync(join(bin, name), '#!/bin/sh\n');
    chmodSync(join(bin, name), 0o755);
  }
  const license = join(root, 'license.key');
  writeFileSync(license, 'fake-cloak-test-key');
  return { root, env: { PATH: bin, CLOAKBROWSER_LICENSE_FILE: license } };
}

function listen(path: string): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer().listen(path, () => resolve(server));
    cleanups.push(() => server.close());
  });
}

function fakeSystemd(display: string, onStop: () => void = () => {}) {
  const calls: string[][] = [];
  const active = new Set<string>();
  const environments: (NodeJS.ProcessEnv | undefined)[] = [];
  const servers = new Map<string, Server[]>();
  const behavior = {
    quit: 'exit' as 'exit' | 'stay' | 'fail',
    start: 'ok' as 'ok' | 'exits',
    windows: true,
    pid: 4242,
  };
  const browserUnit = () => [...active].find((unit) => unit.endsWith('-browser.service'));
  const run = vi.fn(async (argv: readonly string[], env?: NodeJS.ProcessEnv) => {
    calls.push([...argv]);
    environments.push(env);
    if (basename(argv[0] as string) === 'cloak-manual') {
      const unit = `cairn-desktop-${basename(dirname(argv[0] as string))}-browser.service`;
      if (!active.has(unit)) {
        if (behavior.start === 'exits') return { code: 1, stdout: '' };
        active.add(unit);
      }
      return { code: behavior.windows ? 0 : 1, stdout: '' };
    }
    if (argv[0] === 'xdotool') {
      const unit = browserUnit();
      if (argv[1] === 'search')
        return behavior.windows && unit
          ? { code: 0, stdout: '0x1\n0x2\n' }
          : { code: 1, stdout: '' };
      if (argv[1] === 'windowquit') {
        if (behavior.quit === 'fail') return { code: 1, stdout: '' };
        if (behavior.quit === 'exit' && unit) active.delete(unit);
        return { code: 0, stdout: '' };
      }
    }
    if (argv[0] === 'systemctl' && argv[2] === 'show') {
      const unit = argv.at(-1) as string;
      return { code: 0, stdout: `${active.has(unit) ? behavior.pid : 0}\n` };
    }
    if (argv[0] === 'systemd-run') {
      const unit = argv.find((arg) => arg.startsWith('--unit='))?.slice('--unit='.length) ?? '';
      if (unit.endsWith('-browser.service')) {
        active.add(unit);
        return { code: 0, stdout: '' };
      }
      const directory = argv.at(-2) as string;
      for (const server of servers.get(directory) ?? []) server.close();
      for (const name of ['view.sock', 'vnc.sock'])
        rmSync(join(directory, 'computer', name), { force: true });
      servers.set(directory, [
        await listen(join(directory, 'computer', 'view.sock')),
        await listen(join(directory, 'computer', 'vnc.sock')),
      ]);
      writeFileSync(join(directory, 'display'), `${display}\n`);
      active.add(unit);
      return { code: 0, stdout: '' };
    }
    if (argv[0] === 'systemctl' && argv[2] === 'stop' && active.has(argv[3] as string)) {
      onStop();
      active.delete(argv[3] as string);
    }
    if (argv[0] === 'systemctl' && argv[2] === 'is-active') {
      const units = argv.slice(3);
      return {
        code: units.every((unit) => active.has(unit)) ? 0 : 3,
        stdout: units.map((unit) => (active.has(unit) ? 'active' : 'inactive')).join('\n'),
      };
    }
    return { code: 0, stdout: '' };
  });
  return { calls, active, run, environments, behavior };
}

function ownerUnit(scopeKey: string): string {
  return `cairn-desktop-${createHash('sha256').update(scopeKey).digest('hex').slice(0, 16)}-browser.service`;
}

const stops = (calls: string[][], suffix = '-browser.service') =>
  calls.filter(
    (argv) => argv[0] === 'systemctl' && argv[2] === 'stop' && argv[3]?.endsWith(suffix),
  );
const quits = (calls: string[][]) => calls.filter((argv) => argv[1] === 'windowquit');

const PROGRAMS = [...HOST_DESKTOP_PROGRAMS];
const BROWSER = [...PROGRAMS, 'xdotool', 'agent-browser', 'chromium'];

function fakeAgentBrowser(bin: string, log: string, script = '') {
  writeFileSync(
    join(bin, 'agent-browser'),
    `#!/bin/sh\necho "$AGENT_BROWSER_PROFILE|$*" >> '${log}'\n${script}`,
  );
  chmodSync(join(bin, 'agent-browser'), 0o755);
}

function scopeHome(root: string, scopeKey: string): string {
  return join(root, createHash('sha256').update(scopeKey).digest('hex').slice(0, 16), 'home');
}

describe('HostDesktops', () => {
  test('without a Cloak license Chromium is offered, a stealth call is refused and files stay usable', async () => {
    const { root, env } = workspace(BROWSER);
    const systemd = fakeSystemd('91');
    const desktops = new HostDesktops({
      root,
      toolsRoot: root,
      env: { ...env, CLOAKBROWSER_LICENSE_FILE: join(root, 'missing') },
      run: systemd.run,
    });
    await expect(desktops.prepareBrowser()).rejects.toThrow('license file');
    expect(desktops.offersBrowser()).toBe(true);
    expect(desktops.offersStealthBrowser()).toBe(false);
    await expect(
      desktops.forScope('chief:a').execute({
        argv: ['agent-browser', '--session', 'chief_a-stealth', 'snapshot'],
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('No CloakBrowser license');
    await desktops.forScope('chief:a').writeFile('note.txt', 'available');
    expect(await desktops.forScope('chief:a').readFile('note.txt')).toBe('available');
  });

  test('without Chromium the default browser is not offered', async () => {
    const { root, env } = workspace(BROWSER.filter((name) => name !== 'chromium'));
    const desktops = new HostDesktops({ root, toolsRoot: root, env, run: fakeSystemd('91').run });
    await desktops.prepareBrowser();
    expect(desktops.offersBrowser()).toBe(false);
    expect(desktops.offersStealthBrowser()).toBe(true);
  });

  test('a default browser call runs Chromium on its own profile without the Cloak key', async () => {
    const { root, env } = workspace(BROWSER);
    const log = join(root, 'environment.log');
    fakeAgentBrowser(
      env.PATH,
      log,
      `printf '%s|%s|%s' "$CLOAKBROWSER_LICENSE_KEY" "$AGENT_BROWSER_EXECUTABLE_PATH" "$AGENT_BROWSER_ARGS" > '${log}.env'`,
    );
    const desktops = new HostDesktops({ root, toolsRoot: root, env, run: fakeSystemd('90').run });
    await desktops.prepareBrowser();
    for await (const _ of await desktops.forScope('chief:a').execute({
      argv: ['agent-browser', '--session', 'chief_a', 'snapshot'],
      timeoutMs: 5_000,
      signal: new AbortController().signal,
    }));
    const [key, executable, args] = readFileSync(`${log}.env`, 'utf8').split('|');
    expect(key).toBe('');
    expect(executable).toBe(join(env.PATH, 'chromium'));
    expect(args).toContain('--restore-last-session');
    expect(args).not.toContain('--fingerprint');
    expect(readFileSync(log, 'utf8')).toContain(
      `${join(scopeHome(root, 'chief:a'), '.cairn', 'browser-profile')}|--session chief_a snapshot`,
    );
  });

  test('an old Cloak profile moves to the stealth profile and Chromium starts fresh', async () => {
    const { root, env } = workspace(BROWSER);
    const home = scopeHome(root, 'chief:a');
    const old = join(home, '.cairn', 'browser-profile');
    mkdirSync(join(old, 'Default'), { recursive: true });
    writeFileSync(join(old, '.cairn-cloak-identity.json'), '{}');
    writeFileSync(join(old, 'Default', 'Cookies'), 'login');
    await new HostDesktops({ root, toolsRoot: root, env, run: fakeSystemd('90').run }).ensure(
      'chief:a',
    );
    expect(readFileSync(join(home, '.cairn', 'cloak-profile', 'Default', 'Cookies'), 'utf8')).toBe(
      'login',
    );
    expect(existsSync(join(old, '.cairn-cloak-identity.json'))).toBe(false);
  });

  test('the Dock never points to the system Chromium desktop entry', async () => {
    const { root, env } = workspace(BROWSER);
    const systemd = fakeSystemd('92');
    await new HostDesktops({ root, toolsRoot: root, env, run: systemd.run }).ensure('chief:a');
    const script = systemd.calls.find((argv) => argv[0] === 'systemd-run')?.join('\n');
    expect(script).not.toContain('/usr/share/applications/chromium.desktop');
  });
  test('browser environment is lazy, browser-only and shares the generated Dock identity', async () => {
    const { root, env } = workspace(BROWSER);
    const log = join(root, 'environment.log');
    fakeAgentBrowser(
      env.PATH,
      log,
      `printf '%s|%s|%s' "$CLOAKBROWSER_LICENSE_KEY" "$AGENT_BROWSER_EXECUTABLE_PATH" "$AGENT_BROWSER_ARGS" > '${log}.env'`,
    );
    const systemd = fakeSystemd('90');
    const desktops = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
    const provider = desktops.forScope('chief:a');
    const request = { timeoutMs: 5_000, signal: new AbortController().signal };
    const shellEvents = [];
    for await (const event of await provider.execute({
      ...request,
      argv: ['/bin/sh', '-c', 'test -z "$CLOAKBROWSER_LICENSE_KEY"'],
    }))
      shellEvents.push(event);
    expect(shellEvents.at(-1)).toMatchObject({ kind: 'exit', code: 0 });
    expect(desktops.offersStealthBrowser()).toBe(false);
    await desktops.prepareBrowser();
    expect(desktops.offersStealthBrowser()).toBe(true);
    for await (const _ of await provider.execute({
      ...request,
      argv: ['agent-browser', '--session', 'chief_a-stealth', 'snapshot'],
    }));
    const browserEnv = readFileSync(`${log}.env`, 'utf8');
    expect(browserEnv).toContain('fake-cloak-test-key|/fake/cloak|');
    expect(browserEnv).toContain('--fingerprint=12345,--fingerprint-platform=windows');
    expect(browserEnv).toContain('--hide-crash-restore-bubble');
    const directory = join(scopeHome(root, 'chief:a'), '..');
    const launcher = readFileSync(join(directory, 'cloak-browser'), 'utf8');
    const desktop = readFileSync(join(directory, 'cloak-browser.desktop'), 'utf8');
    expect(launcher).toContain('--fingerprint=12345');
    expect(launcher).toContain('--fingerprint-timezone=UTC');
    expect(launcher).toContain(env.CLOAKBROWSER_LICENSE_FILE);
    expect(launcher).not.toContain('fake-cloak-test-key');
    expect(launcher.match(/--restore-last-session/g)).toHaveLength(1);
    expect(desktop).toContain('Name=Cairn Cloak Browser');
    expect(desktop).toContain(`Exec="${join(directory, 'cloak-manual')}"`);
    expect(desktop).not.toContain('fake-cloak-test-key');
    expect(launcher).not.toMatch(/remote-debugging|enable-automation/);
    expect(
      systemd.environments.every((value) => value?.CLOAKBROWSER_LICENSE_KEY === undefined),
    ).toBe(true);
  });

  test.each(['failed close', 'locked profile'])(
    '%s refuses takeover before owner launch',
    async (failure) => {
      const { root, env } = workspace(BROWSER);
      fakeAgentBrowser(
        env.PATH,
        join(root, 'browser.log'),
        `case "$*" in
      "--json session list") echo '{"data":{"sessions":["chief_a-stealth"]}}' ;;
      *close) exit ${failure === 'failed close' ? 1 : 0} ;;
    esac`,
      );
      const systemd = fakeSystemd('90');
      let now = 0;
      const desktops = new HostDesktops({
        root,
        toolsRoot: root,
        env,
        run: systemd.run,
        now: () => {
          now += 20_000;
          return now;
        },
      });
      await desktops.prepareBrowser();
      await desktops.ensure('chief:a');
      if (failure === 'locked profile')
        symlinkSync(
          `host-${process.pid}`,
          join(scopeHome(root, 'chief:a'), '.cairn/cloak-profile/SingletonLock'),
        );
      await expect(desktops.hold('chief:a', 'control')).rejects.toThrow('did not close');
      expect(
        systemd.calls.some(
          (argv) =>
            argv[0] === 'systemd-run' && argv.some((arg) => arg.endsWith('-browser.service')),
        ),
      ).toBe(false);
    },
  );

  async function takenOver(fastClock: boolean) {
    const { root, env } = workspace(BROWSER);
    const log = join(root, 'browser.log');
    fakeAgentBrowser(env.PATH, log, `echo '{"data":{"sessions":["chief_a-stealth"]}}'`);
    const systemd = fakeSystemd('90');
    let now = 0;
    const desktops = new HostDesktops({
      root,
      toolsRoot: root,
      env,
      run: systemd.run,
      now: () => {
        now += 20_000;
        return fastClock ? now : Date.now();
      },
    });
    await desktops.prepareBrowser();
    (await desktops.hold('chief:a', 'control'))();
    const request = {
      argv: ['agent-browser', '--session', 'chief_a-stealth', 'snapshot'],
      timeoutMs: 5_000,
      signal: new AbortController().signal,
    };
    return { root, log, systemd, desktops, request, unit: ownerUnit('chief:a') };
  }

  test('the owner launch runs the shared manual starter with no key and no forced stop', async () => {
    const { root, systemd, unit } = await takenOver(true);
    const starter = join(scopeHome(root, 'chief:a'), '..', 'cloak-manual');
    const index = systemd.calls.findIndex((argv) => argv[0] === starter);
    expect(systemd.calls[index]).toEqual([starter]);
    expect(systemd.active.has(unit)).toBe(true);
    expect(
      systemd.environments.every((value) => value?.CLOAKBROWSER_LICENSE_KEY === undefined),
    ).toBe(true);
    expect(systemd.calls.flat().join(' ')).not.toMatch(/fake-cloak-test-key|remote-debugging/);
    expect(stops(systemd.calls)).toEqual([]);
    expect(readFileSync(starter, 'utf8')).not.toContain('fake-cloak-test-key');
  });

  test.each([
    ['quit fails', { quit: 'fail' as const, windows: true }],
    ['no window is found', { quit: 'exit' as const, windows: false }],
    ['a close dialog keeps it running', { quit: 'stay' as const, windows: true }],
  ])('handback refuses when %s and keeps the manual browser', async (_name, behavior) => {
    const { log, systemd, desktops, request, unit } = await takenOver(true);
    Object.assign(systemd.behavior, behavior);
    await expect(desktops.forScope('chief:a').execute(request)).rejects.toThrow('did not close');
    expect(systemd.active.has(unit)).toBe(true);
    expect(stops(systemd.calls)).toEqual([]);
    expect(readFileSync(log, 'utf8')).not.toContain('snapshot');
  });

  test('handback quits MainPID windows on the scope display and then waits for lock release', async () => {
    const { root, log, systemd, desktops, request, unit } = await takenOver(false);
    const lock = join(scopeHome(root, 'chief:a'), '.cairn/cloak-profile/SingletonLock');
    symlinkSync(`host-${process.pid}`, lock);
    const releaseLock = setTimeout(() => unlinkSync(lock), 50);
    try {
      for await (const _ of await desktops.forScope('chief:a').execute(request));
    } finally {
      clearTimeout(releaseLock);
    }
    const search = systemd.calls.findIndex((argv) => argv[1] === 'search');
    expect(systemd.calls[search]).toEqual(['xdotool', 'search', '--onlyvisible', '--pid', '4242']);
    expect(systemd.environments[search]?.DISPLAY).toBe(':90');
    expect(quits(systemd.calls).map((argv) => argv.slice(0, 3))).toEqual([
      ['xdotool', 'windowquit', '0x1'],
      ['xdotool', 'windowquit', '0x2'],
    ]);
    expect(systemd.active.has(unit)).toBe(false);
    expect(existsSync(lock)).toBe(false);
    expect(stops(systemd.calls)).toEqual([]);
    expect(readFileSync(log, 'utf8')).toContain('snapshot');
  });

  test('a live profile lock still refuses handback after the manual unit exits', async () => {
    const { root, systemd, desktops, request } = await takenOver(true);
    symlinkSync(
      `host-${process.pid}`,
      join(scopeHome(root, 'chief:a'), '.cairn/cloak-profile/SingletonLock'),
    );
    await expect(desktops.forScope('chief:a').execute(request)).rejects.toThrow('did not close');
    expect(stops(systemd.calls)).toEqual([]);
  });

  test('an unregistered or cached Dock-started manual unit is discovered and quit before the agent runs', async () => {
    const { root, env } = workspace(BROWSER);
    const log = join(root, 'browser.log');
    fakeAgentBrowser(env.PATH, log, `echo '{"data":{"sessions":[]}}'`);
    const systemd = fakeSystemd('90');
    const request = {
      argv: ['agent-browser', '--session', 'chief_a-stealth', 'snapshot'],
      timeoutMs: 5_000,
      signal: new AbortController().signal,
    };
    const cached = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
    await cached.prepareBrowser();
    await cached.ensure('chief:a');
    const unit = ownerUnit('chief:a');
    systemd.active.add(unit);
    for await (const _ of await cached.forScope('chief:a').execute(request));
    expect(quits(systemd.calls)).toHaveLength(2);
    expect(systemd.active.has(unit)).toBe(false);

    systemd.active.add(unit);
    const restarted = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
    await restarted.prepareBrowser();
    for await (const _ of await restarted.forScope('chief:a').execute(request));
    expect(quits(systemd.calls)).toHaveLength(4);
    expect(stops(systemd.calls)).toEqual([]);
  });

  test('an inactive manual unit neither blocks on the agent profile lock nor stops anything', async () => {
    const { root, env } = workspace(BROWSER);
    fakeAgentBrowser(env.PATH, join(root, 'browser.log'), `echo '{"data":{"sessions":[]}}'`);
    const systemd = fakeSystemd('90');
    const desktops = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
    await desktops.prepareBrowser();
    await desktops.ensure('chief:a');
    const profile = join(scopeHome(root, 'chief:a'), '.cairn/browser-profile');
    mkdirSync(profile, { recursive: true });
    symlinkSync(`host-${process.pid}`, join(profile, 'SingletonLock'));
    const request = {
      argv: ['agent-browser', 'snapshot'],
      timeoutMs: 5_000,
      signal: new AbortController().signal,
    };
    for await (const _ of await desktops.forScope('chief:a').execute(request));
    expect(quits(systemd.calls)).toEqual([]);
    expect(stops(systemd.calls)).toEqual([]);
  });

  test('the Dock entry and the owner API run one generated starter for one unit', async () => {
    const { root, env } = workspace(BROWSER);
    fakeAgentBrowser(
      env.PATH,
      join(root, 'browser.log'),
      `echo '{"data":{"sessions":["chief_a-stealth"]}}'`,
    );
    const systemd = fakeSystemd('96');
    const desktops = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
    await desktops.prepareBrowser();
    (await desktops.hold('chief:a', 'control'))();
    const directory = join(scopeHome(root, 'chief:a'), '..');
    const starter = join(directory, 'cloak-manual');
    const entry = readFileSync(join(directory, 'cloak-browser.desktop'), 'utf8');
    expect(entry).toContain(`Exec="${starter}"`);
    expect(entry).not.toContain('cloak-browser"');
    expect(systemd.calls.some((argv) => argv[0] === starter)).toBe(true);
  });

  test('taking control while a Dock-started unit is active confirms its window through the starter', async () => {
    const { root, env } = workspace(BROWSER);
    fakeAgentBrowser(env.PATH, join(root, 'browser.log'), `echo '{"data":{"sessions":[]}}'`);
    const systemd = fakeSystemd('90');
    const desktops = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
    await desktops.prepareBrowser();
    await desktops.ensure('chief:a');
    systemd.active.add(ownerUnit('chief:a'));
    (await desktops.hold('chief:a', 'control'))();
    expect(
      systemd.calls.filter((argv) => basename(argv[0] as string) === 'cloak-manual'),
    ).toHaveLength(1);
    expect(stops(systemd.calls)).toEqual([]);
  });

  test.each([
    ['an active unit has no window', 'ok', true],
    ['the unit exits after creation', 'exits', false],
    ['a new unit never shows a window', 'ok', false],
  ] as const)('owner takeover is refused when %s', async (_name, start, preActive) => {
    const { root, env } = workspace(BROWSER);
    fakeAgentBrowser(
      env.PATH,
      join(root, 'browser.log'),
      `echo '{"data":{"sessions":["chief_a-stealth"]}}'`,
    );
    const systemd = fakeSystemd('90');
    systemd.behavior.start = start;
    systemd.behavior.windows = false;
    const desktops = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
    await desktops.prepareBrowser();
    await desktops.ensure('chief:a');
    if (preActive) systemd.active.add(ownerUnit('chief:a'));
    await expect(desktops.hold('chief:a', 'control')).rejects.toThrow('could not be started');
    expect(stops(systemd.calls)).toEqual([]);
    expect(quits(systemd.calls)).toEqual([]);
  });

  describe('generated manual starter', () => {
    function starterRun(options: {
      mode: 'ok' | 'exits' | 'fail';
      active?: boolean;
      window?: boolean;
    }) {
      const { root, env } = workspace(BROWSER);
      const fake = join(root, 'fake');
      const state = join(root, 'state');
      mkdirSync(fake);
      mkdirSync(state);
      const script = (name: string, body: string) => {
        writeFileSync(join(fake, name), `#!/bin/bash\n${body}\n`);
        chmodSync(join(fake, name), 0o755);
      };
      script(
        'systemctl',
        `case "$*" in *is-active*) [[ -e "$STATE/active" ]] ;; *show*) if [[ -e "$STATE/active" ]]; then echo 4242; else echo 0; fi ;; esac`,
      );
      script(
        'systemd-run',
        `printf '%s\\n' "$@" > "$STATE/argv"; echo run >> "$STATE/runs"; case "$MODE" in ok) touch "$STATE/active" ;; fail) exit 1 ;; esac`,
      );
      script(
        'xdotool',
        `echo "$DISPLAY|$*" >> "$STATE/xdotool"; if [[ -e "$STATE/window" ]]; then echo 0x1; else exit 1; fi`,
      );
      if (options.active) writeFileSync(join(state, 'active'), '');
      if (options.window) writeFileSync(join(state, 'window'), '');
      const directory = join(scopeHome(root, 'chief:a'), '..');
      const systemd = fakeSystemd('96');
      const desktops = new HostDesktops({
        root,
        toolsRoot: root,
        env,
        run: systemd.run,
        browserReadyMs: 300,
      });
      const generated = desktops.prepareBrowser().then(() => desktops.ensure('chief:a'));
      return generated.then(() => {
        const ran = spawnSync(join(directory, 'cloak-manual'), ['https://example.test'], {
          env: { PATH: `${fake}:/usr/bin:/bin`, STATE: state, MODE: options.mode },
        });
        const read = (name: string) =>
          existsSync(join(state, name)) ? readFileSync(join(state, name), 'utf8') : '';
        return { ran, read, root, directory };
      });
    }

    test('creates the unit and succeeds only once a visible window belongs to MainPID', async () => {
      const { ran, read, root, directory } = await starterRun({
        mode: 'ok',
        window: true,
      });
      expect(ran.status).toBe(0);
      const argv = read('argv').trim().split('\n');
      const unit = ownerUnit('chief:a');
      expect(argv).toContain(`--unit=${unit}`);
      expect(argv).toContain(`--property=BindsTo=${unit.replace('-browser.service', '.service')}`);
      expect(argv).toContain('--setenv=DISPLAY=:96');
      expect(argv).toContain(`--setenv=HOME=${scopeHome(root, 'chief:a')}`);
      expect(argv.slice(-2)).toEqual([join(directory, 'cloak-browser'), 'https://example.test']);
      expect(argv.join(' ')).not.toMatch(/fake-cloak-test-key|CLOAKBROWSER_LICENSE_KEY/);
      expect(read('xdotool')).toContain(':96|search --onlyvisible --pid 4242');
    });

    test.each([
      ['systemd-run itself fails', { mode: 'fail' as const, window: true }],
      ['the created unit has already exited', { mode: 'exits' as const, window: true }],
      ['a created unit never shows a window', { mode: 'ok' as const, window: false }],
      ['a cached active unit has no window', { mode: 'ok' as const, active: true }],
    ])('fails when %s', async (_name, options) => {
      const { ran } = await starterRun(options);
      expect(ran.status).not.toBe(0);
    });

    test('an already active unit with a window is reused without creating another', async () => {
      const { ran, read } = await starterRun({ mode: 'ok', active: true, window: true });
      expect(ran.status).toBe(0);
      expect(read('runs')).toBe('');
    });
  });

  test('a reused running desktop replaces the old Dock entry without restarting its service', async () => {
    const { root, env } = workspace(BROWSER);
    const systemd = fakeSystemd('90');
    await new HostDesktops({ root, toolsRoot: root, env, run: systemd.run }).ensure('chief:a');
    const dock = join(scopeHome(root, 'chief:a'), '.config/plank/dock1/launchers');
    mkdirSync(dock, { recursive: true });
    const stock = join(dock, 'chromium.dockitem');
    writeFileSync(stock, 'Launcher=file:///usr/share/applications/chromium.desktop');
    const again = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
    await again.prepareBrowser();
    await again.ensure('chief:a');
    expect(existsSync(stock)).toBe(false);
    expect(readFileSync(join(dock, 'cloak-browser.dockitem'), 'utf8')).toContain(
      '/cloak-browser.desktop',
    );
    expect(systemd.calls.filter((argv) => argv[0] === 'systemd-run')).toHaveLength(1);
  });

  describe('without browser capability', () => {
    const request = {
      argv: ['agent-browser', 'snapshot'],
      timeoutMs: 5_000,
      signal: new AbortController().signal,
    };

    async function plainControl(env: NodeJS.ProcessEnv, root: string, prepared: CloakBrowser) {
      const systemd = fakeSystemd('90');
      const desktops = new HostDesktops({
        root,
        toolsRoot: root,
        env,
        run: systemd.run,
        browser: prepared,
      });
      const release = await desktops.hold('chief:a', 'control');
      await desktops.forScope('chief:a').writeFile('note.txt', 'still here');
      expect(await desktops.forScope('chief:a').readFile('note.txt')).toBe('still here');
      await expect(desktops.forScope('chief:a').execute(request)).rejects.toThrow('taken over');
      release();
      const directory = join(scopeHome(root, 'chief:a'), '..');
      expect(desktops.offersStealthBrowser()).toBe(false);
      expect(existsSync(join(directory, 'cloak-manual'))).toBe(false);
      expect(existsSync(join(directory, 'cloak-browser.desktop'))).toBe(false);
      expect(systemd.calls.some((argv) => basename(argv[0] as string) === 'cloak-manual')).toBe(
        false,
      );
      expect(systemd.calls.some((argv) => argv[0] === 'xdotool')).toBe(false);
      expect(stops(systemd.calls)).toEqual([]);
    }

    test('without a key, control still takes the desktop and starts no browser', async () => {
      const { root, env } = workspace(BROWSER);
      const absent = { ...env, CLOAKBROWSER_LICENSE_FILE: join(root, 'missing') };
      await plainControl(absent, root, new CloakBrowser(absent));
    });

    test('without xdotool, preparation refuses before the SDK and prepared state offers no browser', async () => {
      const { root, env } = workspace(BROWSER.filter((name) => name !== 'xdotool'));
      const sdk: CloakSdk = {
        binaryInfo: vi.fn(() => ({ installed: true, binaryPath: '/fake/cloak', version: '1' })),
        ensureBinary: vi.fn(async () => '/fake/downloaded'),
        getDefaultStealthArgs: vi.fn(() => [
          '--fingerprint=12345',
          '--fingerprint-platform=windows',
        ]),
        licenseErrorFrom: vi.fn(() => null),
      };
      const prepared = new CloakBrowser(env, sdk);
      const desktops = new HostDesktops({ root, toolsRoot: root, env, browser: prepared });
      await expect(desktops.prepareBrowser()).rejects.toThrow('xdotool');
      expect(sdk.binaryInfo).not.toHaveBeenCalled();
      expect(sdk.ensureBinary).not.toHaveBeenCalled();
      await prepared.prepare();
      await plainControl(env, root, prepared);
    });
  });

  test('a missing program refuses before any unit starts and names the program', async () => {
    const { root, env } = workspace(PROGRAMS.filter((name) => name !== 'x11vnc'));
    const systemd = fakeSystemd('90');
    const desktops = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
    const error = await desktops.ensure('chief:a').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ComputerRefusal);
    expect((error as Error).message).toContain('x11vnc');
    expect(systemd.calls.filter((argv) => argv[0] === 'systemd-run')).toHaveLength(0);
    expect(await desktops.presence()).toEqual([]);
  });

  test('a scope gets its own desktop, reused while its unit stays active', async () => {
    const { root, env } = workspace(BROWSER);
    const systemd = fakeSystemd('93');
    const desktops = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
    expect(await desktops.ensure('chief:a')).toBe(':93');
    const view = desktops.socketPath('chief:a', 'view');
    expect(view.endsWith('/computer/view.sock')).toBe(true);
    expect(desktops.socketPath('chief:b', 'view')).not.toBe(view);
    expect(desktops.socketPath('chief:a', 'control')).toBe(view.replace('view.sock', 'vnc.sock'));

    const started = systemd.calls.find((argv) => argv[0] === 'systemd-run') ?? [];
    for (const name of [
      'HOME',
      'XDG_CONFIG_HOME',
      'XDG_DATA_HOME',
      'XDG_CACHE_HOME',
      'XDG_STATE_HOME',
    ]) {
      const value = started.find((arg) => arg.startsWith(`--setenv=${name}=`));
      expect(value?.slice(`--setenv=${name}=`.length).startsWith(`${root}/`)).toBe(true);
    }

    const again = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
    expect(await again.ensure('chief:a')).toBe(':93');
    expect(systemd.calls.filter((argv) => argv[0] === 'systemd-run')).toHaveLength(1);

    expect(await again.presence()).toEqual([
      {
        scopeKey: 'chief:a',
        providerRef: `cairn-orb-computer-${createHash('sha256').update('chief:a').digest('hex').slice(0, 40)}`,
        state: 'running',
      },
    ]);
    systemd.active.clear();
    expect((await again.presence())[0]?.state).toBe('stopped');
  });

  test('a desktop that never becomes ready is stopped and reported failed', async () => {
    const { root, env } = workspace(BROWSER);
    const calls: string[][] = [];
    const run: CommandRunner = async (argv) => {
      calls.push([...argv]);
      return { code: argv[0] === 'systemd-run' ? 0 : 3, stdout: 'inactive' };
    };
    const desktops = new HostDesktops({ root, toolsRoot: root, env, run, readyMs: 50 });
    await expect(desktops.ensure('chief:a')).rejects.toThrow('did not become ready');
    expect(calls.at(-1)?.slice(0, 3)).toEqual(['systemctl', '--user', 'stop']);
    expect((await desktops.presence())[0]?.state).toBe('failed');
  });

  test('an idle desktop saves the browser login, stops, and starts again on the next call', async () => {
    const { root, env } = workspace(BROWSER);
    const log = join(root, 'agent-browser.log');
    writeFileSync(
      join(env.PATH, 'agent-browser'),
      `#!/bin/sh\nsleep 0.3\necho "$HOME $*" >> '${log}'\n`,
    );
    chmodSync(join(env.PATH, 'agent-browser'), 0o755);
    const closedBeforeStop: boolean[] = [];
    const systemd = fakeSystemd('94', () => closedBeforeStop.push(existsSync(log)));
    let now = 0;
    const desktops = new HostDesktops({
      root,
      toolsRoot: root,
      env,
      run: systemd.run,
      now: () => now,
      idleStopMs: 1_000,
    });
    await desktops.prepareBrowser();
    await desktops.forScope('chief:a').writeFile('note.txt', 'x');
    now = 999;
    await desktops.sweep();
    expect(systemd.active.size).toBe(1);

    const release = await desktops.hold('chief:a');
    now = 5_000;
    await desktops.sweep();
    expect(systemd.active.size).toBe(1);
    release();
    now = 5_999;
    await desktops.sweep();
    expect(systemd.active.size).toBe(1);

    now = 6_000;
    await desktops.sweep();
    expect(systemd.active.size).toBe(0);
    expect(closedBeforeStop).toEqual([true]);
    const [line] = readFileSync(log, 'utf8').trim().split('\n');
    expect(line).toMatch(new RegExp(`^${root}/[0-9a-f]{16}/home --session chief_a close$`));
    expect((await desktops.presence())[0]?.state).toBe('stopped');

    expect(await desktops.forScope('chief:a').readFile('note.txt')).toBe('x');
    expect(systemd.calls.filter((argv) => argv[0] === 'systemd-run')).toHaveLength(2);
    expect(systemd.active.size).toBe(1);
  });

  test('a desktop an earlier daemon left running is stopped once idle', async () => {
    const { root, env } = workspace(BROWSER);
    const systemd = fakeSystemd('95');
    await new HostDesktops({ root, toolsRoot: root, env, run: systemd.run }).ensure('chief:a');
    let now = 0;
    const later = new HostDesktops({
      root,
      toolsRoot: root,
      env,
      run: systemd.run,
      now: () => now,
      idleStopMs: 1_000,
    });
    await later.sweep();
    expect(systemd.active.size).toBe(1);
    now = 1_000;
    await later.sweep();
    expect(systemd.active.size).toBe(0);
  });
  test('idle stop gracefully quits a discovered manual browser before stopping the desktop', async () => {
    const { root, env } = workspace(BROWSER);
    const systemd = fakeSystemd('95');
    await new HostDesktops({ root, toolsRoot: root, env, run: systemd.run }).ensure('chief:a');
    systemd.active.add(ownerUnit('chief:a'));
    let now = 0;
    const later = new HostDesktops({
      root,
      toolsRoot: root,
      env,
      run: systemd.run,
      now: () => now,
      idleStopMs: 1_000,
    });
    await later.sweep();
    now = 1_000;
    await later.sweep();
    expect(systemd.active.size).toBe(0);
    const quit = systemd.calls.findIndex((argv) => argv[1] === 'windowquit');
    const stop = systemd.calls.findLastIndex((argv) => argv[2] === 'stop');
    expect(quit).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(quit);
    expect(stops(systemd.calls)).toEqual([]);
  });

  test('idle stop leaves everything running when the manual browser will not quit', async () => {
    const { root, env } = workspace(BROWSER);
    const systemd = fakeSystemd('95');
    await new HostDesktops({ root, toolsRoot: root, env, run: systemd.run }).ensure('chief:a');
    systemd.active.add(ownerUnit('chief:a'));
    systemd.behavior.quit = 'stay';
    let now = 0;
    const later = new HostDesktops({
      root,
      toolsRoot: root,
      env,
      run: systemd.run,
      now: () => (now += 1_000),
      idleStopMs: 1_000,
    });
    await later.sweep();
    await expect(later.sweep()).rejects.toThrow('did not close');
    expect(systemd.active.size).toBe(2);
    expect(stops(systemd.calls, '.service')).toHaveLength(1);
  });

  test('taking control swaps the agent browser for no-CDP Cloak on the same profile until every controller hands back', async () => {
    const { root, env } = workspace([...BROWSER, 'chromium']);
    const log = join(root, 'agent-browser.log');
    fakeAgentBrowser(
      env.PATH,
      log,
      `case "$*" in
  "--json session list") echo '{"success":true,"data":{"sessions":["chief_a","chief_a-stealth"]}}' ;;
  *"get url") echo 'https://www.zhipin.com/web/geek/job' ;;
esac
`,
    );
    const systemd = fakeSystemd('96');
    const lines = () => readFileSync(log, 'utf8').trim().split('\n');
    let agentLogAtOwnerStart: string[] = [];
    const run: CommandRunner = async (argv) => {
      if (basename(argv[0] as string) === 'cloak-manual') agentLogAtOwnerStart = lines();
      return systemd.run(argv);
    };
    const desktops = new HostDesktops({
      root,
      toolsRoot: root,
      env: { ...env, HTTPS_PROXY: 'http://127.0.0.1:7890' },
      run,
    });
    const profile = join(scopeHome(root, 'chief:a'), '.cairn', 'cloak-profile');
    const owner = `cairn-desktop-${createHash('sha256').update('chief:a').digest('hex').slice(0, 16)}-browser.service`;

    await desktops.prepareBrowser();
    const first = await desktops.hold('chief:a', 'control');
    expect(agentLogAtOwnerStart).toEqual([
      '|--json session list',
      `${profile}|--session chief_a-stealth get url`,
      `${profile}|--session chief_a-stealth close`,
    ]);
    const starter = join(scopeHome(root, 'chief:a'), '..', 'cloak-manual');
    expect(systemd.calls.filter((argv) => argv[0] === starter)).toEqual([
      [starter, 'https://www.zhipin.com/web/geek/job'],
    ]);
    expect(stops(systemd.calls)).toEqual([]);
    const launcher = readFileSync(join(scopeHome(root, 'chief:a'), '..', 'cloak-browser'), 'utf8');
    for (const flag of [
      `--user-data-dir=${profile}`,
      '--fingerprint=12345',
      '--fingerprint-platform=windows',
      '--proxy-server=http://127.0.0.1:7890',
    ])
      expect(launcher).toContain(flag);
    expect(launcher).not.toMatch(/remote-debugging|enable-automation|fake-cloak-test-key/);
    expect(systemd.active.has(owner)).toBe(true);

    const browser = desktops.forScope('chief:a');
    const request = {
      argv: ['agent-browser', '--session', 'chief_a-stealth', 'snapshot'],
      timeoutMs: 5_000,
      signal: new AbortController().signal,
    };
    await expect(browser.execute(request)).rejects.toThrow('taken over');

    const second = await desktops.hold('chief:a', 'control');
    first();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(systemd.active.has(owner)).toBe(true);
    await expect(browser.execute(request)).rejects.toThrow('taken over');
    second();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(systemd.active.has(owner)).toBe(true);

    const reconnected = await desktops.hold('chief:a', 'control');
    reconnected();
    expect(systemd.calls.filter((argv) => argv[0] === starter)).toHaveLength(2);
    expect(systemd.active.has(owner)).toBe(true);

    const events = await browser.execute(request);
    const ownerActiveAtSnapshot = systemd.active.has(owner);
    for await (const _event of events);
    expect(ownerActiveAtSnapshot).toBe(false);
    expect(lines().at(-1)).toBe(`${profile}|--session chief_a-stealth snapshot`);
    expect(quits(systemd.calls).length).toBeGreaterThan(0);
    expect(stops(systemd.calls)).toEqual([]);
    expect(systemd.calls.filter((argv) => argv[0] === starter)).toHaveLength(2);
  });

  test('taking control with no stealth session hands over the open windows and starts no owner browser', async () => {
    const { root, env } = workspace(BROWSER);
    fakeAgentBrowser(
      env.PATH,
      join(root, 'agent-browser.log'),
      `echo '{"success":true,"data":{"sessions":["chief_a"]}}'\n`,
    );
    const systemd = fakeSystemd('98');
    const desktops = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
    await desktops.prepareBrowser();
    (await desktops.hold('chief:a', 'control'))();
    const directory = join(scopeHome(root, 'chief:a'), '..');
    expect(systemd.calls.some((argv) => argv[0] === join(directory, 'cloak-manual'))).toBe(false);
    expect(readFileSync(join(root, 'agent-browser.log'), 'utf8')).not.toContain('close');
    expect(
      readFileSync(join(directory, 'cloak-browser'), 'utf8').match(/--restore-last-session/g),
    ).toHaveLength(1);
  });

  test('a desktop imports the old saved login into the browser profile once', async () => {
    const { root, env } = workspace(BROWSER);
    const log = join(root, 'agent-browser.log');
    fakeAgentBrowser(env.PATH, log);
    const sessions = join(scopeHome(root, 'chief:a'), '.agent-browser', 'sessions');
    mkdirSync(sessions, { recursive: true });
    const saved = join(sessions, 'chief_a-chief_a.json');
    writeFileSync(
      saved,
      JSON.stringify({
        cookies: [
          {
            name: 'wt2',
            value: 'a b',
            domain: '.zhipin.com',
            path: '/',
            expires: 1829275006.7,
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
            size: 3,
            session: false,
          },
          {
            name: 'XFI',
            value: 'x',
            domain: 'wappass.baidu.com',
            path: '/static',
            expires: -1,
            httpOnly: false,
            secure: false,
            session: true,
          },
          { name: '', value: 'y', domain: 'wappass.baidu.com', path: '/static', expires: -1 },
        ],
        origins: [{ origin: 'https://www.zhaopin.com', localStorage: [] }],
      }),
    );
    const systemd = fakeSystemd('97');
    const desktops = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
    await desktops.prepareBrowser();
    await desktops.ensure('chief:a');
    const profile = join(scopeHome(root, 'chief:a'), '.cairn', 'browser-profile');
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
      `${profile}|--session chief_a cookies set wt2 a b --domain .zhipin.com --path / --http-only --secure --same-site Lax --expires 1829275006`,
      `${profile}|--session chief_a cookies set XFI x --domain wappass.baidu.com --path /static`,
      `${profile}|--session chief_a close`,
    ]);
    expect(existsSync(saved)).toBe(false);
    expect(existsSync(`${saved}.imported`)).toBe(true);

    systemd.active.clear();
    await new HostDesktops({ root, toolsRoot: root, env, run: systemd.run }).ensure('chief:a');
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(3);
  });

  describe('profile safety on desktop start', () => {
    const preferencesOf = (root: string) =>
      join(scopeHome(root, 'chief:a'), '.cairn/browser-profile/Default/Preferences');
    const seed = (root: string, body: object) => {
      mkdirSync(dirname(preferencesOf(root)), { recursive: true });
      writeFileSync(preferencesOf(root), JSON.stringify(body));
    };

    test('a fresh start keeps custom Preferences, disables password manager and makes a private socket dir', async () => {
      const { root, env } = workspace(BROWSER);
      fakeAgentBrowser(env.PATH, join(root, 'b.log'));
      seed(root, { custom: 1, profile: { name: 'keep' } });
      const systemd = fakeSystemd('93');
      const desktops = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
      await desktops.prepareBrowser();
      await desktops.ensure('chief:a');
      expect(JSON.parse(readFileSync(preferencesOf(root), 'utf8'))).toEqual({
        custom: 1,
        credentials_enable_service: false,
        profile: { name: 'keep', password_manager_enabled: false },
      });
      expect(statSync(join(scopeHome(root, 'chief:a'), '.agent-browser')).mode & 0o777).toBe(0o700);
    });

    test('an active manual unit found at discovery keeps its Preferences, session and login import', async () => {
      const { root, env } = workspace(BROWSER);
      const log = join(root, 'b.log');
      fakeAgentBrowser(env.PATH, log);
      seed(root, { custom: 1 });
      const sessions = join(scopeHome(root, 'chief:a'), '.agent-browser', 'sessions');
      mkdirSync(sessions, { recursive: true });
      writeFileSync(join(sessions, 'chief_a-chief_a.json'), JSON.stringify({ cookies: [] }));
      symlinkSync(
        `host-${process.pid}`,
        join(dirname(dirname(preferencesOf(root))), 'SingletonLock'),
      );
      const systemd = fakeSystemd('94');
      systemd.active.add(ownerUnit('chief:a'));
      const desktops = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
      await desktops.prepareBrowser();
      await desktops.ensure('chief:a');
      expect(JSON.parse(readFileSync(preferencesOf(root), 'utf8'))).toEqual({ custom: 1 });
      expect(existsSync(log)).toBe(false);
      expect(stops(systemd.calls)).toEqual([]);
    });

    test('an unavailable browser with a locked profile still starts the plain desktop untouched', async () => {
      const { root, env } = workspace(PROGRAMS);
      seed(root, { custom: 1 });
      symlinkSync(
        `host-${process.pid}`,
        join(dirname(dirname(preferencesOf(root))), 'SingletonLock'),
      );
      const systemd = fakeSystemd('95');
      const desktops = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
      expect(desktops.offersBrowser()).toBe(false);
      expect(await desktops.ensure('chief:a')).toBe(':95');
      expect(JSON.parse(readFileSync(preferencesOf(root), 'utf8'))).toEqual({ custom: 1 });
      expect(statSync(join(scopeHome(root, 'chief:a'), '.agent-browser')).mode & 0o777).toBe(0o700);
    });
  });
});
