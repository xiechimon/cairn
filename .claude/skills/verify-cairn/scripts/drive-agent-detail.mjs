#!/usr/bin/env node
// verify-cairn drive-agent-detail — Agent 详情编辑面（#485，r3 §4 实测形态）。
//
// 走真用户路径：团队页点 Agent 卡 → 详情路由 → 概览改名称/职责/模型 → 权限
// 开关（工具六开关 + #510 密钥区聚合总开关）→ 记忆空态 → 回团队页用创建
// 弹窗选模型建 Agent。
//
// 真值 = server 面（不是 UI 回显）：每次编辑后重取 GET
// /api/teams/{id}/agents/{aid} 对字段，创建后重取 members 对 provider/modelId。
// UI 回显成功而 server 没变 = 本 probe 要抓的失败模式（#485 之前 patchAgent
// 是零消费点的死代码，这条缝从没被 web 面走过）。
//
// fixture 面（apps/web e2e 的 agent-detail.spec / agent-create-model.spec）证明
// 交互；本 probe 证明 live 落库。两条都要，互不替代。
// 用法：node <worktree>/.claude/skills/verify-cairn/scripts/drive-agent-detail.mjs

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

// —— 播种：一个 custom provider（模型选择器的候选源）+ 两个团队密钥 +
// 一个 Agent ──────────────────────────────────────────────────────────
await sendJson(`${SERVER}/api/teams/${teamId}/providers`, 'POST', {
  providerId: 'verify-485-gw',
  label: 'verify-485-gw',
  baseUrl: 'https://gw.invalid/v1',
  api: 'anthropic-messages',
  models: [{ id: 'claude-sonnet-5', name: 'claude-sonnet-5' }],
}).catch(() => {}); // 409 = 重跑时已存在
// #510：两个团队密钥。密钥区授权粒度是全有全无——写回的是团队全部密钥 id，
// 只播一个密钥时「全 id 集」与「首个 id」两种实现都过，两个才有牙。
// POST 无幂等键（每次新 id），故断言一律对「点击时 server 的现行 id 集」，
// 重跑留下的旧密钥不会让断言失真。
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
  // —— 1. 团队页卡是链接，点进详情路由 ──────────────────────────────────
  await page.goto(`${WEB}/app/team`);
  await page.waitForSelector('[data-route="team"]', { timeout: 15_000 });
  // #952 维护：.team-agent-card 类名钩已随 #947 退役 → testid 二级载体。
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

  // —— 2. 概览回显 = server 真值 ────────────────────────────────────────
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
  // XMON-18：概览撤掉「状态」行（`agentStatusSchema` 只有一个取值 active）。
  // 判据取**元素计数为零**，比断言文本更能钉住「没长回来 + 撤行没留空壳」。
  // 注意这里是「只撤状态」——思考强度那行要留着，上面那条就是它的看门人。
  const statusRowCount = await page.locator('.agent-status').count();
  check('overview-no-status-row', statusRowCount === 0, `status=${statusRowCount}`);
  // 运行时档 = provider 位派生（本场景 provider = verify-485-gw 这个 custom
  // provider，故直接出 id；内置 pi 时出「内置 (pi)」）。t-0024 起是选择器
  // 触发钮（.agent-runtime-select 句柄，只读 span .agent-runtime 已退役）。
  check(
    'overview-runtime-derived',
    (await page.locator('.agent-runtime-select').textContent())?.includes('verify-485-gw') ===
      true,
    await page.locator('.agent-runtime-select').textContent(),
  );

  // —— 2b. 思考强度档位来自能力读面（XMON-16 / #499 B3）────────────────
  // 读面本体：七档有序（期望值来源 = pi-agent-core 的 ThinkingLevel 联合，
  // 字面量独立写出，不读实现里的常量）。
  const caps = await getJson(`${SERVER}/api/capabilities`);
  check(
    'capabilities-seven-levels',
    JSON.stringify(caps.thinkingLevels) ===
      JSON.stringify(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
    JSON.stringify(caps.thinkingLevels),
  );
  // 只读行按读面呈现：词表内的值呈现；词表外的值不呈现（落「默认」）——
  // 这条是「读面真的接到了 UI 上」的判据，只验端点不算数。
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
  await sendJson(agentUrl(agentId), 'PATCH', { thinkingLevel: null }); // 还原种子态

  // —— 3. 名称行内编辑 → server displayName 变 ──────────────────────────
  await page.locator('.agent-name').click();
  await page.locator('#agent-name-input').fill(RENAMED);
  await page.locator('#agent-name-input').press('Enter');
  await page.waitForTimeout(400); // invalidateAll 重取的落窗
  const afterName = await getJson(agentUrl(agentId));
  check('name-persisted', afterName.displayName === RENAMED, afterName.displayName);

  // —— 4. 职责编辑 → server description 变 ──────────────────────────────
  await page.locator('.agent-role-edit').click();
  await page.locator('#agent-role-input').fill('负责构建与合并');
  await page.locator('.agent-role-save').click();
  await page.waitForTimeout(400);
  const afterRole = await getJson(agentUrl(agentId));
  check('role-persisted', afterRole.description === '负责构建与合并', afterRole.description);
  await shot(page, '02-overview-edited.png');

  // —— 5. 模型槽：清空 → server 置 null；再选回 → server 复原 ───────────
  await page.locator('.agent-model-select').click();
  await page.waitForSelector('.agent-model-menu');
  await page.locator('.agent-model-menu').waitFor({ state: 'visible' });
  await shot(page, '03-model-menu.png');
  // t-0024 两级化 + #770 后：模型候选投影 = model-sources 非 pi 段（providers
  // 段已除）。本栈零机器零 runtime 源 → 菜单恒只有「未设置模型」清空行一条；
  // 清空只清 modelId、provider 留在一级（两级语义）。有候选时的重选路径 =
  // fixture 面 agent-detail.spec / agent-create-model.spec（stub model-sources）
  // 承载，live 面不伪造 runtime 段。
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

  // —— 6. 权限：工具开关 → server tools[] 变 ────────────────────────────
  await page.locator('.agent-tab').nth(2).click();
  await page.waitForSelector('.agent-perms');
  const switches = page.locator('.agent-tool-switch');
  check('perm-six-switches', (await switches.count()) === 6, `${await switches.count()} 个`);
  // XMON-84 B4 后新建 Agent 自带默认工具集（推送分支）——断言取对称差翻转，
  // 不再假设全集恰一。
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

  // —— 6b. 密钥区：一行聚合总开关 → server secrets[] = 团队全 id 集 ────────
  // 有密钥时恰好一行、一个开关（回退成 per-secret 粒度会渲染 N 行 N 开关）。
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
  await page.waitForTimeout(400); // invalidateAll 重取的落窗
  const afterSecretOn = await getJson(agentUrl(agentId));
  check(
    'secret-on-writes-full-id-set',
    afterSecretOn.secrets.length === allSecretIds.length &&
      allSecretIds.every((id) => afterSecretOn.secrets.includes(id)),
    `写回 ${JSON.stringify(afterSecretOn.secrets)}；团队全 id 集 ${JSON.stringify(allSecretIds)}`,
  );
  // 勾选态 = agent.secrets 非空：重取回来的真值仍非空 → 开关保持勾选。
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

  // —— 7. 记忆 tab：canon 空态 ──────────────────────────────────────────
  await page.locator('.agent-tab').nth(1).click();
  await page.waitForSelector('.agent-memories');
  check(
    'memory-empty-canon',
    (await page.locator('.agent-memory-empty').textContent())?.trim() ===
      '尚无记忆。Agent 会在工作中将值得沉淀的经验存入此处。',
  );

  // —— 8. 创建弹窗（#770/t-0024 后形态）：本栈零机器 → model-sources 无非 pi
  // 段 → 弹窗出告警行 + 配置服务商外链（不出模型选择器）；仅名称也能创建落库
  // （provider/modelId 落 null）。有 runtime 候选时的两级选择路径 = fixture 面
  // agent-create-model.spec（stub model-sources）承载，live 面不伪造。
  // #952/#910 载体：.team-create-agent 类钩退役（#947）→ role=button 文案一级；
  // 壳 scope = getByRole(dialog) 可及名「创建 agent」；名称输入 = getByLabel。
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

  // —— 9. 删除 Agent（XMON-19/B2）：概览入口 → 二次确认 → live 落库 ────────
  // 真值面三件：GET agent → 404（行真没了）；members 名单里该 Agent 消失而
  // 邻居留存；复删仍 404（DELETE_FACE 族律）。取消路径单独钉：确认层可关且
  // server 行毫发无损（误删通道）。
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

  // 取消路径：层关掉、人留在详情页、server 行还在。
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

  // 确认路径
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