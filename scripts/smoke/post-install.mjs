import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, _electron as electron } from '@playwright/test';
import { mainWindow } from '../../apps/desktop/scripts/main-window.mjs';
import { LOBEHUB_MONO } from '../../apps/web/src/icons/lobehub-mono.ts';

const DEFAULT_BASE = 'http://127.0.0.1:54400';
const DEFAULT_USER_DATA = join(homedir(), 'Library', 'Application Support', '@cairn', 'desktop');
const LAUNCH_TIMEOUT_MS = 120_000;
const SERVER_WAIT_MS = 90_000;
const UI_WAIT_MS = 20_000;
const RUNNER_DEADLINE_MS = 60_000;
const POLL_MS = 2_000;

const STRINGS = {
  zh: {
    settings: '设置',
    closeSettings: '关闭设置',
    copyImage: '拷贝图像',
    saveImage: '将图像存储为…',
    copyLink: '拷贝链接',
    paste: '粘贴',
    copy: '拷贝',
    lookUp: '查询“',
    start: '开始',
    handedToCoordinator: (title) => `已交给 Coordinator：${title}`,
    handedToastTitle: '已交给 Coordinator 编排',
    unknownVersion: '未知版本',
    devVersion: '开发版',
  },
  en: {
    settings: 'Settings',
    closeSettings: 'Close settings',
    copyImage: 'Copy Image',
    saveImage: 'Save Image As…',
    copyLink: 'Copy Link',
    paste: 'Paste',
    copy: 'Copy',
    lookUp: 'Look Up “',
    start: 'Start',
    handedToCoordinator: (title) => `Handed to the Coordinator: ${title}`,
    handedToastTitle: 'Handed to the Coordinator',
    unknownVersion: 'Unknown version',
    devVersion: 'Dev',
  },
};

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36 CairnDesktop/mac';

export const TRAFFIC_LIGHT_ZONE = { x: 0, y: 0, width: 80, height: 32 };

export function overlapsTrafficLights(box) {
  return (
    box.x < TRAFFIC_LIGHT_ZONE.x + TRAFFIC_LIGHT_ZONE.width &&
    box.x + box.width > TRAFFIC_LIGHT_ZONE.x &&
    box.y < TRAFFIC_LIGHT_ZONE.y + TRAFFIC_LIGHT_ZONE.height &&
    box.y + box.height > TRAFFIC_LIGHT_ZONE.y
  );
}

export function formatExpectedServerVersion(version, commit, lang = 'en') {
  const shortCommit = commit === null ? null : commit.slice(0, 7);
  const copy = STRINGS[lang] ?? STRINGS.en;
  if (version === null) {
    return shortCommit === null ? copy.unknownVersion : `${copy.devVersion} · ${shortCommit}`;
  }
  return shortCommit === null ? version : `${version} · ${shortCommit}`;
}

export function buildStartTaskSeedPrompt(todo) {
  return (
    `开始任务 #${todo.seqNum}\n\n` +
    `编排请求：[#${todo.seqNum}](todo:${todo.id}) —— 直接规划，并按活的类型派发执行。\n\n` +
    `任务原文：\n> ${todo.spec}`
  );
}

export const SWE2 = {
  name: 'SWE-2',
  vendor: 'Devin',
  iconPath: LOBEHUB_MONO.devin.paths[0],
  levels: ['Default (High)', 'Medium', 'High', 'Max'],
};
export const CLAUDE = {
  name: 'Claude Sonnet 5.5',
  vendor: 'Claude Code',
  iconPath: LOBEHUB_MONO.claude.paths[0],
  levels: ['Default (Medium)', 'Low', 'Medium', 'High', 'Xhigh', 'Max'],
};

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TXT_BODY = 'post-install smoke attachment body\nsecond line of the file\n';

const SMOKE_LABEL = 'post-install-smoke';
const IMAGE_NAMES = ['smoke.png', 'second.png'];
const MESSAGE_TEXT = (pngKeys, txtKey) =>
  'Release notes draft — see [the spec](https://example.com/release-notes) for details.\n' +
  pngKeys.map((key, index) => `![${IMAGE_NAMES[index]}](attachment:${key})\n`).join('') +
  `![notes.txt](attachment:${txtKey})`;

export function parseArgs(argv) {
  const args = {
    app: null,
    prevApp: null,
    base: DEFAULT_BASE,
    userData: null,
    token: null,
    evidence: null,
    checks: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--app') args.app = argv[++i];
    else if (arg === '--prev-app') args.prevApp = argv[++i];
    else if (arg === '--base') args.base = argv[++i];
    else if (arg === '--user-data') args.userData = argv[++i];
    else if (arg === '--token') args.token = argv[++i];
    else if (arg === '--evidence') args.evidence = argv[++i];
    else if (arg === '--checks') {
      const raw = argv[++i] ?? '';
      const ids = raw
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      if (ids.length === 0) throw new Error('--checks requires at least one check id');
      const known = new Set(CHECKS.map((check) => check.id));
      for (const id of ids) {
        if (!known.has(id)) throw new Error(`unknown check: ${id}`);
      }
      args.checks = ids;
    } else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.app === null && args.userData === null) args.userData = DEFAULT_USER_DATA;
  return args;
}

async function waitForFile(path, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await delay(250);
  }
  throw new Error(`timed out waiting for ${label ?? path}`);
}

function readOwnerToken(userData) {
  const text = readFileSync(join(userData, 'home', 'token'), 'utf8');
  const token = /^CAIRN_TOKEN=(\S+)/m.exec(text)?.[1];
  if (!token) throw new Error(`no CAIRN_TOKEN in ${userData}/home/token`);
  return token;
}

