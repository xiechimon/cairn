// per-step 凭证持有面（02 §5.4/§8 运行时层：`token/{stepId}` 下发，daemon
// 内存持有、不落盘常驻）。relay 工具名对照 = `push_credential`（r5 §3.1/
// RELAY_TOOLS：官方经服务端 relay 工具下发 git 凭证；复刻 = daemon 主动拉取
// token 端点的等价物，04 附录 A「自定等价物（形状对即可）」口径）。
// 纪律：本模块是凭证在 daemon 内的唯一驻留位——不写日志、不进 journal、
// 不进任何文件；步收尾即 clear()（GC 面前不留引用）。
//
// 密钥半边的形状（02 §8 运行时层）：**不是**「名字 → 明文」的环境变量映射。
// agent 的工作是执行仓库里的代码——依赖的 postinstall、MCP server、被它调起
// 的任何 CLI 都继承进程环境且读取不留痕。故明文不经进程环境，只由本模块的
// 取用台账持有，agent 经 per-step 本地取用通道（runner 注册的本地 pi 工具）
// 显式取用，取用留审计行（步 id + agent id + 密钥名 + 时间，永不写值）。

import type { BoundGitCredentials, MachineTokenResponse, ProviderConfig } from '@cairn/shared';

/** 本步团队密钥的取用台账。明文由闭包捕获（模块外不可枚举），只经 take()
 * 交出；clearCredentials 后 take() 恒 null——步收尾即失效，失败/中断步同路。 */
export interface SecretVault {
  /** 本步可取用的密钥名集（授权面；不需要密钥的步 kind = 空）。 */
  names: readonly string[];
  /** 取用：命中 → 明文；不在授权面 → null（调用方据此给出可取的原因）。 */
  take(name: string): string | null;
}

/** 空台账（未授权 / 步收尾后）。 */
export const EMPTY_SECRET_VAULT: SecretVault = { names: [], take: () => null };

function openSecretVault(values: Record<string, string>): SecretVault {
  const held = new Map(Object.entries(values));
  return {
    names: [...held.keys()],
    take(name: string): string | null {
      const value = held.get(name);
      return value === undefined ? null : value;
    },
  };
}

export interface StepCredentials {
  /** 模型凭证（apiKey 内存态 → backend setRuntimeApiKey，02 §8）。 */
  provider: ProviderConfig | null;
  /** 团队密钥取用台账（02 §8 运行时层；形状见本文件头注）。 */
  secrets: SecretVault;
  /** 托管 repo git 凭证（02 §3 凭证纪律：仅 per-step 注入——手动 fetch 无
   * 凭证失败；注入形 = git.ts gitCredentialEnv，argv/磁盘均不落）。绑定本步
   * 项目 repo 的 cloneUrl，helper 只对该主机应答（#1484）。 */
  git: BoundGitCredentials | null;
}

/** push_credential 对照位：token/{stepId} 响应 → 步内内存凭证束。git 凭证绑定
 * `repoUrl`（claim 的 project.repo.cloneUrl，#1484）；步未绑 repo = null，没有
 * 可绑定的主机，凭证不进任何 git 调用。 */
export function pushCredential(
  token: MachineTokenResponse,
  repoUrl: string | null,
): StepCredentials {
  return {
    provider: token.provider,
    secrets: openSecretVault(token.secrets),
    git: token.git === null || repoUrl === null ? null : { ...token.git, url: repoUrl },
  };
}

/** 步收尾清空（引用置空；明文串本身随 GC）。 */
export function clearCredentials(creds: StepCredentials): void {
  creds.provider = null;
  creds.secrets = EMPTY_SECRET_VAULT;
  creds.git = null;
}
