const ZERO_OID = /^0+$/;

export interface ReceivePackCommand {
  oldOid: string;
  newOid: string;
  ref: string;
}

export function parseReceivePackCommands(body: Uint8Array): ReceivePackCommand[] | null {
  const commands: ReceivePackCommand[] = [];
  let offset = 0;
  while (offset + 4 <= body.length) {
    const header = Buffer.from(body.subarray(offset, offset + 4)).toString('latin1');
    if (!/^[0-9a-f]{4}$/.test(header)) return null;
    const length = Number.parseInt(header, 16);
    if (length === 0) return commands;
    if (length < 4 || offset + length > body.length) return null;
    const payload = Buffer.from(body.subarray(offset + 4, offset + length)).toString('utf8');
    offset += length;
    const line = payload.split('\0')[0]?.replace(/\n$/, '') ?? '';
    const match = /^([0-9a-f]{40,64}) ([0-9a-f]{40,64}) (\S.*)$/.exec(line);
    if (!match) return null;
    commands.push({ oldOid: match[1] ?? '', newOid: match[2] ?? '', ref: match[3] ?? '' });
  }
  return null;
}

export function stepPushRefAllowed(command: ReceivePackCommand, workBranch: string): boolean {
  if (command.ref === `refs/heads/${workBranch}`) return !ZERO_OID.test(command.newOid);
  return (
    command.ref.startsWith('refs/tags/') &&
    ZERO_OID.test(command.oldOid) &&
    !ZERO_OID.test(command.newOid)
  );
}
