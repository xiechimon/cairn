import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

interface UpgradeServer {
  on(
    event: 'upgrade',
    listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
  off(
    event: 'upgrade',
    listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
}

const claimed = Symbol('cairnUpgradeClaimed');

type ClaimedRequest = IncomingMessage & { [claimed]?: true };

export function claimUpgrade(request: IncomingMessage): void {
  (request as ClaimedRequest)[claimed] = true;
}

export function upgradeClaimed(request: IncomingMessage): boolean {
  return (request as ClaimedRequest)[claimed] === true;
}

export function closeUnclaimedUpgrades(server: UpgradeServer): () => void {
  const listener = (request: IncomingMessage, socket: Duplex): void => {
    if (!upgradeClaimed(request)) socket.destroy();
  };
  server.on('upgrade', listener);
  return () => server.off('upgrade', listener);
}
