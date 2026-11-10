import assert from 'node:assert/strict';
import { closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from '../../../apps/server/node_modules/better-sqlite3/lib/index.js';
import { Client } from '../../../apps/daemon/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../../../apps/daemon/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import { InMemoryTransport } from '../../../apps/daemon/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { buildHostTools, createHostMcpServer } from '../../../apps/daemon/src/backend/claude-code.js';
import { CHIEF_REMOTE_TOOLS } from '../../../packages/shared/src/protocol/chief-tools.js';
import { runOwned, spawnOwned } from '../../../scripts/owned-process.mjs';

const root = process.cwd();
const scratch = process.env.CAIRN_TEST_TEMP_ROOT;
assert(scratch, 'Set an isolated CAIRN_TEST_TEMP_ROOT');
const phase = process.argv[2];
assert(['before', 'after'].includes(phase));
const before = phase === 'before';
const evidence = join(scratch, `assignment-live-${phase}`);
const home = join(scratch, `assignment-home-${phase}-${Date.now()}`);
mkdirSync(evidence, { recursive: true });
mkdirSync(home, { recursive: true });
const port = process.env.ASSIGNMENT_PROBE_PORT ?? '18798';
const base = `http://127.0.0.1:${port}`;
const fd = openSync(join(scratch, `assignment-${phase}.log`), 'w');
const env = Object.fromEntries(['PATH', 'HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS'].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
const server = spawnOwned(process.execPath, [join(root, 'apps/server/node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], { cwd: join(root, 'apps/server'), env: { ...env, NODE_ENV: 'production', PORT: port, HOST: '127.0.0.1', CAIRN_HOME: home, CAIRN_AUTH: 'off', CAIRN_COORDINATOR_IN_SERVER: '0', CAIRN_SKILLS_DIR: join(home, 'skills'), CAIRN_MCP_CONFIG: join(home, 'absent-mcp.json') }, stdio: ['ignore', fd, fd], name: `assignment-${phase}` });
async function request<T = Record<string, unknown>>(method: string, path: string, expected: number, body?: unknown, credential?: string): Promise<T> {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(credential ? { authorization: `Bearer ${credential}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.status, expected, `${method} ${path}`);
  return response.json() as Promise<T>;
}
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${base}/api/auth/session`)).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert(ready, 'Server readiness timed out');
  const db = new Database(join(home, 'server/server.db'));
  try {
    const user = db.prepare('SELECT id FROM user LIMIT 1').get() as { id: string };
    assert.equal((await request('GET', '/api/user/me', 200)).id, user.id, 'Drive only the scratch database server');
    const project = await request<{ id: string; teamId: string }>('POST', '/api/projects', 201, { name: 'Assignment probe' });
    const spec = 'Keep these owner words.';
    const cited = JSON.stringify({ segments: [{ source: { kind: 'edit', userId: user.id, at: 1, span: 'whole' }, author: 'owner', sourceRef: null, text: spec }], siblings: [], difficulty: null, titleSource: 'owner', titleSourceRef: null });
    db.prepare('INSERT INTO tag (id,projectId,name,color,createdAt,v) VALUES (?,?,?,?,?,?)').run('legacy-category', project.id, 'CoRrEcTiOn', '#123456', 17, 3);
    for (const [id, request] of [['legacy-task', null], ['cited-task', cited]]) {
      db.prepare('INSERT INTO todo (id,teamId,projectId,title,spec,phaseAt,seqNum,correctionRequired,request,createdBy,ownerId) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, project.teamId, project.id, 'Original title', spec, 1, id === 'legacy-task' ? 1 : 2, 1, request, user.id, user.id);
      db.prepare('INSERT INTO todo_tag (todoId,tagId) VALUES (?,?)').run(id, 'legacy-category');
    }
    db.prepare('INSERT INTO github_label (id,projectId,name,color,createdAt,v) VALUES (?,?,?,?,?,?)').run('retained-label', project.id, 'enhancement', '#abcdef', 23, 4);
    db.prepare('INSERT INTO todo_github_label (todoId,labelId) VALUES (?,?)').run('legacy-task', 'retained-label');
    db.prepare('INSERT INTO schedule (id,teamId,projectId,todoId,kind,tz,createdBy,at,nextRunAt) VALUES (?,?,?,?,?,?,?,?,?)').run('retained-schedule', project.teamId, project.id, 'legacy-task', 'daily', 'UTC', user.id, 1, Date.now() + 86_400_000);
    const state = () => JSON.stringify(Object.fromEntries(['todo', 'todo_tag', 'tag', 'todo_github_label', 'github_label', 'schedule', 'build'].map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])));
    const initial = state();
    const card = { steps: [
      { clause: before ? 'Before: category create allowed' : 'Category create retired', method: 'POST', path: `/api/projects/${project.id}/todos`, body: { title: 'Must not create', spec: 'No write expected after retirement.', tagIds: [] }, expectStatus: before ? 201 : 400, sql: 'SELECT title,correctionRequired,v FROM todo ORDER BY seqNum' },
      { clause: before ? 'Before: category replacement allowed' : 'Category replacement retired', method: 'PATCH', path: '/api/todos/legacy-task', body: { title: 'Must not stick', tagIds: [] }, expectStatus: before ? 200 : 400, sql: "SELECT title,correctionRequired,v FROM todo WHERE id='legacy-task'" },
    ] };
    const cardPath = join(scratch, `assignment-card-${phase}.json`);
    const runDir = join(scratch, `assignment-run-${phase}`);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(cardPath, JSON.stringify(card));
    writeFileSync(join(runDir, 'ports.json'), JSON.stringify({ serverPort: Number(port), homeDir: home }));
    assert.equal(await runOwned(process.execPath, [join(root, '.claude/skills/verify-cairn/scripts/api-evidence-card.mjs'), cardPath], { cwd: root, env: { ...process.env, VERIFY_REPO_ROOT: root, VERIFY_RUN_DIR: runDir, VERIFY_EVIDENCE_DIR: evidence }, name: 'assignment-api-card' }), 0);
    const result: Record<string, unknown> = { phase, surface: before ? 'isolated production src/index.ts and API evidence-card driver' : 'isolated production src/index.ts and actual SDK transports', provider: 'not exercised', github: 'not contacted', schemaMigration: 'none' };
    if (before) {
      result.observations = { oldCreateStatus: 201, oldReplacementStatus: 200, legacyMembershipAfterAllowedReplacement: 0, correctionAfterAllowedReplacement: 0 };
      assert.equal((db.prepare("SELECT count(*) AS n FROM todo_tag WHERE todoId='legacy-task'").get() as { n: number }).n, 0);
      assert.equal((db.prepare("SELECT correctionRequired FROM todo WHERE id='legacy-task'").get() as { correctionRequired: number }).correctionRequired, 0);
    } else {
      assert.equal(state(), initial);
      let restRejected = 0;
      for (const tagIds of [[], null, 'bug', ['retired']]) {
        await request('POST', `/api/projects/${project.id}/todos`, 400, { title: 'Must not create', spec, tagIds });
        await request('PATCH', '/api/todos/legacy-task', 400, { title: 'Must not stick', tagIds });
        restRejected += 2;
        assert.equal(state(), initial);
      }
      const key = await request<{ plaintext: string }>('POST', `/api/teams/${project.teamId}/api-keys`, 201, { name: 'MCP fixture', gitAccess: false, mcpAccess: true, toolGrants: { read: [], write: ['Create Todo', 'Update Todo'] } });
      const mcp = new Client({ name: 'assignment-probe', version: '1' });
      await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), { requestInit: { headers: { authorization: `Bearer ${key.plaintext}` } } }));
      let mcpRejected = 0;
      try {
        for (const name of ['create_todo', 'update_todo']) {
          assert(!Object.hasOwn((await mcp.listTools()).tools.find((tool) => tool.name === name)!.inputSchema.properties ?? {}, 'tagIds'));
          for (const tagIds of [[], null, 'bug', ['retired']]) {
            const args = name === 'create_todo' ? { projectId: project.id, title: 'Must not create', spec, tagIds } : { todoId: 'legacy-task', title: 'Must not stick', tagIds };
            const response = await mcp.callTool({ name, arguments: args });
            assert.equal(response.isError, true);
            assert(JSON.stringify(response.content).includes('tagIds'));
            assert.equal(state(), initial);
            mcpRejected++;
          }
        }
      } finally { await mcp.close(); }
      const bootstrap = await request<{ plaintext: string }>('POST', `/api/teams/${project.teamId}/api-keys`, 201, { name: 'Machine fixture', gitAccess: false, mcpAccess: false, machineAccess: true, toolGrants: { read: [], write: [] } });
      const machine = await request<{ machineId: string; token: string }>('POST', '/api/machine/enroll', 200, { teamId: project.teamId, name: 'assignment-fixture', cliVersion: '0.1.0' }, bootstrap.plaintext);
      const coordinator = await request<{ thread: { id: string } }>('GET', `/api/teams/${project.teamId}/coordinator`, 200);
      const now = Date.now();
      db.prepare('INSERT INTO step (id,buildId,kind,machineId,status,claimedAt,lastHeartbeatAt,createdAt) VALUES (?,?,?,?,?,?,?,?)').run('fixture-chief-step', coordinator.thread.id, 'chief', machine.machineId, 'claimed', now, now, now);
      let coordinatorHttpRejected = 0;
      for (const name of ['create_todo', 'update_todo']) {
        for (const tagIds of [[], null, 'bug', ['retired']]) {
          const params = name === 'create_todo' ? { projectId: project.id, sourceTodoId: 'legacy-task', tagIds } : { todoId: 'cited-task', title: 'Must not stick', tagIds };
          await request('POST', '/api/machine/tool/fixture-chief-step', 400, { name, params }, machine.token);
          assert.equal(state(), initial);
          coordinatorHttpRejected++;
        }
      }
      const sdkStatuses: number[] = [];
      const host = createHostMcpServer(buildHostTools({ remoteTools: CHIEF_REMOTE_TOOLS.filter(({ name }) => ['create_todo', 'update_todo'].includes(name)), localTools: [], relay: async (name, params) => {
        const response = await fetch(`${base}/api/machine/tool/fixture-chief-step`, { method: 'POST', headers: { authorization: `Bearer ${machine.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name, params }) });
        sdkStatuses.push(response.status);
        const body = await response.json() as { text?: string; error?: string };
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
        return body.text ?? '';
      } }));
      const client = new Client({ name: 'claude-host-probe', version: '1' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await host.instance.connect(serverTransport);
      await client.connect(clientTransport);
      try {
        for (const name of ['create_todo', 'update_todo']) {
          for (const tagIds of [[], null, 'bug', ['retired']]) {
            const args = name === 'create_todo' ? { projectId: project.id, sourceTodoId: 'legacy-task', tagIds } : { todoId: 'cited-task', title: 'Must not stick', tagIds };
            const response = await client.callTool({ name, arguments: args });
            assert.equal(response.isError, true);
            assert(JSON.stringify(response.content).includes('tagIds'));
            assert.equal(state(), initial);
          }
        }
        assert.deepEqual(sdkStatuses, Array(8).fill(400));
        assert.equal((await client.callTool({ name: 'update_todo', arguments: { todoId: 'cited-task', title: 'Coordinator summary' } })).isError ?? false, false);
      } finally { await client.close(); await host.instance.close(); }
      const valid = await request<{ id: string; title: string; spec: string }>('POST', `/api/projects/${project.id}/todos`, 201, { title: '', spec: 'First line\nKeep the body.', machineId: 'ignored-hint', unrelatedIgnoredField: true });
      assert.equal(valid.title, 'First line');
      assert.equal(valid.spec, 'First line\nKeep the body.');
      await request('PATCH', '/api/todos/legacy-task', 200, { title: 'Owner edit', machineId: 'ignored-hint', unrelatedIgnoredField: true });
      await request('PATCH', '/api/todos/legacy-task', 409, { phase: 'done' });
      for (const id of ['legacy-task', 'cited-task']) {
        const task = db.prepare('SELECT spec,correctionRequired,request FROM todo WHERE id=?').get(id) as { spec: string; correctionRequired: number; request: string | null };
        assert.equal(task.spec, spec);
        assert.equal(task.correctionRequired, 1);
        assert.equal((db.prepare('SELECT count(*) AS n FROM todo_tag WHERE todoId=?').get(id) as { n: number }).n, 1);
      }
      assert.equal((db.prepare("SELECT title FROM todo WHERE id='cited-task'").get() as { title: string }).title, 'Coordinator summary');
      assert.deepEqual(JSON.parse((db.prepare("SELECT request FROM todo WHERE id='cited-task'").get() as { request: string }).request), { ...JSON.parse(cited), titleSource: 'coordinator' });
      assert.equal((await request('GET', '/api/todos/legacy-task', 200)).correctionRequired, undefined);
      assert.equal((db.prepare("SELECT count(*) AS n FROM todo_github_label WHERE todoId='legacy-task'").get() as { n: number }).n, 1);
      result.auth = 'owner auth off on loopback; real MCP API key and enrolled machine token; claimed Coordinator step is a direct fixture';
      result.observations = { restRejected, mcpRejected, coordinatorHttpRejected, coordinatorSdkRejected: 8, sdkStatuses, taskAndAssociationStateUnchangedOnEveryRejection: true, validCreateStatus: 201, validOwnerEditStatus: 200, validCoordinatorSummaryStatus: 200, ownerWordsAndClassificationPreserved: true, dedicatedLabelPreserved: true, correctionCompletionStatus: 409 };
    }
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    result.foreignKeyViolations = 0;
    writeFileSync(join(evidence, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Assignment ${phase}: verified; no real model, Claude CLI or GitHub invoked.`);
  } finally { db.close(); }
} finally { await server.stop(); closeSync(fd); }
