import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CODESIGN = '/usr/bin/codesign';
const VERIFY = ['--verify', '--strict'];

type RunningSignature =
  | { kind: 'certificate'; requirement: string }
  | { kind: 'adhoc' }
  | { kind: 'unsigned' }
  | { kind: 'unreadable' };

export function parseRunningSignature(stdout: string, stderr: string): RunningSignature {
  const signature = stderr.split('\n').find((line) => line.startsWith('Signature'));
  if (signature === 'Signature=adhoc') return { kind: 'adhoc' };
  if (!signature?.startsWith('Signature size=')) return { kind: 'unreadable' };

  const requirement = /^designated => (.+)$/m.exec(`${stdout}\n${stderr}`)?.[1]?.trim();
  return requirement ? { kind: 'certificate', requirement } : { kind: 'unreadable' };
}

async function readRunningSignature(appPath: string): Promise<RunningSignature> {
  try {
    const { stdout, stderr } = await run(CODESIGN, ['-d', '--verbose=4', '-r-', appPath], {
      env: { ...process.env, LC_ALL: 'C' },
    });
    return parseRunningSignature(stdout, stderr);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 1 &&
      'stdout' in error &&
      error.stdout === '' &&
      'stderr' in error &&
      error.stderr === `${appPath}: code object is not signed at all\n`
    ) {
      return { kind: 'unsigned' };
    }
    return { kind: 'unreadable' };
  }
}

export async function signedLikeRunningApp(bundle: string, stagedApp: string): Promise<boolean> {
  const signature = await readRunningSignature(bundle);
  if (signature.kind === 'unreadable') return false;

  const requirement = signature.kind === 'certificate' ? [`-R=${signature.requirement}`] : [];
  const checks = [run(CODESIGN, [...VERIFY, ...requirement, stagedApp])];
  if (signature.kind !== 'unsigned') checks.push(run(CODESIGN, [...VERIFY, bundle]));
  return Promise.all(checks).then(
    () => true,
    () => false,
  );
}
