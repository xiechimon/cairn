// provider 服务面（02 §6.2 record 形状 = r3 §2 实测原样 + §8 密钥纪律）。
// API 面纪律（02 §8）：apiKey 只写不读——record 投影刻意不含 apiKey 字段
// （shared providerRecordSchema 同判），值经 SecretBox 密封落 [内部]
// apiKeyCipher 列；keyfile 丢失 = 存量 provider key 报废需重录（README 护栏）。
// presets[] 38 项目录单源 = shared PROVIDER_PRESET_IDS/OAUTH/XAI 常量（r3 §2）。
// model-sources 面（spec 11 §A3/A4，#356；#707 起 claude-code 段跟随执行机）：
// providers 页 runtime tabs 的数据契约——pi 段 = custom providers models[]
// 投影；claude-code 段 = 各执行机 daemon 上报的本机 settings.json 解析结果
// （server 按机器聚合，不读本机文件）。
// fs 直读 helper（claudeCodeModelSource）为 chief 收单回落（#774）保留。

import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  type ModelSource,
  type ModelSourceModel,
  type ModelSourcesEnvelope,
  PROVIDER_OAUTH_PRESET_IDS,
  PROVIDER_PRESET_IDS,
  PROVIDER_XAI_PRESET,
  type ProviderCompat,
  type ProviderPreset,
  type ProviderRecord,
  type SecretBox,
} from '@pacman/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { machine, provider } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { mergedCatalogModels } from './model-liveness.js';

export interface ProviderDeps {
  db: Db;
  box: SecretBox;
}

type ProviderRow = typeof provider.$inferSelect;

/** GET 封套的 presets[] 段（r3 §2：auth:"oauth" 仅二项 + xai 双通道
 * oauthLabel，其余 api_key；目录外字段未采 [推断] 不发明）。 */
export function providerPresets(): ProviderPreset[] {
  const oauthIds: readonly string[] = PROVIDER_OAUTH_PRESET_IDS;
  return PROVIDER_PRESET_IDS.map((id) => ({
    id,
    auth: oauthIds.includes(id) ? ('oauth' as const) : ('api_key' as const),
    ...(id === PROVIDER_XAI_PRESET.id ? { oauthLabel: PROVIDER_XAI_PRESET.oauthLabel } : {}),
  }));
}

export function toProviderRecord(row: ProviderRow): ProviderRecord {
  return {
    // 表内仅 custom 行（内置 built-in provider 走 Pro，不在复刻范围，02 §2.4）。
    kind: 'custom',
    providerId: row.providerId,
    label: row.label,
    baseUrl: row.baseUrl,
    api: row.api,
    authHeader: row.authHeader,
    compat: row.compat,
    models: row.models,
    id: row.id,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface ProviderBody {
  providerId: string;
  label: string;
  baseUrl: string;
  api: ProviderRecord['api'];
  authHeader?: boolean;
  compat?: ProviderCompat;
  models?: { id: string; name: string }[];
  /** 只写位（02 §8）：string = 密封存储；null = 清除（「可以替换或删除」）。 */
  apiKey?: string | null;
}

function getRow(deps: ProviderDeps, teamId: string, id: string): ProviderRow | undefined {
  return deps.db
    .select()
    .from(provider)
    .where(and(eq(provider.id, id), eq(provider.teamId, teamId)))
    .get();
}

function assertProviderIdFree(
  deps: ProviderDeps,
  teamId: string,
  providerId: string,
  exceptId?: string,
): void {
  // providerId 团队内唯一 [设计]：机器日志 `using model <provider>/<modelId>`
  // 与 per-step 凭证解析都按 providerId 寻址（r3 §1.5/§2）。
  const dup = deps.db
    .select({ id: provider.id })
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, providerId)))
    .all()
    .find((r) => r.id !== exceptId);
  if (dup) throw conflict(`provider ${providerId} already exists`);
}

export function listProviders(deps: ProviderDeps, teamId: string): ProviderRecord[] {
  return deps.db
    .select()
    .from(provider)
    .where(eq(provider.teamId, teamId))
    .orderBy(asc(provider.createdAt))
    .all()
    .map(toProviderRecord);
}

/** GET /api/teams/{id}/providers 封套 [推断]：presets[] 字段实测在位
 * （r3 §2），与 custom 记录同封套并列的包络形未采到。 */
