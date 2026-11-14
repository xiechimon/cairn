import { copyFileSync, existsSync, renameSync } from 'node:fs';
import type { Context } from '@earendil-works/chord/context';
import type { Models } from '@earendil-works/pi-ai/models';
import {
  AssistantEntry,
  type EntryId,
  type EntryRecord,
  type Extension,
  type Harness,
  type HarnessSettings,
  ToolResultEntry,
  UserEntry,
} from '@earendil-works/pi-durable';
import { parseWatermark } from '../watermark.js';
import { activeConversation, type Conversation, newestEntryId } from './conversations.js';
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
  storeId?: string | null;
  adoptStore?(storeId: string): void;
  conversationId: string | null;
  lastMirroredEntryId: string | null;
  piVersion: string | null;
  hasClaimedStep: boolean;
  forceReseed?: boolean;
  isLive(requestId: string): boolean;
  seed(): Promise<ReconcileSeed>;
  record(state: {
    storeId?: string;
    conversationId: string;
    piVersion: string;
    reseeded: boolean;
  }): void;
}

export type ReconcileOutcome =
  | 'seeded'
  | 'adopted-store'
  | 'reseeded-missing-conversation'
  | 'reseeded-replaced-store'
  | 'reseeded-ahead'
  | 'reseeded-behind'
  | 'reseeded-rewound'
  | 'unchanged';

export interface ReconcileOptions {
  extensions?: readonly Extension[];
  settings?: () => HarnessSettings;
  beforeReconcile?: (harness: Harness, storeId?: string) => Promise<void>;
  storeIdentity?: (harness: Harness) => Promise<string>;
  refreshFacts?: () => ReconcileFacts;
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

function isContentEntry(entry: EntryRecord): boolean {
  if (UserEntry.is(entry) || ToolResultEntry.is(entry)) return true;
  if (!AssistantEntry.is(entry)) return false;
  const message = entry.model?.[0];
  return !(message?.role === 'assistant' && message.stopReason === 'aborted');
}

async function hasContentBeyond(
  root: Conversation,
  after: number,
  context: Context,
): Promise<boolean> {
  const page = await root.entries(
    { minEntryId: (after + 1) as EntryId, order: 'ascending' },
    500,
    undefined,
    context,
  );
  return page.items.some(isContentEntry);
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
  let storeId = await options.storeIdentity?.(harness);
  if (facts.storeId == null && storeId !== undefined) facts.adoptStore?.(storeId);
  await options.beforeReconcile?.(harness, storeId);
  const refreshed = options.refreshFacts?.() ?? facts;
  facts =
    facts.forceReseed === true
      ? { ...refreshed, forceReseed: true, hasClaimedStep: false }
      : refreshed;
  const root = await harness.root(context);
  const rootNewest = await newestEntryId(root, context);
  const recorded =
    facts.conversationId === null || rootNewest === undefined
      ? root
      : await activeConversation(harness, facts.conversationId, context);
  const watermark = parseWatermark(facts.lastMirroredEntryId);
  let outcome: ReconcileOutcome = 'unchanged';
  let reseed: ReconcileOutcome | null = null;
  if (rootNewest === undefined) {
    reseed = 'seeded';
  } else if (storeId !== undefined && facts.storeId != null && facts.storeId !== storeId) {
    reseed = 'reseeded-replaced-store';
  } else if (facts.forceReseed === true) {
    reseed = 'reseeded-rewound';
  } else if (facts.conversationId === null) {
    outcome = 'adopted-store';
  } else if (recorded === undefined) {
    reseed = 'reseeded-missing-conversation';
  } else if (
    watermark?.kind === 'mirrored' &&
    ((await newestEntryId(recorded, context)) ?? 0) < watermark.entryId
  ) {
    reseed = 'reseeded-behind';
  } else if (
    watermark?.kind === 'mirrored' &&
    !facts.hasClaimedStep &&
    (await hasContentBeyond(recorded, watermark.entryId, context))
  ) {
    reseed = 'reseeded-ahead';
  }
  if (reseed !== null) {
    if (rootNewest !== undefined) {
      await harness.close(context);
      setAside(storagePath, `stale-${Date.now()}`);
      harness = await open();
      storeId = await options.storeIdentity?.(harness);
      await options.beforeReconcile?.(harness, storeId);
    }
    const seed = await facts.seed();
    await seedCoordinator(harness, seed.summary, seed.rows, seed.model, context);
    outcome = reseed;
  }
  const settled = await settleStaleSubmissions(harness, context, facts.isLive);
  const active = reseed === null && recorded !== undefined ? recorded : await harness.root(context);
  facts.record({
    ...(storeId === undefined ? {} : { storeId }),
    conversationId: String(active.id),
    piVersion: PI_VERSION,
    reseeded: reseed !== null && rootNewest !== undefined,
  });
  harness.resume();
  if (settled.placedStale && settled.adopted.length === 0) await active.abort(context);
  return { harness, outcome, stale: settled.aborted };
}
