// persona seeding 服务（#1250 / ADR 0018 决策 0）：六名角色 agent 按团队
// 幂等落库（缺谁补谁，形态对齐 seedFixedTags 的启动补齐）。
//
// 设计钉死（票面 + ADR + 施工期实测）：
// - description = shared PERSONA_PROFILES 的 persona 契约全文（role/scope/
//   output format/rules + Composition 块）——seeding 只搬运不加工，单源在
//   shared，改契约 = 改 shared（server 不持第二份）。
// - thinkingLevel = 档位注记落位（高档/中高档/中档 → xhigh/high/medium）；
//   档位差走 effort 档，模型不按角色区分（模型清单无档位元数据——「按当时
//   模型清单定值」的诚实落法 = 全员同一可领模型 + effort 分档）。
// - provider/modelId = 当时模型清单的**可领值**（claim 闸硬要求 modelId 非空
//   ——machines.ts「Agent 在但无模型位 = 不可领」；留 null 的角色 agent 是
//   永远 pending 的死步）。取值序 = claude-code（上报机器的 settings.json 模
//   型）→ pi（自定义 provider 首个模型）→ 都没有时 null（服务端此刻无任何
//   模型真值可填，落 null 等下次启动补齐或用户 PATCH——只有 null 会补，用户
//   设置过的值永不覆盖）。#1259 归属机落地前这是唯一不造「机器没配的模型」
//   洞的填法：值来自机器真实上报或用户自配 provider，不是拍脑袋常量。
// - 幂等键 = (teamId, persona)——已在位的角色行不动（编辑保留），缺谁补谁
//   （删除的角色下次启动复活——seedFixedTags 同语义；要永久摘角 =
//   PATCH persona: null，不是删 agent 行）。
// - 工具开关 = 档案缺省集（Implementer/Verifier 推送分支；其余空——
//   只读角色不持交付面权限）。

import { PERSONA_PROFILES, type PersonaRole } from '@pacman/shared';
import { and, asc, eq, like } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, machine as machineTable, provider as providerTable, team } from '../db/schema.js';
import { newRecordId } from '../lib/ids.js';

/** 当时模型清单的可领模型（claim 闸要求的 provider+modelId 二元组）：
 *  claude-code 上报优先（自托管主车道——machine.claudeCodeReport 现读，
 *  default 槽模型优先），回落 pi 自定义 provider 首模（provider 表 models
 *  列明文直读）；两者皆空 = null（此刻无模型真值，等补齐/用户配置）。
 *  直读表列而非 getModelSources：后者 ProviderDeps 必带 box（密钥解密面），
 *  模型清单本身是明文 json，seed 面不需要密钥。 */
function pickPersonaModel(db: Db, teamId: string): { provider: string; modelId: string } | null {
  for (const row of db
    .select({ report: machineTable.claudeCodeReport })
    .from(machineTable)
    .where(eq(machineTable.teamId, teamId))
    .orderBy(asc(machineTable.name))
    .all()) {
    const report = row.report;
    if (report === null || report.models.length === 0) continue;
    const model = report.models.find((m) => m.slot === 'default') ?? report.models[0]!;
    return { provider: 'claude-code', modelId: model.id };
  }
  for (const p of db.select().from(providerTable).where(eq(providerTable.teamId, teamId)).all()) {
    const model = p.models.find((m) => m.id !== '');
    if (model !== undefined && p.providerId !== '') {
      return { provider: p.providerId, modelId: model.id };
    }
  }
  return null;
}

/** #1259：persona 的归属机 = 团队 mea 机（name LIKE 'mea%' 惯例，与迁移
 *  回填同口径）；团队无机（daemon 未接入）= null——卡片出「未设归属机」
 *  警示，接入后补值（下方 null 补值半边同律）。 */
function pickPersonaHome(db: Db, teamId: string): string | null {
  const row = db
    .select({ id: machineTable.id })
    .from(machineTable)
    .where(and(eq(machineTable.teamId, teamId), like(machineTable.name, 'mea%')))
    .get();
  return row?.id ?? null;
}

/** 为单个团队补齐 persona 角色 agent（缺谁补谁 + null 模型补值）。返回新
 *  插入的行数。已在位的角色行不动（编辑保留）；modelId 为 null 的角色行在
 *  模型清单有值时补值（用户设置过的值永不覆盖）。 */
export function ensurePersonasSeeded(db: Db, teamId: string): number {
  const pick = pickPersonaModel(db, teamId);
  const home = pickPersonaHome(db, teamId);
  let inserted = 0;
  for (const profile of PERSONA_PROFILES) {
    const existing = db
      .select()
      .from(agent)
      .where(and(eq(agent.teamId, teamId), eq(agent.persona, profile.role)))
      .get();
    if (existing !== undefined) {
      // 补值半边：null 模型 + 清单有值 → 填（用户值不碰）。provider 同步
      // 只在 modelId 为 null 时发生（二元组原子填，不拆开配半对）。
      if (existing.modelId === null && pick !== null) {
        db.update(agent)
          .set({ provider: pick.provider, modelId: pick.modelId })
          .where(eq(agent.id, existing.id))
          .run();
      }
      // 归属机补值（#1259）：null + mea 机在 → 填（用户换绑过的值不碰——
      // 非 null 即用户态）。
      if (existing.machineId === null && home !== null) {
        db.update(agent).set({ machineId: home }).where(eq(agent.id, existing.id)).run();
      }
      continue;
    }
    db.insert(agent)
      .values({
        id: newRecordId(),
        teamId,
        displayName: profile.displayName,
        description: profile.description,
        status: 'active',
        avatarUrl: null,
        provider: pick?.provider ?? null,
        modelId: pick?.modelId ?? null,
        thinkingLevel: profile.thinkingLevel,
        persona: profile.role,
        tools: [...profile.tools],
        secrets: [],
        defaultSkill: null,
        skillsAllowlist: null,
        mcpServers: [],
        maxConcurrentTasks: null,
        machineId: home,
      })
      .run();
    inserted += 1;
  }
  return inserted;
}

/** 启动补齐：存量团队逐个 ensurePersonasSeeded（幂等，空集零动作）。 */
export function backfillPersonas(db: Db): void {
  const rows = db.select({ id: team.id }).from(team).all();
  for (const row of rows) {
    ensurePersonasSeeded(db, row.id);
  }
}

/** 按角色解析团队的 persona agent 行（fan-out / 指派默认槽位共用）；
 *  未 seeding / 已删除 = null（调用方回落或点名缺谁）。 */
export function personaAgent(
  db: Db,
  teamId: string,
  role: PersonaRole,
): typeof agent.$inferSelect | null {
  return (
    db
      .select()
      .from(agent)
      .where(and(eq(agent.teamId, teamId), eq(agent.persona, role)))
      .get() ?? null
  );
}
