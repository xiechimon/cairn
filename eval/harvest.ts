import { writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactSecrets } from '@cairn/shared';
import { openExperimentClient } from '@cairn/shared/langfuse';
import BetterSqlite from 'better-sqlite3';
import { runtimeTask } from './harness/types.js';

const DB = join(
  homedir(),
  'Library',
  'Application Support',
  '@cairn',
  'desktop',
  'home',
  'server',
  'server.db',
);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.env.HARVEST_OUT ?? join(tmpdir(), 'harvest-items.jsonl'));
if (OUT === REPO_ROOT || OUT.startsWith(`${REPO_ROOT}${sep}`))
  throw new Error('harvest: HARVEST_OUT must stay outside the repository');
const DATASET = process.env.HARVEST_DATASET ?? 'cairn-eval-suite';
const LIMIT = Number(process.env.HARVEST_LIMIT ?? 60);

interface SnapshotRow {
  turnId: string;
  payload: string;
}

interface SnapshotPayload {
  claim?: {
    instruction?: string | null;
    projects?: { name?: string | null }[] | null;
  } | null;
  toolViews?: {
    callId?: string;
    tool?: string;
    params?: Record<string, unknown>;
    preCallTodos?: unknown[];
    result?: unknown;
  }[];
}

function items(): { id: string; input: Record<string, unknown>; expectedOutput: unknown }[] {
  if (!Number.isFinite(LIMIT) || LIMIT <= 0) return [];
  if (!process.env.HARVEST_DB) {
    console.warn(`harvest: set HARVEST_DB to a sealed snapshot db; default path is owner-local`);
  }
  const db = new BetterSqlite(process.env.HARVEST_DB ?? DB, { readonly: true });
  const stmt = db.prepare(
    `SELECT turnId, payload FROM coordinator_turn_snapshot WHERE status='sealed' AND json_valid(payload) AND json_type(payload, '$.claim') = 'object' ORDER BY capturedAt DESC`,
  );
  const out = [];
  for (const row of stmt.iterate() as IterableIterator<SnapshotRow>) {
    let payload: SnapshotPayload | null;
    try {
      payload = JSON.parse(row.payload) as SnapshotPayload | null;
    } catch {
      continue;
    }
    if (payload === null || typeof payload !== 'object') continue;
    const claim = payload.claim;
    if (claim === null || claim === undefined) continue;
    const rawRequest = claim.instruction;
    if (typeof rawRequest !== 'string' || rawRequest.length < 8 || rawRequest.length > 4000)
      continue;
    const request = String(redactSecrets(rawRequest).value);
    const projects = (claim.projects ?? [])
      .map((p) => p.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .map((n) => String(redactSecrets(n).value))
      .slice(0, 6);
    const script = [{ text: '(harvested: scripted responses must be reviewed before activation)' }];
    const candidate = {
      kind: 'runtime',
      id: `harvest-${row.turnId
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .slice(0, 24)}`,
      request,
      world: { projects },
      script,
      expected: { decision: 'any' },
      gate: false,
    };
    const parsed = runtimeTask.safeParse(candidate);
    if (!parsed.success) continue;
    out.push({ id: parsed.data.id, input: parsed.data, expectedOutput: parsed.data.expected });
    if (out.length >= LIMIT) break;
  }
  return out;
}

async function main() {
  const list = items();
  writeFileSync(OUT, `${list.map((i) => JSON.stringify(i)).join('\n')}\n`);
  console.log(
    `harvest: ${list.length} candidate items -> ${OUT} (gate=false; review before enabling)`,
  );
  if (process.env.HARVEST_UPLOAD !== '1') return;
  const experiment = openExperimentClient({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? '',
    secretKey: process.env.LANGFUSE_SECRET_KEY ?? '',
    baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
  });
  const api = experiment.client.api;
  await api.datasets.create({ name: DATASET, description: 'cairn eval suite harvested turns' });
  for (const item of list) {
    await api.datasetItems.create({
      datasetName: DATASET,
      input: item.input,
      expectedOutput: item.expectedOutput,
      metadata: { harvested: true, gate: false },
    });
  }
  await experiment.close();
  console.log(`harvest: uploaded ${list.length} items to dataset ${DATASET}`);
}

await main();
