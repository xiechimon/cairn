// per-step 凭证下发接口面（02 §8 运行时层 + 02 §5.4 `/api/machine/token/{stepId}`
// 的服务端解析契约——HTTP 端点归 M3 机器面，本层先行；载荷细形 [推断]，
// wire 未采（r3 §1.6 仅端点名 + git fetch 无凭证失败旁证；r5 §3.1 relay 工具名
// `push_credential` 坐实 per-step 下发语义）。
// 纪律（02 §8）：明文只出现在返回值——executor 内存持有、不落盘常驻
// （[推断] r3 注记原样继承）；本层不落库、不写日志。
// 解析链：step → build → todo → assignment 执行侧槽 → agent → provider 行
// （按 providerId 寻址 [推断]，r3 §1.5 `using model <provider>/<modelId>` 同串）
// → SecretBox 解密；secrets = agent.secrets 授权集（records/agent.ts [推断]
// 关联 secret id）∩ 本步 kind 的取用面（records/step.ts stepTakesSecrets：
// plan/review/chief 步恒空）→ 名字 → 明文。明文只进返回值，**不铺进 agent
// 进程环境**——daemon 持有真值，agent 经本地取用通道显式取用。

import {
  type ProviderApi,
  type ProviderCompat,
  type ProviderModel,
  type SecretBox,
  stepTakesSecrets,
} from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, apiKey, build, chief, chiefThread, step, todo } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { createApiKey } from './api-keys.js';
import { openProviderKey, type ProviderDeps } from './providers.js';
import { openSecretValues, type SecretDeps } from './secrets.js';

export interface CredentialsDeps {
  db: Db;
  box: SecretBox;
}

/** per-step 一次性 git 凭证（M3b，02 §5.4/§8「模型 key + 托管 repo git
 * 凭证」的 git 半；relay 工具名对照 = `push_credential`，r5 §3.1）。
 * [设计]：发行 = apiKey 行（gitAccess=true，name `git-step-<stepId>` 幂等键，
 * 服务端只存哈希）；明文仅出现在 token/{stepId} 响应（daemon 内存持有，
 * 不落盘常驻）；步收尾（done，成败均）即回收 = 撤销面随 per-step 生命周期，
 * 非全局撤销（apiKey「撤销面未观测」纪律不破——本行类型是本服务自发的
 * 内部凭证，不进用户 api-keys 管理面语义）。 */
export function issueStepGitCredential(
  deps: { db: Db },
  input: { teamId: string; stepId: string },
): { username: string; password: string } {
  revokeStepGitCredential(deps, input.stepId); // 幂等重取（recover 二次 token）
  const issued = createApiKey(deps, {
    teamId: input.teamId,
    name: stepGitKeyName(input.stepId),
    gitAccess: true,
    mcpAccess: false,
    toolGrants: { read: [], write: [] },
  });
  return { username: 'git', password: issued.plaintext };
}

export function revokeStepGitCredential(deps: { db: Db }, stepId: string): void {
  deps.db
    .delete(apiKey)
    .where(eq(apiKey.name, stepGitKeyName(stepId)))
    .run();
}

function stepGitKeyName(stepId: string): string {
  return `git-step-${stepId}`;
}

/** 下发载荷 [推断]（02 §5.4 token 端点注 =「模型 key + 托管 repo git 凭证」；
 * git 槽 = issueStepGitCredential 发行面（M3b），解析链本层仍恒 null——发行
 * 需 teamId/step 上下文，归 machines.stepToken 组装）。 */
export interface StepCredentialBundle {
  /** 模型凭证（provider key 明文，内存 only）；null = 未指派 / provider 未配。 */
  provider: {
    providerId: string;
    label: string;
    baseUrl: string;
    api: ProviderApi;
    authHeader: boolean;
    /** 兼容旋钮（#654：provider 行 compat 原样下发；daemon 物化进 pi
     * models.json，未设置位 = pi 端点探测默认）。 */
    compat: ProviderCompat;
    /** 明文密钥；无密钥网关 = null（r3 §2「无密钥网关可留空」）。 */
    apiKey: string | null;
    /** 目录模型集（r3 §2 `探测模型` 面）；M3a：daemon 侧 pi models.json
     * 物化需要（backend/pi.ts materializeProvider）。可选 cost 位（#927）：
     * 管理员声明的模型价格（USD / 1M tokens）随条目下发，pi 据此算成本。 */
    models: ProviderModel[];
    /** Agent 侧选定模型（r3 §1.5 `using model <provider>/<modelId>`）。 */
    modelId: string | null;
  } | null;
  /** 本步可取用的团队密钥（名字 → 明文；仅 Agent 授权集 ∩ 本步 kind 的取用
   * 面，02 §8/r2 权限开关）。plan/review/chief 步恒空（stepTakesSecrets）。 */
  secrets: Record<string, string>;
  /** 托管 repo git 凭证槽（02 §5.4）；发行面 = issueStepGitCredential，
   * 组装在 machines.stepToken（本解析链不带 step 所有权上下文，恒 null）。 */
  git: null;
}

