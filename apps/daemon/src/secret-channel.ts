// per-step 团队密钥取用通道（02 §8 运行时层）：daemon 持有本步授权集的明文
// （credentials.ts 的取用台账），agent 经本通道显式取用——明文不铺进进程环境
// （agent 会执行仓库里的任意代码，环境变量会被 postinstall / MCP server / 它
// 调起的任何 CLI 静默继承），每次取用留一行审计。
//
// 审计纪律：写「步 id + agent id + 密钥名 + 时间」，**永不写值**；走既有日志
// 前缀词表（log.ts 的 `[step]`），不进 journal（journal 会被 recover 读取与
// 回传）。值本身只出现在工具结果文本里——即 agent 显式索取的那一次。

import type { LocalToolDef } from '@cairn/shared';
import type { StepCredentials } from './credentials.js';

/** 本地工具名（agent 侧可见名；不经 relay，不出机器）。 */
export const GET_SECRET_TOOL_NAME = 'get_secret';

export interface SecretChannelOpts {
  /** 本步凭证束（明文台账；步收尾 clearCredentials 后 take() 恒 null）。 */
  creds: StepCredentials;
  stepId: string;
  /** 取用方 Agent（claim 载荷；未指派 = null，届时台账必空）。 */
  agentId: string | null;
  /** 审计行出口（runner 接 logger.step；测试录制）。 */
  onAudit: (line: string) => void;
  /** 时钟注入（测试钉时间；缺省 = 系统时钟）。 */
  now?: () => Date;
}

/** 取用审计行：步 id + agent id + 密钥名 + 时间，无值。 */
export function secretAuditLine(opts: {
  stepId: string;
  agentId: string | null;
  name: string;
  at: Date;
}): string {
  return `secret taken step=${opts.stepId} agent=${opts.agentId ?? 'none'} name=${opts.name} at=${opts.at.toISOString()}`;
}

/** 本地取用工具定义（runner 按 step kind 决定是否注册：不需要密钥的步 kind
 * 恒不注册，agent 连工具面都看不见——least-privilege 与按 kind 裁剪同律）。 */
export function buildSecretTool(opts: SecretChannelOpts): LocalToolDef {
  return {
    name: GET_SECRET_TOOL_NAME,
    label: GET_SECRET_TOOL_NAME,
    description:
      'Read one team secret granted to you for this step. Secrets are not present in the ' +
      'shell environment: this tool is the only way to obtain the value. Every read is ' +
      'recorded (step, agent, secret name). Prefer piping the value into the command that ' +
      'needs it over writing it into files, logs or anything that leaves the machine.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Secret name, e.g. STRIPE_API_KEY.',
        },
      },
      required: ['name'],
    },
    execute: async (params: Record<string, unknown>): Promise<string> => {
      const name = typeof params.name === 'string' ? params.name : '';
      if (name === '') return 'get_secret needs a non-empty "name".';
      // 台账读在取用当下——步收尾清空后同一引用恒回 null（凭据生命周期）。
      const value = opts.creds.secrets.take(name);
      if (value === null) {
        return opts.creds.secrets.names.length === 0
          ? `no team secret is available for this step (asked for "${name}"); this step's credential lifetime may have ended.`
          : `secret "${name}" is not granted to this agent for this step; granted: ${opts.creds.secrets.names.join(', ')}.`;
      }
      opts.onAudit(
        secretAuditLine({
          stepId: opts.stepId,
          agentId: opts.agentId,
          name,
          at: (opts.now ?? (() => new Date()))(),
        }),
      );
      return value;
    },
  };
}
