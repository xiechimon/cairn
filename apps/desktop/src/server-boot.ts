export interface BootServer {
  readonly origin: string;
  readonly exitCode: number | null;
}

interface BootWaiterOptions {
  current: () => BootServer | null;
  waitReady: (server: BootServer) => Promise<void>;
  timeoutMs: number;
  attempts?: number;
  now?: () => number;
}

export function createBootWaiter(options: BootWaiterOptions): () => Promise<BootServer> {
  const now = options.now ?? Date.now;
  const attempts = options.attempts ?? 3;
  return async () => {
    const deadline = now() + options.timeoutMs;
    let lastError: unknown = null;
    let tried = 0;
    while (tried < attempts && now() < deadline) {
      const server = options.current();
      if (server === null) throw lastError ?? new Error('the Cairn server is not running');
      tried += 1;
      try {
        await options.waitReady(server);
        return server;
      } catch (error) {
        lastError = error;
        const replaced = options.current();
        if (replaced === null || replaced === server) throw error;
      }
    }
    throw lastError ?? new Error('the Cairn server did not answer in time');
  };
}
