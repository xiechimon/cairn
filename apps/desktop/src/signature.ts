import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface SigningIdentity {
  identifier: string | null;
  authority: string | null;
}

export function parseSigningIdentity(output: string): SigningIdentity {
  const identifier = /^Identifier=(.+)$/m.exec(output)?.[1]?.trim() ?? null;
  const authority = /^Authority=(.+)$/m.exec(output)?.[1]?.trim() ?? null;
  return { identifier, authority };
}

export function signatureMatches(running: SigningIdentity, staged: SigningIdentity): boolean {
  if (running.authority === null) return true;
  return staged.authority === running.authority && staged.identifier === running.identifier;
}

async function codesignIdentity(appPath: string): Promise<{ verified: boolean; identity: string }> {
  const [details, verified] = await Promise.all([
    run('/usr/bin/codesign', ['-d', '--verbose=4', appPath]).then(
      (result) => result.stdout,
      () => '',
    ),
    run('/usr/bin/codesign', ['--verify', '--strict', appPath]).then(
      () => true,
      () => false,
    ),
  ]);
  return { verified, identity: details };
}

export async function signedLikeRunningApp(bundle: string, stagedApp: string): Promise<boolean> {
  const [running, staged] = await Promise.all([
    codesignIdentity(bundle),
    codesignIdentity(stagedApp),
  ]);
  if (!running.verified) return true;
  return (
    staged.verified &&
    signatureMatches(parseSigningIdentity(running.identity), parseSigningIdentity(staged.identity))
  );
}
