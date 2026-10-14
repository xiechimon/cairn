// 机器能力清单 + agent 能力要求（#1251 / ADR 0018 决策 4）：跨机协调模型的
// wire 单源。命名刻意与 records/capabilities.ts（引擎思考档位词表读面）分开
// ——那一面是「引擎认得什么」，本面是「这台机器装了什么 / 这个 Agent 要求
// 什么」，两族事实不同源不合并。
//
// 上报链（ADR 0018 决策 4.1）：daemon 注册/心跳携带机器能力清单——已装 MCP
// server slug 集（本机 `~/.claude.json` mcpServers 键投影，slug 归一单源 =
// protocol/mcp.ts parseClaudeMcpEntries）+ 本机技能目录名集。模型二进制与
// 档位不在本清单重复上报：claudeCodeReport（records/model-source.ts）已随
// 同一心跳上行（bin + models[].slot），server 侧能力视图两列合并。
//
// 心跳红线（02 §5.4，票面点名）：capabilities 位在 presence/enroll body 的
// wire 层是 z.unknown 宽松位——坏形状字段永不 400 整个心跳；收严在 server
// 侧对 machineCapabilitiesSchema 单独 safeParse（失败丢弃该字段、保留旧值）。
// 能力上报是增强信号，坏一条不能打死心跳通道。

import { z } from 'zod';
import { recordId } from './common.js';

/** #1241 机器能力指纹（daemon 启动 + 每个 presence 节拍现探，不缓存）。
 *  推荐并发只消费核数与内存总量（静态量，不随运行中的步抖动）；可用内存、
 *  load 与磁盘余量进依据显示。缺席 = 这拍没探到（server 沿用上一拍硬件，没有
 *  上一拍则估算）。 */
export const machineHardwareSchema = z.object({
  /** os.cpus().length。 */
  cpuCores: z.number().int().positive(),
  /** os.totalmem()，MiB。可选：升级前落库的指纹没有此字段，读侧不得因此整行
   *  解析失败；推荐公式对缺席者回落估算。 */
  memoryTotalMb: z.number().int().nonnegative().optional(),
  /** os.freemem()，MiB。 */
  memoryAvailableMb: z.number().int().nonnegative(),
  /** os.loadavg()[0]，1 分钟负载。 */
  loadAvg1: z.number().nonnegative(),
  /** 技能根所在卷的可用空间，MiB（statfs；根不可读则回落 `/`）。 */
  diskFreeMb: z.number().int().nonnegative(),
});
export type MachineHardware = z.infer<typeof machineHardwareSchema>;

/** daemon 上报的机器能力清单（machine.capabilities 列 / presence·enroll body
 *  的 capabilities 位收严后的存储形）。mcpServers/skills 恒发（daemon 探测面
 *  是全函数：文件缺失/坏 JSON → 空集，不缺席）——「报了空集」= 该机确实没有；
 *  「整列 null」= 该机从未上报（老 daemon），能力闸对未知快照放行。
 *  hardware 可选：老 daemon 不带；坏形状由 parseReportedCapabilities 丢弃，
 *  不连坐 mcp/skills（心跳红线的字段级半边）。 */
export const machineCapabilitiesSchema = z.object({
  /** 已装 MCP server slug 集（小写归一，parseClaudeMcpEntries 单源；与
   *  agent.mcpServers 勾选值 / claim 载荷 slug 同值域）。 */
  mcpServers: z.array(z.string()),
  /** 本机技能目录名集（machine-owned skills，PACMAN_SKILLS_DIR 扫描根）。
   *  team skills 维持 server 单源按步下发（票面界限），不进本清单。 */
  skills: z.array(z.string()),
  hardware: machineHardwareSchema.optional(),
});
export type MachineCapabilities = z.infer<typeof machineCapabilitiesSchema>;

/** 心跳/注册收严（02 §5.4 字段级）：整包不是能力清单 → undefined（调用方
 *  保留旧列）。mcp/skills 合法但 hardware 坏或缺失 → 仍收下清单，hardware
 *  缺席。不在这里做「沿用上一拍硬件」——那是 server 写点对照旧行的事。 */
export function parseReportedCapabilities(raw: unknown): MachineCapabilities | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  const base = z
    .object({
      mcpServers: z.array(z.string()),
      skills: z.array(z.string()),
    })
    .safeParse({ mcpServers: rec.mcpServers, skills: rec.skills });
  if (!base.success) return undefined;
  if (rec.hardware === undefined) return base.data;
  const hardware = machineHardwareSchema.safeParse(rec.hardware);
  return hardware.success ? { ...base.data, hardware: hardware.data } : base.data;
}

