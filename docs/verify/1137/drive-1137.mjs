// drive-1137: GitHub webhook receiver live evidence (#1137).
// Boots an in-process server via bootServer (same harness as webhook.test.ts,
// zero real outbound — githubFetch mocked), then drives real HTTP requests
// through the Hono app and dumps the three tracer legs:
//   request  = response JSON per scenario (created/duplicate/401/ignored)
//   persist  = SQLite rows: todo + webhook_token.lastUsedAt
//   dispatch = chief_thread + chief_message + step rows
// Evidence lands in docs/verify/1137/ (invoked from apps/server dir).

import { writeFileSync, mkdirSync } from 'node:fs';

process.env.NODE_ENV = 'test';
const repoRoot = new URL('../', import.meta.url).pathname;
const pathTo = (p) => new URL(p, import.meta.url).pathname;
const { bootServer, req } = await import('/home/measure/.pacman-chief/workspaces/01a12e1b-77aa-7417-9484-9ef8be0eb3fa/apps/server/test/helpers.js');
const { eq } = await import('drizzle-orm');
const schema = await import('/home/measure/.pacman-chief/workspaces/01a12e1b-77aa-7417-9484-9ef8be0eb3fa/apps/server/src/db/schema.js');
const { upsertGithubConnection } = await import('/home/measure/.pacman-chief/workspaces/01a12e1b-77aa-7417-9484-9ef8be0eb3fa/apps/server/src/services/github-connection.js');
const { createWebhookToken } = await import('/home/measure/.pacman-chief/workspaces/01a12e1b-77aa-7417-9484-9ef8be0eb3fa/apps/server/src/services/webhook-tokens.js');
const { hashCredential } = await import('/home/measure/.pacman-chief/workspaces/01a12e1b-77aa-7417-9484-9ef8be0eb3fa/apps/server/src/lib/hash.js');

const REPO = 'octo/alpha';
const ISSUE_PATH = `/repos/${REPO}/issues/7`;
const LABELS_PATH = `/repos/${REPO}/labels`;
const ISSUE_DETAIL = {
  number: 7,
  title: 'webhook live evidence issue',
  body: 'trigger label pacman auto task',
  state: 'open',
  labels: [{ name: 'pacman', color: '0075ca' }],
};
const LABELS_FULL = [{ name: 'pacman', color: '0075ca', description: null }];

const calls = [];
const ghFetch = async (input) => {
  const url = new URL(String(input));
  calls.push(url.pathname);
  const route = { [ISSUE_PATH]: ISSUE_DETAIL, [LABELS_PATH]: LABELS_FULL }[url.pathname];
  const status = route ? 200 : 404;
  return {
    ok: status === 200,
    status,
    headers: { get: () => null },
    json: async () => route ?? { message: 'Not Found' },
    text: async () => JSON.stringify(route ?? { message: 'Not Found' }),
  };
};

const s = bootServer({ githubFetch: ghFetch });
upsertGithubConnection(
  { db: s.db, box: s.secretBox },
  { teamId: s.team.id, login: 'octo', accessToken: 'ghp_live_evidence', scope: 'repo' },
);
const projRes = await req(s.app, 'POST', '/api/projects', {
  name: 'alpha',
  kind: 'github',
  githubRepo: REPO,
});
if (projRes.status !== 201) throw new Error(`project create: ${projRes.status}`);
const projectId = (await projRes.json()).id;
s.db
  .insert(schema.agent)
  .values({
    id: 'agent-live-1',
    teamId: s.team.id,
    displayName: 'agent-live-1',
    provider: 'stub-live',
    modelId: 'stub-model',
  })
  .run();
s.db
  .insert(schema.chief)
  .values({
    id: `chief-${s.user.id}-${s.team.id}`,
    userId: s.user.id,
    teamId: s.team.id,
    agentId: 'agent-live-1',
    charter: '',
    watches: [],
    wakes: [],
    createdAt: Date.now(),
  })
  .run();

const tokenRow = createWebhookToken({ db: s.db }, { teamId: s.team.id, name: 'live-evidence' });