async function api(ctx, method, path, body, token = ctx.token) {
  const res = await fetch(`${ctx.base}${path}`, {
    method,
    signal: AbortSignal.timeout(30_000),
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      authorization: `Bearer ${token}`,
      'sec-fetch-site': 'same-origin',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text === '' ? null : JSON.parse(text);
}

async function windowApi(ctx, method, path, body) {
  await ctx.page.waitForLoadState('load');
  const result = await ctx.page.evaluate(
    async (request) => {
      const res = await fetch(request.path, {
        method: request.method,
        headers: request.body === undefined ? {} : { 'content-type': 'application/json' },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      });
      return { ok: res.ok, status: res.status, text: await res.text() };
    },
    { method, path, body },
  );
  if (!result.ok) {
    throw new Error(`${method} ${path} from the app window -> ${result.status}: ${result.text}`);
  }
  return result.text === '' ? null : JSON.parse(result.text);
}

const SEEDED_MODELS = [
  { provider: 'devin', modelId: 'swe-2-high', thinkingLevel: null },
  { provider: 'claude-code', modelId: 'claude-sonnet-5-5', thinkingLevel: null },
];

async function seedModelSources(ctx) {
  const created = await windowApi(ctx, 'POST', `/api/teams/${ctx.teamId}/devin-subscriptions`, {
    label: SMOKE_LABEL,
    token: 'post-install-smoke-devin-token',
  });
  await windowApi(ctx, 'PATCH', `/api/teams/${ctx.teamId}/devin-subscriptions/${created.id}`, {
    models: [
      {
        id: 'swe-2-high',
        name: 'SWE-2',
        thinkingLevels: ['medium', 'high', 'max'],
        thinkingDefault: 'high',
      },
    ],
  });
  const started = await api(ctx, 'POST', '/api/machine/enroll/start', { name: SMOKE_LABEL });
  const confirmed = await windowApi(ctx, 'POST', '/api/machine/enroll/confirm', {
    enrollId: started.enrollId,
  });
  const machine = confirmed.machine ?? confirmed;
  await api(
    ctx,
    'POST',
    '/api/machine/presence',
    {
      hostname: SMOKE_LABEL,
      capabilities: { mcpServers: [], skills: [], devin: { installed: false } },
      claudeCode: {
        installed: true,
        hostname: SMOKE_LABEL,
        models: [
          {
            id: 'claude-sonnet-5-5',
            name: 'Claude Sonnet 5.5',
            thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
            thinkingDefault: 'medium',
          },
        ],
      },
    },
    machine.token,
  );
  await windowApi(ctx, 'PUT', `/api/teams/${ctx.teamId}/top-models`, { models: SEEDED_MODELS });
}

async function ensureProject(ctx) {
  const projects = await api(ctx, 'GET', '/api/projects');
  const live = (projects.projects ?? projects).filter((p) => p.archivedAt == null);
  if (live.length > 0) return;
  const created = await windowApi(ctx, 'POST', '/api/projects', {
    name: 'post-install-smoke',
    localPath: ctx.userData,
  });
  ctx.cleanup.push(async () => {
    await windowApi(ctx, 'DELETE', `/api/projects/${created.id}`).catch(() => {});
  });
}

async function seedTopModels(ctx) {
  const before = await api(ctx, 'GET', `/api/teams/${ctx.teamId}/top-models`);
  const existing = before?.models ?? [];
  const merged = [...existing];
  for (const row of SEEDED_MODELS) {
    if (!merged.some((m) => m.provider === row.provider && m.modelId === row.modelId)) {
      merged.push(row);
    }
  }
  if (merged.length === existing.length) return;
  await windowApi(ctx, 'PUT', `/api/teams/${ctx.teamId}/top-models`, { models: merged });
  ctx.cleanup.push(async () => {
    await windowApi(ctx, 'PUT', `/api/teams/${ctx.teamId}/top-models`, {
      models: existing,
    }).catch(() => {});
  });
}

async function seedTsnet(userData) {
  const dir = join(userData, 'home', 'server');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'tsnet-remote.json'), JSON.stringify({ enabled: true }));
}

async function uploadAttachment(ctx, fileName, mimeType, bytes) {
  const grant = await windowApi(ctx, 'POST', '/api/uploads/grant', {
    kind: 'attachment',
    fileName,
    mimeType,
    size: bytes.byteLength,
    scope: 'message',
  });
  const uploaded = await ctx.page.evaluate(
    async (request) => {
      const form = new FormData();
      form.set('grant', request.grant);
      const bytes = Uint8Array.from(atob(request.b64), (ch) => ch.charCodeAt(0));
      form.set('file', new Blob([bytes], { type: request.mimeType }), request.fileName);
      const res = await fetch(request.url, { method: 'POST', body: form });
      return { ok: res.ok, status: res.status, text: await res.text() };
    },
    {
      url: `${grant.uploadUrl}/upload`,
      grant: grant.grant,
      fileName,
      mimeType,
      b64: bytes.toString('base64'),
    },
  );
  if (!uploaded.ok) {
    throw new Error(`attachment upload -> ${uploaded.status}: ${uploaded.text}`);
  }
  return grant.key;
}

const TERMINAL_STATUS =
  /done|complete|finish|success|stop|archiv|closed|idle|dead|fail|seen|idle|end/i;
const JSON_COLUMN =
  /json|data|report|payload|result|config|grant|capabilit|models|tools|hashes|content|body|meta|envelope|input|output|args|context|facts|summary|detail|state|question|answer|event|request|response|params|props|setting|rule|polic|source|item|node|blob|snapshot/i;
const ENDED_AT =
  /^(archived|closed|disabled|deleted|completed|finished|ended|stopped|consumed|resolved|settled|revoked|dismissed)At$/i;
const STATUS_LIKE =
  /status|state|phase|outcome|mode|stage|kind|type|direction|role|delivery|verdict/i;

function checkLiterals(sql) {
  const values = new Map();
  for (const match of sql.matchAll(/"(\w+)"\s+in\s*\(([^)]*)\)/gi)) {
    const literals = [...match[2].matchAll(/'([^']*)'|(\d+)/g)].map((l) => l[1] ?? Number(l[2]));
    if (literals.length === 0) continue;
    const terminal = literals.find((l) => typeof l === 'string' && TERMINAL_STATUS.test(l));
    values.set(
      match[1],
      STATUS_LIKE.test(match[1]) && terminal !== undefined ? terminal : literals[0],
    );
  }
  return values;
}

const STEP_GROUP_SAMPLES = {
  step_quota: { quotaBlock: '{}' },
  step_subscription: { claudeSubscriptionId: 'smoke-subscription' },
  step_schedule: { scheduleId: 'smoke-schedule' },
  step_memory_trace: { memoryTrace: '{}' },
  step_skill_injection: { skillInjection: '{"hits":[]}' },
  step_blocker_handoff: { blockerHandoff: '{}' },
};

const SEED_OVERRIDES = {
  ...STEP_GROUP_SAMPLES,
  coordinator_turn_snapshot: {
    schemaVersion: 1,
    outcome: 'success',
    status: 'unusable',
    reason: 'smoke',
    expiresAt: (now) => now + 2_592_000_000,
    capturedAt: (now) => now,
  },
};

function placeholderValue(col, tableName, checks, seq, now, label) {
  const override = SEED_OVERRIDES[tableName]?.[col.name];
  if (override !== undefined) return typeof override === 'function' ? override(now) : override;
  if (checks.has(col.name)) return checks.get(col.name);
  const type = (col.type ?? '').toUpperCase();
  if (type.includes('INT')) {
    if (col.pk > 0) return seq.next();
    return /at$|_at$/i.test(col.name) ? now : 0;
  }
  if (type.includes('BLOB')) return Buffer.from('smoke');
  if (
    type.includes('REAL') ||
    type.includes('NUM') ||
    type.includes('DOUB') ||
    type.includes('FLOA')
  )
    return 0;
  if (ENDED_AT.test(col.name)) return now;
  if (JSON_COLUMN.test(col.name)) return '{}';
  return `smoke-${label}-${col.name}`;
}

