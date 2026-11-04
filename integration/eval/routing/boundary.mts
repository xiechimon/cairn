import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface BoundaryExecution {
  enforced: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  violations: string[];
  runtimeDenials: string[];
}

export function executeBounded(input: {
  workspace: string;
  command: string;
  compiler?: string;
  landlockAbiOverride?: number;
  timeoutMs?: number;
}): BoundaryExecution {
  const temporary = mkdtempSync(join(tmpdir(), 'routing-enforcement-'));
  const failure = (stderr: string): BoundaryExecution => ({
    enforced: false,
    exitCode: null,
    stdout: '',
    stderr,
    violations: [],
    runtimeDenials: [],
  });
  try {
    if (process.platform !== 'linux' || process.arch !== 'x64')
      return failure('Linux x86_64 required');
    const helper = join(temporary, 'boundary');
    const defines =
      input.landlockAbiOverride === undefined
        ? []
        : [`-DROUTING_LANDLOCK_ABI_OVERRIDE=${input.landlockAbiOverride}`];
    const compiled = spawnSync(
      input.compiler ?? 'gcc',
      [
        '-std=c11',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Werror',
        ...defines,
        join(import.meta.dirname, 'read-boundary.c'),
        '-o',
        helper,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    if (compiled.status !== 0) return failure(`${compiled.error ?? ''}${compiled.stderr}`);
    const executables = ['/usr/bin/bash', '/usr/bin/cat', '/usr/bin/sed', process.execPath].map(
      (path) => realpathSync(path),
    );
    const resources = new Set(executables);
    for (const executable of executables) {
      const linked = spawnSync('ldd', [executable], { encoding: 'utf8', timeout: 5000 });
      if (linked.status !== 0)
        return failure(`Cannot resolve runtime dependencies: ${linked.stderr}`);
      for (const match of linked.stdout.matchAll(/(?:=>\s+|^\s*)(\/[^\s]+)/gm)) {
        if (match[1]) resources.add(realpathSync(match[1]));
      }
    }
    for (const path of [
      '/etc/ld.so.cache',
      '/dev/null',
      '/dev/urandom',
      '/etc/nsswitch.conf',
      '/etc/passwd',
    ]) {
      if (existsSync(path)) resources.add(realpathSync(path));
    }
    const manifest = join(temporary, 'runtime');
    const auditPath = join(temporary, 'audit');
    writeFileSync(manifest, `${[...resources].join('\n')}\n`);
    const run = spawnSync(
      helper,
      [
        realpathSync(input.workspace),
        manifest,
        auditPath,
        executables[0] ?? '',
        input.command,
        'v1',
      ],
      {
        encoding: 'utf8',
        timeout: input.timeoutMs ?? 10_000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
          LC_ALL: 'C',
          HOME: input.workspace,
          OPENSSL_CONF: '/dev/null',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const audit = existsSync(auditPath) ? readFileSync(auditPath, 'utf8') : '';
    return {
      enforced: !run.error && audit.endsWith('COMPLETE\n'),
      exitCode: run.status,
      stdout: run.stdout ?? '',
      stderr: `${run.stderr ?? ''}${run.error ?? ''}`,
      runtimeDenials: audit.split('\n').filter((line) => line.startsWith('RUNTIME_DENIED ')),
      violations: audit
        .split('\n')
        .filter((line) => line.startsWith('DENIED '))
        .map((line) => {
          const [, syscall, path = ''] = line.split(' ');
          return `syscall ${syscall}: ${Buffer.from(path, 'hex').toString('utf8')}`;
        }),
    };
  } catch (error) {
    return failure(String(error));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
