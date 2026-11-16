import { spawn } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { TailscaleAccess } from '@cairn/shared';
import { z } from 'zod';

const SERVE_HTTPS_PORTS = [443, 8443, 10000] as const;
const QUICK_TIMEOUT_MS = 5_000;
const ENABLE_TIMEOUT_MS = 10 * 60_000;
const REAPPLY_TIMEOUT_MS = 30_000;
const VERIFY_TIMEOUT_MS = 5_000;
const VERIFY_GRACE_MS = 90_000;
const READY_CACHE_MS = 30_000;
const MAGIC_DNS_SETTINGS_URL = 'https://login.tailscale.com/admin/dns';
const ACCESS_DENIED_PATTERN = /access denied|--operator/i;
const CONSENT_URL_PATTERN = /https:\/\/login\.tailscale\.com\/[^\s"'<>]+/;

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type RunTailscale = (
  bin: string,
  args: readonly string[],
  options: { timeoutMs: number; onOutput?: (output: string) => void },
) => Promise<RunResult>;

export interface TailscaleServeDeps {
  environmentId: string;
  listenPort: number;
  recordPath: string;
  findCli?: () => string | null;
  run?: RunTailscale;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface TailscaleServe {
  status(): Promise<TailscaleAccess>;
  enable(): Promise<TailscaleAccess>;
  reapply(): Promise<void>;
  withdraw(): Promise<void>;
}

const statusSchema = z.object({
  BackendState: z.string(),
  Self: z.object({ DNSName: z.string().optional() }).nullable().optional(),
});

const serveConfigSchema = z
  .object({
    TCP: z.record(z.string(), z.unknown()).nullable().optional(),
    Web: z
      .record(
        z.string(),
        z.object({
          Handlers: z
            .record(z.string(), z.object({ Proxy: z.string().optional() }).passthrough())
            .nullable()
            .optional(),
        }),
      )
      .nullable()
      .optional(),
  })
  .passthrough()
  .nullable();

type ServeConfig = z.infer<typeof serveConfigSchema>;

const recordSchema = z.object({
  httpsPort: z.number().int(),
  target: z.string(),
});

type Online = { bin: string; dnsName: string; config: ServeConfig };
type Snapshot = Online | { early: TailscaleAccess };

export function tailscaleCliCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  const name = platform === 'win32' ? 'tailscale.exe' : 'tailscale';
  const fromPath = (env.PATH ?? '')
    .split(platform === 'win32' ? ';' : delimiter)
    .filter((dir) => dir !== '')
    .map((dir) => (platform === 'win32' ? `${dir}\\${name}` : join(dir, name)));
  if (platform === 'darwin') {
    return [
      ...fromPath,
      '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
      '/opt/homebrew/bin/tailscale',
      '/usr/local/bin/tailscale',
    ];
  }
  if (platform === 'win32') {
    return [...fromPath, `${env.ProgramFiles ?? 'C:\\Program Files'}\\Tailscale\\tailscale.exe`];
  }
  return [...fromPath, '/usr/bin/tailscale', '/usr/sbin/tailscale', '/usr/local/bin/tailscale'];
}

function findInstalledCli(): string | null {
  for (const candidate of tailscaleCliCandidates(process.platform, process.env)) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}

const runTailscale: RunTailscale = (bin, args, { timeoutMs, onOutput }) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const settle = (result: RunResult) => {
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      onOutput?.(stdout);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => settle({ code: null, stdout, stderr: error.message }));
    child.once('close', (code) => settle({ code, stdout, stderr }));
  });

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function access(state: TailscaleAccess['state'], extra: Partial<TailscaleAccess> = {}) {
  return { state, url: null, consentUrl: null, ...extra } satisfies TailscaleAccess;
}

function webEntry(config: ServeConfig, dnsName: string, port: number) {
  return config?.Web?.[`${dnsName}:${port}`];
}

function urlFor(dnsName: string, port: number): string {
  return port === 443 ? `https://${dnsName}` : `https://${dnsName}:${port}`;
}

