import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import type {
  ClaudeSubscriptionQuotaWindow,
  MachineAntigravityUsageProbeClaim,
  MachineAntigravityUsageProbeResult,
} from '@cairn/shared';
import { createCredentialProfile } from '@cairn/shared/credential-profile';
import {
  antigravityFileStorageEnv,
  prepareAntigravityHome,
  writeAntigravityOAuthCredential,
} from '../agent-config.js';
import { type AntigravityInstall, antigravityProbeEnv } from './antigravity-managed.js';

const USAGE_PROBE_TIMEOUT_MS = 25_000;
const MAX_STDOUT_BYTES = 1_048_576;
const MAX_STDERR_BYTES = 16_384;
const AUTH_ERROR_PATTERN =
  /unauthorized|authentication|unauthenticated|invalid(?:(?!invalid).)*?(?:token|credential|grant)|expired|not logged in|login required|forbidden|\b401\b|\b403\b/i;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function parseUsageJson(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  if (trimmed === '') return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim() ?? '';
    if (!line.startsWith('{')) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {}
  }
  return null;
}

export function parseAntigravityUsageOutput(
  stdout: string,
  observedAt: number,
): ClaudeSubscriptionQuotaWindow[] {
  const parsed = parseUsageJson(stdout);
  if (parsed === null) return [];
  const command = parsed.command;
  if (typeof command !== 'object' || command === null || Array.isArray(command)) return [];
  const cmd = command as Record<string, unknown>;
  if (cmd.name !== 'usage') return [];
  const data = cmd.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return [];
  const groups = (data as Record<string, unknown>).groups;
  if (!Array.isArray(groups)) return [];

  const windows = new Map<string, ClaudeSubscriptionQuotaWindow>();
  for (const group of groups) {
    if (typeof group !== 'object' || group === null || Array.isArray(group)) continue;
    const buckets = (group as Record<string, unknown>).buckets;
    if (!Array.isArray(buckets)) continue;
    for (const bucket of buckets) {
      if (typeof bucket !== 'object' || bucket === null || Array.isArray(bucket)) continue;
      const rec = bucket as Record<string, unknown>;
      const id = typeof rec.id === 'string' ? rec.id.trim() : '';
      const remaining = rec.remaining_fraction;
      if (
        id === '' ||
        id.length > 64 ||
        typeof remaining !== 'number' ||
        !Number.isFinite(remaining)
      ) {
        continue;
      }
      const ts = typeof rec.reset_time === 'string' ? Date.parse(rec.reset_time) : Number.NaN;
      const resetsAt = Number.isFinite(ts) && ts > 0 ? Math.trunc(ts) : null;
      if (!windows.has(id)) {
        windows.set(id, {
          name: id,
          utilization: clamp01(1 - remaining),
          resetsAt,
          observedAt,
        });
      }
    }
  }
  return [...windows.values()];
}

function hasUsageCommandPayload(stdout: string): boolean {
  const parsed = parseUsageJson(stdout);
  if (parsed === null || parsed.status !== 'SUCCESS') return false;
  const cmd = parsed.command;
  if (typeof cmd !== 'object' || cmd === null || Array.isArray(cmd)) return false;
  const record = cmd as Record<string, unknown>;
  const data = record.data;
  return (
    record.name === 'usage' &&
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data) &&
    Array.isArray((data as Record<string, unknown>).groups)
  );
}

function killChildProcess(child: ReturnType<typeof spawn>): void {
  if (process.platform !== 'win32' && typeof child.pid === 'number') {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {}
  }
  child.kill('SIGKILL');
}

function runUsageCommand(
  binPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<MachineAntigravityUsageProbeResult> {
  if (signal.aborted) {
    return Promise.resolve({ status: 'failed', failure: 'timeout' });
  }
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binPath, ['--output-format', 'json', '-p', '/usage'], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(process.platform !== 'win32' ? { detached: true } : {}),
        windowsHide: true,
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      resolve({ status: 'failed', failure: code === 'ENOENT' ? 'not-found' : 'upstream' });
      return;
    }

    let settled = false;
    let stdout = '';
    let stderr = '';
    let overflowed = false;

    const finish = (result: MachineAntigravityUsageProbeResult) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const onAbort = () => {
      killChildProcess(child);
      finish({ status: 'failed', failure: 'timeout' });
    };
    signal.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      if (overflowed) return;
      stdout += chunk.toString('utf8');
      if (Buffer.byteLength(stdout, 'utf8') > MAX_STDOUT_BYTES) {
        overflowed = true;
        killChildProcess(child);
        finish({ status: 'failed', failure: 'upstream' });
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-MAX_STDERR_BYTES);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({
        status: 'failed',
        failure: error.code === 'ENOENT' ? 'not-found' : 'upstream',
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      if (signal.aborted) {
        finish({ status: 'failed', failure: 'timeout' });
        return;
      }
      if (code === 0 && hasUsageCommandPayload(stdout)) {
        const windows = parseAntigravityUsageOutput(stdout, Date.now());
        finish({ status: 'ok', windows });
        return;
      }
      if (AUTH_ERROR_PATTERN.test(stderr) || AUTH_ERROR_PATTERN.test(stdout)) {
        finish({ status: 'failed', failure: 'auth' });
        return;
      }
      finish({ status: 'failed', failure: 'upstream' });
    });
  });
}

export async function probeAntigravityUsage(
  install: Pick<AntigravityInstall, 'binPath'>,
  auth: MachineAntigravityUsageProbeClaim,
  cairnHome: string,
  realHome: string = homedir(),
  signal?: AbortSignal,
): Promise<MachineAntigravityUsageProbeResult> {
  const timeout = AbortSignal.timeout(USAGE_PROBE_TIMEOUT_MS);
  const deadline = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  if (deadline.aborted) return { status: 'failed', failure: 'timeout' };

  if (auth.mode === 'oauth') {
    const { credential } = auth;
    if (
      credential.refreshToken === undefined &&
      (credential.expiresAt === undefined || credential.expiresAt <= Date.now())
    ) {
      return { status: 'failed', failure: 'auth' };
    }
    let profile: ReturnType<typeof createCredentialProfile> | undefined;
    try {
      profile = createCredentialProfile(cairnHome);
      writeAntigravityOAuthCredential(profile.home, credential);
      const env: NodeJS.ProcessEnv = {
        ...antigravityProbeEnv(process.env),
        ...profile.env,
        ...antigravityFileStorageEnv(profile.home),
        TMPDIR: profile.home,
        TMP: profile.home,
        TEMP: profile.home,
      };
      return await runUsageCommand(install.binPath, profile.home, env, deadline);
    } catch {
      return deadline.aborted
        ? { status: 'failed', failure: 'timeout' }
        : { status: 'failed', failure: 'upstream' };
    } finally {
      profile?.cleanup();
    }
  }

  try {
    const home = prepareAntigravityHome({ cairnHome, realHome, apiKey: false });
    const env: NodeJS.ProcessEnv = {
      ...antigravityProbeEnv(process.env),
      HOME: home,
      ...antigravityFileStorageEnv(home),
      TMPDIR: home,
      TMP: home,
      TEMP: home,
    };
    return await runUsageCommand(install.binPath, home, env, deadline);
  } catch {
    return deadline.aborted
      ? { status: 'failed', failure: 'timeout' }
      : { status: 'failed', failure: 'upstream' };
  }
}