export function seedEveryTable(dbPath, label = `smoke-${Date.now()}`) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const marker = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'step' AND name = ?",
      )
      .get('step_require_writer_generation_update');
    if (marker) db.function('cairn_step_write_generation', { deterministic: true }, () => 1);
    const all = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();
    const fts = new Set(all.filter((r) => /using fts5/i.test(r.sql ?? '')).map((r) => r.name));
    const shadow = new Set(
      all
        .filter((r) => [...fts].some((b) => r.name !== b && r.name.startsWith(`${b}_`)))
        .map((r) => r.name),
    );
    const targets = all.filter(
      (r) =>
        !r.name.startsWith('sqlite_') &&
        r.name !== '__drizzle_migrations' &&
        !fts.has(r.name) &&
        !shadow.has(r.name),
    );
    const info = new Map();
    for (const t of targets) {
      info.set(t.name, {
        cols: db.prepare(`PRAGMA table_info(${JSON.stringify(t.name)})`).all(),
        fks: db.prepare(`PRAGMA foreign_key_list(${JSON.stringify(t.name)})`).all(),
        checks: checkLiterals(t.sql ?? ''),
      });
    }
    const deps = new Map(
      [...info.keys()].map((n) => [
        n,
        new Set(
          info
            .get(n)
            .fks.map((f) => f.table)
            .filter((p) => p !== n && info.has(p)),
        ),
      ]),
    );
    const order = [];
    const remaining = new Set(info.keys());
    while (remaining.size > 0) {
      let progressed = false;
      for (const name of [...remaining]) {
        if ([...deps.get(name)].some((d) => remaining.has(d))) continue;
        order.push(name);
        remaining.delete(name);
        progressed = true;
      }
      if (!progressed) {
        order.push(...remaining);
        remaining.clear();
      }
    }
    const existing = (table, col) =>
      db.prepare(`SELECT ${JSON.stringify(col)} AS v FROM ${JSON.stringify(table)} LIMIT 1`).get()
        ?.v;
    const inserted = new Map();
    const skipped = [];
    const seq = { n: 0, next: () => ++seq.n };
    const now = Date.now();
    db.exec('BEGIN');
    try {
      for (const name of order) {
        const { cols, fks, checks } = info.get(name);
        const values = new Map();
        for (const c of cols) {
          if (fks.some((f) => f.from === c.name)) continue;
          const ownPk = c.pk > 0;
          const forced = SEED_OVERRIDES[name]?.[c.name] !== undefined;
          if (!ownPk && !forced && (c.notnull === 0 || c.dflt_value !== null)) continue;
          values.set(
            c.name,
            ownPk && (c.type ?? '').toUpperCase().includes('TEXT')
              ? `${label}-${name}`
              : placeholderValue(c, name, checks, seq, now, label),
          );
        }
        for (const c of cols) {
          const fk = fks.find((f) => f.from === c.name);
          if (fk === undefined) continue;
          const target = fk.to ?? 'id';
          const v =
            (fk.table === name ? values.get(target) : undefined) ??
            inserted.get(fk.table)?.get(target) ??
            existing(fk.table, target) ??
            placeholderValue(c, name, checks, seq, now, label);
          values.set(c.name, v);
        }
        const colNames = [...values.keys()];
        const sqlText =
          colNames.length === 0
            ? `INSERT INTO ${JSON.stringify(name)} DEFAULT VALUES RETURNING *`
            : `INSERT INTO ${JSON.stringify(name)} (${colNames.map((c) => JSON.stringify(c)).join(', ')}) VALUES (${colNames.map(() => '?').join(', ')}) RETURNING *`;
        try {
          const row = db.prepare(sqlText).get(...colNames.map((c) => values.get(c)));
          inserted.set(name, new Map(Object.entries(row ?? {})));
        } catch (error) {
          if (name === 'step' || Object.hasOwn(STEP_GROUP_SAMPLES, name)) {
            throw new Error(`required smoke sample ${name}: ${error.message}`, { cause: error });
          }
          skipped.push(`${name}: ${error.message}`);
        }
      }
      for (const [name, sample] of Object.entries(STEP_GROUP_SAMPLES)) {
        if (!info.has(name)) continue;
        const row = inserted.get(name);
        for (const [column, value] of Object.entries(sample)) {
          if (
            info.get(name).cols.some((col) => col.name === column) &&
            row?.get(column) !== value
          ) {
            throw new Error(`required smoke sample ${name}.${column} missing or changed`);
          }
        }
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { seeded: inserted.size, skipped };
  } finally {
    db.close();
  }
}

function dbRows(dbPath, sql) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

function seedChiefMessage(ctx) {
  const dbPath = join(ctx.userData, 'home', 'server', 'server.db');
  const db = new DatabaseSync(dbPath);
  try {
    const chief = db
      .prepare('SELECT id, userId, teamId FROM chief WHERE teamId = ?')
      .get(ctx.teamId);
    if (!chief) throw new Error('no chief row provisioned');
    const now = Date.now();
    const coordinator = db
      .prepare(
        `SELECT id FROM chief_thread
         WHERE chiefId = ? AND projectId IS NULL AND archivedAt IS NULL
           AND id NOT LIKE 'chief-digest-%' AND id NOT LIKE 'chief-memory-%'`,
      )
      .get(chief.id);
    let threadId = coordinator?.id;
    let createdThread = false;
    if (threadId === undefined) {
      threadId = `chief-smoke-${now}`;
      db.prepare(
        `INSERT INTO chief_thread
           (id, chiefId, userId, teamId, projectId, title, createdAt, updatedAt,
            sessionRuntime, sessionId, sessionOpenedAt, toolDefHashes, toolResultHashes)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'pi', '', ?, '{}', '{}')`,
      ).run(threadId, chief.id, chief.userId, chief.teamId, 'Smoke notes', now, now, now);
      createdThread = true;
    }
    const messageId = `smoke-msg-${now}`;
    db.prepare(
      `INSERT INTO chief_message (id, threadId, role, content, projectId, delivery, createdAt)
       VALUES (?, ?, 'user', ?, NULL, NULL, ?)`,
    ).run(messageId, threadId, JSON.stringify(MESSAGE_TEXT(ctx.pngKeys, ctx.txtKey)), now);
    ctx.cleanup.push(async () => {
      const cleanupDb = new DatabaseSync(dbPath);
      try {
        cleanupDb.prepare('DELETE FROM chief_message WHERE id = ?').run(messageId);
        if (createdThread) {
          cleanupDb.prepare('DELETE FROM chief_thread WHERE id = ?').run(threadId);
        }
      } finally {
        cleanupDb.close();
      }
    });
    return threadId;
  } finally {
    db.close();
  }
}

async function waitForChief(ctx) {
  const deadline = Date.now() + UI_WAIT_MS;
  for (;;) {
    const rows = dbRows(
      join(ctx.userData, 'home', 'server', 'server.db'),
      `SELECT id FROM chief WHERE teamId = '${ctx.teamId.replace(/'/g, "''")}'`,
    );
    if (rows.length > 0) return;
    if (Date.now() > deadline) throw new Error('no chief row provisioned');
    await api(ctx, 'GET', `/api/teams/${ctx.teamId}/chief`).catch(() => {});
    await delay(500);
  }
}

