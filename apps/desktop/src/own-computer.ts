import { execFile } from 'node:child_process';
import type { HostPermissions } from '@cairn/shared';

const COMMAND_TIMEOUT_MS = 30_000;
const GUIDE_TIMEOUT_MS = 10 * 60_000;

function run(
  file: string,
  args: readonly string[],
  timeout = COMMAND_TIMEOUT_MS,
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { timeout, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => resolve(error ? null : stdout),
    );
  });
}

function envelopeData(stdout: string | null): Record<string, unknown> | null {
  if (stdout === null) return null;
  try {
    const parsed = JSON.parse(stdout) as { ok?: unknown; data?: unknown };
    return parsed.ok === true && parsed.data !== null && typeof parsed.data === 'object'
      ? (parsed.data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const PERMISSION_STATES = new Set(['granted', 'not_required', 'denied', 'unknown']);

export async function readPermissions(binary: string): Promise<HostPermissions | null> {
  const data = envelopeData(await run(binary, ['permissions']));
  const state = (key: string): string | null => {
    const value = (data?.[key] as { state?: unknown } | undefined)?.state;
    return typeof value === 'string' && PERMISSION_STATES.has(value) ? value : null;
  };
  const accessibility = state('accessibility');
  const automation = state('automation');
  const screenRecording = state('screen_recording');
  if (accessibility === null || automation === null || screenRecording === null) return null;
  return { accessibility, automation, screenRecording } as HostPermissions;
}

export async function openPermissionGuide(binary: string): Promise<void> {
  await run(binary, ['permissions', '--guide'], GUIDE_TIMEOUT_MS);
}

export interface OwnComputerActions {
  guide: () => Promise<void>;
  permissions: () => Promise<HostPermissions | null>;
}

export interface IpcHandle<E> {
  handle: (channel: string, handler: (event: E) => unknown) => void;
}

export function registerOwnComputerIpc<E>(
  ipc: IpcHandle<E>,
  fromOwnPage: (event: E) => boolean,
  actions: OwnComputerActions,
): void {
  ipc.handle('own-computer:guide', async (event) => {
    if (!fromOwnPage(event)) return null;
    await actions.guide();
    return true;
  });
  ipc.handle('own-computer:permissions', (event) =>
    fromOwnPage(event) ? actions.permissions() : null,
  );
}
