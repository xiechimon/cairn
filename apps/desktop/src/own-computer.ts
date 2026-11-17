import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  AgentDesktopRelease,
  HostPermissions,
  OwnComputerInstallFailure,
  OwnComputerInstallResult,
} from '@cairn/shared';

const COMMAND_TIMEOUT_MS = 30_000;
const GUIDE_TIMEOUT_MS = 10 * 60_000;

export interface InstallOptions {
  toolsRoot: string;
  release: AgentDesktopRelease | null;
  version: string;
  helper: string;
  fetch?: typeof fetch;
}

class InstallFailure extends Error {
  readonly reason: OwnComputerInstallFailure;

  constructor(reason: OwnComputerInstallFailure) {
    super(reason);
    this.reason = reason;
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

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

export function agentDesktopPath(toolsRoot: string, version: string): string {
  return join(toolsRoot, 'agent-desktop', version, 'agent-desktop');
}

export function ownComputerRunnerEnv(
  runnerHome: string,
  platform: string,
  version: string,
): Record<string, string> {
  if (platform !== 'darwin') return {};
  return {
    CAIRN_AGENT_DESKTOP: agentDesktopPath(join(runnerHome, 'tools'), version),
    CAIRN_OWN_COMPUTER: '1',
  };
}

async function installed(binary: string, release: AgentDesktopRelease): Promise<boolean> {
  try {
    return sha256(await readFile(binary)) === release.binarySha256;
  } catch {
    return false;
  }
}

async function download(url: string, fetchImpl: typeof fetch): Promise<Uint8Array> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) throw new InstallFailure('network');
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof InstallFailure) throw error;
    throw new InstallFailure('network');
  }
}

async function onDisk<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof InstallFailure) throw error;
    throw new InstallFailure('disk');
  }
}

async function findUnpacked(root: string, helper: string): Promise<string> {
  const nested = (await readdir(root, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory(),
  );
  const dir =
    !existsSync(join(root, 'agent-desktop')) && nested.length === 1 && nested[0] !== undefined
      ? join(root, nested[0].name)
      : root;
  if (!existsSync(join(dir, 'agent-desktop')) || !existsSync(join(dir, helper)))
    throw new InstallFailure('archive');
  return dir;
}

export async function installAgentDesktop(opts: InstallOptions): Promise<OwnComputerInstallResult> {
  const { release } = opts;
  if (release === null) return { ok: false, reason: 'unsupported' };
  const binary = agentDesktopPath(opts.toolsRoot, opts.version);
  if (await installed(binary, release)) return { ok: true, binary };
  const parent = dirname(dirname(binary));
  let staging: string | null = null;
  try {
    staging = await onDisk(async () => {
      await mkdir(parent, { recursive: true, mode: 0o700 });
      return mkdtemp(join(parent, '.staging-'));
    });
    const bytes = await download(release.url, opts.fetch ?? fetch);
    if (sha256(bytes) !== release.archiveSha256) throw new InstallFailure('checksum');
    const archive = join(staging, 'archive.tar.gz');
    const unpacked = join(staging, 'unpacked');
    await onDisk(async () => {
      await writeFile(archive, bytes, { mode: 0o600 });
      await mkdir(unpacked);
    });
    if ((await run('/usr/bin/tar', ['-xzf', archive, '-C', unpacked])) === null)
      throw new InstallFailure('archive');
    const dir = await findUnpacked(unpacked, opts.helper);
    const staged = join(dir, 'agent-desktop');
    if (sha256(await readFile(staged)) !== release.binarySha256)
      throw new InstallFailure('checksum');
    if (envelopeData(await run(staged, ['version']))?.version !== opts.version)
      throw new InstallFailure('version');
    await onDisk(async () => {
      await rm(dirname(binary), { recursive: true, force: true });
      await rename(dir, dirname(binary));
    });
    return { ok: true, binary };
  } catch (error) {
    if (error instanceof InstallFailure) return { ok: false, reason: error.reason };
    return { ok: false, reason: 'disk' };
  } finally {
    if (staging !== null) await rm(staging, { recursive: true, force: true }).catch(() => {});
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
  install: () => Promise<OwnComputerInstallResult>;
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
  ipc.handle('own-computer:install', (event) => (fromOwnPage(event) ? actions.install() : null));
  ipc.handle('own-computer:guide', async (event) => {
    if (!fromOwnPage(event)) return null;
    await actions.guide();
    return true;
  });
  ipc.handle('own-computer:permissions', (event) =>
    fromOwnPage(event) ? actions.permissions() : null,
  );
}
