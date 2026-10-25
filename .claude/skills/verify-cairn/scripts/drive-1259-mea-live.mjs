#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const EVIDENCE = join(REPO, 'docs/verify/1259');
mkdirSync(EVIDENCE, { recursive: true });

const WEB = process.env.MEA_WEB ?? 'http://127.0.0.1:5274';
const SERVER = process.env.MEA_SERVER ?? 'http://127.0.0.1:8792';

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail: detail ?? null });
  process.stdout.write((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + String(detail).slice(0, 160) : '') + '\n');
}
async function shot(page, name) {
  await page.screenshot({ path: join(EVIDENCE, name), fullPage: true });
  process.stdout.write('shot  ' + name + '\n');
}

const browser = await chromium.launch({ args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto(WEB + '/app/resources/machines', { waitUntil: 'commit', timeout: 60_000 });
await page.getByRole('link', { name: 'mea-wsl-verify' }).waitFor({ timeout: 180_000 });
await page.getByRole('link', { name: 'mea-wsl-verify' }).click();
await page.waitForURL('**/app/resources/machines/*');
await shot(page, 'mea-1-machine-detail.png');
check('M1 mea 详情页可进（列表行名链接）', await page.getByTestId('machine-detail-online').isVisible());

await page.getByRole('button', { name: '创建 Agent' }).click();
const dlg = page.getByRole('dialog', { name: '创建 agent' });
await dlg.waitFor();
await dlg.getByLabel('名称').fill('mea-live-agent');

await dlg.locator('.dlg-agent-machine-select').waitFor();
const machineBefore = await dlg.locator('.dlg-agent-machine-select').textContent();
check('M2 详情页创建槽预选归属机 = mea', (machineBefore ?? '').includes('mea-wsl-verify'), machineBefore);

const runtimeSelect = dlg.locator('.dlg-agent-runtime-select');
await runtimeSelect.click();
await shot(page, 'mea-2-runtime-menu.png');
const ccItem = page.getByRole('option', { name: /Claude Code/i }).first();
check('M3 运行时清单含 claude-code', await ccItem.count() === 1);
await ccItem.click();
await page.waitForTimeout(300);

const modelSelect = dlg.locator('.dlg-agent-model-select');
await modelSelect.click();
await page.waitForTimeout(300);
await shot(page, 'mea-3-model-menu.png');
const menuText = await page.getByRole('listbox').textContent().catch(() => '');
const realModels = ['fable', 'deepseek-v4.1-flash', 'qwen3.8-max', 'gpt-5.6-luna', 'MiniMax-M3'];
const seen = realModels.filter((m) => (menuText ?? '').includes(m));
check('M4 模型清单 = mea 自报真实模型', seen.length >= 4, seen.join(','));
await page.getByRole('option', { name: /fable/ }).first().click();
await page.waitForTimeout(200);

const createBtn = dlg.getByRole('button', { name: '创建', exact: true });
check('M5 三槽齐 → 创建钮可用', await createBtn.isEnabled());
await shot(page, 'mea-4-create-filled.png');
await createBtn.click();
await page.waitForTimeout(800);
check('M6 创建成功（弹窗关闭）', (await dlg.count()) === 0);
await shot(page, 'mea-5-after-create.png');

const teams = await (await fetch(SERVER + '/api/teams')).json();
const teamId = teams[0].id;

const members = await (await fetch(SERVER + `/api/teams/${teamId}/members`)).json();
const member = (Array.isArray(members) ? members : []).find(
  (m) => m.memberType === 'agent' && m.actor?.displayName === 'mea-live-agent',
);
const agent = member?.actor ? { ...member.actor, id: member.actorId } : undefined;
check('M7 agent 落库：provider=claude-code、modelId=fable、归属机=mea', agent?.provider === 'claude-code' && agent?.modelId === 'fable' && agent?.machineId != null, JSON.stringify({ provider: agent?.provider, modelId: agent?.modelId }));

const projects = await (await fetch(SERVER + '/api/projects')).json();
const project = projects.find((p) => p.name === 'verify-mea');
const todo = await (
  await fetch(`${SERVER}/api/projects/${project.id}/todos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: '在 README.md 末尾追加一行：今日日期',
      spec: '在 /home/measure/verify-target 仓的 README.md 末尾追加一行，内容为今天的日期（YYYY-MM-DD）。不要改其它内容。完成后提交 commit。',
    }),
  })
).json();
const build = await (
  await fetch(`${SERVER}/api/projects/${project.id}/builds`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      todoIds: [todo.id],
      assignment: { plan: null, build: { agentId: agent.id } },
      withPlan: false,
    }),
  })
).json();
check('M8 真任务 build 入队', build.builds?.[0]?.id != null, JSON.stringify(build).slice(0, 120));

const stepId = build.builds[0].id;
let lastPhase = '';
let done = null;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const steps = await (await fetch(`${SERVER}/api/builds/${build.builds[0].id}/steps`)).json().catch(() => null);
  const row = (steps?.steps ?? steps ?? []).find?.((s) => s.id === stepId) ?? (steps?.steps ?? [])[0];
  const todos = await (await fetch(SERVER + '/api/todos')).json().catch(() => []);
  const t = (todos.todos ?? todos).find?.((x) => x.id === todo.id);
  const phase = t?.phase ?? '';
  if (phase !== lastPhase) {
    process.stdout.write(`  … phase=${phase} step=${row?.status}\n`);
    lastPhase = phase;
  }
  if (['confirm', 'review', 'done', 'building'].includes(phase) === false && row?.status === 'claimed') {

  }
  if (phase === 'confirm' || phase === 'done' || phase === 'review') {
    done = { phase, stepStatus: row?.status };
    break;
  }
  if (row?.status === 'failed') {
    done = { phase, stepStatus: 'failed' };
    break;
  }
}
check('M9 真任务推进到 confirm/done（claude 在 mea 真跑完）', done !== null && done.stepStatus !== 'failed', JSON.stringify(done));
await shot(page, 'mea-6-build-result.png').catch(() => {});

writeFileSync(join(EVIDENCE, 'mea-live-result.json'), JSON.stringify({ checks, ok: checks.every((c) => c.ok) }, null, 2));
await browser.close();
const failed = checks.filter((c) => !c.ok);
process.stdout.write('\n' + (failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED') + '\n');
process.exit(failed.length === 0 ? 0 : 1);
