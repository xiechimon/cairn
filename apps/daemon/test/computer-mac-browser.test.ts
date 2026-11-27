import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import type { ComputerCall, ComputerFrame, MachineCapabilities } from '@cairn/shared';
import { OWNER_CHROME_UNAVAILABLE_PREFIX } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { MAC_SHELL_DENIED_PORTS } from '../src/backend/loopback-ports.js';
import { createComputerDispatcher } from '../src/computer/dispatch.js';
import {
  createMacBrowser,
  findInstalledChrome,
  type MacBrowserOptions,
  NO_STEALTH_BROWSER_NOTE,
  verifyGoogleChrome,
} from '../src/computer/mac-browser.js';
import { boot } from './machine-loop-harness.js';
import { testTempDir } from './test-temp-dir.js';

vi.setConfig({ testTimeout: 30_000 });

function executable(path: string, body: string): string {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function fakeAgentBrowser(dir: string, log: string): string {
  return executable(
    join(dir, 'agent-browser'),
    `printf '%s\\n' "ARGV $*" "EXE $AGENT_BROWSER_EXECUTABLE_PATH" "PROFILE $AGENT_BROWSER_PROFILE" "UA $AGENT_BROWSER_USER_AGENT" "ARGS $AGENT_BROWSER_ARGS" "REAL $CAIRN_BROWSER_EXECUTABLE" "STREAM $AGENT_BROWSER_STREAM_PORT" "AI $AI_GATEWAY_API_KEY" >> '${log}'
case "$*" in
  *" open "*)
    sdir="$HOME/$AGENT_BROWSER_SOCKET_DIR"
    mkdir -p "$sdir"
    printf '%s' "$$" > "$sdir/$2.pid"
    printf '%s' "$AGENT_BROWSER_STREAM_PORT" > "$sdir/$2.stream"
    echo '✓ Example Domain' ;;
  *"stream disable"*)
    stream="$HOME/$AGENT_BROWSER_SOCKET_DIR/$2.stream"
    if [ -e "$stream" ]; then
      '${process.execPath}' -e 'require("fs").unlinkSync(process.argv[1])' "$stream"
      echo 'Streaming disabled'
    else
      echo '✗ Streaming is not enabled for this session' >&2
      exit 1
    fi ;;
  *"tab list"*) echo '{"data":{"tabs":[{"active":true,"label":null,"targetId":"t1"}]}}' ;;
  *"get url"*) echo '{"data":{"url":"https://example.com/"}}' ;;
  *"snapshot"*) echo '- link "Learn more" [ref=e1]' ;;
  *eval*) echo '{"data":{"result":[]}}' ;;
esac`,
  );
}

function shellZip(dir: string): { path: string; sha256: string } {
  const folder = join(dir, 'zip-source', 'chrome-headless-shell-mac-arm64');
  mkdirSync(folder, { recursive: true });
  executable(
    join(folder, 'chrome-headless-shell'),
    '[ -e "$(dirname "$0")/broken" ] && exit 1\necho "Google Chrome for Testing 158.0.1.2"',
  );
  const path = join(dir, 'shell.zip');
  execFileSync('zip', ['-qr', path, 'chrome-headless-shell-mac-arm64'], {
    cwd: join(dir, 'zip-source'),
  });
  return { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
}

function world(overrides: Partial<MacBrowserOptions> = {}) {
  const dir = realpathSync(testTempDir('mac-browser-'));
  const log = join(dir, 'agent-browser.log');
  const agentBrowser = fakeAgentBrowser(dir, log);
  const chrome = executable(join(dir, 'chrome'), 'echo "Google Chrome 158.0.8127.89 "');
  const zip = shellZip(dir);
  const options: MacBrowserOptions = {
    root: join(dir, 'home', 'mac-browser'),
    toolsRoot: join(dir, 'home', 'tools'),
    agentBrowser,
    arch: 'arm64',
    env: { PATH: process.env.PATH, HOME: dir },
    chrome: async () => chrome,
    shellReleases: {
      arm64: { version: '158.0.1.2', url: 'https://shell.test/shell.zip', sha256: zip.sha256 },
    },
    ...overrides,
  };
  return { dir, log, chrome, zip, browser: createMacBrowser(options), options };
}

function dispatcherFor(browser: ReturnType<typeof createMacBrowser> | undefined) {
  const frames: ComputerFrame[] = [];
  const dispatcher = createComputerDispatcher({
    client: {
      computerFrames: async (_id, body) => {
        frames.push(...body.frames);
        return { ok: true as const, cancelled: false };
      },
    },
    ...(browser ? { browser } : {}),
    cairnOrigins: [],
    flushMs: 20,
    heartbeatMs: 5_000,
    retryBaseMs: 5,
    retryMaxMs: 20,
  });
  const run = async (extra: Partial<ComputerCall> = {}) => {
    frames.length = 0;
    await dispatcher.dispatch({
      callId: createHash('sha256').update(`${Math.random()}`).digest('hex'),
      stepId: 'step-1',
      tool: 'browser_navigate',
      params: { url: 'https://example.com' },
      deadlineAt: Date.now() + 25_000,
      scopeKey: 'chief:c1',
      browserScope: 'thread-1',
      computerGrant: 'browser',
      ...extra,
    });
    const last = frames.at(-1);
    if (last?.kind === 'done') return { ok: true, text: last.text };
    if (last?.kind === 'error') return { ok: false, text: last.message };
    throw new Error('the call did not finish');
  };
  return { run, dispatcher };
}

function download(zipPath: string, gate?: Promise<void>): typeof fetch {
  return (async () => {
    const bytes = readFileSync(zipPath);
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(bytes.subarray(0, Math.floor(bytes.length / 2)));
        await gate;
        controller.enqueue(bytes.subarray(Math.floor(bytes.length / 2)));
        controller.close();
      },
    });
    return new Response(body, { headers: { 'content-length': String(bytes.length) } });
  }) as typeof fetch;
}

