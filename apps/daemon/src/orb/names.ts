import { createHash } from 'node:crypto';

export const ORB_NAME_PATTERN = /^cairn-orb-[a-zA-Z0-9][a-zA-Z0-9-]{0,53}$/;

export function orbMachineName(conversationId: string): string {
  const suffix =
    conversationId !== 'base' &&
    !/^computer/i.test(conversationId) &&
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,44}[a-zA-Z0-9])?$/.test(conversationId)
      ? conversationId
      : createHash('sha256').update(conversationId).digest('hex').slice(0, 54);
  return `cairn-orb-${suffix}`;
}

export function assertOrbMachineName(id: string): void {
  if (!ORB_NAME_PATTERN.test(id) || id === 'cairn-orb-base' || /^cairn-orb-computer/i.test(id))
    throw new Error('Invalid orb machine name');
}