async function pollLocalRunnerOnline(ctx) {
  const deadline = ctx.launchedAt + RUNNER_DEADLINE_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const machines = await api(ctx, 'GET', `/api/teams/${ctx.teamId}/machines`);
      const local = (machines.machines ?? machines).find((m) => m.kind === 'local');
      if (local?.online === true) {
        return { onlineAt: Date.now(), name: local.name };
      }
    } catch (error) {
      lastError = error;
    }
    await delay(POLL_MS);
  }
  throw new Error(
    `local runner not online within ${RUNNER_DEADLINE_MS / 1000}s of app start` +
      (lastError ? ` (last error: ${lastError.message})` : ''),
  );
}

async function openSettings(page, ctx, section) {
  await page.goto(`${ctx.base}/app/settings/${section}`, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('dialog', { name: STRINGS[ctx.lang].settings })
    .waitFor({ timeout: UI_WAIT_MS });
}

function seededText(page) {
  return page.getByText('Release notes draft', { exact: false }).first();
}

async function scrollConversationToEnd(page) {
  await page
    .evaluate(() => {
      let best = null;
      for (const el of document.querySelectorAll('div,main,section')) {
        if (el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 200) {
          if (best === null || el.scrollHeight > best.scrollHeight) best = el;
        }
      }
      if (best !== null) best.scrollTop = best.scrollHeight;
    })
    .catch(() => {});
}

async function openCoordinator(page, ctx) {
  await page.goto(`${ctx.base}/app`, { waitUntil: 'domcontentloaded' });
  const text = seededText(page);
  const deadline = Date.now() + UI_WAIT_MS;
  for (;;) {
    if (await text.isVisible().catch(() => false)) return;
    if (Date.now() > deadline) {
      await text.waitFor({ timeout: 2_000 });
      return;
    }
    await scrollConversationToEnd(page);
    await delay(400);
  }
}

function rowFor(section, name) {
  return section.getByTestId('frequent-model-row').filter({ hasText: name });
}

async function assertModelRow(section, model) {
  const row = rowFor(section, model.name);
  await row.waitFor({ timeout: UI_WAIT_MS });
  assert.equal(
    await row.getAttribute('data-unavailable'),
    null,
    `${model.name} row is marked unavailable`,
  );
  const text = await row.textContent();
  assert.ok(
    text.includes(model.vendor),
    `${model.name} row does not show vendor "${model.vendor}": ${text}`,
  );
  const icon = row.locator(`svg path[d="${model.iconPath}"]`);
  assert.ok((await icon.count()) > 0, `${model.name} row missing its vendor icon`);
  const trigger = row.locator('.frequent-model-level');
  assert.ok((await trigger.count()) > 0, `${model.name} row has no thinking level selector`);
  await trigger.first().click();
  const optionList = row.page().getByRole('option');
  await optionList.first().waitFor({ timeout: UI_WAIT_MS });
  const options = await optionList.allTextContents();
  await row.page().keyboard.press('Escape');
  assert.deepEqual(
    options,
    model.levels,
    `${model.name} thinking levels differ: ${JSON.stringify(options)}`,
  );
}

async function checkModels(page, ctx) {
  await openSettings(page, ctx, 'routing');
  const section = page
    .getByRole('dialog', { name: STRINGS[ctx.lang].settings })
    .getByTestId('frequent-models');
  await section.waitFor({ timeout: UI_WAIT_MS });
  await assertModelRow(section, SWE2);
  await assertModelRow(section, CLAUDE);
}

async function checkRunner(_page, ctx) {
  const result = await ctx.runnerPromise;
  return `local runner "${result.name}" online ${(result.onlineAt - ctx.launchedAt) / 1000}s after start`;
}

async function installMenuCapture(electronApp) {
  await electronApp.evaluate(({ Menu }) => {
    globalThis.__smokeMenus = [];
    const original = Menu.buildFromTemplate;
    globalThis.__smokeMenuBuild = original;
    Menu.buildFromTemplate = function captured(template) {
      globalThis.__smokeMenus.push(
        template.map((item) => ({
          label: item.label,
          role: typeof item.role === 'string' ? item.role : undefined,
          enabled: item.enabled,
          type: item.type,
        })),
      );
      return original.call(this, template);
    };
  });
}

async function restoreMenuCapture(electronApp) {
  await electronApp
    .evaluate(({ Menu }) => {
      if (globalThis.__smokeMenuBuild) Menu.buildFromTemplate = globalThis.__smokeMenuBuild;
      globalThis.__smokeMenuBuild = undefined;
    })
    .catch(() => {});
}

async function capturedMenus(electronApp) {
  return electronApp.evaluate(() => globalThis.__smokeMenus ?? []);
}

async function rightClick(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ button: 'right', timeout: UI_WAIT_MS });
  await page.keyboard.press('Escape');
  const panel = page.getByTestId('artifact-panel');
  if (await panel.isVisible().catch(() => false)) {
    await panel.getByTestId('artifact-close').click();
    await panel.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
  }
  await delay(400);
}

async function checkMenu(page, ctx) {
  const app = ctx.electronApp;
  await installMenuCapture(app);
  try {
    await openCoordinator(page, ctx);
    const attachments = page.getByTestId('chief-sent-attachment');
    await attachments.first().waitFor({ timeout: UI_WAIT_MS });
    const imageTile = attachments.filter({ has: page.locator('img') }).first();
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-slot="attachment-trigger"]')) {
        el.style.pointerEvents = 'none';
      }
    });
    await rightClick(page, imageTile.locator('img'));
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-slot="attachment-trigger"]')) {
        el.style.pointerEvents = '';
      }
    });
    const link = page.locator('a[href="https://example.com/release-notes"]').first();
    await rightClick(page, link);
    const paragraph = seededText(page);
    const paragraphEl = await paragraph.elementHandle();
    await page.evaluate((target) => {
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, paragraphEl);
    await rightClick(page, paragraph);
    const composer = page.locator('textarea[data-compose-target]').first();
    await composer.click({ timeout: UI_WAIT_MS });
    await rightClick(page, composer);
    const flat = (await capturedMenus(app)).flat();
    const labels = flat.map((item) => item.label).filter(Boolean);
    const roles = flat.map((item) => item.role).filter(Boolean);
    const menu = STRINGS[ctx.lang];
    const want = [menu.copyImage, menu.saveImage, menu.copyLink, menu.paste];
    for (const label of want) {
      assert.ok(
        labels.includes(label),
        `context menu missing "${label}"; captured: ${JSON.stringify(labels)}`,
      );
    }
    assert.ok(
      labels.some((label) => label === menu.copy) || roles.includes('copy'),
      `context menu missing copy; captured: ${JSON.stringify(labels)}`,
    );
    assert.ok(
      labels.some((label) => label.startsWith(menu.lookUp)),
      `context menu missing look up; captured: ${JSON.stringify(labels)}`,
    );
    return `captured menu labels: ${[...new Set(labels)].join(', ')}`;
  } finally {
    await restoreMenuCapture(app);
  }
}

