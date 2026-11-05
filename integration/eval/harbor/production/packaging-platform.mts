import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export function packagingTestsRequested(value: string | undefined): boolean {
  return value === '1';
}

export async function requirePackagingPlatform(
  options: { platform?: string; bwrapPath?: string } = {},
): Promise<void> {
  if ((options.platform ?? process.platform) !== 'linux') {
    throw new Error(
      'Production runtime packaging requires Linux and Bubblewrap; no packaging proof was produced',
    );
  }
  try {
    await promisify(execFile)(
      options.bwrapPath ?? '/usr/bin/bwrap',
      [
        '--unshare-all',
        '--die-with-parent',
        '--new-session',
        '--clearenv',
        '--ro-bind',
        '/usr',
        '/usr',
        '--symlink',
        'usr/bin',
        '/bin',
        '--ro-bind',
        '/lib',
        '/lib',
        '--ro-bind',
        '/lib64',
        '/lib64',
        '--proc',
        '/proc',
        '--dev',
        '/dev',
        '--tmpfs',
        '/tmp',
        '/usr/bin/true',
      ],
      { env: {}, timeout: 10_000 },
    );
  } catch (cause) {
    throw new Error('Bubblewrap namespace preflight failed; no packaging proof was produced', {
      cause,
    });
  }
}
