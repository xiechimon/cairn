import type { DesktopUpdateInstallResult, DesktopUpdateState } from '@cairn/shared';
import type { ApplyWhen, Updater } from './updater.js';

export interface UpdateInstallMessages {
  notMainWindow: string;
  noPendingUpdate: string;
  offline: string;
  current: (version: string) => string;
  unsupported: (
    blocker: Extract<DesktopUpdateState, { status: 'unsupported' }>['blocker'],
  ) => string;
}

export async function installDesktopUpdate(opts: {
  fromMainPage: boolean;
  updater: Pick<Updater, 'state' | 'install' | 'apply'>;
  messages: UpdateInstallMessages;
  errorMessage: (error: unknown) => string;
}): Promise<DesktopUpdateInstallResult> {
  if (!opts.fromMainPage) {
    return { ok: false, reason: opts.messages.notMainWindow };
  }

  const runApply = async (when: ApplyWhen): Promise<DesktopUpdateInstallResult> => {
    try {
      await opts.updater.apply(when);
      const after = opts.updater.state();
      if (after.status === 'error') return { ok: false, reason: after.message };
      if (after.status === 'offline') return { ok: false, reason: opts.messages.offline };
      if (after.status === 'unsupported') {
        return { ok: false, reason: opts.messages.unsupported(after.blocker) };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: opts.errorMessage(error) };
    }
  };

  const initial = opts.updater.state();
  if (initial.status === 'ready') {
    return runApply('foreground');
  }
  if (initial.status === 'available') {
    try {
      await opts.updater.install();
    } catch (error) {
      return { ok: false, reason: opts.errorMessage(error) };
    }
    const afterInstall = opts.updater.state();
    if (afterInstall.status === 'ready') {
      return runApply('foreground');
    }
    if (afterInstall.status === 'restarting') return { ok: true };
    if (afterInstall.status === 'error') return { ok: false, reason: afterInstall.message };
    if (afterInstall.status === 'offline') return { ok: false, reason: opts.messages.offline };
    if (afterInstall.status === 'unsupported') {
      return { ok: false, reason: opts.messages.unsupported(afterInstall.blocker) };
    }
    return { ok: false, reason: opts.messages.noPendingUpdate };
  }
  if (
    initial.status === 'checking' ||
    initial.status === 'downloading' ||
    initial.status === 'installing' ||
    initial.status === 'restarting'
  ) {
    return { ok: true };
  }
  if (initial.status === 'unsupported') {
    return { ok: false, reason: opts.messages.unsupported(initial.blocker) };
  }
  if (initial.status === 'error') {
    return { ok: false, reason: initial.message };
  }
  if (initial.status === 'offline') {
    return { ok: false, reason: opts.messages.offline };
  }
  if (initial.status === 'current') {
    return { ok: false, reason: opts.messages.current(initial.version) };
  }
  return { ok: false, reason: opts.messages.noPendingUpdate };
}
