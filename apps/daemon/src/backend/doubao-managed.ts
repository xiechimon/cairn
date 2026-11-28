import { homedir } from 'node:os';
import { join } from 'node:path';
import { BRAND, type DoubaoReport } from '@cairn/shared';
import {
  currentDoubaoManagedInstall,
  type DoubaoCliRelease,
  doubaoInstallSupported,
  ensureDoubaoManagedInstall,
} from '@cairn/shared/doubao-install';
import { toolInstallRoot } from '../runtime-homes.js';
import {
  type DoubaoBinaryResolution,
  type DoubaoController,
  probeDoubaoRuntime,
  resolveDoubaoNativeBinary,
} from './doubao-probe.js';

export interface DoubaoManagedOptions {
  root?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  fetchImpl?: typeof fetch;
  archiveUrlPrefix?: string;
  release?: DoubaoCliRelease;
  env?: NodeJS.ProcessEnv;
  realHome?: string;
  log?: (message: string) => void;
}

export interface DoubaoManaged {
  current(): (DoubaoBinaryResolution & { version?: string }) | null;
  ensure(signal?: AbortSignal): Promise<(DoubaoBinaryResolution & { version?: string }) | null>;
  probeController(now?: () => number): DoubaoController;
  probe(): Promise<DoubaoReport>;
}

export function doubaoInstallRoot(cairnHome: string): string {
  return toolInstallRoot(cairnHome, 'doubao');
}

export function createDoubaoManaged(options: DoubaoManagedOptions = {}): DoubaoManaged {
  const root = options.root ?? doubaoInstallRoot(join(homedir(), BRAND.homeDirName));
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const env = options.env ?? process.env;
  const log = options.log ?? (() => {});
  let pendingEnsure: Promise<(DoubaoBinaryResolution & { version?: string }) | null> | null = null;
  let pendingController: AbortController | null = null;
  let activeWaiters = 0;

  function current(): (DoubaoBinaryResolution & { version?: string }) | null {
    const managed = currentDoubaoManagedInstall(root);
    if (managed !== null) {
      return { command: managed.binPath, source: 'native', version: managed.version };
    }
    return resolveDoubaoNativeBinary({
      ...(options.realHome !== undefined ? { realHome: options.realHome } : {}),
      platform,
      env,
    });
  }

  async function ensure(
    signal?: AbortSignal,
  ): Promise<(DoubaoBinaryResolution & { version?: string }) | null> {
    if (signal?.aborted) return null;
    const existing = current();
    if (existing !== null) return existing;
    if (!doubaoInstallSupported(platform, arch)) return null;
    if (pendingEnsure === null) {
      const controller = new AbortController();
      pendingController = controller;
      pendingEnsure = (async () => {
        const installed = await ensureDoubaoManagedInstall({
          root,
          platform,
          arch,
          signal: controller.signal,
          ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
          ...(options.archiveUrlPrefix !== undefined
            ? { archiveUrlPrefix: options.archiveUrlPrefix }
            : {}),
          ...(options.release !== undefined ? { release: options.release } : {}),
          log,
        });
        if (installed !== null) {
          return {
            command: installed.binPath,
            source: 'native' as const,
            version: installed.version,
          };
        }
        return current();
      })().finally(() => {
        if (pendingController === controller) {
          pendingEnsure = null;
          pendingController = null;
        }
      });
    }
    const currentEnsure = pendingEnsure;
    const currentController = pendingController;
    activeWaiters += 1;
    let settled = false;
    try {
      if (signal === undefined) return await currentEnsure;
      return await new Promise<(DoubaoBinaryResolution & { version?: string }) | null>(
        (resolve) => {
          const onAbort = () => {
            if (settled) return;
            settled = true;
            if (
              activeWaiters <= 1 &&
              currentController !== null &&
              !currentController.signal.aborted
            ) {
              if (pendingController === currentController) {
                pendingEnsure = null;
                pendingController = null;
              }
              currentController.abort();
            }
            resolve(null);
          };
          signal.addEventListener('abort', onAbort, { once: true });
          void currentEnsure.then(
            (res) => {
              signal.removeEventListener('abort', onAbort);
              if (settled) return;
              settled = true;
              resolve(res);
            },
            () => {
              signal.removeEventListener('abort', onAbort);
              if (settled) return;
              settled = true;
              resolve(null);
            },
          );
        },
      );
    } finally {
      activeWaiters -= 1;
    }
  }

  function probe(now?: () => number): Promise<DoubaoReport> {
    const bin = current();
    return probeDoubaoRuntime({
      ...(options.realHome !== undefined ? { realHome: options.realHome } : {}),
      ...(bin !== null ? { command: bin.command } : {}),
      platform,
      arch,
      env,
      ...(now !== undefined ? { now } : {}),
    });
  }

  return {
    current,
    ensure,
    probe: () => probe(),
    probeController: (now) => ({
      ...probeControllerBase(() => probe(now), now),
    }),
  };
}

function probeControllerBase(
  probeFn: () => Promise<DoubaoReport>,
  now?: () => number,
): DoubaoController {
  let cached: DoubaoReport | null = null;
  let inFlight: Promise<DoubaoReport> | null = null;
  let generation = 0;
  const clock = now ?? (() => Date.now());
  return {
    current: () => cached,
    refresh: () => {
      if (inFlight !== null) return inFlight;
      const myGen = generation;
      const run = probeFn()
        .then((report) => {
          const prevAt = cached?.probedAt ?? 0;
          if (myGen === generation && (cached === null || (report.probedAt ?? 0) >= prevAt)) {
            cached = report;
          }
          return cached ?? report;
        })
        .finally(() => {
          if (inFlight === run) inFlight = null;
        });
      inFlight = run;
      return run;
    },
    invalidateAuth: () => {
      generation += 1;
      inFlight = null;
      const nextAt = Math.max(clock(), (cached?.probedAt ?? 0) + 1);
      cached =
        cached === null
          ? {
              installed: true,
              authenticated: false,
              platformSupported: doubaoInstallSupported(process.platform, process.arch),
              probedAt: nextAt,
            }
          : {
              ...cached,
              authenticated: false,
              probedAt: nextAt,
            };
    },
  };
}
