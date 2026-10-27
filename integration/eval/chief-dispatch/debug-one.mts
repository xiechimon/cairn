#!/usr/bin/env -S pnpm exec tsx
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RosterAgent } from './grade.mts';
import {
  bootStack,
  driveTurn,
  relayBaseUrl,
  relayKey,
  resolveFromRoot,
  seedWorld,
} from './stack.mts';

const FLOW = process.argv[2];
const CASE_ID = process.argv[3];
if (FLOW === undefined || CASE_ID === undefined) {
  console.error('用法: debug-one.mts <flow 目录> <case id>');
  process.exit(2);
}
const flowDir = resolveFromRoot(FLOW);
const d = JSON.parse(readFileSync(join(flowDir, 'cases.json'), 'utf8')) as {
  roster: RosterAgent[];
  cases: { id: string; prompt: string; expect: { kind: string; agent?: string } }[];
};
const c = d.cases.find((x) => x.id === CASE_ID);
if (c === undefined) throw new Error(`${CASE_ID} 不在 ${flowDir}/cases.json 里`);

const stack = await bootStack();
try {
  const world = await seedWorld(stack, {
    relayBaseUrl: relayBaseUrl(),
    relayKey: relayKey(),
    roster: d.roster,
    chiefModelId: 'glm-5.3',
  });
  console.log('=== roster → agentId ===');
  for (const r of d.roster) {
    console.log(
      `  ${r.key.padEnd(9)} ${r.displayName.padEnd(6)} ${r.modelId.padEnd(14)} → ${world.agentIds[r.key]}`,
    );
  }
  console.log(
    `  chief 绑定 → ${world.chiefAgentId}（即 ${Object.entries(world.agentIds).find(([, v]) => v === world.chiefAgentId)?.[0]}）`,
  );
  console.log(
    `  期望：${c.expect.kind}${c.expect.agent ? ` → ${c.expect.agent}（${world.agentIds[c.expect.agent]}）` : ''}`,
  );

  const ev = await driveTurn(stack, c.prompt, { timeoutMs: 600_000 });
  console.log('\n=== run_builds 实参 ===');
  for (const a of ev.runBuildsArgs) console.log(' ', JSON.stringify(a));
  console.log('\n=== todo 行（新建）===');
  for (const t of ev.createdTodoRows) {
    const key = Object.entries(world.agentIds).find(([, v]) => v === t.buildAgentId)?.[0] ?? '?';
    console.log(`  ${t.id} phase=${t.phase} buildAgentId=${t.buildAgentId} → 归属 key=${key}`);
  }
  console.log('\n=== 正文里点名了谁 ===');
  for (const r of d.roster) {
    if (ev.assistantText.includes(r.displayName)) console.log(`  提到 ${r.displayName}`);
  }
  console.log('\n=== 正文尾部 ===');
  console.log(ev.assistantText.slice(-600));
} finally {
  await stack.close();
}
process.exit(0);