async function checkAttachment(page, ctx) {
  await openCoordinator(page, ctx);
  const attachments = page.getByTestId('chief-sent-attachment');
  await attachments.first().waitFor({ timeout: UI_WAIT_MS });
  assert.equal(
    await attachments.count(),
    IMAGE_NAMES.length + 1,
    'expected the seeded image and text tiles',
  );
  const textTile = attachments.filter({ hasText: 'notes.txt' }).first();
  assert.ok(
    (await textTile.locator('svg, [data-file-icon]').count()) > 0,
    'text file tile does not show a type icon',
  );
  const panel = page.getByTestId('artifact-panel');
  const selected = panel.locator('[data-testid="artifact-tab"][data-active]');
  const openTile = async (name) => {
    const chatFocus = page.getByTestId('artifact-focus-chat');
    if (await chatFocus.isVisible().catch(() => false)) await chatFocus.click();
    await attachments.getByRole('button', { name, exact: true }).first().click();
  };
  await openTile(IMAGE_NAMES[0]);
  await selected.filter({ hasText: IMAGE_NAMES[0] }).waitFor({ timeout: UI_WAIT_MS });
  await openTile(IMAGE_NAMES[1]);
  await selected.filter({ hasText: IMAGE_NAMES[1] }).waitFor({ timeout: UI_WAIT_MS });
  await openTile('notes.txt');
  await panel
    .getByTestId('artifact-body')
    .filter({ hasText: TXT_BODY.split('\n')[0] })
    .waitFor({ timeout: UI_WAIT_MS });
  const tabs = await panel.getByTestId('artifact-tab').count();
  assert.equal(tabs, 3, `expected three artifact tabs, saw ${tabs}`);
  await panel.getByTestId('artifact-close').click();
  await panel.waitFor({ state: 'detached', timeout: UI_WAIT_MS });
  return `${IMAGE_NAMES[0]}, ${IMAGE_NAMES[1]} and notes.txt opened as artifact panel tabs`;
}

async function checkRemote(page, ctx) {
  const routes = await api(ctx, 'GET', '/api/remote/routes');
  const expected = routes.tailnet.enabled === true;
  await openSettings(page, ctx, 'remote');
  const toggle = page.getByTestId('remote-access-switch');
  await toggle.waitFor({ timeout: UI_WAIT_MS });
  const rendered = async () =>
    (await toggle.getAttribute('aria-checked')) === 'true' ||
    (await toggle.getAttribute('data-checked')) !== null;
  const deadline = Date.now() + UI_WAIT_MS;
  let on = await rendered();
  while (on !== expected && Date.now() < deadline) {
    await delay(400);
    on = await rendered();
  }
  assert.equal(
    on,
    expected,
    `remote access switch renders ${on ? 'on' : 'off'} but saved state is ${
      expected ? 'on' : 'off'
    }`,
  );
  return `switch ${on ? 'on' : 'off'}, matches saved state`;
}

async function checkServeApp(_page, ctx) {
  const res = await fetch(`${ctx.base}/app`, {
    signal: AbortSignal.timeout(30_000),
    headers: { 'sec-fetch-site': 'same-origin' },
  });
  assert.ok(res.ok, `GET /app -> ${res.status}`);
  const body = await res.text();
  assert.ok(body.length > 0, '/app returned an empty body');
  await api(ctx, 'GET', '/api/teams');
  return `serving /app${ctx.seededTables === undefined ? '' : ` on a migrated ${ctx.seededTables}-table database`}`;
}

async function checkStartTaskEcho(page, ctx) {
  const projects = await api(ctx, 'GET', '/api/projects');
  const project = (projects.projects ?? projects).find((p) => p.archivedAt == null);
  assert.ok(project, 'expected at least one active project');

  const todo = await windowApi(ctx, 'POST', `/api/projects/${project.id}/todos`, {
    title: 'Smoke start-task echo guard',
    spec: 'Verify synthetic start prompt is hidden in Coordinator chat',
  });
  const dbPath = join(ctx.userData, 'home', 'server', 'server.db');
  const now = Math.max(Date.now(), (todo.phaseAt ?? 0) + 10);
  const prompt = JSON.stringify(buildStartTaskSeedPrompt(todo));
  const syntheticId = `smoke-orch-${now}`;
  const echoId = `smoke-orch-echo-${now}`;

  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      `INSERT INTO chief_message (id, threadId, role, content, projectId, delivery, origin, createdAt)
       VALUES (?, ?, 'user', ?, NULL, NULL, 'synthetic', ?)`,
    ).run(syntheticId, ctx.threadId, prompt, now);
    db.prepare(
      `INSERT INTO chief_message (id, threadId, role, content, projectId, delivery, origin, createdAt)
       VALUES (?, ?, 'user', ?, NULL, NULL, 'task-prompt', ?)`,
    ).run(echoId, ctx.threadId, prompt, now + 5);
  } finally {
    db.close();
  }

  ctx.cleanup.push(async () => {
    const cleanupDb = new DatabaseSync(dbPath);
    try {
      cleanupDb.prepare('DELETE FROM chief_message WHERE id IN (?, ?)').run(syntheticId, echoId);
    } finally {
      cleanupDb.close();
    }
    await windowApi(ctx, 'DELETE', `/api/todos/${todo.id}`).catch(() => {});
  });

  await openCoordinator(page, ctx);
  const stream = page.getByTestId('chief-stream');
  await stream.waitFor({ timeout: UI_WAIT_MS });
  const streamText = await stream.innerText();
  assert.ok(
    !streamText.includes('开始任务') && !streamText.includes('编排请求'),
    `Coordinator stream leaked synthetic start-task prompt: ${streamText}`,
  );

  await page.goto(`${ctx.base}/app?thread=${todo.id}`, { waitUntil: 'domcontentloaded' });
  const sideChat = page.getByRole('complementary', { name: todo.title });
  await sideChat.waitFor({ timeout: UI_WAIT_MS });
  const expectedNote = STRINGS[ctx.lang].handedToCoordinator(todo.title);
  await sideChat
    .getByTestId('transcript-note')
    .filter({ hasText: expectedNote })
    .first()
    .waitFor({ timeout: UI_WAIT_MS });
  const sideText = await sideChat.innerText();
  assert.ok(
    !sideText.includes(`#${todo.seqNum}`),
    `Task thread leaked #${todo.seqNum}: ${sideText}`,
  );

  const machines = await api(ctx, 'GET', `/api/teams/${ctx.teamId}/machines`);
  const onlineMachines = (machines.machines ?? machines).filter((m) => m.online === true);
  if (onlineMachines.length <= 1) {
    let orchestrateCalls = 0;
    const routePattern = `**/api/todos/${todo.id}/orchestrate`;
    const routeHandler = async (route, request) => {
      if (request.method() !== 'POST') return route.fallback();
      orchestrateCalls += 1;
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          thread: {
            id: ctx.threadId,
            chiefId: 'chief-smoke',
            userId: 'u-smoke',
            teamId: ctx.teamId,
            title: 'Coordinator',
            createdAt: now - 60_000,
            updatedAt: Date.now(),
            lastTurnAt: null,
            session: { runtime: 'pi', id: '', openedAt: now - 60_000 },
            pendingSessionResumeAt: null,
            toolDefHashes: {},
            toolResultHashes: {},
            activeRun: { phase: 'chief' },
            turnQueue: null,
            orchestration: { todoId: todo.id, state: 'queued', error: null },
          },
          message: {
            id: 'smoke-orch-click',
            role: 'user',
            origin: 'synthetic',
            content: buildStartTaskSeedPrompt(todo),
            createdAt: Date.now(),
          },
        }),
      });
    };
    await page.route(routePattern, routeHandler);
    try {
      const startBtn = sideChat.getByRole('button', { name: STRINGS[ctx.lang].start });
      await startBtn.waitFor({ timeout: UI_WAIT_MS });
      await startBtn.click();
      const deadline = Date.now() + UI_WAIT_MS;
      while (orchestrateCalls === 0 && Date.now() < deadline) await delay(100);
      assert.equal(orchestrateCalls, 1, 'expected Start button to trigger mocked orchestrate POST');
      await delay(200);
      const toastCount = await page
        .locator('[data-sonner-toast]')
        .filter({ hasText: STRINGS[ctx.lang].handedToastTitle })
        .count();
      assert.equal(toastCount, 0, 'in-thread Start must not emit redundant orchestration toast');
    } finally {
      await page.unroute(routePattern, routeHandler);
    }
  }

  return `suppressed "开始任务 #${todo.seqNum}" in Coordinator and rendered "${expectedNote}"`;
}

