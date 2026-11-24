import { accessSync, constants, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type DesktopSubscriptionMetadata,
  type DevinLocalStatus,
  type DevinLoginOutcome,
  devinCredentialsPath,
  devinKeyFromToml,
} from '@cairn/shared';
import { activeManagedBin } from '@cairn/shared/managed-bin';
import { authenticateCredential } from './acp-credential-login.js';

function hostCredential(): string | null {
  try {
    return devinKeyFromToml(readFileSync(devinCredentialsPath(homedir()), 'utf8'));
  } catch {
    return null;
  }
}

function resolveDevinBinary(): string | null {
  const active = activeManagedBin(join(homedir(), '.cairn', 'tools', 'devin'));
  if (active === null) return null;
  try {
    accessSync(active.command, constants.X_OK);
    return active.command;
  } catch {
    return null;
  }
}

export function devinLocalStatus(): DevinLocalStatus {
  return { loggedIn: hostCredential() !== null, canLogin: resolveDevinBinary() !== null };
}

async function saveDevinCredential(
  key: string | null,
  save: (key: string) => Promise<DesktopSubscriptionMetadata>,
): Promise<DevinLoginOutcome> {
  if (key === null) return { ok: false, reason: 'no-key' };
  try {
    return { ok: true, subscription: await save(key) };
  } catch {
    return { ok: false, reason: 'save' };
  }
}

export function devinImport(save: (key: string) => Promise<DesktopSubscriptionMetadata>) {
  return saveDevinCredential(hostCredential(), save);
}

let flight: { controller: AbortController; done: Promise<DevinLoginOutcome> } | null = null;

export function devinCancelLogin(): void {
  flight?.controller.abort();
}

export async function stopDevinLogin(): Promise<void> {
  const current = flight;
  current?.controller.abort();
  await current?.done;
}

export function devinLogin(
  save: (key: string) => Promise<DesktopSubscriptionMetadata>,
  appData: string,
  workerPath?: string,
): Promise<DevinLoginOutcome> {
  if (flight !== null) return Promise.resolve({ ok: false, reason: 'busy' });
  const bin = resolveDevinBinary();
  if (bin === null) return Promise.resolve({ ok: false, reason: 'no-binary' });
  const controller = new AbortController();
  const done = authenticateCredential({
    appData,
    bin,
    args: () => ['acp'],
    env: () => ({
      ...Object.fromEntries(
        Object.keys(process.env)
          .filter((key) => key.startsWith('CHISEL_') || key.startsWith('DEVIN_'))
          .map((key) => [key, undefined]),
      ),
      WINDSURF_API_KEY: undefined,
    }),
    credentialPath: devinCredentialsPath,
    pickMethod: (methods) => {
      const method = methods?.[0]?.id;
      return typeof method === 'string' ? method : 'devin-browser';
    },
    signal: controller.signal,
    workerPath,
  })
    .then((auth): DevinLoginOutcome | Promise<DevinLoginOutcome> => {
      if (!auth.ok) return { ok: false, reason: auth.reason === 'failed' ? 'exit' : auth.reason };
      if (controller.signal.aborted) return { ok: false, reason: 'cancelled' };
      return saveDevinCredential(auth.text === null ? null : devinKeyFromToml(auth.text), save);
    })
    .catch((): DevinLoginOutcome => ({ ok: false, reason: 'spawn' }))
    .finally(() => {
      flight = null;
    });
  flight = { controller, done };
  return done;
}
