#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { requestsRow, requestsTable } from './api-card-table.mjs';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT ? resolve(process.env.VERIFY_REPO_ROOT) : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');

const args = process.argv.slice(2);
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const specPath = args.find((arg, at) => !arg.startsWith('--') && args[at - 1] !== '--before-port');
if (specPath === undefined) {
  console.error('usage: api-evidence-card.mjs <spec.json> [--before-port <port>]');
  process.exit(2);
}
const spec = JSON.parse(readFileSync(resolve(specPath), 'utf8'));
const beforePort = flagValue('--before-port');

let stack;
try {
  stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
} catch {
  console.error(`no stack: ${join(RUN_DIR, 'ports.json')} is missing. Run vp.mjs launch first.`);
  process.exit(1);
}
const stackBase = `http://127.0.0.1:${stack.serverPort}`;
const beforeBase = beforePort === undefined ? undefined : `http://127.0.0.1:${beforePort}`;
const DB_PATH = join(stack.homeDir, 'server', 'server.db');
const EVIDENCE = process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_ROOT, '.claude', 'verify-evidence', `api-card-${Date.now()}`);
mkdirSync(EVIDENCE, { recursive: true });

const Database = createRequire(join(ROOT, 'apps', 'server', 'package.json'))('better-sqlite3');
const rowsOf = (sql) => {
  if (sql === undefined) return undefined;
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db.prepare(sql).all();
  } catch (err) {
    return String(err.message).startsWith('no such table') ? null : Promise.reject(err);
  } finally {
    db.close();
  }
};
const describeRows = (before, after) => {
  if (before === undefined) return 'n/a';
  const count = (rows) => (rows === null ? 'table absent' : `${rows.length}`);
  const last = Array.isArray(after) && after.length > 0 ? ` (${JSON.stringify(after[0]).slice(0, 90)})` : '';
  return `${count(before)} to ${count(after)}${last}`;
};

const teamIds = new Map();
const teamOf = async (base) => {
  if (!teamIds.has(base)) teamIds.set(base, (await (await fetch(`${base}/api/teams`)).json())[0]?.id);
  return teamIds.get(base);
};

const transcript = [];
const tableRows = [];
const live = [];
let failures = 0;

for (const [index, step] of spec.steps.entries()) {
  const base = step.on === 'before' ? beforeBase : stackBase;
  if (base === undefined) {
    console.log(`SKIP  ${step.clause}: no --before-port stack`);
    continue;
  }
  const path = step.path.replaceAll('{team}', await teamOf(base));
  const method = step.method ?? 'GET';
  const body = step.body === undefined ? undefined : JSON.stringify(step.body);
  const before = step.on === 'before' ? undefined : rowsOf(step.sql);
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  const after = step.on === 'before' ? undefined : rowsOf(step.sql);
  const rows = step.on === 'before' ? (step.sql === undefined ? 'n/a' : 'other stack') : describeRows(before, after);
  const ok = step.expectStatus === undefined ? '-' : res.status === step.expectStatus ? 'yes' : 'NO';
  if (ok === 'NO') failures += 1;
  transcript.push(
    `$ curl -s -X ${method} '${base}${path}'${body === undefined ? '' : ` -H 'content-type: application/json' -d '${body}'`}`,
    `HTTP ${res.status}`,
    text,
    ...(step.sql === undefined || step.on === 'before' ? [] : [`rows before: ${JSON.stringify(before)}`, `rows after:  ${JSON.stringify(after)}`]),
    '',
  );
  tableRows.push(requestsRow({ clause: step.clause, method, path: step.path, body, status: res.status, responseText: text, rows, ok }));
  console.log(`${ok === 'NO' ? 'FAIL' : 'PASS'}  ${step.clause}: ${method} ${path} -> ${res.status}${step.expectStatus === undefined ? '' : ` (expected ${step.expectStatus})`}`);
  if (step.shot === true && method === 'GET') live.push({ index, url: `${base}${path}` });
}

const transcriptPath = join(EVIDENCE, 'calls.txt');
writeFileSync(transcriptPath, `${transcript.join('\n')}\n`);
writeFileSync(join(EVIDENCE, 'card-requests.md'), `### Requests\n\n![Request and response](calls.png)\n\n${requestsTable(tableRows)}\n`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(pathToFileURL(transcriptPath).href);
  await page.screenshot({ path: join(EVIDENCE, 'calls.png'), fullPage: true });
  console.log('shot  calls.png');
  for (const { index, url } of live) {
    await page.goto(url);
    const name = `get-${String(index + 1).padStart(2, '0')}.png`;
    await page.screenshot({ path: join(EVIDENCE, name), fullPage: true });
    console.log(`shot  ${name}`);
  }
} finally {
  await browser.close();
}

console.log(`vp: card ${join(EVIDENCE, 'card-requests.md')}`);
process.exit(failures === 0 ? 0 : 1);
