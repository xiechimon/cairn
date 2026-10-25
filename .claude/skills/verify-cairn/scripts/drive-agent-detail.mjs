#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const ports = existsSync(join(RUN_DIR, 'ports.json'))
  ? JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'))
  : {};
const SERVER = `http://127.0.0.1:${ports.serverPort ?? process.env.VERIFY_PORT ?? 8791}`;
const WEB = `http://127.0.0.1:${ports.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273}`;
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-agent-detail`);
mkdirSync(EVIDENCE, { recursive: true });

const AGENT_NAME = 'verify-485-builder';
const RENAMED = 'verify-485-renamed';

const checks = [];
function check(name, ok, detail) {
  if (typeof ok !== 'boolean') {
    throw new TypeError(`check(${JSON.stringify(name)}) 的 ok 位须为 boolean，收到 ${typeof ok}`);
  }
  checks.push({ name, ok, detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
const artifacts = [];
const shot = async (page, name) => {
  await page.screenshot({ path: join(EVIDENCE, name) });
  artifacts.push(name);
  process.stdout.write(`shot  ${name}\n`);
};

const getJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
};
const sendJson = async (url, method, body) => {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
  return res.status === 204 ? null : res.json();
};

const teams = await getJson(`${SERVER}/api/teams`);
const teamId = teams[0]?.id;
if (teamId === undefined) throw new Error('no team seeded');
const agentUrl = (aid) => `${SERVER}/api/teams/${teamId}/agents/${aid}`;
const extra = { teamId, agentId: null };

await sendJson(`${SERVER}/api/teams/${teamId}/providers`, 'POST', {
  providerId: 'verify-485-gw',
  label: 'verify-485-gw',
  baseUrl: 'https://gw.invalid/v1',
  api: 'anthropic-messages',
  models: [{ id: 'claude-sonnet-5', name: 'claude-sonnet-5' }],
}).catch(() => {});

const secretsUrl = `${SERVER}/api/teams/${teamId}/secrets`;
for (const name of ['verify-510-key-a', 'verify-510-key-b']) {
  await sendJson(secretsUrl, 'POST', { name, description: null, value: `value-${name}` });
}
const created = await sendJson(`${SERVER}/api/teams/${teamId}/agents`, 'POST', {
  displayName: AGENT_NAME,
  provider: 'verify-485-gw',
  modelId: 'claude-sonnet-5',
});
const agentId = created.id;
extra.agentId = agentId;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

try {

  await page.goto(`${WEB}/app/team`);
  await page.waitForSelector('[data-route="team"]', { timeout: 15_000 });

const card = page.locator('[data-testid="team-agent-card"]', { hasText: AGENT_NAME });
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  check('team-card-is-link', (await card.evaluate((el) => el.tagName)) === 'A', '卡元素是 a');
  await card.click();
  await page.waitForSelector('.agent-overview', { timeout: 15_000 });
  check(
    'card-opens-detail-route',
    new URL(page.url()).pathname === `/app/resources/agents/${agentId}`,
    page.url(),
  );
  await shot(page, '01-overview.png');

  const record0 = await getJson(agentUrl(agentId));
  check('server-seeded', record0.displayName === AGENT_NAME, record0.displayName);
  check(
    'overview-name',
    (await page.locator('.agent-name').textContent())?.trim() === AGENT_NAME,
  );
  check(
    'overview-role-empty-canon',
    (await page.locator('.agent-role-text').textContent())?.trim() === '未设置职责',
  );
  check(
    'overview-model',
    ((await page.locator('.agent-model-select').textContent()) ?? '').includes('claude-sonnet-5'),
  );
  check(
    'overview-thinking-readonly',
    (await page.locator('.agent-thinking').textContent())?.trim() === '默认' &&
      (await page.locator('.agent-thinking button').count()) === 0,
  );

  const statusRowCount = await page.locator('.agent-status').count();
  check('overview-no-status-row', statusRowCount === 0, `status=${statusRowCount}`);

  check(
    'overview-runtime-derived',
    (await page.locator('.agent-runtime-select').textContent())?.includes('verify-485-gw') ===
      true,
    await page.locator('.agent-runtime-select').textContent(),
  );

  const caps = await getJson(`${SERVER}/api/capabilities`);
  check(
    'capabilities-seven-levels',
    JSON.stringify(caps.thinkingLevels) ===
      JSON.stringify(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
    JSON.stringify(caps.thinkingLevels),
  );

  await sendJson(agentUrl(agentId), 'PATCH', { thinkingLevel: 'high' });
  await page.reload();
  await page.waitForSelector('.agent-overview', { timeout: 15_000 });
  check(
    'thinking-inside-vocabulary-rendered',
    (await page.locator('.agent-thinking').textContent())?.trim() === 'high',
    await page.locator('.agent-thinking').textContent(),
  );
  await shot(page, '01b-thinking-level-high.png');
  await sendJson(agentUrl(agentId), 'PATCH', { thinkingLevel: 'ultra' });
  await page.reload();
  await page.waitForSelector('.agent-overview', { timeout: 15_000 });
  check(
    'thinking-outside-vocabulary-falls-back',
    (await page.locator('.agent-thinking').textContent())?.trim() === '默认' &&
      (await page.locator('.agent-thinking button').count()) === 0,
    await page.locator('.agent-thinking').textContent(),
  );
  await shot(page, '01c-thinking-outside-vocabulary.png');
  await sendJson(agentUrl(agentId), 'PATCH', { thinkingLevel: null });

  await page.locator('.agent-name').click();
  await page.locator('#agent-name-input').fill(RENAMED);
  await page.locator('#agent-name-input').press('Enter');
  await page.waitForTimeout(400);
  const afterName = await getJson(agentUrl(agentId));
  check('name-persisted', afterName.displayName === RENAMED, afterName.displayName);

  await page.locator('.agent-role-edit').click();
  await page.locator('#agent-role-input').fill('负责构建与合并');
  await page.locator('.agent-role-save').click();
  await page.waitForTimeout(400);
  const afterRole = await getJson(agentUrl(agentId));
  check('role-persisted', afterRole.description === '负责构建与合并', afterRole.description);
  await shot(page, '02-overview-edited.png');

  await page.locator('.agent-model-select').click();
  await page.waitForSelector('.agent-model-menu');
  await page.locator('.agent-model-menu').waitFor({ state: 'visible' });
  await shot(page, '03-model-menu.png');

  check(
    'model-menu-unset-row-only',
    (await page.locator('.agent-model-row').count()) === 1 &&
      ((await page.locator('.agent-model-row').first().textContent()) ?? '').includes('未设置模型'),
    `rows=${await page.locator('.agent-model-row').count()}`,
  );
  await page.locator('.agent-model-row', { hasText: '未设置模型' }).click();
  await page.waitForTimeout(400);
  const afterClear = await getJson(agentUrl(agentId));
  check(
    'model-cleared-keeps-provider',
    afterClear.provider === 'verify-485-gw' && afterClear.modelId === null,
    `${afterClear.provider}/${afterClear.modelId}`,
  );

  await page.locator('.agent-tab').nth(2).click();
  await page.waitForSelector('.agent-perms');
  const switches = page.locator('.agent-tool-switch');
  check('perm-six-switches', (await switches.count()) === 6, `${await switches.count()} 个`);

  const firstLabel = await switches.first().getAttribute('aria-label');
  const toolsBefore = (await getJson(agentUrl(agentId))).tools;
  await switches.first().click();
  await page.waitForTimeout(400);
  const afterTool = await getJson(agentUrl(agentId));
  const toolsExpected = toolsBefore.includes(firstLabel)
    ? toolsBefore.filter((tool) => tool !== firstLabel)
    : [...toolsBefore, firstLabel];
  check(
    'tool-persisted',
    JSON.stringify([...afterTool.tools].sort()) === JSON.stringify([...toolsExpected].sort()),
    `${JSON.stringify(toolsBefore)} → ${JSON.stringify(afterTool.tools)}`,
  );
  await shot(page, '04-permissions.png');

  const allSecretIds = (await getJson(secretsUrl)).map((row) => row.id);
  const secretSwitch = page.locator('.agent-secret-switch');
  check(
    'secret-row-single',
    (await page.locator('.agent-secret-row').count()) === 1,
    `${await page.locator('.agent-secret-row').count()} 行`,
  );
  check('secret-switch-single', (await secretSwitch.count()) === 1, `${await secretSwitch.count()} 个`);
  check(
    'secret-unchecked-when-empty',
    (await secretSwitch.getAttribute('aria-checked')) === 'false',
    `secrets=${JSON.stringify((await getJson(agentUrl(agentId))).secrets)}`,
  );

  await secretSwitch.click();
  await page.waitForTimeout(400);
  const afterSecretOn = await getJson(agentUrl(agentId));
  check(
    'secret-on-writes-full-id-set',
    afterSecretOn.secrets.length === allSecretIds.length &&
      allSecretIds.every((id) => afterSecretOn.secrets.includes(id)),
    `写回 ${JSON.stringify(afterSecretOn.secrets)}；团队全 id 集 ${JSON.stringify(allSecretIds)}`,
  );

  check(
    'secret-stays-checked-when-nonempty',
    (await secretSwitch.getAttribute('aria-checked')) === 'true',
    `${await secretSwitch.count()} 个开关，首个 aria-checked=${await secretSwitch.getAttribute('aria-checked')}`,
  );
  await shot(page, '05-permissions-secret-on.png');

  await secretSwitch.click();
  await page.waitForTimeout(400);
  const afterSecretOff = await getJson(agentUrl(agentId));
  check(
    'secret-off-clears',
    afterSecretOff.secrets.length === 0,
    JSON.stringify(afterSecretOff.secrets),
  );

  await page.locator('.agent-tab').nth(1).click();
  await page.waitForSelector('.agent-memories');
  check(
    'memory-empty-canon',
    (await page.locator('.agent-memory-empty').textContent())?.trim() ===
      '尚无记忆。Agent 会在工作中将值得沉淀的经验存入此处。',
  );

  await page.goto(`${WEB}/app/team`);
  await page.waitForSelector('[data-route="team"]', { timeout: 15_000 });
  await page.getByRole('button', { name: '创建 Agent' }).first().click();
  const createDialog = page.getByRole('dialog', { name: '创建 agent' });
  await createDialog.waitFor({ timeout: 15_000 });
  await createDialog.getByText('尚未配置模型服务商').waitFor({ timeout: 5_000 });
  check('create-dialog-warn-row', true, '零 runtime 源时出告警行（不出模型选择器）');
  check(
    'create-dialog-configure-link',
    (await createDialog.getByRole('link', { name: '配置服务商' }).count()) === 1,
  );
  await shot(page, '06-create-dialog-warn.png');
  await createDialog.getByLabel('名称').fill('verify-485-created');
  await createDialog.getByRole('button', { name: '创建', exact: true }).click();
  await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 15_000 });
  const members = await getJson(`${SERVER}/api/teams/${teamId}/members`);
  const fresh = members
    .filter((m) => m.memberType === 'agent')
    .map((m) => m.actor)
    .find((a) => a.displayName === 'verify-485-created');
  check(
    'create-name-only-persisted',
    fresh != null && fresh.provider === null && fresh.modelId === null,
    `${fresh?.provider}/${fresh?.modelId}`,
  );
  await shot(page, '07-team-after-create.png');

  const doomed = page.locator('[data-testid="team-agent-card"]', { hasText: RENAMED });
  await doomed.click();
  await page.waitForSelector('.agent-overview', { timeout: 15_000 });
  await page.locator('.agent-delete').click();
  await page.waitForSelector('.delete-confirm', { timeout: 15_000 });
  check(
    'delete-confirm-canon-title',
    (await page.locator('.delete-confirm-title').textContent())?.trim() === '删除 Agent？',
    await page.locator('.delete-confirm-title').textContent(),
  );
  check(
    'delete-confirm-canon-body',
    (await page.locator('.delete-confirm-summary').textContent())?.trim() ===
      `将「${RENAMED}」移出团队？该 Agent 进行中的任务将被停止。`,
    await page.locator('.delete-confirm-summary').textContent(),
  );
  await shot(page, '08-delete-confirm.png');

  await page.locator('.delete-confirm-cancel').click();
  await page.waitForSelector('.delete-confirm', { state: 'hidden', timeout: 15_000 });
  check(
    'delete-cancel-keeps-row',
    (await getJson(agentUrl(agentId)).then(
      (r) => r.displayName === RENAMED,
      () => false,
    )) === true,
    '取消后 GET agent 仍 200',
  );

  await page.locator('.agent-delete').click();
  await page.waitForSelector('.delete-confirm', { timeout: 15_000 });
  await page.locator('.delete-confirm-delete').click();
  await page.waitForSelector('[data-route="team"]', { timeout: 15_000 });
  check(
    'delete-lands-on-team',
    new URL(page.url()).pathname === '/app/team',
    page.url(),
  );

  const agentGone = await fetch(agentUrl(agentId), { signal: AbortSignal.timeout(8000) });
  check('delete-row-gone-404', agentGone.status === 404, `GET agent → ${agentGone.status}`);
  const again = await fetch(agentUrl(agentId), {
    method: 'DELETE',
    signal: AbortSignal.timeout(8000),
  });
  check('delete-repeat-404', again.status === 404, `复删 → ${again.status}`);

  const membersAfter = await getJson(`${SERVER}/api/teams/${teamId}/members`);
  const namesAfter = membersAfter
    .filter((m) => m.memberType === 'agent')
    .map((m) => m.actor.displayName);
  check('delete-roster-drops-target', !namesAfter.includes(RENAMED), JSON.stringify(namesAfter));
  check(
    'delete-roster-keeps-neighbor',
    namesAfter.includes('verify-485-created'),
    JSON.stringify(namesAfter),
  );
  const cardsAfter = await page.locator('[data-testid="team-agent-card"]').count();
  check(
    'delete-roster-count-matches-server',
    cardsAfter === namesAfter.length,
    `UI ${cardsAfter} 张卡 / server ${namesAfter.length} 个 Agent`,
  );
  await shot(page, '09-team-after-delete.png');
} finally {
  await browser.close();
}

const ok = checks.every((c) => c.ok);
writeFileSync(
  join(EVIDENCE, 'result.json'),
  `${JSON.stringify(
    {
      probe: 'agent-detail',
      ok,
      at: new Date().toISOString(),
      stack: { api: SERVER, web: WEB, homeDir: join(RUN_DIR, 'home') },
      checks,
      artifacts,
      ...extra,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(
  `\nevidence: ${EVIDENCE}\nallOk=${ok}\n${ok ? 'drive agent-detail:PASS' : 'drive agent-detail:FAIL'}\n`,
);
process.exit(ok ? 0 : 1);
