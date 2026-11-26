import { createServer } from 'node:net';
import { MAC_BROWSER_PORT_SLOTS } from '../backend/loopback-ports.js';
import { ComputerRefusal } from './provider.js';

type PortSlot = (typeof MAC_BROWSER_PORT_SLOTS)[number];

function free(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function bothFree(slot: PortSlot): Promise<boolean> {
  return (await free(slot.debug)) && (await free(slot.stream));
}

export function createBrowserPortSlots(): (session: string) => Promise<PortSlot> {
  const held = new Map<string, PortSlot>();
  let queue: Promise<unknown> = Promise.resolve();

  async function claim(session: string): Promise<PortSlot> {
    const known = held.get(session);
    if (known !== undefined) return known;
    const taken = new Set(held.values());
    for (const slot of MAC_BROWSER_PORT_SLOTS) {
      if (taken.has(slot) || !(await bothFree(slot))) continue;
      held.set(session, slot);
      return slot;
    }
    for (const [idle, slot] of held) {
      if (!(await bothFree(slot))) continue;
      held.delete(idle);
      held.set(session, slot);
      return slot;
    }
    throw new ComputerRefusal('这台 Mac 上同时打开的浏览器太多了，请过半小时再试。');
  }

  return (session) => {
    const mine = queue.then(() => claim(session));
    queue = mine.catch(() => {});
    return mine;
  };
}
