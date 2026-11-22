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

interface Claim {
  request?: { text?: string };
  projects?: { name?: string }[];
  toolCalls?: { name?: string; arguments?: Record<string, unknown> }[];
}

function items(): { id: string; input: Record<string, unknown>; expectedOutput: unknown }[] {
  if (!process.env.HARVEST_DB) {
    console.warn(`harvest: set HARVEST_DB to a sealed snapshot db; default path is owner-local`);
  }
  const db = new BetterSqlite(process.env.HARVEST_DB ?? DB, { readonly: true });
  const rows = db
    .prepare(
      `SELECT turnId, payload FROM coordinator_turn_snapshot WHERE status='sealed' ORDER BY capturedAt DESC LIMIT ?`,
    )
    .all(LIMIT) as SnapshotRow[];
  const out = [];
  for (const row of rows) {
    let claim: Claim;
    try {
      claim = JSON.parse(row.payload) as Claim;
    } catch {
      continue;
    }
    const rawRequest = claim.request?.text;
    if (rawRequest === undefined || rawRequest.length < 8 || rawRequest.length > 4000) continue;
    const request = String(redactSecrets(rawRequest).value);
    const projects = (claim.projects ?? [])
      .map((p) => p.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .map((n) => String(redactSecrets(n).value))
      .slice(0, 6);
    const script = [{ text: '(harvested: scripted responses must be reviewed before activation)' }];
    const candidate = {
      kind: 'runtime',
      id: `harvest-${row.turnId.slice(0, 12)}`,
      request,
      world: { projects },
      script,
      expected: { decision: 'any' },
      gate: false,
    };
    const parsed = runtimeTask.safeParse(candidate);
    if (!parsed.success) continue;
    out.push({ id: parsed.data.id, input: parsed.data, expectedOutput: parsed.data.expected });
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