async function assertNarrowSettingsTitlebar(page, base, lang) {
  await page.goto(`${base}/app/settings/account`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('dialog', { name: STRINGS[lang].settings }).waitFor({ timeout: UI_WAIT_MS });
  const shell = await page.locator('html').getAttribute('data-shell');
  assert.equal(shell, 'mac-desktop', `expected data-shell="mac-desktop", got ${shell}`);

  const header = page.getByTestId('settings-title');
  await header.waitFor({ timeout: UI_WAIT_MS });
  const titleHeading = header.locator('h1');
  const closeButton = header.getByRole('button', { name: STRINGS[lang].closeSettings });
  await titleHeading.waitFor({ timeout: UI_WAIT_MS });
  await closeButton.waitFor({ timeout: UI_WAIT_MS });

  const titleBox = await titleHeading.boundingBox();
  const closeBox = await closeButton.boundingBox();
  assert.ok(titleBox !== null, 'Settings title heading must have a bounding box');
  assert.ok(closeBox !== null, 'Settings close button must have a bounding box');
  assert.equal(
    overlapsTrafficLights(titleBox),
    false,
    `Settings title (${JSON.stringify(titleBox)}) overlaps traffic lights ${JSON.stringify(TRAFFIC_LIGHT_ZONE)}`,
  );
  assert.equal(
    overlapsTrafficLights(closeBox),
    false,
    `Settings close button (${JSON.stringify(closeBox)}) overlaps traffic lights ${JSON.stringify(TRAFFIC_LIGHT_ZONE)}`,
  );

  const dragCheck = await header.evaluate((el) => {
    const dialog = el.closest('[role="dialog"]');
    const beforeStyle = dialog ? getComputedStyle(dialog, '::before') : null;
    const headerStyle = getComputedStyle(el);
    const closeBtn = el.querySelector('button');
    const closeStyle = closeBtn ? getComputedStyle(closeBtn) : null;
    return {
      beforeAppRegion: beforeStyle?.webkitAppRegion,
      headerAppRegion: headerStyle.webkitAppRegion,
      closeAppRegion: closeStyle?.webkitAppRegion,
    };
  });
  assert.ok(
    dragCheck.beforeAppRegion === 'drag' || dragCheck.headerAppRegion === 'drag',
    `expected narrow Settings header or ::before to be draggable, got ${JSON.stringify(dragCheck)}`,
  );
  assert.equal(
    dragCheck.closeAppRegion,
    'no-drag',
    `expected Settings close button to be no-drag, got ${dragCheck.closeAppRegion}`,
  );
  return { titleBox, closeBox };
}

async function checkSettingsTitlebar(page, ctx) {
  if (ctx.mode === 'app') {
    const savedBounds = await ctx.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(
        (w) => !w.webContents.getURL().includes('/tray'),
      );
      if (!win) throw new Error('main BrowserWindow not found');
      const bounds = win.getBounds();
      win.setSize(760, 850);
      return bounds;
    });
    try {
      const deadline = Date.now() + UI_WAIT_MS;
      while (Date.now() < deadline) {
        const w = await page.evaluate(() => window.innerWidth);
        if (w <= 767) break;
        await delay(100);
      }
      const { titleBox } = await assertNarrowSettingsTitlebar(page, ctx.base, ctx.lang);
      return `760px Settings titlebar clears traffic lights (h1 y=${Math.round(titleBox.y)}px)`;
    } finally {
      await ctx.electronApp
        .evaluate(({ BrowserWindow }, bounds) => {
          const win = BrowserWindow.getAllWindows().find(
            (w) => !w.webContents.getURL().includes('/tray'),
          );
          if (win) win.setBounds(bounds);
        }, savedBounds)
        .catch(() => {});
    }
  }

  const desktopContext = await ctx.browser.newContext({
    userAgent: DESKTOP_UA,
    viewport: { width: 760, height: 850 },
    extraHTTPHeaders: { authorization: `Bearer ${ctx.token}` },
  });
  try {
    const desktopPage = await desktopContext.newPage();
    await desktopPage.goto(`${ctx.base}/app`, { waitUntil: 'domcontentloaded' });
    const lang = await desktopPage
      .evaluate(() => document.documentElement.lang)
      .then((value) => (value.toLowerCase().startsWith('zh') ? 'zh' : 'en'))
      .catch(() => ctx.lang);
    const { titleBox } = await assertNarrowSettingsTitlebar(desktopPage, ctx.base, lang);
    return `760px Settings titlebar clears traffic lights (h1 y=${Math.round(titleBox.y)}px)`;
  } finally {
    await desktopContext.close().catch(() => {});
  }
}

