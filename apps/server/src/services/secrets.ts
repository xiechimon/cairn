// secret 服务面（团队密钥；CONTEXT.md 强制拆两义：secret ≠ apiKey）。
// 02 §8：值按 Agent 授权、在需要它的执行步经取用通道下发（不预置进任务 shell
// 环境）、只写不读（保存后只能覆盖或删除，无法再次查看，r2 §6.3）、密文经
// SecretBox（AES-256-GCM + keyfile，01 §4.2）。
// API 面纪律：GET 永不返回 value（record 投影 = shared secretRecordSchema）。

import type { SecretBox, SecretRecord } from '@cairn/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { secret } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { newRecordId } from '../lib/ids.js';

export interface SecretDeps {
  db: Db;
  box: SecretBox;
}

type SecretRow = typeof secret.$inferSelect;

export function toSecretRecord(row: SecretRow): SecretRecord {
  return { id: row.id, teamId: row.teamId, name: row.name, description: row.description };
}

function getRow(deps: SecretDeps, teamId: string, id: string): SecretRow | undefined {
  return deps.db
    .select()
    .from(secret)
    .where(and(eq(secret.id, id), eq(secret.teamId, teamId)))
    .get();
}

/** 密钥名团队内唯一 [设计]：取用通道与 wire 槽均按名寻址（02 §8），重名
 * 会使下发歧义；wire 真值未采（04 §3 不判负）。 */
function assertNameFree(deps: SecretDeps, teamId: string, name: string, exceptId?: string): void {
  const dup = deps.db
    .select({ id: secret.id })
    .from(secret)
    .where(and(eq(secret.teamId, teamId), eq(secret.name, name)))
    .all()
    .find((r) => r.id !== exceptId);
  if (dup) throw conflict(`secret ${name} already exists`);
}

export function listSecrets(deps: SecretDeps, teamId: string): SecretRecord[] {
  return deps.db
    .select()
    .from(secret)
    .where(eq(secret.teamId, teamId))
    .orderBy(asc(secret.name))
    .all()
    .map(toSecretRecord);
}

export function createSecret(
  deps: SecretDeps,
  input: { teamId: string; name: string; description?: string | null; value: string },
): SecretRecord {
  assertNameFree(deps, input.teamId, input.name);
  const id = newRecordId();
  deps.db
    .insert(secret)
    .values({
      id,
      teamId: input.teamId,
      name: input.name,
      description: input.description ?? null,
      valueCipher: deps.box.seal(input.value), // 只写位：明文不落库（02 §8）
    })
    .run();
  const row = getRow(deps, input.teamId, id);
  if (!row) throw new Error('secret missing after insert');
  return toSecretRecord(row);
}

/** 覆盖 = PATCH 带 value 重密封（「保存后只能覆盖或删除」r2 §6.3）。 */
export function updateSecret(
  deps: SecretDeps,
  teamId: string,
  id: string,
  patch: { name?: string; description?: string | null; value?: string },
): SecretRecord {
  const row = getRow(deps, teamId, id);
  if (!row) throw notFound(`secret ${id}`);
  if (patch.name !== undefined && patch.name !== row.name) {
    assertNameFree(deps, teamId, patch.name, id);
  }
  deps.db
    .update(secret)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.value !== undefined ? { valueCipher: deps.box.seal(patch.value) } : {}),
    })
    .where(eq(secret.id, id))
    .run();
  const updated = getRow(deps, teamId, id);
  if (!updated) throw new Error('secret missing after update');
  return toSecretRecord(updated);
}

export function deleteSecret(deps: SecretDeps, teamId: string, id: string): boolean {
  const row = getRow(deps, teamId, id);
  if (!row) return false;
  deps.db.delete(secret).where(eq(secret.id, id)).run();
  return true;
}

/** per-step 下发读点（02 §8 运行时层）：授权集（agent.secrets [推断] 关联
 * secret id，records/agent.ts 注同）→ 名字 → 明文。明文只进返回值
 * （daemon 内存持有，不落盘）；引用已删 id 静默跳过 [设计]。
 * 本读点只解值，不下发形状决策——按 step kind 的收窄在调用方
 * （services/credentials.ts，records/step.ts stepTakesSecrets）。 */
export function openSecretValues(
  deps: SecretDeps,
  teamId: string,
  ids: readonly string[],
): Record<string, string> {
  if (ids.length === 0) return {};
  const rows = deps.db
    .select()
    .from(secret)
    .where(and(eq(secret.teamId, teamId), inArray(secret.id, [...ids])))
    .all();
  const values: Record<string, string> = {};
  for (const row of rows) {
    if (row.valueCipher === null) continue; // 无值行不下发 [设计]
    values[row.name] = deps.box.open(row.valueCipher);
  }
  return values;
}