export function resolveStepCredentials(
  deps: CredentialsDeps,
  stepId: string,
): StepCredentialBundle {
  const stepRow = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow) throw notFound(`step ${stepId}`);
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) throw notFound(`build ${stepRow.buildId}`);
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) throw notFound(`todo ${buildRow.todoId}`);

  // 执行侧优先（build 槽），规划步回退 plan 槽（02 §4.2 双槽分派，r5 §5）。
  const agentId = todoRow.assignment?.build?.agentId ?? todoRow.assignment?.plan?.agentId ?? null;
  const agentRow = agentId ? deps.db.select().from(agent).where(eq(agent.id, agentId)).get() : null;

  const boxDeps: ProviderDeps & SecretDeps = deps;
  let provider: StepCredentialBundle['provider'] = null;
  // #1493 降级链：步换到备选模型后，模型 key 按备选的 provider 解（provider
  // 行仍是本团队的——openProviderKey 按 teamId 查，备选不能跨团队取 key）。
  const providerId = stepRow.fallback?.model?.provider ?? agentRow?.provider ?? null;
  const modelId = stepRow.fallback?.model?.modelId ?? agentRow?.modelId ?? null;
  if (agentRow && providerId) {
    const opened = openProviderKey(boxDeps, todoRow.teamId, providerId);
    if (opened) {
      provider = {
        providerId: opened.row.providerId,
        label: opened.row.label,
        baseUrl: opened.row.baseUrl,
        api: opened.row.api,
        authHeader: opened.row.authHeader,
        compat: opened.row.compat,
        apiKey: opened.apiKey,
        models: opened.row.models,
        modelId,
      };
    }
  }

  // 未指派 Agent = 无取用面（secrets 开关是 per-Agent 授权，r2 权限 tab）；
  // 按步收窄：不需要密钥的步 kind（plan/review/chief）恒空，与 daemon 侧取用
  // 通道注册面共用同一条判据（records/step.ts stepTakesSecrets）。
  const secrets =
    agentRow && stepTakesSecrets(stepRow.kind)
      ? openSecretValues(boxDeps, todoRow.teamId, agentRow.secrets)
      : {};

  return { provider, secrets, git: null };
}

/** chief 步凭证解析（step.buildId = `chief-<threadId>`，无 build/todo 行）：
 * step → chief_thread → chief → 绑定 Agent → provider（SecretBox 解密）。
 * secrets 槽恒空（chief = 总管探索步，取用面恒空，records/step.ts
 * stepTakesSecrets——记忆与存储共用同一 Agent，r5 §2/§6）。
 * git 槽恒 null（chief 探索基座凭证在 machines.chiefStepToken 组装，需 teamId/
 * workspaceProject 上下文）。载荷形状 = StepCredentialBundle（02 §5.4）。 */
export function resolveChiefStepCredentials(
  deps: CredentialsDeps,
  threadId: string,
): StepCredentialBundle {
  const threadRow = deps.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  if (!threadRow) throw notFound(`chief thread ${threadId}`);
  const chiefRow = deps.db.select().from(chief).where(eq(chief.id, threadRow.chiefId)).get();
  if (!chiefRow?.agentId) throw notFound(`chief agent binding for ${threadId}`);
  const agentRow = deps.db.select().from(agent).where(eq(agent.id, chiefRow.agentId)).get();
  if (!agentRow) throw notFound(`agent ${chiefRow.agentId}`);

  const boxDeps: ProviderDeps & SecretDeps = deps;
  let provider: StepCredentialBundle['provider'] = null;
  if (agentRow.provider) {
    const opened = openProviderKey(boxDeps, threadRow.teamId, agentRow.provider);
    if (opened) {
      provider = {
        providerId: opened.row.providerId,
        label: opened.row.label,
        baseUrl: opened.row.baseUrl,
        api: opened.row.api,
        authHeader: opened.row.authHeader,
        compat: opened.row.compat,
        apiKey: opened.apiKey,
        models: opened.row.models,
        modelId: agentRow.modelId,
      };
    }
  }
  return { provider, secrets: {}, git: null };
}
