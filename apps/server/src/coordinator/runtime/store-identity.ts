import { randomUUID } from 'node:crypto';
import type { Context } from '@earendil-works/chord/context';
import { defineDoc, type Harness } from '@earendil-works/pi-durable';

const StoreIdentity = defineDoc({
  kind: 'cairn.store-identity',
  scope: 'session',
  version: 1,
  initial: () => ({ id: randomUUID().replaceAll('-', '') }),
  checkpointWhen: () => true,
});

export async function coordinatorStoreId(harness: Harness, context: Context): Promise<string> {
  return harness.commit(async (tx) => (await tx.doc(StoreIdentity)).id, context);
}
