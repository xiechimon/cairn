import {
  type HostRollbackNotice,
  isRemoteServerOlder,
  isServerVersionNewer,
  type RemoteVersionState,
  type ServerUpdateReason,
  type ServerVersionV2Response,
  serverUpdateResponseSchema,
  serverVersionV2ResponseSchema,
} from '@cairn/shared';

export const REMOTE_POLL_MS = 2_500;
export const REMOTE_RESTART_TIMEOUT_MS = 120_000;
const FETCH_TIMEOUT_MS = 5_000;

export interface RemoteVersionControllerOptions {
  origin: string;
  appVersion: string;
  pollMs?: number;
  restartTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onState: (state: RemoteVersionState) => void;
  onAbout: (info: { version: string | null; commit: string | null }) => void;
  onReloadReady: () => void;
  onNewerRelease?: (version: string) => void;
}

export interface RemoteVersionController {
  state(): RemoteVersionState;
  check(): Promise<void>;
  retry(): Promise<void>;
  onAuthChanged(): void;
  stop(): void;
}

const ACTIVE_UPDATER_STATES = new Set([
  'checking',
  'downloading',
  'waiting-idle',
  'installing',
  'restarting',
]);

function versionAdvanced(next: string | null, previous: string | null): boolean {
  return isServerVersionNewer(next, previous);
}

