import { z } from 'zod';
import { BRAND } from '../brand.js';
import { phaseSchema, recordId } from './common.js';
import { requiredCapabilitiesSchema } from './machine-capabilities.js';
import { SECRET_MIN_CLI_VERSION } from './secret.js';

export const PERSONA_ROLES = [
  'planner',
  'implementer',
  'code_reviewer',
  'security_auditor',
  'test_engineer',
  'verifier',
] as const;
export type PersonaRole = (typeof PERSONA_ROLES)[number];

export const personaRoleSchema = z.enum(PERSONA_ROLES);

export const REVIEW_FANOUT_ROLES: readonly PersonaRole[] = [
  'code_reviewer',
  'security_auditor',
  'test_engineer',
];

export const agentStatusSchema = z.enum(['active']);

export const AGENT_TOOL_SWITCHES = [
  '远程 shell',
  '合并分支',
  '创建标签',
  '推送分支',
  '创建技能',
  '更新技能',
] as const;
export type AgentToolSwitch = (typeof AGENT_TOOL_SWITCHES)[number];

export const AGENT_TOOL_MERGE: AgentToolSwitch = '合并分支';
export const AGENT_TOOL_PUSH: AgentToolSwitch = '推送分支';
export const AGENT_TOOL_SKILL_CREATE: AgentToolSwitch = '创建技能';
export const AGENT_TOOL_SKILL_UPDATE: AgentToolSwitch = '更新技能';

export const AGENT_TOOL_SHELL: AgentToolSwitch = '远程 shell';

export const AGENT_TOOL_TAG: AgentToolSwitch = '创建标签';

export const AGENT_TOOL_DEFAULTS: readonly AgentToolSwitch[] = [AGENT_TOOL_PUSH];

export const AGENT_DESC_MAX_LENGTH = 2000;

export const AGENT_TOOL_COPY: Record<(typeof AGENT_TOOL_SWITCHES)[number], string> = {
  '远程 shell': '允许该 Agent 在团队中已开启 shell 访问的机器上执行命令。',
  合并分支: '允许该 Agent 通过合并分支进行发布（例如将 develop 合并进 main）。',
  创建标签: '允许该 Agent 创建 git tag，这可能触发发布流程。',
  推送分支: '允许该 Agent 随时提交并推送其工作分支（自行合并发布改动时需要）。',
  创建技能: '允许该 Agent 向团队技能库添加新技能。',
  更新技能: '允许该 Agent 修改团队技能库中已有的技能。',
};

export function filterAgentTools(tools: string[]): string[] {
  return tools.filter((t) => (AGENT_TOOL_SWITCHES as readonly string[]).includes(t));
}

export const AGENT_PERMISSION_COPY = {
  secrets: `任务执行时，该 Agent 可在需要密钥的执行步中按需取用团队密钥，每次取用都会留下记录；密钥不预置进 shell 环境。所在机器需要 ${BRAND.cliCommandName} CLI ${SECRET_MIN_CLI_VERSION} 及以上。`,
  mcpServers:
    '该 Agent 执行任务时可使用的团队 MCP 服务器，其工具以 mcp__<服务器>__<工具> 的形式出现。',
  responsibility:
    '说明该 Agent 的常驻职责，可多行。该说明会注入它执行的每个任务的系统提示词，也会提供给总管用于分派。',
  defaultSkill: '该 Agent 执行任何任务时自动携带的团队技能，无需在消息中 @ 引用。',
  skillsAllowlist:
    '该 Agent 执行任务时可读取的团队技能范围。开启「不限制」= 全量可读；关闭后仅勾选的技能可读，未勾选一律拒绝——「不限制」与全不勾是两种状态，可随时互转。',
} as const;

export const FALLBACK_MODELS_MAX = 5;

export const fallbackModelsSchema = z
  .array(z.object({ provider: z.string().min(1), modelId: z.string().min(1) }))
  .max(FALLBACK_MODELS_MAX);

export const agentRecordSchema = z.object({
  id: recordId,
  displayName: z.string(),
  description: z.string().nullable(),
  status: agentStatusSchema,
  avatarUrl: z.string().nullable(),
  provider: z.string().nullable(),
  modelId: z.string().nullable(),
  persona: z.enum(PERSONA_ROLES).nullish(),
  thinkingLevel: z.string().nullable(),
  tools: z.array(z.string()),
  secrets: z.array(z.string()),
  defaultSkill: z.string().nullable(),
  skillsAllowlist: z.array(z.string()).nullable(),
  mcpServers: z.array(z.string()),
  maxConcurrentTasks: z.number().int().nullable().optional(),
  machineId: recordId.nullable().optional(),
  requiredCapabilities: requiredCapabilitiesSchema.nullish(),
  fallbackModels: fallbackModelsSchema.nullish(),
});
export type AgentRecord = z.infer<typeof agentRecordSchema>;

export const createAgentBodySchema = z.object({
  displayName: z.string().min(1),
  description: z
    .string()
    .max(AGENT_DESC_MAX_LENGTH, `职责过长（最多 ${AGENT_DESC_MAX_LENGTH} 字）`)
    .nullish(),
  provider: z.string().nullish(),
  modelId: z.string().nullish(),
  thinkingLevel: z.string().nullish(),
  persona: z.enum(PERSONA_ROLES).nullish(),
  tools: z.array(z.string()).optional(),
  secrets: z.array(z.string()).optional(),
  defaultSkill: z.string().nullish(),
  skillsAllowlist: z.array(z.string()).nullish(),
  mcpServers: z.array(z.string()).optional(),
  maxConcurrentTasks: z.number().int().min(1).max(50).nullish(),
  machineId: recordId,
  requiredCapabilities: requiredCapabilitiesSchema.nullish(),
  fallbackModels: fallbackModelsSchema.nullish(),
});
export type CreateAgentBody = z.infer<typeof createAgentBodySchema>;

export const agentTaskSchema = z.object({
  kind: z.literal('build'),
  state: z.literal('waiting').nullable(),
  buildId: recordId,
  todo: z.object({
    id: recordId,
    seqNum: z.number().int(),
    title: z.string(),
    phase: phaseSchema,
  }),
});
export type AgentTask = z.infer<typeof agentTaskSchema>;

export const patchAgentBodySchema = createAgentBodySchema.partial().extend({
  displayName: z.string().min(1).optional(),
});
export type PatchAgentBody = z.infer<typeof patchAgentBodySchema>;