async function reportedCapabilities(env: NodeJS.ProcessEnv): Promise<MachineCapabilities> {
  const booted = await boot({ platform: 'darwin', capEnv: env, presenceIntervalMs: 20 });
  await vi.waitFor(() => expect(booted.api.presenceBodies.length).toBeGreaterThan(0), {
    timeout: 15_000,
  });
  return (booted.api.presenceBodies.at(-1) as { capabilities: MachineCapabilities }).capabilities;
}

function plantedChrome(root: string, applications = join(root, 'Applications')): string {
  const binary = join(applications, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome');
  mkdirSync(dirname(binary), { recursive: true });
  executable(binary, 'echo "Google Chrome 158.0.0.0"');
  return binary;
}

describe('choosing the installed Chrome', () => {
  test('verification is the system codesign with Google’s designated requirement', async () => {
    const seen: unknown[][] = [];
    const runImpl = vi.fn(async (...args: unknown[]) => {
      seen.push(args);
      return { stdout: '', stderr: '' };
    }) as unknown as Parameters<typeof verifyGoogleChrome>[1];
    await expect(verifyGoogleChrome('/tmp/Google Chrome.app', runImpl)).resolves.toBe(true);
    expect(seen[0]?.[0]).toBe('/usr/bin/codesign');
    const args = seen[0]?.[1] as string[];
    expect(args[0]).toBe('--verify');
    expect(args[1]).toContain('identifier "com.google.Chrome"');
    expect(args[1]).toContain('anchor apple generic');
    expect(args[1]).toContain('certificate leaf[subject.OU] = "EQHXZ8M8AV"');
    expect(args[2]).toBe('/tmp/Google Chrome.app');
  });

  test('a Chrome-shaped program in the user Applications folder is never used', async () => {
    const dir = realpathSync(testTempDir('mac-chrome-lookup-'));
    plantedChrome(join(dir, 'home'));
    const systemApplications = join(dir, 'system-applications');
    mkdirSync(systemApplications, { recursive: true });
    await expect(
      findInstalledChrome(join(dir, 'home'), { applications: systemApplications }),
    ).resolves.toBeNull();
  });

  test('the system Chrome must pass the Google designated requirement before its path is used', async () => {
    const dir = realpathSync(testTempDir('mac-chrome-verify-'));
    const systemApplications = join(dir, 'system-applications');
    const binary = plantedChrome(systemApplications, systemApplications);
    const verify = vi.fn(async () => false);
    await expect(
      findInstalledChrome(join(dir, 'home'), { applications: systemApplications, verify }),
    ).resolves.toBeNull();
    expect(verify).toHaveBeenCalledWith(join(systemApplications, 'Google Chrome.app'));
    verify.mockImplementation(async () => true);
    await expect(
      findInstalledChrome(join(dir, 'home'), { applications: systemApplications, verify }),
    ).resolves.toBe(binary);
  });

  test.runIf(process.platform === 'darwin')(
    'real codesign rejects an unsigned Chrome-shaped bundle',
    async () => {
      const dir = realpathSync(testTempDir('mac-chrome-real-codesign-'));
      plantedChrome(dir, dir);
      await expect(verifyGoogleChrome(join(dir, 'Google Chrome.app'))).resolves.toBe(false);
    },
  );
});

describe('what a Mac reports', () => {
  test('a Mac whose app bundles agent-browser reports a browser and no computer', async () => {
    const dir = testTempDir('mac-caps-');
    const capabilities = await reportedCapabilities({
      PATH: process.env.PATH,
      HOME: dir,
      CAIRN_AGENT_BROWSER: fakeAgentBrowser(dir, join(dir, 'log')),
    });
    expect(capabilities.browser).toBe(true);
    expect(capabilities.browserSecretFill).toBe(true);
    expect(capabilities.ownerChrome).toBe(true);
    expect(capabilities.computer).toBeUndefined();
    expect(capabilities.screenHandoff).toBeUndefined();
  });

  test('a Mac without the bundled binary reports no browser but can still drive the owner’s Chrome', async () => {
    const dir = testTempDir('mac-caps-');
    const capabilities = await reportedCapabilities({ PATH: process.env.PATH, HOME: dir });
    expect(capabilities.browser).toBeUndefined();
    expect(capabilities.ownerChrome).toBe(true);
  });
});

describe('a browser call on a Mac', () => {
  test('with Chrome installed it runs windowless on a Cairn profile and downloads nothing', async () => {
    const fetchImpl = vi.fn(async () => new Response('no', { status: 500 }));
    const w = world({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await dispatcherFor(w.browser).run();
    expect(result).toMatchObject({ ok: true });
    expect(result.text).toContain('Example Domain');
    const seen = readFileSync(w.log, 'utf8');
    expect(seen).toContain('--headed false');
    expect(seen).not.toContain('--init-script');
    expect(seen).toContain(`EXE ${join(w.options.root, 'browser-launcher')}`);
    expect(seen).toContain(`REAL ${w.chrome}`);
    expect(seen).toContain(`PROFILE ${join(w.options.root, 'profiles')}`);
    expect(seen).toMatch(/UA Mozilla\/5\.0 \(Macintosh.* Chrome\/158\.0\.0\.0 Safari/);
    expect(seen).not.toContain('HeadlessChrome');
    expect(seen).toContain('--use-mock-keychain');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('browser commands do not inherit an AI gateway key', async () => {
    const w = world();
    const browser = createMacBrowser({
      ...w.options,
      env: { ...w.options.env, AI_GATEWAY_API_KEY: 'secret-key' },
    });
    const result = await dispatcherFor(browser).run();
    expect(result.ok).toBe(true);
    const seen = readFileSync(w.log, 'utf8');
    expect(seen).toContain('AI ');
    expect(seen).not.toContain('secret-key');
  });

  test('without Chrome the first call downloads the headless shell, then works', async () => {
    const w = world({ chrome: async () => null });
    const browser = createMacBrowser({ ...w.options, fetchImpl: download(w.zip.path) });
    const result = await dispatcherFor(browser).run();
    expect(result).toMatchObject({ ok: true });
    expect(result.text).toContain('第一次使用浏览器');
    expect(readFileSync(w.log, 'utf8')).toContain(
      `REAL ${join(w.options.toolsRoot, 'chrome-headless-shell', 'versions', '158.0.1.2')}`,
    );
    const again = await dispatcherFor(browser).run();
    expect(again.text).not.toContain('第一次使用浏览器');
  });

  test('the archive is unpacked by the system unzip even when PATH offers another one', async () => {
    const w = world({ chrome: async () => null });
    const bin = join(w.dir, 'path');
    mkdirSync(bin, { recursive: true });
    executable(join(bin, 'unzip'), 'echo planted-unzip >&2\nexit 42');
    vi.stubEnv('PATH', bin);
    try {
      const browser = createMacBrowser({ ...w.options, fetchImpl: download(w.zip.path) });
      const result = await dispatcherFor(browser).run();
      expect(result.ok).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test('a download slower than the wait answers with its progress and carries on', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const w = world();
    const fetchImpl = vi.fn(download(w.zip.path, gate));
    const browser = createMacBrowser({
      ...w.options,
      chrome: async () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      waitMs: 300,
    });
    const first = await dispatcherFor(browser).run();
    expect(first.ok).toBe(false);
    expect(first.text).toMatch(/浏览器组件还在下载（已完成 \d+%）/);
    expect(first.text).not.toContain('\n');
    release();
    await vi.waitFor(async () => expect((await dispatcherFor(browser).run()).ok).toBe(true), {
      timeout: 10_000,
      interval: 200,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['a server error', async () => new Response('no', { status: 503 }), 'HTTP 503'],
    ['a tampered file', async () => new Response('not the archive'), '校验'],
    [
      'no network',
      async () => {
        throw new TypeError('fetch failed');
      },
      'fetch failed',
    ],
  ])('%s fails with one Chinese line and the next call tries again', async (_name, bad, cause) => {
    const w = world();
    let attempts = 0;
    const browser = createMacBrowser({
      ...w.options,
      chrome: async () => null,
      fetchImpl: (async (...args: Parameters<typeof fetch>) => {
        attempts += 1;
        return attempts === 1 ? bad() : download(w.zip.path)(...args);
      }) as typeof fetch,
    });
    const failed = await dispatcherFor(browser).run();
    expect(failed.ok).toBe(false);
    expect(failed.text).toContain('浏览器组件下载失败');
    expect(failed.text).toContain(cause);
    expect(failed.text).not.toContain('\n');
    expect(existsSync(w.log)).toBe(false);
    expect((await dispatcherFor(browser).run()).ok).toBe(true);
  });

  test('an archive exceeding the size limit is rejected before hashing', async () => {
    const w = world({
      chrome: async () => null,
      maxArchiveBytes: 1024,
      fetchImpl: (async () =>
        new Response(new Uint8Array(2048), {
          headers: { 'content-length': '2048' },
        })) as typeof fetch,
    });
    const failed = await dispatcherFor(w.browser).run();
    expect(failed.ok).toBe(false);
    expect(failed.text).toContain('超出限制');
  });

  test('killAll aborts an in-flight shell download', async () => {
    let seenSignal: AbortSignal | null | undefined;
    const w = world({
      chrome: async () => null,
      waitMs: 50,
      fetchImpl: ((_url: string | URL | Request, init?: RequestInit) => {
        seenSignal = init?.signal;
        return new Promise<Response>(() => {});
      }) as typeof fetch,
    });
    const first = await dispatcherFor(w.browser).run();
    expect(first.ok).toBe(false);
    expect(seenSignal?.aborted).toBe(false);
    await w.browser.killAll();
    expect(seenSignal?.aborted).toBe(true);
  });
});

describe('the browser’s loopback ports', () => {
  test('every session gets its own ports out of the ones a sandboxed shell cannot reach', async () => {
    const w = world();
    const { run } = dispatcherFor(w.browser);
    await run();
    await run({ browserScope: 'thread-2' });
    const seen = readFileSync(w.log, 'utf8');
    const debug = [...seen.matchAll(/debugging-port=(\d+)/g)].map((m) => Number(m[1]));
    const stream = [...seen.matchAll(/^STREAM (\d+)$/gm)].map((m) => Number(m[1]));
    expect(debug.length).toBeGreaterThan(1);
    expect(stream.length).toBe(debug.length);
    for (const port of [...debug, ...stream]) expect(MAC_SHELL_DENIED_PORTS).toContain(port);
    expect(new Set(debug).size).toBe(2);
    expect(new Set(stream).size).toBe(2);
  });
});

describe('the browser launcher', () => {
  test('every launch switches the live stream off and records the launch-to-shutdown gap', async () => {
    const messages: string[] = [];
    const w = world({ log: (message) => messages.push(message) });
    const { run } = dispatcherFor(w.browser);
    await run();
    expect(readFileSync(w.log, 'utf8')).toContain('--session p_thread-1 stream disable');
    expect(existsSync(join(w.options.root, '.agent-browser', 'p_thread-1.stream'))).toBe(false);
    expect(messages.some((line) => /stream.*off after \d+ ms/.test(line))).toBe(true);
  });

  test('a stream that fell back to a port outside the pool is still switched off on the next command', async () => {
    const w = world();
    const { run } = dispatcherFor(w.browser);
    await run();
    writeFileSync(w.log, '');
    mkdirSync(join(w.options.root, '.agent-browser'), { recursive: true });
    writeFileSync(join(w.options.root, '.agent-browser', 'p_thread-1.stream'), '53108');
    await run();
    expect(readFileSync(w.log, 'utf8')).toContain('--session p_thread-1 stream disable');
    expect(existsSync(join(w.options.root, '.agent-browser', 'p_thread-1.stream'))).toBe(false);
  });

  test.skipIf(process.platform !== 'darwin')(
    'it tells agent-browser where the browser it started is listening',
    async () => {
      const w = world();
      await dispatcherFor(w.browser).run();
      const profile = join(w.dir, 'launched-profile');
      mkdirSync(profile);
      const server = join(w.dir, 'server.cjs');
      writeFileSync(
        server,
        `const flags = process.argv.filter((a) => a.startsWith('--remote-debugging-port='));
const port = Number(flags.at(-1).split('=')[1]);
const body = '{\\n   "webSocketDebuggerUrl": "ws://127.0.0.1:' + port + '/devtools/browser/abc"\\n}';
require('node:http').createServer((_q, r) => r.end(body)).listen(port, '127.0.0.1');
setTimeout(() => process.exit(0), 8000);
`,
      );
      const real = executable(
        join(w.dir, 'real-browser'),
        `exec '${process.execPath}' '${server}' "$@"`,
      );
      const probe = createServer();
      await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
      const { port } = probe.address() as AddressInfo;
      await new Promise((resolve) => probe.close(resolve));
      const child = spawn(
        join(w.options.root, 'browser-launcher'),
        [
          '--remote-debugging-port=0',
          `--user-data-dir=${profile}`,
          `--remote-debugging-port=${port}`,
        ],
        { env: { PATH: process.env.PATH, CAIRN_BROWSER_EXECUTABLE: real }, stdio: 'ignore' },
      );
      try {
        await vi.waitFor(
          () =>
            expect(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8')).toBe(
              `${port}\n/devtools/browser/abc`,
            ),
          { timeout: 10_000, interval: 100 },
        );
      } finally {
        child.kill();
      }
    },
    20_000,
  );
});

describe('keeping the headless shell current', () => {
  async function installedOnce() {
    const w = world({ chrome: async () => null });
    const fetchImpl = vi.fn(download(w.zip.path));
    const options = { ...w.options, fetchImpl: fetchImpl as unknown as typeof fetch };
    expect((await dispatcherFor(createMacBrowser(options)).run()).ok).toBe(true);
    return { w, fetchImpl, options };
  }

  test('a Cairn update that pins another version downloads it', async () => {
    const { w, fetchImpl, options } = await installedOnce();
    const updated = createMacBrowser({
      ...options,
      shellReleases: {
        arm64: { version: '159.0.0.0', url: 'https://shell.test/new.zip', sha256: w.zip.sha256 },
      },
    });
    expect((await dispatcherFor(updated).run()).ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(readFileSync(w.log, 'utf8')).toContain(join('versions', '159.0.0.0'));
  });

  test('an installed shell that no longer starts is downloaded again', async () => {
    const { w, fetchImpl, options } = await installedOnce();
    writeFileSync(
      join(
        w.options.toolsRoot,
        'chrome-headless-shell',
        'versions',
        '158.0.1.2',
        'chrome-headless-shell-mac-arm64',
        'broken',
      ),
      '',
    );
    expect((await dispatcherFor(createMacBrowser(options)).run()).ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('stealth on a Mac', () => {
  test('a call that asks for the stealth browser runs in the standard one and says so', async () => {
    const w = world();
    const result = await dispatcherFor(w.browser).run({
      params: { url: 'https://example.com', stealth: true },
    });
    expect(result.ok).toBe(true);
    expect(result.text).toContain(NO_STEALTH_BROWSER_NOTE);
    expect(result.text).toContain('Example Domain');
  });
});

describe('Browser MCP on a Mac', () => {
  test('a call for the owner’s Chrome that cannot reach it says so instead of opening another browser', async () => {
    const w = world();
    const result = await dispatcherFor(w.browser).run({
      ownerChrome: 'browsermcp',
      params: { url: 'not a url' },
    });
    expect(result.text).toContain('browser_navigate only accepts');
    expect(existsSync(w.log)).toBe(false);
  });

  test('it needs no Cairn browser, and an unreachable extension is reported for the server to try elsewhere', async () => {
    vi.stubEnv('PATH', testTempDir('no-npx-'));
    const result = await dispatcherFor(undefined).run({ ownerChrome: 'browsermcp' });
    vi.unstubAllEnvs();
    expect(result.ok).toBe(false);
    expect(result.text.startsWith(OWNER_CHROME_UNAVAILABLE_PREFIX)).toBe(true);
    expect(result.text).toContain('npx');
  });
});
