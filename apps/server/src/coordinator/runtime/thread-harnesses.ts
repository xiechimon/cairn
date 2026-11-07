import { join } from 'node:path';
import type { Context } from '@earendil-works/chord/context';
import type { Models } from '@earendil-works/pi-ai/models';
import type { Extension, Harness, HarnessSettings } from '@earendil-works/pi-durable';
import { openCoordinatorHarness } from './harness.js';

const THREAD_ID = /^[A-Za-z0-9_-]+$/;

export function threadStorePath(storageDir: string, threadId: string): string {
  if (!THREAD_ID.test(threadId)) throw new Error(`invalid Coordinator thread id ${threadId}`);
  return join(storageDir, `${threadId}.sqlite`);
}

export function createThreadHarnesses(
  storageDir: string,
  models: Models,
  context: Context,
  options: {
    extensions?: readonly Extension[];
    settings?: () => HarnessSettings;
    beforeResume?: (threadId: string, harness: Harness) => Promise<void>;
  },
) {
  const open = new Map<string, Promise<Harness>>();
  return {
    get(threadId: string): Promise<Harness> {
      const existing = open.get(threadId);
      if (existing !== undefined) return existing;
      const { beforeResume, ...rest } = options;
      const opening = openCoordinatorHarness(
        threadStorePath(storageDir, threadId),
        models,
        context,
        {
          ...rest,
          ...(beforeResume === undefined
            ? {}
            : { beforeResume: (harness: Harness) => beforeResume(threadId, harness) }),
        },
      );
      open.set(threadId, opening);
      opening.catch(() => open.delete(threadId));
      return opening;
    },
    async close(): Promise<void> {
      const harnesses = await Promise.allSettled([...open.values()]);
      open.clear();
      for (const result of harnesses) {
        if (result.status === 'fulfilled') await result.value.close(context);
      }
    },
  };
}
