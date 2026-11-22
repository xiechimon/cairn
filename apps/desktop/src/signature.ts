import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CODESIGN = '/usr/bin/codesign';
const VERIFY = ['--verify', '--strict'];
const CERTIFICATE_PROBE = '-R=certificate leaf[subject.CN] exists';

async function runningRequirement(bundle: string): Promise<string | null> {
  try {
    await run(CODESIGN, [...VERIFY, CERTIFICATE_PROBE, bundle], {
      env: { ...process.env, LC_ALL: 'C' },
    });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      !('signal' in error && error.signal) &&
      !('killed' in error && error.killed)
    ) {
      if (error.code === 3) return null;
      if (
        error.code === 1 &&
        'stdout' in error &&
        error.stdout === '' &&
        'stderr' in error &&
        error.stderr === `${bundle}: code object is not signed at all\n`
      ) {
        return null;
      }
    }
    throw error;
  }

  const { stdout } = await run(CODESIGN, ['-d', '-r-', bundle]);
  const requirement = /^designated => (\S.*)\n?$/.exec(stdout)?.[1];
  if (!requirement) throw new Error('codesign did not return one designated requirement');
  return `-R=${requirement}`;
}

export async function signedLikeRunningApp(bundle: string, stagedApp: string): Promise<boolean> {
  try {
    const requirement = await runningRequirement(bundle);
    if (requirement === null) {
      await run(CODESIGN, [...VERIFY, stagedApp]);
    } else {
      await Promise.all([
        run(CODESIGN, [...VERIFY, requirement, bundle]),
        run(CODESIGN, [...VERIFY, requirement, stagedApp]),
      ]);
    }
    return true;
  } catch {
    return false;
  }
}