/** agent 能力要求声明（agent.requiredCapabilities 列；ADR 0018 决策 4.2）。
 *  两维各自可选，空对象 = 显式无要求（与 null 同值）；runtime 维不在这里
 *  ——enabledRuntimes 机器开关闸（#682）已单源覆盖。null = 无要求（缺省/
 *  存量行）。写侧 zod 闸（create/patch body），读侧宽（nullish 加法契约）。 */
export const requiredCapabilitiesSchema = z.object({
  /** 机器必须已装的 MCP server slug 集（⊆ 机器上报 capabilities.mcpServers；
   *  比对前小写归一——与 parseClaudeMcpEntries slug 律同源）。 */
  mcpServers: z.array(z.string()).optional(),
  /** 机器 claude-code 必须已配置的模型 id 集（⊆ claudeCodeReport.models[].id；
   *  pi 侧模型由 server 按步物化下发、无本机清单，本维只对 claude-code 机器
   *  事实判定——机器无 claudeCodeReport 快照 = 未知，放行）。 */
  models: z.array(z.string()).optional(),
});
export type RequiredCapabilities = z.infer<typeof requiredCapabilitiesSchema>;

/** 能力缺项的可读名（reason 文案 / 排队 blocked.missing / machine-fit 单源；
 *  嵌入中文句子的 token 形与 runtime 名同律——原样透出不译）。 */
export function capabilityMissingLabels(missing: {
  mcpServers?: string[];
  models?: string[];
}): string[] {
  return [
    ...(missing.mcpServers ?? []).map((slug) => `MCP server "${slug}"`),
    ...(missing.models ?? []).map((id) => `model "${id}"`),
  ];
}

/** 排队投影的 pending 成因位（#1251，stepJournalRowSchema.queue.blocked /
 *  chiefThreadSchema.turnQueue.blocked 同形）：区分「等机器上线」（等待即可）
 *  与「缺能力」（装 X 即解锁，给修法）——Multica dispatch/reason.go 族的
 *  语义对位（runtime_offline vs runtime_unusable 的分野：等待有没有用）。
 *  缺席 = 老 server / 无阻塞事实（正常排队），呈现回落既有排队标签。 */
export const stepQueueBlockedSchema = z.object({
  kind: z.enum(['machine-offline', 'capability-missing']),
  /** capability-missing：缺项可读名（capabilityMissingLabels 值域）；
   *  machine-offline：空集。 */
  missing: z.array(z.string()),
});
export type StepQueueBlocked = z.infer<typeof stepQueueBlockedSchema>;

/** agent 面「哪些机器可跑它」（ADR 0018 决策 4.6：requiredCapabilities ×
 *  各机上报清单的交集）读面行。canRun = 派发闸真值（runtimeOk ∧ 能力不缺）；
 *  missing null = 该机未上报能力快照（老 daemon——闸按未知放行，canRun 跟随
 *  runtimeOk，显示面闭嘴不编造缺项）。mcpGaps = 对账面（agent.mcpServers
 *  声明 vs 机器实装的缺口，可见但不挡派发——daemon 对未知 slug 的既有语义
 *  是跳过降级，硬闸只吃 requiredCapabilities 显式声明）。 */
export const agentMachineFitRowSchema = z.object({
  machineId: recordId,
  name: z.string(),
  online: z.boolean(),
  /** 机器 enabledRuntimes 是否含该 agent 步所需 runtime（#682 闸同判据）。 */
  runtimeOk: z.boolean(),
  /** 能力闸缺项（capabilityMissingLabels 值域）；null = 未上报快照（未知）。 */
  missing: z.array(z.string()).nullable(),
  /** agent.mcpServers 声明中该机未装的 slug；null = 未上报快照（未知）。 */
  mcpGaps: z.array(z.string()).nullable(),
  canRun: z.boolean(),
});
export type AgentMachineFitRow = z.infer<typeof agentMachineFitRowSchema>;

/** GET /api/teams/{id}/agents/{aid}/machine-fit 响应封套。 */
export const agentMachineFitResponseSchema = z.object({
  machines: z.array(agentMachineFitRowSchema),
});
export type AgentMachineFitResponse = z.infer<typeof agentMachineFitResponseSchema>;
