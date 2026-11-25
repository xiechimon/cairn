import {
  afterSwap,
  folderWritable,
  outsideUpdaterNote,
  SignatureRefused,
  stagedBundleExists,
  swapInStaged,
  type VerifySignature,
  verifyStaged,
} from './update-core.js';
import { readUpdateState, stagedFor, updateStatePath, writeUpdateState } from './update-state.js';
import { readBundleVersion, restoreIfBundleMissing } from './update-swap.js';

export const LAUNCH_SETTLED_FLAG = '--cairn-launch-settled';

export interface LaunchContext {
  bundle: string;
  userData: string;
  runningVersion: string;
  settled: boolean;
  verify?: VerifySignature;
  log(line: string): void;
}

export type LaunchVerdict = 'continue' | 'relaunch';

export async function settleBundleAtLaunch(context: LaunchContext): Promise<LaunchVerdict> {
  const { bundle, userData, runningVersion, log } = context;
  if (await restoreIfBundleMissing(bundle)) {
    log('restored the previous Cairn after an install was interrupted');
  }
  const statePath = updateStatePath(userData);
  if (!context.settled) {
    const onDisk = await readBundleVersion(bundle);
    if (onDisk !== null && onDisk !== runningVersion) {
      log(`${bundle} became ${onDisk} while ${runningVersion} was starting; opening ${onDisk}`);
      return 'relaunch';
    }
    const state = readUpdateState(statePath);
    const staged = stagedFor(state, runningVersion);
    if (
      staged !== null &&
      state.installed === null &&
      stagedBundleExists(staged) &&
      (await folderWritable(bundle))
    ) {
      try {
        await verifyStaged(bundle, staged, context.verify);
        const installed = await swapInStaged(bundle, staged, runningVersion);
        writeUpdateState(statePath, afterSwap(readUpdateState(statePath), installed));
        log(`installed the downloaded ${staged.version} before opening ${runningVersion}`);
        return 'relaunch';
      } catch (error) {
        log(`could not install the downloaded ${staged.version} at launch: ${String(error)}`);
        if (error instanceof SignatureRefused) {
          const latest = readUpdateState(statePath);
          if (latest.staged?.app === staged.app) {
            writeUpdateState(statePath, { ...latest, staged: null });
          }
        }
      }
    }
  }
  const state = readUpdateState(statePath);
  const note = outsideUpdaterNote(state, runningVersion);
  if (note !== null) log(note);
  if (state.knownVersion !== runningVersion) {
    writeUpdateState(statePath, { ...state, knownVersion: runningVersion });
  }
  return 'continue';
}