async function checkImeComposition(page, ctx) {
  await openCoordinator(page, ctx);
  const composer = page.locator('textarea[data-compose-target]').first();
  await composer.waitFor({ timeout: UI_WAIT_MS });

  let posts = 0;
  const routeHandler = async (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    const { pathname } = new URL(request.url());
    if (
      !/\/api\/conversations\/[^/]+\/messages$/.test(pathname) &&
      !/\/api\/teams\/[^/]+\/chief\/threads$/.test(pathname)
    ) {
      return route.fallback();
    }
    posts += 1;
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        thread: {
          id: ctx.threadId,
          chiefId: 'chief-smoke',
          userId: 'u-smoke',
          teamId: ctx.teamId,
          title: 'Coordinator',
          createdAt: Date.now() - 60_000,
          updatedAt: Date.now(),
          lastTurnAt: null,
          session: { runtime: 'pi', id: '', openedAt: Date.now() - 60_000 },
          pendingSessionResumeAt: null,
          toolDefHashes: {},
          toolResultHashes: {},
          activeRun: null,
          turnQueue: null,
        },
        message: {
          id: `smoke-ime-${posts}`,
          role: 'user',
          origin: 'user',
          content: 'smoke ime',
          createdAt: Date.now(),
        },
      }),
    });
  };

  await page.route('**/api/**', routeHandler);
  try {
    await composer.click({ timeout: UI_WAIT_MS });
    await composer.fill('smoke ime blur');
    await composer.evaluate((el) => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    });
    await composer.press('Enter');
    assert.equal(posts, 0, 'Enter during active IME composition must not send');

    await composer.evaluate((el) => el.blur());
    await composer.click({ timeout: UI_WAIT_MS });
    await composer.press('Enter');
    const blurDeadline = Date.now() + UI_WAIT_MS;
    while (posts < 1 && Date.now() < blurDeadline) await delay(100);
    assert.equal(posts, 1, 'Enter after blur without compositionend must send');
    const afterBlur = await composer.inputValue();
    assert.equal(afterBlur, '', `expected composer draft to clear after send, got "${afterBlur}"`);

    await composer.click({ timeout: UI_WAIT_MS });
    await composer.fill('smoke ime cancel');
    await composer.evaluate((el) => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      el.dispatchEvent(new CompositionEvent('compositioncancel', { bubbles: true, data: '' }));
    });
    await composer.press('Enter');
    const cancelDeadline = Date.now() + UI_WAIT_MS;
    while (posts < 2 && Date.now() < cancelDeadline) await delay(100);
    assert.equal(posts, 2, 'Enter after compositioncancel must send');
    const afterCancel = await composer.inputValue();
    assert.equal(
      afterCancel,
      '',
      `expected composer draft to clear after compositioncancel send, got "${afterCancel}"`,
    );
  } finally {
    await page.unroute('**/api/**', routeHandler);
  }

  return 'blur and compositioncancel reset composing state so Enter sends cleanly';
}

async function checkServerVersion(page, ctx) {
  const info = await api(ctx, 'GET', '/api/server/version');
  assert.ok(
    info.version !== null || info.commit !== null,
    `GET /api/server/version returned neither version nor commit: ${JSON.stringify(info)}`,
  );
  await openSettings(page, ctx, 'account');
  const badge = page.getByTestId('server-version');
  await badge.waitFor({ timeout: UI_WAIT_MS });
  const rendered = (await badge.textContent()).trim();
  const expected = formatExpectedServerVersion(info.version, info.commit, ctx.lang);
  assert.equal(
    rendered,
    expected,
    `Settings version badge rendered "${rendered}", expected "${expected}"`,
  );
  assert.ok(
    !/[0-9a-f]{8,}/i.test(rendered),
    `Settings version badge leaked full/untruncated SHA: "${rendered}"`,
  );

  const devSha = '606d9c2ef';
  const expectedDev = formatExpectedServerVersion(null, devSha, ctx.lang);
  const versionPattern = '**/api/server/version';
  const versionHandler = async (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: null,
        commit: devSha.slice(0, 7),
        busy: false,
        updater: {
          supported: false,
          state: 'idle',
          availableVersion: null,
          percent: null,
          error: null,
          updatedAt: null,
        },
      }),
    });
  };
  await page.route(versionPattern, versionHandler);
  try {
    await page.goto(`${ctx.base}/app`, { waitUntil: 'domcontentloaded' });
    await openSettings(page, ctx, 'account');
    await badge.waitFor({ timeout: UI_WAIT_MS });
    const deadline = Date.now() + UI_WAIT_MS;
    let devRendered = (await badge.textContent()).trim();
    while (devRendered !== expectedDev && Date.now() < deadline) {
      await delay(200);
      devRendered = (await badge.textContent()).trim();
    }
    assert.equal(
      devRendered,
      expectedDev,
      `Settings dev version badge rendered "${devRendered}", expected "${expectedDev}"`,
    );
  } finally {
    await page.unroute(versionPattern, versionHandler);
  }

  return `Settings version renders "${rendered}" and untagged dev fallback "${expectedDev}"`;
}

const CHECKS = [
  { id: 'migration', run: checkServeApp },
  { id: 'models', run: checkModels },
  { id: 'runner', run: checkRunner },
  { id: 'menu', run: checkMenu, appOnly: true },
  { id: 'attachment', run: checkAttachment },
  { id: 'remote', run: checkRemote },
  { id: 'start-task-echo', run: checkStartTaskEcho },
  { id: 'settings-titlebar', run: checkSettingsTitlebar },
  { id: 'ime-composition', run: checkImeComposition },
  { id: 'server-version', run: checkServerVersion },
];

async function waitForServerUp(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/teams`, { signal: AbortSignal.timeout(10_000) });
      if (res.status < 500) return;
      lastError = new Error(`/api/teams -> ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(`server never came up${lastError ? `: ${lastError.message}` : ''}`);
}

const INSTALLED_APPS = /^\/applications(\/|$)/i;

export function smokableBundle(appPath) {
  const resolved = resolve(appPath);
  if (INSTALLED_APPS.test(resolved)) {
    throw new Error(`refusing to run against the installed app: ${resolved}`);
  }
  const root = realpathSync(resolved);
  if (INSTALLED_APPS.test(root)) {
    throw new Error(`refusing to run against the installed app: ${root}`);
  }
  return root;
}

