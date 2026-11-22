import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CODESIGN = '/usr/bin/codesign';
const VERIFY = ['--verify', '--strict'];
const BUNDLE_ID = 'io.github.xiechimon.cairn';
const FINGERPRINT = '19AA592374DC19928A4C5494BCAC5A984182EA8A';

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