function labeledPayload() {
  return {
    action: 'labeled',
    issue: { number: 7, title: ISSUE_DETAIL.title },
    label: { name: 'pacman' },
    repository: { full_name: REPO },
  };
}
async function deliver(token, headers = {}) {
  return s.app.request(`/api/webhook/github/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(labeledPayload()),
  });
}

const out = { checks: [], request: {}, persist: {}, dispatch: {} };
function check(label, ok, detail) {
  out.checks.push({ ok, label, detail: detail ?? null });
  if (!ok) process.exitCode = 1;
}

// request leg — full chain
const created = await deliver(tokenRow.plaintext, {
  'x-github-event': 'issues',
  'x-github-delivery': 'live-delivery-1',
});
const createdBody = await created.json();
out.request.created = { status: created.status, body: createdBody };
check('A1 created: 202 + result=created', created.status === 202 && createdBody.result === 'created');
check('A2 envelope has todoId/threadId', Boolean(createdBody.todoId && createdBody.threadId));

// request leg — duplicate within window
const dup = await deliver(tokenRow.plaintext, {
  'x-github-event': 'issues',
  'x-github-delivery': 'live-delivery-1',
});
const dupBody = await dup.json();
out.request.duplicate = { status: dup.status, body: dupBody };
check('B1 duplicate: 202 + result=duplicate', dup.status === 202 && dupBody.result === 'duplicate');

// request leg — wrong token
const wrong = await deliver('pacman_wrongtoken'.padEnd(64, 'x'));
out.request.wrongToken = { status: wrong.status, body: await wrong.json() };
check('E1 wrong token: 401', wrong.status === 401);

// request leg — non-issues event
const ping = await deliver(tokenRow.plaintext, { 'x-github-event': 'ping' });
const pingBody = await ping.json();
out.request.ping = { status: ping.status, body: pingBody };
check('C1 ping: 202 ignored', ping.status === 202 && pingBody.result === 'ignored');

// persist leg
const todoRows = s.db.select().from(schema.todo).all();
out.persist.todo = todoRows;
check('todo count = 1', todoRows.length === 1);
const t = todoRows[0];
check(
  'todo sourceKind/sourceRef',
  t?.sourceKind === 'github-issue' && t?.sourceRef === `github:${REPO}#7`,
);
const wtok = s.db.select().from(schema.webhookToken).all();
out.persist.webhookToken = wtok;
check('token row: hash only, lastUsedAt set', wtok[0]?.tokenHash === hashCredential(tokenRow.plaintext) && wtok[0]?.lastUsedAt !== null && !JSON.stringify(wtok).includes(tokenRow.plaintext));

// dispatch leg
const threadRows = s.db.select().from(schema.chiefThread).all();
out.dispatch.chiefThread = threadRows;
const msgRows = s.db.select().from(schema.chiefMessage).all();
out.dispatch.chiefMessage = msgRows;
const stepRows = s.db.select().from(schema.step).all();
out.dispatch.step = stepRows;
check('thread count = 1 (no double dispatch)', threadRows.length === 1);
const chiefMsg = msgRows.find((m) => m.threadId === threadRows[0]?.id);
check('chief first message embeds issue body', Boolean(chiefMsg?.content?.includes(ISSUE_DETAIL.body)));
check('chief step pending', stepRows.length === 1 && stepRows[0]?.kind === 'chief' && stepRows[0]?.status === 'pending');

// githubFetch routes actually hit (import chain real)
out.request.githubFetchCalls = calls;
check('github outbound: issue detail + labels mirror', calls.includes(ISSUE_PATH) && calls.includes(LABELS_PATH));

const outDir = process.argv[2] ?? '.';
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString();
writeFileSync(`${outDir}/result.json`, JSON.stringify({ probe: 'drive-1137', stamp, ...out }, null, 2));
s.dispose();
const failed = out.checks.filter((c) => !c.ok);
console.log(`drive-1137: ${out.checks.length - failed.length}/${out.checks.length} PASS${failed.length ? ` — FAILED: ${failed.map((f) => f.label).join('; ')}` : ''}`);