export function getProvidersEnvelope(
  deps: ProviderDeps,
  teamId: string,
): { presets: ProviderPreset[]; providers: ProviderRecord[] } {
  return { presets: providerPresets(), providers: listProviders(deps, teamId) };
}

/** claude-code 槽位键模式：env.ANTHROPIC_<SLOT>_MODEL。ANTHROPIC_MODEL
 *  本体无中段（`ANTHROPIC_` 与 `_MODEL` 之间需至少一段）天然不命中，
 *  不会与顶层 model 的 default 槽撞名。 */
const CLAUDE_MODEL_SLOT_PATTERN = /^ANTHROPIC_([A-Z0-9_]+)_MODEL$/;

/** claude-code 段（spec 11 §A4）：server 端 fs 直读 settings.json——
 *  文件缺失 / 非法 JSON / 非对象 JSON 一律 installed:false，不空报不崩。
 *  槽值非字符串或空串的项跳过（installed 仍为 true）。
 *  导出供 chief 收单回落（#774）复用同源：回落判据与 model-sources 读面同文件。 */
export function claudeCodeModelSource(homeDir: string): ModelSource {
  const host = hostname();
  const notInstalled: ModelSource = {
    runtime: 'claude-code',
    installed: false,
    hostname: host,
    models: [],
  };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(homeDir, '.claude', 'settings.json'), 'utf8'));
  } catch {
    return notInstalled;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return notInstalled;
  const settings = raw as { model?: unknown; env?: unknown };
  const models: ModelSourceModel[] = [];
  if (typeof settings.model === 'string' && settings.model !== '') {
    models.push({ id: settings.model, name: settings.model, slot: 'default' });
  }
  const env = settings.env;
  if (typeof env === 'object' && env !== null && !Array.isArray(env)) {
    for (const [key, value] of Object.entries(env)) {
      const match = CLAUDE_MODEL_SLOT_PATTERN.exec(key);
      const slot = match?.[1];
      if (slot === undefined || typeof value !== 'string' || value === '') continue;
      models.push({ id: value, name: value, slot: slot.toLowerCase().replace(/_/g, '-') });
    }
  }
  return { runtime: 'claude-code', installed: true, hostname: host, models };
}

/** 上报过的机器的 claude-code 段（#707 model-sources 按机器聚合面）：
 *  每台上报过的机器一段（installed 如实，含 false），hostname = daemon
 *  上报的本机 hostname。从未上报的机器（旧 daemon）缺席、不下发假清单。
 *  按机器名排序，序固定。 */
export function listClaudeCodeSources(db: Db, teamId: string): ModelSourcesEnvelope['sources'] {
  return db
    .select()
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .orderBy(asc(machine.name))
    .all()
    .flatMap((row) => {
      const report = row.claudeCodeReport;
      if (report === null) return [];
      return [
        {
          runtime: 'claude-code' as const,
          installed: report.installed,
          hostname: report.hostname,
          // #1259 归属机维：段与机器行同 id（创建三级级联的过滤键）。
          machineId: row.id,
          models: report.models,
          // #1050 两个事实位原样透传（server 不合成、不猜）：`bin` = null
          // 是「探过了、没有」（页面对它说未安装），键缺席才是「没探过」
          // （老 daemon，UI 闭嘴）；`auth` 缺席 = 该机器还没跑过 claude-code
          // 步（预检未发生）。
          ...(report.bin !== undefined ? { bin: report.bin } : {}),
          ...(report.auth !== undefined ? { auth: report.auth } : {}),
        },
      ];
    });
}

/** GET /api/teams/{id}/model-sources 封套（spec 11 数据契约 + #707）：
 *  pi 一段（custom providers models[] 投影 ∪ relay 目录探活结果，按 model id
 *  去重、活性取严，空 id 行丢弃、空 name 回退 id——封套须过 shared
 *  modelSourcesEnvelopeSchema）+ 每台上报过的机器一段 claude-code（序固定：
 *  pi 首 + 按机器名）。
 *  从未上报的机器缺席——server 不读本机 settings.json，不下发假清单。
 *  #1288：pi 段模型带活性标注（alive/dead/unknown，缺省 unknown fail-open）；
 *  探活结果按 providerId 缓存（60s），未探测过的 provider 模型标 unknown。 */
