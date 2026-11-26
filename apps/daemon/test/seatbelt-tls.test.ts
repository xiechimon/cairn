import { type AddressInfo, createServer } from 'node:net';
import { describe, expect, test } from 'vitest';
import { hostShellCommand } from '../src/backend/confine-seatbelt.js';
import {
  type HostShellConfinement,
  runnerHostShellConfinement,
} from '../src/backend/host-shell-confinement.js';
import { MAC_SHELL_DENIED_PORTS } from '../src/backend/loopback-ports.js';
import { HostComputerProvider } from '../src/computer/host.js';
import { defaultStagingRoot } from '../src/computer/staging.js';
import { testTempDir } from './test-temp-dir.js';

const TRUSTD_SERVICES = ['com.apple.trustd', 'com.apple.trustd.agent'];
const TRUSTD_DENY = '(deny mach-lookup (global-name-prefix "com.apple.trustd"))';

const HTTPS_URLS = ['https://github.com/', 'https://www.cloudflare.com/'];
const GIT_URLS = ['https://github.com/git/git.git', 'https://gitlab.com/git-scm/git.git'];
const DNS_NAMES = HTTPS_URLS.map((url) => new URL(url).hostname);

function machDenialsCovering(profile: string, service: string): string[] {
  return profile
    .split('\n')
    .filter((line) => line.startsWith('(deny mach-lookup'))
    .filter((line) => {
      const filters = [...line.matchAll(/\((global-name(?:-prefix)?) "([^"]*)"\)/g)];
      const unread = line.replace(/\(global-name(?:-prefix)? "[^"]*"\)/g, '').replace(/\s/g, '');
      if (filters.length === 0 || unread !== '(denymach-lookup)') return true;
      return filters.some(([, kind, name = '']) =>
        kind === 'global-name' ? service === name : service.startsWith(name),
      );
    });
}

describe('host shell seatbelt profile and trustd (#5412)', () => {
  test('no mach-lookup rule can cover trustd, checked on every platform', () => {
    const launch = hostShellCommand({ deniedDirectories: [], deniedFiles: [] }, 'true', []);
    const profile = launch.args[1] as string;
    expect(profile).toContain('(allow default)');
    for (const service of TRUSTD_SERVICES) {
      expect(machDenialsCovering(profile, service), service).toEqual([]);
      expect(machDenialsCovering(`${profile}${TRUSTD_DENY}\n`, service), service).toEqual([
        TRUSTD_DENY,
      ]);
    }
  });
});

describe('host shell seatbelt profile and Cairn’s browser ports', () => {
  test('every browser debugging, streaming and extension port is closed to the sandboxed shell', () => {
    const profile = hostShellCommand({ deniedDirectories: [], deniedFiles: [] }, 'true', [])
      .args[1] as string;
    expect(MAC_SHELL_DENIED_PORTS).toContain(9009);
    for (const port of MAC_SHELL_DENIED_PORTS)
      for (const rule of [
        'network-outbound (remote',
        'network-inbound (local',
        'network-bind (local',
      ])
        expect(profile).toContain(`(deny ${rule} tcp "localhost:${port}"))`);
  });

  test.skipIf(process.platform !== 'darwin')(
    'a sandboxed shell cannot connect to a listening browser port but can reach other local ports',
    async () => {
      const listen = async (port: number) => {
        const server = createServer((socket) => {
          socket.on('error', () => {});
          socket.end('hi');
        });
        const bound = await new Promise<boolean>((resolve) => {
          server.once('error', () => resolve(false));
          server.listen(port, '127.0.0.1', () => resolve(true));
        });
        return bound ? server : null;
      };
      let guarded: Awaited<ReturnType<typeof listen>> = null;
      for (const port of MAC_SHELL_DENIED_PORTS.slice(1).reverse()) {
        guarded = await listen(port);
        if (guarded !== null) break;
      }
      const open = await listen(0);
      if (guarded === null || open === null) throw new Error('no port to listen on');
      const host = new HostComputerProvider({ confinement: productionConfinement() });
      const connect = async (port: number) => {
        const events = await host.execute({
          argv: ['/usr/bin/nc', '-z', '-w', '2', '127.0.0.1', String(port)],
          timeoutMs: 8_000,
          signal: new AbortController().signal,
        });
        let code = -1;
        for await (const event of events) if (event.kind === 'exit') code = event.code;
        return code;
      };
      try {
        expect(await connect((open.address() as AddressInfo).port)).toBe(0);
        expect(await connect((guarded.address() as AddressInfo).port)).not.toBe(0);
      } finally {
        guarded.close();
        open.close();
      }
    },
    25_000,
  );
});

interface Client {
  argv: (target: string) => string[];
  targets: string[];
  connected: (run: { code: number; stdout: string }) => boolean;
}

const exitedCleanly = (run: { code: number }) => run.code === 0;

const SYSTEM_TRUST_CLIENT: Client = {
  argv: (url) => ['/usr/bin/nscurl', '--max-time', '6', '-D', '-', '-o', '/dev/null', url],
  targets: HTTPS_URLS,
  connected: (run) => /^HTTP\/\S+ \d{3}/m.test(run.stdout),
};

const CLIENTS: Record<string, Client> = {
  'curl over https': {
    argv: (url) => ['/usr/bin/curl', '-sS', '--max-time', '6', '-o', '/dev/null', url],
    targets: HTTPS_URLS,
    connected: exitedCleanly,
  },
  'git ls-remote over https': {
    argv: (url) => ['/usr/bin/git', 'ls-remote', url, 'HEAD'],
    targets: GIT_URLS,
    connected: (run) => run.code === 0 && run.stdout.includes('HEAD'),
  },
  'node fetch over https': {
    argv: (url) => [
      process.execPath,
      '-e',
      'fetch(process.argv[1], { signal: AbortSignal.timeout(6000) }).then(() => process.exit(0), (error) => { console.error(error.cause ?? error); process.exit(1) })',
      url,
    ],
    targets: HTTPS_URLS,
    connected: exitedCleanly,
  },
  'a system-trust TLS client (nscurl, through trustd)': SYSTEM_TRUST_CLIENT,
  'a DNS lookup': {
    argv: (name) => [
      process.execPath,
      '-e',
      "require('node:dns').lookup(process.argv[1], (error) => { if (error) console.error(error); process.exit(error ? 1 : 0) })",
      name,
    ],
    targets: DNS_NAMES,
    connected: exitedCleanly,
  },
};

function productionConfinement(): HostShellConfinement {
  const root = testTempDir('seatbelt-tls-');
  return runnerHostShellConfinement({
    cairnHome: `${root}/cairn-home`,
    serverUrl: 'http://127.0.0.1:8787',
    stagingRoot: defaultStagingRoot(),
    capabilityEnv: { CAIRN_AGENT_DESKTOP: `${root}/agent-desktop/agent-desktop` },
  });
}

async function reach(confinement: HostShellConfinement, client: Client) {
  const host = new HostComputerProvider({ confinement });
  const failures: string[] = [];
  for (const target of client.targets) {
    const run = { code: -1, stdout: '', stderr: '' };
    const events = await host.execute({
      argv: client.argv(target),
      timeoutMs: 8_000,
      signal: new AbortController().signal,
    });
    for await (const event of events) {
      if (event.kind === 'exit') run.code = event.code;
      else run[event.kind] += event.text;
    }
    if (client.connected(run)) return { connected: true, failures };
    failures.push(`${target} exit ${run.code}: ${run.stderr.slice(0, 600)}`);
  }
  return { connected: false, failures };
}

describe.skipIf(process.platform !== 'darwin')(
  'host shell seatbelt outbound TLS (macOS only: needs /usr/bin/sandbox-exec)',
  () => {
    test.each(Object.entries(CLIENTS))(
      '%s works under the production profile',
      async (_name, client) => {
        const result = await reach(productionConfinement(), client);
        expect(result.connected, result.failures.join('\n')).toBe(true);
      },
      25_000,
    );

    test('negative control: re-adding the trustd deny breaks system-trust TLS', async () => {
      const production = productionConfinement();
      const result = await reach(
        {
          denied: production.denied,
          wrap: (command, args) => {
            const launch = production.wrap(command, args);
            const [flag = '', profile = '', ...rest] = launch.args;
            return { command: launch.command, args: [flag, `${profile}${TRUSTD_DENY}\n`, ...rest] };
          },
        },
        SYSTEM_TRUST_CLIENT,
      );
      expect(result.connected).toBe(false);
      expect(result.failures.join('\n')).toContain('TLS error');
    }, 25_000);
  },
);
