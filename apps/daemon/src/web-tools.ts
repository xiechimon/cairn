import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { type MachineCapabilities, machineCapabilitiesSchema } from '@cairn/shared';

const exec = promisify(execFile);
export const SCRAPLING_VERSION = '0.5.1';
const UV_VERSION = '0.13.8';
export const WEB_TOOLS_REFRESH_MS = 10 * 60_000;
const UV_ARCHIVES: Record<string, { target: string; sha256: string }> = {
  'darwin-arm64': {
    target: 'aarch64-apple-darwin',
    sha256: '6b71028a6b904f2ae3340ef52e595512de807d06c0a20eaef2f692581b246558',
  },
  'darwin-x64': {
    target: 'x86_64-apple-darwin',
    sha256: 'a04c2ffeac28b2003a2c13caf538ab425fcd7def3e4a41571f4a8fb370a66af3',
  },
  'linux-arm64': {
    target: 'aarch64-unknown-linux-gnu',
    sha256: '74f2f5c6024d397481db228db8fc25eed420db192243f88438c118e7e013e585',
  },
  'linux-x64': {
    target: 'x86_64-unknown-linux-gnu',
    sha256: '5acfd9177cfecf0bf87578f059728215ccc884388988f55f7a65041b57387d91',
  },
};

export function webToolsHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.CAIRN_HOME ?? join(homedir(), '.cairn'));
}

export function agentReachEnabled(home = webToolsHome()): boolean {
  try {
    return readFileSync(join(home, 'agent-reach.enabled'), 'utf8').trim() === 'enabled';
  } catch {
    return false;
  }
}

export function webToolsBin(home: string, tool = 'scrapling'): string {
  return join(`${home}-web-tools`, tool, 'bin');
}

export function activateWebTools(home: string, env: NodeJS.ProcessEnv = process.env): void {
  const bins = [
    webToolsBin(home),
    ...(agentReachEnabled(home) ? [webToolsBin(home, 'agent-reach')] : []),
  ];
  env.PATH = [...new Set([...bins, ...(env.PATH ?? '').split(delimiter)])].join(delimiter);
}

export function uvArchive(platform: string, arch: string): { target: string; sha256: string } {
  const archive = UV_ARCHIVES[`${platform}-${arch}`];
  if (!archive) throw new Error(`Web tools do not support ${platform}/${arch}`);
  return archive;
}

async function ensureUv(home: string): Promise<string> {
  const tools = `${home}-web-tools`;
  const binary = join(tools, `uv-${UV_VERSION}`);
  if (existsSync(binary)) return binary;
  const archive = uvArchive(process.platform, process.arch);
  mkdirSync(tools, { recursive: true });
  const staging = mkdtempSync(join(tools, '.uv-'));
  try {
    const response = await fetch(
      `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${archive.target}.tar.gz`,
      { signal: AbortSignal.timeout(120_000) },
    );
    if (!response.ok) throw new Error(`uv download: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== archive.sha256)
      throw new Error('uv checksum mismatch');
    const tarball = join(staging, 'uv.tar.gz');
    writeFileSync(tarball, bytes);
    await exec('tar', ['-xzf', tarball, '-C', staging, `uv-${archive.target}/uv`], {
      timeout: 30_000,
    });
    renameSync(join(staging, `uv-${archive.target}`, 'uv'), binary);
    return binary;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export async function readScrapling(home: string): Promise<MachineCapabilities['scrapling']> {
  try {
    const { stdout } = await exec(
      join(webToolsBin(home), 'python'),
      [
        '-I',
        '-c',
        'from scrapling.fetchers import Fetcher; from scrapling.cli import main; import markdownify, scrapling; print(scrapling.__version__)',
      ],
      { timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    return machineCapabilitiesSchema.shape.scrapling.parse({ version: stdout.trim() });
  } catch {
    return undefined;
  }
}

async function installPythonTool(home: string, tool: string, requirement: string): Promise<void> {
  const uv = await ensureUv(home);
  const directory = join(`${home}-web-tools`, tool);
  const env = {
    ...process.env,
    UV_PYTHON_INSTALL_DIR: join(`${home}-web-tools`, 'python'),
    UV_PYTHON_DOWNLOADS: 'automatic',
    UV_CONCURRENT_DOWNLOADS: '2',
  };
  await exec(uv, ['venv', '--python', '3.12', '--managed-python', '--allow-existing', directory], {
    env,
    timeout: 180_000,
  });
  await exec(uv, ['pip', 'install', '--python', join(directory, 'bin', 'python'), requirement], {
    env,
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

export async function ensureWebTools(home: string, log: (message: string) => void): Promise<void> {
  activateWebTools(home);
  if ((await readScrapling(home))?.version === SCRAPLING_VERSION) return;
  log('Installing Scrapling for public webpages (no account or browser download)…');
  try {
    await installPythonTool(home, 'scrapling', `scrapling[rag]==${SCRAPLING_VERSION}`);
    if (!(await readScrapling(home))) throw new Error('HTTP fetcher import failed');
    log(`Scrapling ${SCRAPLING_VERSION} ready`);
  } catch (error) {
    log(`Scrapling unavailable: ${String(error)}. Retry with cairn web-tools install.`);
  }
}

export async function setAgentReachEnabled(home: string, enabled: boolean): Promise<void> {
  const marker = join(home, 'agent-reach.enabled');
  if (!enabled) {
    rmSync(marker, { force: true });
    return;
  }
  activateWebTools(home);
  try {
    await exec('agent-reach', ['version'], { timeout: 15_000 });
  } catch {
    const managed = join(webToolsBin(home, 'agent-reach'), 'agent-reach');
    if (!existsSync(managed))
      await installPythonTool(
        home,
        'agent-reach',
        'https://github.com/Panniantong/Agent-Reach/releases/latest/download/agent-reach.zip',
      );
    await exec(managed, ['version'], { timeout: 15_000 });
  }
  mkdirSync(home, { recursive: true });
  writeFileSync(marker, 'enabled\n', { mode: 0o600 });
  activateWebTools(home);
}

export async function runAgentReach(home: string, args: string[]): Promise<string> {
  if (!agentReachEnabled(home))
    throw new Error('Enable Agent Reach first: cairn web-tools agent-reach --enable');
  activateWebTools(home);
  const { stdout } = await exec('agent-reach', args, {
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

export class ScraplingProbe {
  private report: MachineCapabilities['scrapling'];
  private checkedAt = Number.NEGATIVE_INFINITY;
  private running: Promise<void> | null = null;

  constructor(
    private readonly run: () => Promise<MachineCapabilities['scrapling']>,
    private readonly now: () => number = Date.now,
  ) {}

  current(): MachineCapabilities['scrapling'] {
    if (this.running === null && this.now() - this.checkedAt >= WEB_TOOLS_REFRESH_MS) {
      this.checkedAt = this.now();
      this.running = this.run()
        .then((report) => {
          this.report = report;
        })
        .catch(() => {
          this.report = undefined;
        })
        .finally(() => {
          this.running = null;
        });
    }
    return this.report;
  }

  settled(): Promise<void> {
    return this.running ?? Promise.resolve();
  }
}
