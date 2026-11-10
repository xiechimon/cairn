import assert from 'node:assert/strict';
import { closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from '../../../apps/server/node_modules/better-sqlite3/lib/index.js';
import { spawnOwned, runOwned } from '../../../scripts/owned-process.mjs';

const root = process.cwd();
const scratch = process.env.CAIRN_TEST_TEMP_ROOT;
assert(scratch, 'Set CAIRN_TEST_TEMP_ROOT to an isolated scratch directory');
const phase = process.argv[2];
assert(['before', 'after'].includes(phase));
const before = phase === 'before';
const evidence = join(scratch, `vocabulary-live-${phase}`);
const home = join(scratch, `vocabulary-home-${phase}-${Date.now()}`);
mkdirSync(evidence, { recursive: true });
mkdirSync(home, { recursive: true });
const port = process.env.VOCABULARY_PROBE_PORT ?? '18797';
const base = `http://127.0.0.1:${port}`;
const dbPath = join(home, 'server/server.db');
const fd = openSync(join(scratch, `vocabulary-${phase}.log`), 'w');
const env = Object.fromEntries(['PATH', 'HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS'].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
function start() {
  return spawnOwned(process.execPath, [join(root, 'apps/server/node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
    cwd: join(root, 'apps/server'), env: { ...env, NODE_ENV: 'production', PORT: port, HOST: '127.0.0.1', CAIRN_HOME: home, CAIRN_AUTH: 'off', CAIRN_COORDINATOR_IN_SERVER: '0', CAIRN_SKILLS_DIR: join(home, 'skills'), CAIRN_MCP_CONFIG: join(home, 'absent-mcp.json') }, stdio: ['ignore', fd, fd], name: `vocabulary-${phase}`,
  });
}
async function ready() {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${base}/api/auth/session`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Server readiness timed out');
}
async function request(method: string, path: string, expected: number, body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  assert.equal(response.status, expected, `${method} ${path}`);
  return response.json() as Promise<Record<string, unknown>>;
}
let server = start();
try {
  await ready();
  const db = new Database(dbPath);
  const localUser = db.prepare('SELECT id FROM user LIMIT 1').get() as { id: string };
  assert.equal((await request('GET', '/api/user/me', 200)).id, localUser.id, 'Only drive the server belonging to this scratch database');
  const project = await request('POST', '/api/projects', 201, { name: 'Vocabulary probe' });
  const freshCount = (db.prepare('SELECT count(*) AS n FROM tag WHERE projectId=?').get(project.id) as { n: number }).n;
  assert.equal(freshCount, before ? 6 : 0);
  const spec = { steps: [
    { clause: before ? 'Before: vocabulary route' : 'Vocabulary read retired', method: 'GET', path: `/api/projects/${project.id}/tags`, expectStatus: before ? 200 : 404, sql: 'SELECT name,color,v FROM tag ORDER BY name' },
    { clause: before ? 'Before: category creation' : 'Vocabulary write retired', method: 'POST', path: `/api/projects/${project.id}/tags`, body: { name: 'obsolete', color: '#112233' }, expectStatus: before ? 201 : 404, sql: 'SELECT name,color,v FROM tag ORDER BY name' },
    { clause: before ? 'Before: automatic project seeds' : 'Project creation without category seeds', method: 'POST', path: '/api/projects', body: { name: 'Another vocabulary probe' }, expectStatus: 201, sql: 'SELECT name,color,v FROM tag ORDER BY name' },
  ] };
  const specPath = join(scratch, `vocabulary-spec-${phase}.json`);
  const runDir = join(scratch, `vocabulary-run-${phase}`);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(specPath, JSON.stringify(spec));
  writeFileSync(join(runDir, 'ports.json'), JSON.stringify({ serverPort: Number(port), homeDir: home }));
  assert.equal(await runOwned(process.execPath, [join(root, '.claude/skills/verify-cairn/scripts/api-evidence-card.mjs'), specPath], { cwd: root, env: { ...process.env, VERIFY_REPO_ROOT: root, VERIFY_RUN_DIR: runDir, VERIFY_EVIDENCE_DIR: evidence }, name: 'vocabulary-api-card' }), 0);
  db.prepare('DELETE FROM tag WHERE projectId=?').run(project.id);
  db.prepare('INSERT INTO tag (id,projectId,name,color,createdAt,v) VALUES (?,?,?,?,?,?)').run('legacy-correction', project.id, 'CoRrEcTiOn', '#123456', 17, 3);
  db.prepare('INSERT INTO todo (id,teamId,projectId,title,spec,phaseAt,seqNum,correctionRequired) SELECT ?,teamId,id,?,?,?,?,? FROM project WHERE id=?').run('legacy-task', 'Existing correction task', 'Keep these owner words.', 1, 1, 1, project.id);
  db.prepare('INSERT INTO todo_tag (todoId,tagId) VALUES (?,?)').run('legacy-task', 'legacy-correction');
  const task = db.prepare('SELECT * FROM todo WHERE id=?').get('legacy-task');
  const category = db.prepare('SELECT * FROM tag WHERE id=?').get('legacy-correction');
  const links = db.prepare('SELECT * FROM todo_tag WHERE todoId=?').all('legacy-task');
  db.close();
  await server.stop();
  server = start();
  await ready();
  const restarted = new Database(dbPath, { readonly: true });
  try {
    const restartCount = (restarted.prepare('SELECT count(*) AS n FROM tag WHERE projectId=?').get(project.id) as { n: number }).n;
    assert.equal(restartCount, before ? 7 : 1);
    assert.deepEqual(restarted.prepare('SELECT * FROM todo WHERE id=?').get('legacy-task'), task);
    assert.deepEqual(restarted.prepare('SELECT * FROM tag WHERE id=?').get('legacy-correction'), category);
    assert.deepEqual(restarted.prepare('SELECT * FROM todo_tag WHERE todoId=?').all('legacy-task'), links);
    assert.deepEqual(restarted.pragma('foreign_key_check'), []);
    await request('PATCH', '/api/todos/legacy-task', 409, { phase: 'done' });
    writeFileSync(join(evidence, 'result.json'), `${JSON.stringify({ phase, surface: 'isolated production server entry point, API evidence-card driver and SQLite restart observations', ownerAuth: 'off on loopback', provider: 'not exercised', github: 'not contacted', observations: { freshCategoryCount: freshCount, restartCategoryCount: restartCount, legacyTaskPreserved: true, exactLegacyCategoryPreserved: true, legacyAssociationPreserved: true, correctionDoneStatus: 409, foreignKeyViolations: 0 } }, null, 2)}\n`);
  } finally { restarted.close(); }
  console.log(`Vocabulary ${phase}: fresh=${freshCount}, restart=${before ? 7 : 1}; legacy task, category and links exact; correction completion=409; FK clean.`);
} finally { await server.stop(); closeSync(fd); }