export function createTailscaleServe(deps: TailscaleServeDeps): TailscaleServe {
  const run = deps.run ?? runTailscale;
  const findCli = deps.findCli ?? findInstalledCli;
  const fetchUrl = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? Date.now;
  const target = `http://127.0.0.1:${deps.listenPort}`;
  const targetPattern = new RegExp(`^http://(127\\.0\\.0\\.1|localhost):${deps.listenPort}/?$`);
  let configuredAt = now();
  let consentUrl: string | null = null;
  let needsOperator = false;
  let enabling: Promise<RunResult> | null = null;
  let verified: { url: string; at: number } | null = null;
  let inflight: Promise<TailscaleAccess> | null = null;

  const readRecord = (): z.infer<typeof recordSchema> | null => {
    try {
      const parsed = recordSchema.safeParse(JSON.parse(readFileSync(deps.recordPath, 'utf8')));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };

  const snapshot = async (): Promise<Snapshot> => {
    const bin = findCli();
    if (bin === null) return { early: access('not-installed') };
    const status = statusSchema.safeParse(
      parseJson((await run(bin, ['status', '--json'], { timeoutMs: QUICK_TIMEOUT_MS })).stdout),
    );
    if (!status.success || status.data.BackendState !== 'Running') {
      return { early: access('not-connected') };
    }
    const dnsName = status.data.Self?.DNSName?.replace(/\.$/, '') ?? '';
    if (dnsName === '') {
      return { early: access('needs-https', { consentUrl: MAGIC_DNS_SETTINGS_URL }) };
    }
    const served = await run(bin, ['serve', 'status', '--json'], { timeoutMs: QUICK_TIMEOUT_MS });
    const config = serveConfigSchema.safeParse(parseJson(served.stdout));
    if (served.code !== 0 || !config.success) return { early: access('not-connected') };
    return { bin, dnsName, config: config.data };
  };

  const servedPort = (online: Online): number | null =>
    SERVE_HTTPS_PORTS.find((port) => {
      const proxy = webEntry(online.config, online.dnsName, port)?.Handlers?.['/']?.Proxy;
      return proxy !== undefined && targetPattern.test(proxy);
    }) ?? null;

  const recordedMapping = (online: Online, port: number): boolean => {
    const record = readRecord();
    if (record === null || record.httpsPort !== port) return false;
    const web = webEntry(online.config, online.dnsName, port);
    const handlers = Object.keys(web?.Handlers ?? {});
    const proxy = web?.Handlers?.['/']?.Proxy;
    return (
      handlers.length === 1 &&
      proxy !== undefined &&
      (proxy === record.target || targetPattern.test(proxy))
    );
  };

  const freePort = (online: Online, preferred: number | null): number | null => {
    const usable = (port: number): boolean => {
      const web = webEntry(online.config, online.dnsName, port);
      if (web === undefined || Object.keys(web.Handlers ?? {}).length === 0) {
        return online.config?.TCP?.[String(port)] === undefined;
      }
      return recordedMapping(online, port);
    };
    const ordered = preferred === null ? SERVE_HTTPS_PORTS : [preferred, ...SERVE_HTTPS_PORTS];
    return ordered.find(usable) ?? null;
  };

  const verify = async (url: string): Promise<boolean> => {
    if (verified?.url === url && now() - verified.at < READY_CACHE_MS) return true;
    try {
      const res = await fetchUrl(`${url}/api/remote/descriptor`, {
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
      const body = (await res.json()) as { environmentId?: unknown };
      if (!res.ok || body.environmentId !== deps.environmentId) return false;
      verified = { url, at: now() };
      return true;
    } catch {
      return false;
    }
  };

  const describe = async (online: Online): Promise<TailscaleAccess> => {
    const port = servedPort(online);
    if (port === null) {
      verified = null;
      if (consentUrl !== null) return access('needs-https', { consentUrl });
      if (needsOperator) return access('needs-operator');
      return access(freePort(online, null) === null ? 'occupied' : 'off');
    }
    consentUrl = null;
    needsOperator = false;
    const url = urlFor(online.dnsName, port);
    if (await verify(url)) return access('ready', { url });
    return access(now() - configuredAt < VERIFY_GRACE_MS ? 'verifying' : 'unreachable', { url });
  };

  const status = (): Promise<TailscaleAccess> => {
    inflight ??= (async () => {
      const snap = await snapshot();
      return 'early' in snap ? snap.early : describe(snap);
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  const serve = (
    online: Online,
    port: number,
    timeoutMs: number,
    onOutput?: (out: string) => void,
  ) =>
    run(online.bin, ['serve', '--bg', `--https=${port}`, target], {
      timeoutMs,
      ...(onOutput !== undefined ? { onOutput } : {}),
    }).then((result) => {
      if (result.code === 0) {
        writeFileSync(deps.recordPath, `${JSON.stringify({ httpsPort: port, target })}\n`);
        configuredAt = now();
      } else if (ACCESS_DENIED_PATTERN.test(`${result.stderr}\n${result.stdout}`)) {
        needsOperator = true;
      }
      return result;
    });

  const enable = async (): Promise<TailscaleAccess> => {
    const snap = await snapshot();
    if ('early' in snap) return snap.early;
    if (servedPort(snap) !== null || enabling !== null) return describe(snap);
    const port = freePort(snap, null);
    if (port === null) return access('occupied');
    needsOperator = false;
    consentUrl = null;
    let sawConsent: (url: string) => void = () => {};
    const consent = new Promise<string>((resolve) => {
      sawConsent = resolve;
    });
    const started = serve(snap, port, ENABLE_TIMEOUT_MS, (output) => {
      const found = CONSENT_URL_PATTERN.exec(output)?.[0];
      if (found !== undefined) sawConsent(found);
    });
    enabling = started;
    void started.finally(() => {
      enabling = null;
    });
    const first = await Promise.race([started, consent]);
    if (typeof first === 'string') {
      consentUrl = first;
      return access('needs-https', { consentUrl: first });
    }
    if (first.code !== 0 && !needsOperator) {
      throw new Error(first.stderr.trim() || first.stdout.trim() || 'tailscale serve failed');
    }
    return status();
  };

  const reapply = async (): Promise<void> => {
    const record = readRecord();
    if (record === null) return;
    const snap = await snapshot();
    if ('early' in snap || servedPort(snap) !== null) return;
    const port = freePort(snap, record.httpsPort);
    if (port === null) return;
    await serve(snap, port, REAPPLY_TIMEOUT_MS);
  };

  const withdraw = async (): Promise<void> => {
    const record = readRecord();
    if (record === null) return;
    const snap = await snapshot();
    if ('early' in snap || !recordedMapping(snap, record.httpsPort)) return;
    await run(snap.bin, ['serve', `--https=${record.httpsPort}`, 'off'], {
      timeoutMs: QUICK_TIMEOUT_MS,
    });
    verified = null;
  };

  return { status, enable, reapply, withdraw };
}
