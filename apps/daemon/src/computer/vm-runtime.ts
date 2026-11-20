import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import manifestJson from '../../computer-image/image.json' with { type: 'json' };
import { executableOnPath } from './contained-spawn.js';
import { ComputerRefusal } from './provider.js';

export const computerImageManifestSchema = z.strictObject({
  image: z.string().regex(/^[a-z0-9./-]+@sha256:[0-9a-f]{64}$/),
  runtime: z.strictObject({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    minimumVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    url: z.string().url(),
    size: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    signer: z.string().min(1),
  }),
});
export type ComputerImageManifest = z.infer<typeof computerImageManifestSchema>;
export type VmRuntimeManifest = ComputerImageManifest['runtime'];

export const COMPUTER_IMAGE_MANIFEST = computerImageManifestSchema.parse(manifestJson);

export const SYSTEM_CONTAINER_BINARY = '/usr/local/bin/container';
export const VM_RUNTIME_START_MS = 10 * 60_000;
const VM_COMMAND_MS = 30_000;
const NOTARIZED = 'Notarization: trusted by the Apple notary service';
export const VM_NOT_DOWNLOADED_MESSAGE =
  'The Linux VM is not downloaded yet. Tell the owner in one sentence that this needs the Linux VM and that they can download it in the [执行机面板](/app?pane=machines); do not retry until they say it is ready';

export interface VmCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface VmCommandOptions {
  timeoutMs?: number;
  stdin?: string;
}

export type VmCommandRunner = (
  argv: readonly string[],
  options?: VmCommandOptions,
) => Promise<VmCommandResult>;

