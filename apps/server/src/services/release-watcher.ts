import {
  desktopReleaseManifestSchema,
  isServerVersionNewer,
  resolveUpdateFeedBase,
} from '@cairn/shared';
import type { Logger } from 'pino';
import type { Db } from '../db/client.js';
import {
  type HostUpdateContext,
  readHostRollbackNotice,
  readHostUpdateStatus,
  readServerVersionInfo,
  requestHostUpdate,
} from './server-version.js';

const DEFAULT_POLL_INTERVAL_MS = 15 * 60_000;
const DEFAULT_INITIAL_DELAY_MS = 30_000;
const MANIFEST_TIMEOUT_MS = 15_000;

export interface ReleaseWatcher {
  checkNow(): Promise<string | null>;
  latestRelease(): string | null;
  stop(): void;
}

export function createReleaseWatcher(opts: {
  db?: Db;
  homeDir: string;
  deployRecordPath?: string;
  hostUpdate?: HostUpdateContext;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  pollIntervalMs?: number;
  initialDelayMs?: number;
  autoStart?: boolean;
}): ReleaseWatcher {
  const env = opts.env ?? process.env;
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const initialDelayMs = opts.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;

  let latest: string | null = null;
  let inFlight: Promise<string | null> | null = null;
  let stopped = false;
  let bootTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function runCheck(): Promise<string | null> {
    if (stopped) return latest;
    const { desktopManifestUrl } = resolveUpdateFeedBase(env);
    try {
      const response = await fetchFn(desktopManifestUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
      });
      if (!response.ok) return latest;
      const raw = (await response.json()) as unknown;
      const parsed = desktopReleaseManifestSchema.safeParse(raw);
      if (!parsed.success) return latest;
      latest = parsed.data.version;
    } catch (error) {
      opts.logger?.debug({ err: error }, 'release watcher manifest check failed');
      return latest;
    }

    if (stopped || latest === null) return latest;
    const current = readServerVersionInfo({
      env,
      deployRecordPath: opts.deployRecordPath,
    }).version;
    if (!isServerVersionNewer(latest, current)) return latest;

    const now = opts.hostUpdate?.now?.() ?? Date.now();
    const status = readHostUpdateStatus(opts.homeDir, env, now);
    if (!status.supported) return latest;

    const rollback = readHostRollbackNotice(opts.homeDir);
    if (rollback !== null && rollback.failedVersion === latest) return latest;

    try {
      await requestHostUpdate({
        homeDir: opts.homeDir,
        targetVersion: latest,
        env,
        hostUpdate: opts.hostUpdate,
      });
    } catch (error) {
      opts.logger?.warn({ err: error, targetVersion: latest }, 'auto-trigger host update failed');
    }
    return latest;
  }

  function checkNow(): Promise<string | null> {
    if (inFlight !== null) return inFlight;
    inFlight = runCheck().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  if (opts.autoStart === true) {
    bootTimer = setTimeout(() => {
      bootTimer = null;
      void checkNow();
    }, initialDelayMs);
    bootTimer.unref?.();
    pollTimer = setInterval(() => {
      void checkNow();
    }, pollIntervalMs);
    pollTimer.unref?.();
  }

  return {
    checkNow,
    latestRelease: () => latest,
    stop() {
      stopped = true;
      if (bootTimer !== null) {
        clearTimeout(bootTimer);
        bootTimer = null;
      }
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },
  };
}
