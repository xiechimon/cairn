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
