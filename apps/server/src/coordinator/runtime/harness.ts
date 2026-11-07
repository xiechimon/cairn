import type { Context } from '@earendil-works/chord/context';
import type { Models } from '@earendil-works/pi-ai/models';
import {
  createRegistry,
  type Extension,
  type Harness,
  type HarnessSettings,
  Harness as PiHarness,
} from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';

export async function openCoordinatorHarness(
  storagePath: string,
  models: Models,
  context: Context,
  options: {
    extensions?: readonly Extension[];
    settings?: () => HarnessSettings;
    beforeResume?: (harness: Harness) => Promise<void>;
    resume?: boolean;
  } = {},
): Promise<Harness> {
  const storage = await openNodeSqliteStorage(storagePath);
  const registry = createRegistry();
  for (const extension of options.extensions ?? []) registry.install(extension);
  const harness = await PiHarness.open(
    storage,
    { models, registry, ...(options.settings ? { settings: options.settings } : {}) },
    context,
  );
  await options.beforeResume?.(harness);
  if (options.resume !== false) harness.resume();
  return harness;
}
