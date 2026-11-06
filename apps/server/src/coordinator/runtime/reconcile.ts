import { copyFileSync, existsSync, renameSync } from 'node:fs';
import type { Context } from '@earendil-works/chord/context';
import type { Models } from '@earendil-works/pi-ai/models';
import type { Extension, Harness, HarnessSettings } from '@earendil-works/pi-durable';
import { parseWatermark } from '../watermark.js';
import { activeConversation, newestEntryId } from './conversations.js';
import { openCoordinatorHarness } from './harness.js';
import { type SeedRow, seedCoordinator } from './seed.js';
import { settleStaleSubmissions } from './stale-runs.js';

export const PI_VERSION = '1.5.0';

export interface ReconcileSeed {
  summary: string;
  rows: SeedRow[];
  model: { provider: string; modelId: string };
}

export interface ReconcileFacts {
  conversationId: string | null;
  lastMirroredEntryId: string | null;
  piVersion: string | null;
  hasClaimedStep: boolean;
  forceReseed?: boolean;
  isLive(requestId: string): boolean;
  seed(): ReconcileSeed;
  record(state: { conversationId: string; piVersion: string; reseeded: boolean }): void;
}

export type ReconcileOutcome =
  | 'seeded'
  | 'adopted-store'
  | 'reseeded-missing-conversation'
  | 'reseeded-ahead'
  | 'reseeded-rewound'
  | 'unchanged';

export interface ReconcileOptions {
  extensions?: readonly Extension[];
  settings?: () => HarnessSettings;
}

const STORE_SIDE_FILES = ['', '-wal', '-shm'];

function setAside(path: string, tag: string): void {
  for (const suffix of STORE_SIDE_FILES) {
    if (existsSync(`${path}${suffix}`)) renameSync(`${path}${suffix}`, `${path}${suffix}.${tag}`);
  }
}

function backupBeforeUpgrade(path: string, from: string): void {
  const target = `${path}.pi-${from}.bak`;
  if (existsSync(path) && !existsSync(target)) copyFileSync(path, target);
}

export async function openReconciledHarness(
  storagePath: string,
  models: Models,
  context: Context,
  options: ReconcileOptions,
  facts: ReconcileFacts,
): Promise<{ harness: Harness; outcome: ReconcileOutcome; stale: string[] }> {
  if (facts.piVersion !== null && facts.piVersion !== PI_VERSION) {
    backupBeforeUpgrade(storagePath, facts.piVersion);
  }
  const open = () =>
    openCoordinatorHarness(storagePath, models, context, { ...options, resume: false });
  let harness = await open();
  const root = await harness.root(context);
  const rootNewest = await newestEntryId(root, context);
  const recorded =
    facts.conversationId === null || rootNewest === undefined
      ? root
      : await activeConversation(harness, facts.conversationId, context);
  const newest = recorded === undefined ? undefined : await newestEntryId(recorded, context);
  const watermark = parseWatermark(facts.lastMirroredEntryId);
  let outcome: ReconcileOutcome = 'unchanged';
  let reseed: ReconcileOutcome | null = null;
  if (rootNewest === undefined) {
    reseed = 'seeded';
  } else if (facts.forceReseed === true) {
    reseed = 'reseeded-rewound';
  } else if (facts.conversationId === null) {
    outcome = 'adopted-store';
  } else if (recorded === undefined) {
    reseed = 'reseeded-missing-conversation';
  } else if (
    watermark?.kind === 'mirrored' &&
    newest !== undefined &&
    newest > watermark.entryId &&
    !facts.hasClaimedStep
  ) {
    reseed = 'reseeded-ahead';
  }
  if (reseed !== null) {
    if (rootNewest !== undefined) {
      await harness.close(context);
      setAside(storagePath, `stale-${Date.now()}`);
      harness = await open();
    }
    const seed = facts.seed();
    await seedCoordinator(harness, seed.summary, seed.rows, seed.model, context);
    outcome = reseed;
  }
  const settled = await settleStaleSubmissions(harness, context, facts.isLive);
  const active = reseed === null && recorded !== undefined ? recorded : await harness.root(context);
  facts.record({
    conversationId: String(active.id),
    piVersion: PI_VERSION,
    reseeded: reseed !== null && rootNewest !== undefined,
  });
  harness.resume();
  if (settled.placedStale && settled.adopted.length === 0) await active.abort(context);
  return { harness, outcome, stale: settled.aborted };
}