export const runVmCommand: VmCommandRunner = (argv, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(argv[0] as string, argv.slice(1), {
      stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? VM_COMMAND_MS);
    child.stdout?.setEncoding('utf8').on('data', (text: string) => {
      stdout += text;
    });
    child.stderr?.setEncoding('utf8').on('data', (text: string) => {
      stderr += text;
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(options.stdin);
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

export function versionAtLeast(version: string, minimum: string): boolean {
  const parts = (text: string) => text.split('.').map((part) => Number(part));
  const have = parts(version);
  const want = parts(minimum);
  for (let index = 0; index < Math.max(have.length, want.length); index += 1) {
    const difference = (have[index] ?? 0) - (want[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

const systemStatusSchema = z.object({
  status: z.string(),
  server: z.object({ version: z.string() }).optional(),
});

export type VmRuntimeState =
  | 'absent'
  | 'downloading'
  | 'verifying'
  | 'expanded'
  | 'starting'
  | 'ready'
  | 'failed';

export interface VmRuntimeOptions {
  root: string;
  manifest?: VmRuntimeManifest;
  env?: NodeJS.ProcessEnv;
  run?: VmCommandRunner;
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
  arch?: string;
  darwinRelease?: string;
  systemBinary?: string;
  pkgutil?: string;
}

export class VmRuntime {
  private readonly manifest: VmRuntimeManifest;
  private readonly run: VmCommandRunner;
  private resolving: Promise<string> | undefined;
  private permitted = false;
  private onBytes: ((bytes: number) => void) | undefined;
  state: VmRuntimeState = 'absent';
  reason: string | undefined;

  constructor(private readonly options: VmRuntimeOptions) {
    this.manifest = options.manifest ?? COMPUTER_IMAGE_MANIFEST.runtime;
    this.run = options.run ?? runVmCommand;
  }

  unsupported(): string | undefined {
    const platform = this.options.platform ?? process.platform;
    const arch = this.options.arch ?? process.arch;
    const darwin = Number((this.options.darwinRelease ?? release()).split('.')[0]);
    if (platform !== 'darwin' || arch !== 'arm64')
      return 'The agent computer needs a Mac with Apple silicon';
    if (!Number.isInteger(darwin) || darwin < 25)
      return 'The agent computer needs macOS 26 or later';
    return undefined;
  }

  private get runtimeDirectory(): string {
    return join(this.options.root, 'runtime', this.manifest.version);
  }

  private get ownBinary(): string {
    return join(this.runtimeDirectory, 'Payload', 'bin', 'container');
  }

  private get marker(): string {
    return join(this.options.root, 'downloaded');
  }

  downloaded(): boolean {
    return existsSync(this.marker) || existsSync(this.ownBinary);
  }

  markDownloaded(): void {
    mkdirSync(this.options.root, { recursive: true, mode: 0o700 });
    writeFileSync(this.marker, `${this.manifest.version}\n`, { mode: 0o600 });
  }

  async install(onBytes: (bytes: number) => void): Promise<string> {
    this.permitted = true;
    this.onBytes = onBytes;
    try {
      return await this.resolve();
    } catch (error) {
      this.permitted = false;
      throw error;
    } finally {
      this.onBytes = undefined;
    }
  }

  resolve(): Promise<string> {
    this.resolving ??= this.locate().then(
      (binary) => {
        this.state = 'ready';
        this.reason = undefined;
        return binary;
      },
      (error: unknown) => {
        this.resolving = undefined;
        this.state = 'failed';
        this.reason = error instanceof Error ? error.message : String(error);
        throw error instanceof ComputerRefusal ? error : new ComputerRefusal(this.reason);
      },
    );
    return this.resolving;
  }

  forget(): void {
    if (this.state === 'ready') {
      this.resolving = undefined;
      this.state = 'absent';
    }
  }

  private async locate(): Promise<string> {
    const unsupported = this.unsupported();
    if (unsupported) throw new ComputerRefusal(unsupported);
    if (!this.permitted && !this.downloaded()) throw new ComputerRefusal(VM_NOT_DOWNLOADED_MESSAGE);
    const systemBinary = this.options.systemBinary ?? SYSTEM_CONTAINER_BINARY;
    const candidates = [
      executableOnPath('container', this.options.env?.PATH ?? process.env.PATH),
      systemBinary,
      this.ownBinary,
    ].filter(
      (binary, index, all): binary is string =>
        binary !== undefined && existsSync(binary) && all.indexOf(binary) === index,
    );
    for (const binary of candidates) {
      const running = await this.runningVersion(binary);
      if (running === undefined) continue;
      if (!versionAtLeast(running, this.manifest.minimumVersion))
        throw new ComputerRefusal(
          `The running container system is ${running}; the agent computer needs ${this.manifest.minimumVersion} or later`,
        );
      return binary;
    }
    if (existsSync(systemBinary)) {
      const version = await this.binaryVersion(systemBinary);
      if (version !== undefined && versionAtLeast(version, this.manifest.minimumVersion)) {
        await this.start(systemBinary, ['--enable-kernel-install']);
        return systemBinary;
      }
    }
    if (!existsSync(this.ownBinary)) await this.provision();
    await this.start(this.ownBinary, [
      '--install-root',
      join(this.runtimeDirectory, 'Payload'),
      '--app-root',
      join(this.options.root, 'app'),
      '--log-root',
      join(this.options.root, 'log'),
      '--enable-kernel-install',
    ]);
    return this.ownBinary;
  }

  private async runningVersion(binary: string): Promise<string | undefined> {
    const status = await this.run([binary, 'system', 'status', '--format', 'json']);
    if (status.code !== 0) return undefined;
    try {
      const parsed = systemStatusSchema.parse(JSON.parse(status.stdout));
      return parsed.status === 'running' ? (parsed.server?.version ?? '0.0.0') : undefined;
    } catch {
      return undefined;
    }
  }

  private async binaryVersion(binary: string): Promise<string | undefined> {
    const shown = await this.run([binary, '--version']);
    return shown.code === 0 ? /(\d+\.\d+\.\d+)/.exec(shown.stdout)?.[1] : undefined;
  }

  private async start(binary: string, args: readonly string[]): Promise<void> {
    this.state = 'starting';
    const started = await this.run([binary, 'system', 'start', ...args], {
      timeoutMs: VM_RUNTIME_START_MS,
    });
    if (started.code !== 0 || (await this.runningVersion(binary)) === undefined)
      throw new ComputerRefusal('The container system could not be started');
  }

  private async provision(): Promise<void> {
    const downloads = join(this.options.root, 'download');
    const runtimes = join(this.options.root, 'runtime');
    mkdirSync(downloads, { recursive: true, mode: 0o700 });
    mkdirSync(runtimes, { recursive: true, mode: 0o700 });
    const name = this.manifest.url.slice(this.manifest.url.lastIndexOf('/') + 1);
    const pkg = join(downloads, name);
    const partial = `${pkg}.partial`;
    const scratch = join(runtimes, `.expand-${randomBytes(8).toString('hex')}`);
    try {
      this.state = 'downloading';
      const response = await (this.options.fetch ?? fetch)(this.manifest.url);
      if (!response.ok || !response.body)
        throw new ComputerRefusal(`The container runtime download failed (${response.status})`);
      const hash = createHash('sha256');
      let bytes = 0;
      const limit = this.manifest.size;
      const report = this.onBytes;
      await pipeline(
        Readable.fromWeb(response.body),
        new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            bytes += chunk.length;
            if (bytes > limit) {
              callback(new ComputerRefusal('The container runtime download is larger than pinned'));
              return;
            }
            hash.update(chunk);
            report?.(bytes);
            callback(null, chunk);
          },
        }),
        createWriteStream(partial, { mode: 0o600 }),
      );
      this.state = 'verifying';
      if (bytes !== limit || statSync(partial).size !== limit)
        throw new ComputerRefusal('The container runtime download has the wrong size');
      if (hash.digest('hex') !== this.manifest.sha256)
        throw new ComputerRefusal('The container runtime download has the wrong checksum');
      renameSync(partial, pkg);
      const pkgutil = this.options.pkgutil ?? '/usr/sbin/pkgutil';
      const signature = await this.run([pkgutil, '--check-signature', pkg]);
      if (
        signature.code !== 0 ||
        !signature.stdout.includes(NOTARIZED) ||
        !signature.stdout.includes(`1. ${this.manifest.signer}`)
      )
        throw new ComputerRefusal('The container runtime package is not signed by Apple');
      mkdirSync(scratch, { mode: 0o700 });
      const expanded = await this.run([pkgutil, '--expand-full', pkg, join(scratch, 'pkg')], {
        timeoutMs: VM_RUNTIME_START_MS,
      });
      if (expanded.code !== 0 || !existsSync(join(scratch, 'pkg', 'Payload', 'bin', 'container')))
        throw new ComputerRefusal('The container runtime package could not be expanded');
      renameSync(join(scratch, 'pkg'), this.runtimeDirectory);
      this.state = 'expanded';
    } finally {
      rmSync(partial, { force: true });
      rmSync(pkg, { force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}
