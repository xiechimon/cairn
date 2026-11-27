import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  clearHealthyRecord,
  pruneOldVersionSlots,
  RUNNER_PREBOOT_DEADLINE_MS,
  readHealthyRecord,
  readSelfUpdateState,
  resolveSlotEntryPath,
  SELF_UPDATE_EXIT_CODE,
  selfUpdatePaths,
  syncBaseBinaryOverride,
  writeSelfUpdateState,
} from './self-update.js';

function nodeSpawnArgv(entryPath: string, argv: readonly string[]): string[] {
  return entryPath.endsWith('.ts') ? ['--import', 'tsx', entryPath, ...argv] : [entryPath, ...argv];
}

export async function runSelfUpdateBootstrap(opts: {
  cairnHome: string;
  baseEntryPath: string;
  baseReleaseVersion: string | null;
  argv: readonly string[];
  env?: NodeJS.ProcessEnv;
  preBootTimeoutMs?: number;
  now?: () => number;
}): Promise<number> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  const preBootTimeoutMs = opts.preBootTimeoutMs ?? RUNNER_PREBOOT_DEADLINE_MS;
  const { versionsDir } = selfUpdatePaths(opts.cairnHome);
  syncBaseBinaryOverride(opts.cairnHome, opts.baseReleaseVersion);

  let stopping = false;
  let activeChild: ReturnType<typeof spawn> | null = null;
  const forwardStop = (signal: NodeJS.Signals) => {
    stopping = true;
    activeChild?.kill(signal);
  };
  const onTerm = () => forwardStop('SIGTERM');
  const onInt = () => forwardStop('SIGINT');
  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onInt);

  try {
    while (!stopping) {
      let state = readSelfUpdateState(opts.cairnHome);
      const candidateVersion = state.pending ?? state.activeVersion;
      let entryPath = opts.baseEntryPath;
      let launchedVersion = opts.baseReleaseVersion ?? 'base';
      let isProbation = false;
      let attemptId: string | null = null;

      if (candidateVersion !== null) {
        const slotEntry = resolveSlotEntryPath(`${versionsDir}/${candidateVersion}`);
        if (slotEntry !== null) {
          entryPath = slotEntry;
          launchedVersion = candidateVersion;
          if (state.pending === candidateVersion) {
            isProbation = true;
            attemptId = randomUUID();
            clearHealthyRecord(opts.cairnHome);
          }
        } else if (state.pending === candidateVersion) {
          const restored = state.activeVersion ?? opts.baseReleaseVersion ?? 'base';
          state = {
            ...state,
            pending: null,
            blocked: {
              ...state.blocked,
              [candidateVersion]: { at: now(), reason: 'missing runner binary in slot' },
            },
            notice: {
              failedVersion: candidateVersion,
              restoredVersion: restored,
              reason: 'missing runner binary in slot',
              at: now(),
            },
          };
          writeSelfUpdateState(opts.cairnHome, state);
          continue;
        } else {
          state = { ...state, activeVersion: null, previousVersion: null };
          writeSelfUpdateState(opts.cairnHome, state);
        }
      }

      const startedAt = now();
      const childEnv: NodeJS.ProcessEnv = {
        ...env,
        CAIRN_HOME: opts.cairnHome,
        CAIRN_SELF_UPDATE_CHILD: '1',
        ...(attemptId !== null ? { CAIRN_SELF_UPDATE_ATTEMPT: attemptId } : {}),
        ...(launchedVersion !== 'base' ? { CAIRN_SELF_UPDATE_TARGET: launchedVersion } : {}),
      };

      const result = await new Promise<{ code: number | null; timedOutPreBoot: boolean }>(
        (resolveExit) => {
          let settled = false;
          let timedOutPreBoot = false;
          const finish = (code: number | null) => {
            if (settled) return;
            settled = true;
            clearInterval(watchTimer);
            resolveExit({ code, timedOutPreBoot });
          };
          const child = spawn(process.execPath, nodeSpawnArgv(entryPath, opts.argv), {
            stdio: 'inherit',
            env: childEnv,
          });
          activeChild = child;
          const promoteIfConfirmed = () => {
            if (!isProbation || attemptId === null) return;
            const healthy = readHealthyRecord(opts.cairnHome);
            if (
              healthy !== null &&
              healthy.attemptId === attemptId &&
              healthy.status === 'confirmed'
            ) {
              const latest = readSelfUpdateState(opts.cairnHome);
              if (latest.pending === launchedVersion) {
                const updated: typeof latest = {
                  ...latest,
                  previousVersion: latest.activeVersion,
                  activeVersion: launchedVersion,
                  pending: null,
                  notice: null,
                };
                writeSelfUpdateState(opts.cairnHome, updated);
                const keep = new Set<string>([launchedVersion]);
                if (updated.previousVersion !== null) keep.add(updated.previousVersion);
                pruneOldVersionSlots(opts.cairnHome, keep);
                clearHealthyRecord(opts.cairnHome);
                isProbation = false;
              }
            }
          };
          const watchTimer = setInterval(() => {
            promoteIfConfirmed();
            if (!isProbation) return;
            const healthy = readHealthyRecord(opts.cairnHome);
            const booted = healthy !== null && healthy.attemptId === attemptId;
            if (!booted && now() - startedAt >= preBootTimeoutMs) {
              timedOutPreBoot = true;
              child.kill('SIGTERM');
            }
          }, 250);
          watchTimer.unref?.();
          child.on('exit', (code) => {
            promoteIfConfirmed();
            finish(code);
          });
          child.on('error', () => finish(1));
        },
      );
      activeChild = null;

      if (stopping) return 0;
      if (result.code === SELF_UPDATE_EXIT_CODE) continue;

      if (isProbation) {
        const latest = readSelfUpdateState(opts.cairnHome);
        const restored = latest.activeVersion ?? opts.baseReleaseVersion ?? 'base';
        const reason = result.timedOutPreBoot
          ? 'timed out before startup check passed'
          : `exited with code ${result.code ?? 'signal'} before confirmation`;
        writeSelfUpdateState(opts.cairnHome, {
          ...latest,
          pending: null,
          blocked: {
            ...latest.blocked,
            [launchedVersion]: { at: now(), reason },
          },
          notice: {
            failedVersion: launchedVersion,
            restoredVersion: restored,
            reason,
            at: now(),
          },
        });
        clearHealthyRecord(opts.cairnHome);
        continue;
      }

      if (result.code === 0) return 0;
      return result.code ?? 1;
    }
    return 0;
  } finally {
    process.off('SIGTERM', onTerm);
    process.off('SIGINT', onInt);
  }
}
