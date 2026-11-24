import type { Server } from 'node:http';

export function startMint(
  config: {
    appId: string | number;
    installationId: string | number;
    privateKeyPath: string;
    socketPath?: string;
  },
  options?: { fetchImpl?: typeof fetch; now?: () => number },
): Promise<Server>;