export function createRemoteVersionController(
  opts: RemoteVersionControllerOptions,
): RemoteVersionController {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const pollMs = opts.pollMs ?? REMOTE_POLL_MS;
  const restartTimeoutMs = opts.restartTimeoutMs ?? REMOTE_RESTART_TIMEOUT_MS;
  const now = opts.now ?? Date.now;

  let current: RemoteVersionState = {
    phase: 'probing',
    serverVersion: null,
    serverCommit: null,
    appVersion: opts.appVersion,
    targetVersion: null,
    updaterState: null,
    percent: null,
    reason: null,
    rollbackNotice: null,
  };
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let baselineVersion: string | null = null;
  let attemptedKey: string | null = null;
  let restartSince: number | null = null;
  let serverSupportsV2 = false;

  const clearPoll = (): void => {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  const set = (next: RemoteVersionState): void => {
    current = next;
    if (!stopped) opts.onState(next);
  };

  const schedulePoll = (): void => {
    clearPoll();
    if (stopped) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void runProbe(false);
    }, pollMs);
    pollTimer.unref?.();
  };

  const reportAbout = (version: string | null, commit: string | null): void => {
    if (!stopped) opts.onAbout({ version, commit });
  };

  const newestVersionForLaptop = (body: ServerVersionV2Response): string | null => {
    let best: string | null = isServerVersionNewer(body.version, opts.appVersion)
      ? body.version
      : null;
    const latest = body.latestRelease ?? null;
    if (latest !== null && isServerVersionNewer(latest, opts.appVersion)) {
      if (best === null || isServerVersionNewer(latest, best)) best = latest;
    }
    return best;
  };

  const applyVersionResponse = async (
    body: ServerVersionV2Response,
    forceTrigger: boolean,
  ): Promise<void> => {
    const rollbackNotice: HostRollbackNotice | null = body.rollbackNotice ?? null;
    reportAbout(body.version, body.commit);
    const newerRelease = newestVersionForLaptop(body);
    if (newerRelease !== null && !stopped) {
      opts.onNewerRelease?.(newerRelease);
    }
    if (
      baselineVersion !== null &&
      (current.phase === 'updating' || current.phase === 'restarting') &&
      versionAdvanced(body.version, baselineVersion)
    ) {
      clearPoll();
      restartSince = null;
      baselineVersion = null;
      set({
        phase: 'reloading',
        serverVersion: body.version,
        serverCommit: body.commit,
        appVersion: opts.appVersion,
        targetVersion: null,
        updaterState: 'idle',
        percent: null,
        reason: null,
        rollbackNotice,
      });
      if (!stopped) opts.onReloadReady();
      set({
        phase: 'current',
        serverVersion: body.version,
        serverCommit: body.commit,
        appVersion: opts.appVersion,
        targetVersion: null,
        updaterState: body.updater.state,
        percent: null,
        reason: null,
        rollbackNotice,
      });
      return;
    }

    const hostIsOlder = isRemoteServerOlder(body.version, opts.appVersion);
    if (!hostIsOlder && rollbackNotice === null) {
      clearPoll();
      restartSince = null;
      baselineVersion = null;
      set({
        phase: 'current',
        serverVersion: body.version,
        serverCommit: body.commit,
        appVersion: opts.appVersion,
        targetVersion: null,
        updaterState: body.updater.state,
        percent: null,
        reason: null,
        rollbackNotice: null,
      });
      return;
    }

    const triggerTarget = hostIsOlder
      ? opts.appVersion
      : (rollbackNotice?.failedVersion ?? opts.appVersion);
    const olderVersion = body.version;
    const attemptKey = `${triggerTarget}<-${olderVersion ?? 'unknown'}`;
    if (!body.updater.supported) {
      clearPoll();
      restartSince = null;
      set({
        phase: 'unsupported',
        serverVersion: olderVersion,
        serverCommit: body.commit,
        appVersion: opts.appVersion,
        targetVersion: triggerTarget,
        updaterState: 'unsupported',
        percent: null,
        reason: body.updater.reason ?? 'no-updater',
        rollbackNotice,
      });
      return;
    }

    if (ACTIVE_UPDATER_STATES.has(body.updater.state)) {
      baselineVersion ??= olderVersion;
      if (body.updater.state === 'restarting') {
        restartSince ??= now();
      }
      set({
        phase: body.updater.state === 'restarting' ? 'restarting' : 'updating',
        serverVersion: olderVersion,
        serverCommit: body.commit,
        appVersion: opts.appVersion,
        targetVersion: body.updater.targetVersion ?? triggerTarget,
        updaterState: body.updater.state,
        percent: body.updater.percent,
        reason: null,
        rollbackNotice,
      });
      schedulePoll();
      return;
    }

    if (!forceTrigger && attemptedKey === attemptKey) {
      clearPoll();
      restartSince = null;
      const reason: ServerUpdateReason =
        body.updater.state === 'up-to-date' ? 'no-release' : (body.updater.reason ?? 'failed');
      set({
        phase: 'failed',
        serverVersion: olderVersion,
        serverCommit: body.commit,
        appVersion: opts.appVersion,
        targetVersion: triggerTarget,
        updaterState: body.updater.state,
        percent: null,
        reason,
        rollbackNotice,
      });
      return;
    }

    if (
      !forceTrigger &&
      (!hostIsOlder ||
        body.updater.state === 'failed' ||
        body.updater.reason === 'blocked' ||
        (rollbackNotice !== null && rollbackNotice.failedVersion === triggerTarget) ||
        (body.updater.state === 'up-to-date' && body.updater.reason === 'no-release'))
    ) {
      attemptedKey = attemptKey;
      clearPoll();
      restartSince = null;
      set({
        phase: 'failed',
        serverVersion: olderVersion,
        serverCommit: body.commit,
        appVersion: opts.appVersion,
        targetVersion: triggerTarget,
        updaterState: body.updater.state,
        percent: null,
        reason:
          body.updater.state === 'up-to-date' ? 'no-release' : (body.updater.reason ?? 'failed'),
        rollbackNotice,
      });
      return;
    }

    attemptedKey = attemptKey;
    baselineVersion = olderVersion;
    restartSince = null;
    try {
      const response = await fetchImpl(`${opts.origin}/api/server/update`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: opts.origin,
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify({
          targetVersion: triggerTarget,
          ...(forceTrigger && serverSupportsV2 ? { force: true } : {}),
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (stopped) return;
      if (response.status === 404) {
        clearPoll();
        set({
          phase: 'old-server',
          serverVersion: olderVersion,
          serverCommit: body.commit,
          appVersion: opts.appVersion,
          targetVersion: triggerTarget,
          updaterState: 'unsupported',
          percent: null,
          reason: 'no-updater',
          rollbackNotice,
        });
        return;
      }
      if (response.status === 401 || response.status === 403) {
        clearPoll();
        set({
          phase: 'failed',
          serverVersion: olderVersion,
          serverCommit: body.commit,
          appVersion: opts.appVersion,
          targetVersion: triggerTarget,
          updaterState: 'failed',
          percent: null,
          reason: 'failed',
          rollbackNotice,
        });
        return;
      }
      if (!response.ok) {
        clearPoll();
        set({
          phase: 'failed',
          serverVersion: olderVersion,
          serverCommit: body.commit,
          appVersion: opts.appVersion,
          targetVersion: triggerTarget,
          updaterState: 'failed',
          percent: null,
          reason: 'failed',
          rollbackNotice,
        });
        return;
      }
      const parsed = serverUpdateResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        clearPoll();
        set({
          phase: 'failed',
          serverVersion: olderVersion,
          serverCommit: body.commit,
          appVersion: opts.appVersion,
          targetVersion: triggerTarget,
          updaterState: 'failed',
          percent: null,
          reason: 'failed',
          rollbackNotice,
        });
        return;
      }
      const result = parsed.data;
      if (!result.accepted || !result.updater.supported) {
        clearPoll();
        set({
          phase: 'unsupported',
          serverVersion: olderVersion,
          serverCommit: body.commit,
          appVersion: opts.appVersion,
          targetVersion: triggerTarget,
          updaterState: 'unsupported',
          percent: null,
          reason: result.updater.reason ?? 'no-updater',
          rollbackNotice,
        });
        return;
      }
      if (result.updater.state === 'failed' || result.updater.state === 'up-to-date') {
        clearPoll();
        set({
          phase: 'failed',
          serverVersion: olderVersion,
          serverCommit: body.commit,
          appVersion: opts.appVersion,
          targetVersion: triggerTarget,
          updaterState: result.updater.state,
          percent: null,
          reason:
            result.updater.state === 'up-to-date'
              ? 'no-release'
              : (result.updater.reason ?? 'failed'),
          rollbackNotice,
        });
        return;
      }
      set({
        phase: result.updater.state === 'restarting' ? 'restarting' : 'updating',
        serverVersion: olderVersion,
        serverCommit: body.commit,
        appVersion: opts.appVersion,
        targetVersion: result.updater.targetVersion ?? triggerTarget,
        updaterState: result.updater.state,
        percent: result.updater.percent,
        reason: null,
      });
      schedulePoll();
    } catch {
      if (stopped) return;
      clearPoll();
      set({
        phase: 'failed',
        serverVersion: olderVersion,
        serverCommit: body.commit,
        appVersion: opts.appVersion,
        targetVersion: triggerTarget,
        updaterState: 'failed',
        percent: null,
        reason: 'failed',
        rollbackNotice,
      });
    }
  };

  const handleTransientDuringUpdate = (): void => {
    restartSince ??= now();
    if (now() - restartSince >= restartTimeoutMs) {
      clearPoll();
      restartSince = null;
      set({
        ...current,
        phase: 'failed',
        updaterState: 'failed',
        percent: null,
        reason: 'failed',
      });
      return;
    }
    set({
      ...current,
      phase: 'restarting',
      updaterState: 'restarting',
      percent: null,
      reason: null,
    });
    schedulePoll();
  };

  const runProbe = async (forceTrigger: boolean): Promise<void> => {
    if (stopped) return;
    if (inFlight !== null) {
      await inFlight;
      if (!forceTrigger || stopped) return;
    }
    const task = (async () => {
      try {
        const response = await fetchImpl(`${opts.origin}/api/server/version?schema=2`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (stopped) return;
        if (response.status === 401) {
          clearPoll();
          set({
            ...current,
            phase: 'awaiting-auth',
          });
          return;
        }
        if (response.status === 404) {
          clearPoll();
          reportAbout(null, null);
          set({
            phase: 'old-server',
            serverVersion: null,
            serverCommit: null,
            appVersion: opts.appVersion,
            targetVersion: opts.appVersion,
            updaterState: 'unsupported',
            percent: null,
            reason: 'no-updater',
            rollbackNotice: null,
          });
          return;
        }
        if (
          (response.status === 502 || response.status === 503 || response.status === 504) &&
          (current.phase === 'updating' || current.phase === 'restarting')
        ) {
          handleTransientDuringUpdate();
          return;
        }
        if (!response.ok) return;
        const rawJson = (await response.json()) as unknown;
        serverSupportsV2 =
          rawJson !== null &&
          typeof rawJson === 'object' &&
          ('latestRelease' in rawJson || 'rollbackNotice' in rawJson);
        const parsed = serverVersionV2ResponseSchema.safeParse(rawJson);
        if (!parsed.success) {
          clearPoll();
          reportAbout(null, null);
          set({
            phase: 'old-server',
            serverVersion: null,
            serverCommit: null,
            appVersion: opts.appVersion,
            targetVersion: opts.appVersion,
            updaterState: 'unsupported',
            percent: null,
            reason: 'no-updater',
            rollbackNotice: null,
          });
          return;
        }
        await applyVersionResponse(parsed.data, forceTrigger);
      } catch {
        if (stopped) return;
        if (current.phase === 'updating' || current.phase === 'restarting') {
          handleTransientDuringUpdate();
        }
      }
    })();
    inFlight = task;
    try {
      await task;
    } finally {
      if (inFlight === task) inFlight = null;
    }
  };

  return {
    state: () => current,
    check: () => runProbe(false),
    retry: () => {
      attemptedKey = null;
      restartSince = null;
      return runProbe(true);
    },
    onAuthChanged: () => {
      if (stopped) return;
      if (current.phase === 'awaiting-auth' || current.phase === 'probing') {
        void runProbe(false);
      }
    },
    stop: () => {
      stopped = true;
      clearPoll();
    },
  };
}

export interface UpdateChannelLocalUpdater<TState, TInstallResult> {
  state: () => TState;
  check: () => Promise<void>;
  install: () => Promise<TInstallResult>;
}

export interface UpdateChannelRemoteSource {
  state: () => RemoteVersionState;
  retry: () => Promise<void>;
}

export function formatAboutVersion(
  version: string | null,
  commit: string | null,
): { applicationVersion: string; version: string } {
  const shortCommit = commit === null ? null : commit.slice(0, 7);
  if (version === null) {
    return {
      applicationVersion: shortCommit === null ? 'Unknown' : 'Dev',
      version: shortCommit ?? '',
    };
  }
  return {
    applicationVersion: version,
    version: shortCommit ?? '',
  };
}

export function createUpdateChannelHandlers<TState, TInstallResult>(opts: {
  localUpdater: UpdateChannelLocalUpdater<TState, TInstallResult>;
  remote: () => UpdateChannelRemoteSource | null;
}) {
  return {
    shellState: () => opts.localUpdater.state(),
    shellCheck: () => opts.localUpdater.check(),
    shellInstall: () => opts.localUpdater.install(),
    remoteState: () => opts.remote()?.state() ?? null,
    remoteRetry: () => opts.remote()?.retry(),
  };
}