export function getModelSources(deps: ProviderDeps, teamId: string): ModelSourcesEnvelope {
  // 合并目录（探活结果，活性取严）——先于用户录入的 models[] 投影，保证
  // relay /v1/models 的全量目录出现在选择器候选里（#1288 问题 1）。
  const catalog = mergedCatalogModels();
  const catalogIds = new Set(catalog.map((m) => m.id));
  const piModels: ModelSourceModel[] = [...catalog];
  for (const p of listProviders(deps, teamId)) {
    for (const m of p.models) {
      if (m.id === '' || catalogIds.has(m.id)) continue;
      // 用户录入但目录探活未见：unknown（fail-open，不置灰不拒绝）。
      piModels.push({
        id: m.id,
        name: m.name !== '' ? m.name : m.id,
        liveness: 'unknown',
      });
    }
  }
  return {
    sources: [
      { runtime: 'pi', installed: true, hostname: hostname(), models: piModels },
      ...listClaudeCodeSources(deps.db, teamId),
    ],
  };
}

export function createProvider(
  deps: ProviderDeps,
  input: { teamId: string; body: ProviderBody; createdBy: string },
): ProviderRecord {
  const { body } = input;
  assertProviderIdFree(deps, input.teamId, body.providerId);
  const now = nowMs();
  const id = newRecordId();
  deps.db
    .insert(provider)
    .values({
      id,
      teamId: input.teamId,
      kind: 'custom',
      providerId: body.providerId,
      label: body.label,
      baseUrl: body.baseUrl,
      api: body.api,
      authHeader: body.authHeader ?? true, // Bearer 复选默认勾（r3 §2 样本值）
      compat: body.compat ?? { supportsDeveloperRole: false }, // 样本值默认 [推断]
      models: body.models ?? [],
      apiKeyCipher: body.apiKey ? deps.box.seal(body.apiKey) : null,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const row = getRow(deps, input.teamId, id);
  if (!row) throw new Error('provider missing after insert');
  return toProviderRecord(row);
}

export function updateProvider(
  deps: ProviderDeps,
  teamId: string,
  id: string,
  patch: Partial<ProviderBody>,
): ProviderRecord {
  const row = getRow(deps, teamId, id);
  if (!row) throw notFound(`provider ${id}`);
  if (patch.providerId !== undefined && patch.providerId !== row.providerId) {
    assertProviderIdFree(deps, teamId, patch.providerId, id);
  }
  deps.db
    .update(provider)
    .set({
      ...(patch.providerId !== undefined ? { providerId: patch.providerId } : {}),
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl } : {}),
      ...(patch.api !== undefined ? { api: patch.api } : {}),
      ...(patch.authHeader !== undefined ? { authHeader: patch.authHeader } : {}),
      ...(patch.compat !== undefined ? { compat: patch.compat } : {}),
      ...(patch.models !== undefined ? { models: patch.models } : {}),
      // 只写位三态：undefined 保持 / null 清除 / string 重密封（02 §8）。
      ...(patch.apiKey !== undefined
        ? { apiKeyCipher: patch.apiKey === null ? null : deps.box.seal(patch.apiKey) }
        : {}),
      updatedAt: nowMs(),
    })
    .where(eq(provider.id, id))
    .run();
  const updated = getRow(deps, teamId, id);
  if (!updated) throw new Error('provider missing after update');
  return toProviderRecord(updated);
}

export function deleteProvider(deps: ProviderDeps, teamId: string, id: string): boolean {
  const row = getRow(deps, teamId, id);
  if (!row) return false;
  deps.db.delete(provider).where(eq(provider.id, id)).run();
  return true;
}

/** per-step 下发读点（02 §8 运行时层）：按 providerId 解出密钥明文——
 * 只进内存（executor 持有，不落盘 [推断] r3 注记沿用），调用面 =
 * services/credentials.ts（M3 `/api/machine/token/{stepId}` 挂接）。 */
export function openProviderKey(
  deps: ProviderDeps,
  teamId: string,
  providerId: string,
): { row: ProviderRow; apiKey: string | null } | null {
  const row = deps.db
    .select()
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, providerId)))
    .get();
  if (!row) return null;
  return { row, apiKey: row.apiKeyCipher === null ? null : deps.box.open(row.apiKeyCipher) };
}