function matchingPids(pattern) {
  try {
    return execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function killTree(root) {
  for (const pid of matchingPids(`^${root}/`)) {
    try {
      process.kill(Number(pid), 'SIGKILL');
    } catch {}
  }
}

async function launchPackagedApp(executable, userData) {
  return electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${userData}`],
    timeout: LAUNCH_TIMEOUT_MS,
  });
}

function procOf(electronApp) {
  try {
    return electronApp.process();
  } catch {
    return null;
  }
}

async function connectApp(appPath, prevAppPath) {
  const scratch = mkdtempSync(join(tmpdir(), 'cairn-smoke-'));
  const appRoot = smokableBundle(appPath);
  const executable = join(appRoot, 'Contents', 'MacOS', 'Cairn');
  if (!existsSync(executable)) {
    throw new Error(`no executable at ${executable}; pass the path to Cairn.app`);
  }
  await seedTsnet(scratch);
  let seededTables;
  if (prevAppPath !== null) {
    const prevRoot = smokableBundle(prevAppPath);
    const prevExecutable = join(prevRoot, 'Contents', 'MacOS', 'Cairn');
    if (!existsSync(prevExecutable)) {
      throw new Error(`no executable at ${prevExecutable}; pass the previous release's Cairn.app`);
    }
    console.log('booting previous release on the scratch home');
    const prevApp = await launchPackagedApp(prevExecutable, scratch);
    const prevProc = procOf(prevApp);
    let prevBase;
    try {
      const prevPortFile = join(scratch, 'server-port');
      await waitForFile(prevPortFile, SERVER_WAIT_MS, 'previous release server port');
      prevBase = `http://127.0.0.1:${readFileSync(prevPortFile, 'utf8').trim()}`;
      await waitForServerUp(prevBase, SERVER_WAIT_MS);
      console.log(`previous release server up on ${prevBase}`);
    } finally {
      await Promise.race([prevApp.close(), delay(30_000)]).catch(() => {});
      prevProc?.kill('SIGKILL');
      killTree(prevRoot);
    }
    const dbPath = join(scratch, 'home', 'server', 'server.db');
    const seeded = seedEveryTable(dbPath);
    seededTables = seeded.seeded;
    console.log(
      `seed: ${seeded.seeded} tables populated` +
        (seeded.skipped.length > 0 ? `; skipped: ${seeded.skipped.join('; ')}` : ''),
    );
    rmSync(join(scratch, 'server-port'), { force: true });
  }
  console.log('booting the packaged app over the seeded database');
  const electronApp = await launchPackagedApp(executable, scratch);
  const appProc = procOf(electronApp);
  const launchedAt = Date.now();
  const portFile = join(scratch, 'server-port');
  await waitForFile(
    portFile,
    SERVER_WAIT_MS,
    'server port file (server did not boot; migration or launch failure)',
  );
  await waitForFile(join(scratch, 'home', 'token'), SERVER_WAIT_MS, 'owner token file');
  const base = `http://127.0.0.1:${readFileSync(portFile, 'utf8').trim()}`;
  let page;
  try {
    page = await mainWindow(electronApp, SERVER_WAIT_MS);
  } catch (error) {
    const serverLog = join(scratch, 'logs', 'server.log');
    if (existsSync(serverLog)) {
      const tail = readFileSync(serverLog, 'utf8').trim().split('\n').slice(-3).join('\n');
      throw new Error(`app exited before opening a window; server.log tail:\n${tail}`);
    }
    throw error;
  }
  await page.addInitScript(() => {
    try {
      localStorage.setItem('cairn.locale', 'zh');
      localStorage.setItem('cairn-locale', 'zh');
    } catch {}
  });
  return {
    mode: 'app',
    base,
    userData: scratch,
    token: readOwnerToken(scratch),
    page,
    electronApp,
    appProc,
    appRoot,
    launchedAt,
    scratch,
    seededTables,
    lang: 'zh',
  };
}

async function connectLocal(args) {
  const base = args.base.replace(/\/$/, '');
  const token = args.token ?? readOwnerToken(args.userData);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  });
  const page = await context.newPage();
  await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded' });
  const lang = await page
    .evaluate(() => document.documentElement.lang)
    .then((value) => (value.toLowerCase().startsWith('zh') ? 'zh' : 'en'))
    .catch(() => 'en');
  return {
    mode: 'local',
    base,
    userData: args.userData,
    token,
    page,
    browser,
    launchedAt: Date.now(),
    scratch: null,
    lang,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      'Usage: node scripts/smoke/post-install.mjs [--app <path-to-Cairn.app>]\n' +
        '          [--prev-app <path-to-previous-Cairn.app>]\n' +
        `          [--base ${DEFAULT_BASE}] [--user-data <dir>] [--token <t>]\n` +
        '          [--evidence <dir>] [--checks <id,id,...>]\n' +
        'With --prev-app: boot the previous release on the scratch home first,\n' +
        'populate every table, then boot --app so migrations run on real data.\n' +
        'With --app: launches the packaged app in a scratch home and runs all checks.\n' +
        'Without --app: runs the browser checks against a running app (menu check skipped).',
    );
    return;
  }
  const selectedChecks =
    args.checks === null ? CHECKS : CHECKS.filter((check) => args.checks.includes(check.id));
  const evidence = args.evidence ?? mkdtempSync(join(tmpdir(), 'cairn-smoke-evidence-'));
  mkdirSync(evidence, { recursive: true });
  const ctx = args.app ? await connectApp(args.app, args.prevApp) : await connectLocal(args);
  ctx.cleanup = [];
  const results = [];
  try {
    const teams = await api(ctx, 'GET', '/api/teams');
    ctx.teamId = teams[0].id;
    if (selectedChecks.some((check) => check.id === 'runner')) {
      ctx.runnerPromise = pollLocalRunnerOnline(ctx);
    }
    await ensureProject(ctx);
    if (ctx.mode === 'app') {
      await seedModelSources(ctx);
    } else {
      await seedTopModels(ctx);
    }
    ctx.pngKeys = [];
    for (const name of IMAGE_NAMES) {
      ctx.pngKeys.push(
        await uploadAttachment(ctx, name, 'image/png', Buffer.from(PNG_BASE64, 'base64')),
      );
    }
    ctx.txtKey = await uploadAttachment(ctx, 'notes.txt', 'text/plain', Buffer.from(TXT_BODY));
    await api(ctx, 'GET', `/api/teams/${ctx.teamId}/chief`);
    await waitForChief(ctx);
    ctx.threadId = seedChiefMessage(ctx);
    for (const check of selectedChecks) {
      if (check.appOnly && ctx.mode !== 'app') {
        results.push({
          id: check.id,
          status: 'SKIP',
          detail: 'needs --app (native Electron menu)',
        });
        continue;
      }
      const start = Date.now();
      try {
        const detail = await check.run(ctx.page, ctx);
        results.push({
          id: check.id,
          status: 'PASS',
          detail: `${detail ?? ''}${detail ? ' ' : ''}(${((Date.now() - start) / 1000).toFixed(1)}s)`,
        });
      } catch (error) {
        const shot = join(evidence, `${check.id}.png`);
        await ctx.page.screenshot({ path: shot }).catch(() => {});
        results.push({
          id: check.id,
          status: 'FAIL',
          detail: `${error.message} (screenshot: ${shot})`,
        });
      }
      const last = results[results.length - 1];
      console.log(`${last.status} ${last.id}${last.detail ? `: ${last.detail}` : ''}`);
    }
  } finally {
    for (const undo of ctx.cleanup.reverse()) await undo().catch(() => {});
    if (ctx.electronApp) {
      await Promise.race([ctx.electronApp.close(), delay(30_000)]).catch(() => {});
      ctx.appProc?.kill('SIGKILL');
      killTree(ctx.appRoot);
      if (ctx.scratch) rmSync(ctx.scratch, { recursive: true, force: true });
    }
    if (ctx.browser) await ctx.browser.close().catch(() => {});
  }
  const failed = results.filter((r) => r.status === 'FAIL').length;
  if (failed > 0) {
    console.log(
      `${results.length - failed}/${results.length} checks passed; evidence: ${evidence}`,
    );
    process.exit(1);
  }
  console.log(`${results.length} checks green`);
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  main().catch((error) => {
    console.error(`post-install smoke failed to run: ${error.stack ?? error.message}`);
    process.exit(2);
  });
}
