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
  isLive(requestId: string): boolean;
  seed(): ReconcileSeed;
  record(state: { conversationId: string; piVersion: string; reseeded: boolean }): void;
}

export type ReconcileOutcome =
  | 'seeded'
  | 'adopted-store'
  | 'reseeded-missing-conversation'
  | 'reseeded-ahead'
  | 'reseeded-behind'
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

function isContentEntry(entry: EntryRecord): boolean {
  if (UserEntry.is(entry) || ToolResultEntry.is(entry)) return true;
  if (!AssistantEntry.is(entry)) return false;
  const message = entry.model?.[0];
  return !(message?.role === 'assistant' && message.stopReason === 'aborted');
}

async function hasContentBeyond(
  root: Awaited<ReturnType<Harness['root']>>,
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

async function newestEntryId(harness: Harness, context: Context): Promise<number | undefined> {
  const root = await harness.root(context);
  const newest = (await root.entries({}, 1, undefined, context)).items[0]?.id;
  return newest === undefined ? undefined : Number(newest);
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
  const newest = await newestEntryId(harness, context);
  const root = await harness.root(context);
  let outcome: ReconcileOutcome = 'unchanged';
  let reseed: ReconcileOutcome | null = null;
  if (newest === undefined) {
    reseed = 'seeded';
  } else if (facts.conversationId === null) {
    outcome = 'adopted-store';
  } else if (facts.conversationId !== String(root.id)) {
    reseed = 'reseeded-missing-conversation';
  } else if (facts.lastMirroredEntryId !== null && newest < Number(facts.lastMirroredEntryId)) {
    reseed = 'reseeded-behind';
  } else if (
    facts.lastMirroredEntryId !== null &&
    !facts.hasClaimedStep &&
    (await hasContentBeyond(root, Number(facts.lastMirroredEntryId), context))
  ) {
    reseed = 'reseeded-ahead';
  }
  if (reseed !== null) {
    if (newest !== undefined) {
      await harness.close(context);
      setAside(storagePath, `stale-${Date.now()}`);
      harness = await open();
    }
    const seed = facts.seed();
    await seedCoordinator(harness, seed.summary, seed.rows, seed.model, context);
    outcome = reseed;
  }
  const settled = await settleStaleSubmissions(harness, context, facts.isLive);
  facts.record({
    conversationId: String((await harness.root(context)).id),
    piVersion: PI_VERSION,
    reseeded: reseed !== null && newest !== undefined,
  });
  harness.resume();
  if (settled.placedStale && settled.adopted.length === 0) {
    await (await harness.root(context)).abort(context);
  }
  return { harness, outcome, stale: settled.aborted };
}
