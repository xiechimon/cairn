import { type ComputerCommand, computerCommandSchema } from '@cairn/shared';

type Listener = () => void;

const LIVE_KEEP = 200;

let live: readonly ComputerCommand[] = [];
const listeners = new Set<Listener>();

const rank = (command: ComputerCommand): number => (command.status === 'running' ? 0 : 1);

export function mergeComputerFeed(
  history: readonly ComputerCommand[],
  incoming: readonly ComputerCommand[],
): ComputerCommand[] {
  const byCall = new Map<string, { command: ComputerCommand; firstAt: number }>();
  for (const command of [...history, ...incoming]) {
    const known = byCall.get(command.callId);
    if (known === undefined) {
      byCall.set(command.callId, { command, firstAt: command.at });
      continue;
    }
    known.firstAt = Math.min(known.firstAt, command.at);
    if (rank(command) >= rank(known.command)) known.command = command;
  }
  return [...byCall.values()]
    .sort((a, b) => a.firstAt - b.firstAt || (a.command.callId < b.command.callId ? -1 : 1))
    .map((entry) => entry.command);
}

export const computerFeedStore = {
  push(raw: unknown): boolean {
    const parsed = computerCommandSchema.safeParse(raw);
    if (!parsed.success) return false;
    const command = parsed.data;
    const isNew = !live.some((known) => known.callId === command.callId);
    live = mergeComputerFeed(live, [command]).slice(-LIVE_KEEP);
    for (const listener of listeners) listener();
    return isNew;
  },
  clear(): void {
    live = [];
    for (const listener of listeners) listener();
  },
  snapshot(): readonly ComputerCommand[] {
    return live;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
