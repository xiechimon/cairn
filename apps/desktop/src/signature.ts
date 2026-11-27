import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CODESIGN = '/usr/bin/codesign';
const VERIFY = ['--verify', '--strict'];
const BUNDLE_ID = 'io.github.xiechimon.cairn';
const FINGERPRINT = '0534637BC4A0AE2E430CFF4D16661F5EA9899DCB';

export const CAIRN_REQUIREMENT = `identifier "${BUNDLE_ID}" and certificate leaf = H"${FINGERPRINT}"`;

export async function verifyCairnSignature(
  stagedApp: string,
): Promise<'accepted' | 'requirement-mismatch' | 'verification-failed'> {
  try {
    await run(CODESIGN, [...VERIFY, `-R=${CAIRN_REQUIREMENT}`, stagedApp]);
    return 'accepted';
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 3
      ? 'requirement-mismatch'
      : 'verification-failed';
  }
}
