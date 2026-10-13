// 请求处理上下文：DB + 事件 hub + SecretBox + seed 单用户/团队（02 §2 保形恒一行）。

import type { SecretBox, TeamRecord, UserRecord } from '@pacman/shared';
import type { Logger } from 'pino';
import type { Db } from './db/client.js';
import type { FetchLike } from './lib/github.js';
import type { ConversationStreamHub, TeamStreamHub } from './services/events.js';
import type { PendingUpload } from './services/machine-uploads.js';
import type { MachineWakeHub } from './services/machine-wake-hub.js';
import type { OAuthClientConfig, OAuthStateEntry } from './services/oauth.js';
import type { SkillImportFetch } from './services/skill-import.js';

export interface AppContext {
  db: Db;
  hub: TeamStreamHub;
  /** 机器 wake 通道（claim 长轮询等待者 + machine stream SSE，02 §5.4）。 */
  machineHub: MachineWakeHub;
  /** conversation stream 通道（GET /api/conversations/{id}/stream，02 §1.2；
   *  live transcript：message/text_delta/step 事件）。缺省 = 无会话流面
   *  （M2a 单测形态）。 */
  convHub?: ConversationStreamHub;
  /** at-rest 加密缝（02 §8：provider key / secret 值密文进出唯一通道）。 */
  secretBox: SecretBox;
  /** seed 单用户（自动登录，02 §2.1）。 */
  user: UserRecord;
  /** seed 团队（恒一行，02 §2.2）。 */
  team: TeamRecord;
  /** team stream ping 节奏（默认 ~15s，02 §1.2）。 */
  pingIntervalMs: number;
  /** claim 长轮询 hold（默认 = CLAIM_POLL_INTERVAL_MS ~75s，r3 §1.5 节奏）。 */
  claimHoldMs: number;
  /** upload-urls 一次性上传位（[设计]：self-host 无对象存储，内存态即可）。 */
  uploads: Map<string, PendingUpload>;
  /** 浏览器授权流 enroll 位（02 §5.2 路径一；#285 web 侧接线）。name = start
   * 面携带的机器名（授权页展示）；machine = confirm 后的授权产物（poll
   * authorized 态载荷，machine.json 形状——执行机侧注册凭据）。 */
  enrollments: Map<
    string,
    {
      teamId: string;
      name?: string;
      createdAt: number;
      machine?: { machineId: string; token: string; teamId: string; serverUrl: string };
    }
  >;
  /** 托管 bare repo 存储根（数据根子目录，01 §4.2；`<reposDir>/<teamId>/<repoName>.git`）。 */
  reposDir: string;
  /** 附件存储根（#310，r9 §4 wire；`<attachmentsDir>/<teamId>/<id>.<ext>`）。 */
  attachmentsDir: string;
  /** 技能根目录（spec 13 #367：本地目录现扫只读投影，不入库；缺省 =
   *  SKILLS_DIR_DEFAULT `~/.agents/skills`，env PACMAN_SKILLS_DIR 覆写，
   *  config.ts 单源展开）。 */
  skillsDir: string;
  /** 技能导入来源登记文件（#1170：数据根 skill-sources.json——refresh 重拉
   *  的数据源；技能本体不入库，来源记录也不入 DB，见
   *  services/skill-source-store.ts 头注）。 */
  skillSourcesPath: string;
  /** 技能导入 URL 分支出站注入位（#1170：api.github.com + raw 拉取；
   *  缺省 = globalThis.fetch，测试注入 mock。与 githubFetch（repo picker
   *  认证面）分位——出站域不同不共用）。 */
  skillImportFetch?: SkillImportFetch;
  /** 技能导入单请求超时（#1170：缺省 SKILL_IMPORT_FETCH_TIMEOUT_MS；
   *  测试注入短超时钉 504 面）。 */
  skillImportTimeoutMs?: number;
  /** SPA 静态同源托管根（02/A1；= apps/web/dist 产物目录）。null/缺省 =
   *  不托管（纯 API 形态，dev 期 vite proxy 用）。 */
  webDir?: string | null;
  /** GitHub 出站 fetch 注入位（spec 12/#359 缝：GET /api/github/repos →
   *  routes → lib/github 薄桥；缺省 = globalThis.fetch，测试注入 mock。
   *  #223 skills scan 曾用同一位，随 spec 13 #367 退役——位保留给 repo
   *  picker 认证面）。 */
  githubFetch?: FetchLike;
  /** OAuth 握手 state 册（#231：CSRF 防护 + returnOrigin 绑定；TTL 10min
   *  单次核销，services/oauth.ts）。 */
  oauthStates: Map<string, OAuthStateEntry>;
  /** OAuth 出站 token 交换注入位（lib/github.ts OAuth 面；缺省 =
   *  globalThis.fetch，测试注入 mock）。 */
  oauthFetch?: FetchLike;
  /** OAuth App client 凭证对（config.ts env 读位；null = 未配置 →
   *  authorize 400）。 */
  oauthClient: OAuthClientConfig | null;
  /** 可选 token 鉴权（#251，lib/token-auth.ts；config.ts env 读位）。
   *  null = 关（默认，行为与现状一致）；设值 = Bearer 闸开启。 */
  authToken: string | null;
  /** 本机 MCP config 读路径（spec 13/#368：GET mcp-servers 投影源 +
   *  chief mcp_servers 工具源；config.ts 单源，默认 ~/.claude.json）。 */
  mcpConfigPath: string;
  /** 结构化日志（#1137 webhook receiver 的 deliveryId 追踪行；index.ts
   *  传 pino 实例，bootServer 缺省不传 = 测试面静默）。 */
  logger?: Logger;
}
