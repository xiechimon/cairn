#!/usr/bin/env node

import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectOld = process.argv.includes('--expect=old');
const expectNew = process.argv.includes('--expect=new');
if (expectOld === expectNew) {
  console.error('需要 --expect=old 或 --expect=new');
  process.exit(2);
}

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT ? resolve(process.env.VERIFY_REPO_ROOT) : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');
const stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const API = `http://127.0.0.1:${stack.serverPort}`;
const HOME = stack.homeDir;
const SKILLS = join(HOME, 'skills');
const SERVER_DIR = join(HOME, 'server');
const SOURCES = join(SERVER_DIR, 'skill-sources.json');
const SKILL = 'orphan-1185';

const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `1185-import-rollback-${expectOld ? 'old' : 'new'}`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
const check = (ok, label, detail) => {
  if (typeof ok !== 'boolean') {
    throw new TypeError(`check ok must be boolean, got ${ok === null ? 'null' : typeof ok} (${label})`);
  }
  checks.push({ ok, label, detail: detail ?? null });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail != null ? `  — ${detail}` : ''}`);
};

const j = async (path, body, method = 'POST') => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
};

function clearSources() {
  rmSync(SOURCES, { recursive: true, force: true });
  for (const name of readdirSync(SERVER_DIR)) {
    if (name.startsWith('skill-sources.json.tmp-')) rmSync(join(SERVER_DIR, name), { force: true });
  }
}

function auditCreates() {
  const require = createRequire(join(ROOT, 'apps/server/package.json'));
  const Database = require('better-sqlite3');
  const db = new Database(join(SERVER_DIR, 'server.db'), { readonly: true });
  try {
    const row = db
      .prepare('select count(*) as n from skill_audit where skillId = ? and action = ?')
      .get(SKILL, 'create');
    return row.n;
  } finally {
    db.close();
  }
}

const src = join(RUN_DIR, 'import-src-1185', SKILL);
rmSync(join(SKILLS, SKILL), { recursive: true, force: true });
clearSources();
mkdirSync(src, { recursive: true });
writeFileSync(
  join(src, 'SKILL.md'),
  `---\nname: ${SKILL}\ndescription: import rollback repro\n---\n# ${SKILL}\n`,
);
mkdirSync(SOURCES);

const teams = (await j('/api/teams', undefined, 'GET')).body;
const teamId = teams[0].id;
const imported = await j(`/api/teams/${teamId}/skills/import`, { localPath: src });
const dirAfterFail = readdirSync(SKILLS).includes(SKILL);
const createsAfterFail = auditCreates();
const listedAfterFail = (await j(`/api/skills?teamId=${teamId}`, undefined, 'GET')).body.map((row) => row.id);

clearSources();
const refreshed = await j(`/api/teams/${teamId}/skills/${SKILL}/refresh`, {});
const reimported = await j(`/api/teams/${teamId}/skills/import`, { localPath: src });
let sourcesHasSkill = false;
try {
  const stored = JSON.parse(readFileSync(SOURCES, 'utf8'));
  sourcesHasSkill = stored.sources?.[SKILL]?.kind === 'localPath';
} catch {
  sourcesHasSkill = false;
}

const snapshot = {
  expect: expectOld ? 'old' : 'new',
  api: API,
  home: HOME,
  importStatus: imported.status,
  importBody: imported.body,
  dirAfterFail,
  createsAfterFail,
  listedAfterFail,
  refreshStatus: refreshed.status,
  refreshBody: refreshed.body,
  reimportStatus: reimported.status,
  reimportBody: reimported.body,
  sourcesHasSkill,
};
writeFileSync(join(EVIDENCE, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`);

if (expectOld) {
  check(imported.status === 500, 'import returns 500 when source registration cannot land', `${imported.status}`);
  check(dirAfterFail, 'skill directory remains after the failed registration');
  check(createsAfterFail === 1, 'create audit row remains', `creates=${createsAfterFail}`);
  check(listedAfterFail.includes(SKILL), 'skill is still listed');
  check(refreshed.status === 200, 'same process refresh still sees the unpersisted source', `${refreshed.status} ${refreshed.body?.error ?? ''}`);
  check(reimported.status === 409, 'same-name import is rejected', `${reimported.status} ${reimported.body?.error ?? ''}`);
} else {
  check(imported.status === 500, 'import returns 500 when source registration cannot land', `${imported.status}`);
  check(!dirAfterFail, 'skill directory is removed after the failed registration');
  check(createsAfterFail === 0, 'create audit row is removed', `creates=${createsAfterFail}`);
  check(!listedAfterFail.includes(SKILL), 'skill is not listed');
  check(refreshed.status === 404, 'refresh does not see a source for the rolled-back skill', `${refreshed.status} ${refreshed.body?.error ?? ''}`);
  check(reimported.status === 201, 'same-name import succeeds once registration can land', `${reimported.status} ${reimported.body?.error ?? ''}`);
  check(sourcesHasSkill, 'the successful retry wrote a source record');
}

const failures = checks.filter((c) => c.ok !== true).length;
const nonBoolean = checks.filter((c) => typeof c.ok !== 'boolean');
writeFileSync(
  join(EVIDENCE, 'result.json'),
  `${JSON.stringify({ probe: '1185-import-rollback', expect: expectOld ? 'old' : 'new', checks, stack: { API, HOME }, snapshot }, null, 2)}\n`,
);
console.log(`\n${checks.length - failures}/${checks.length}  evidence: ${EVIDENCE}`);
if (nonBoolean.length > 0) {
  console.error(`non-boolean ok: ${nonBoolean.map((c) => c.label).join('; ')}`);
  process.exit(1);
}
process.exit(failures === 0 ? 0 : 1);
