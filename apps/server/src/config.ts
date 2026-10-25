// Settings 缝（01 §3 五缝之一）的当前层：优先级 = 显式入参 > env > 默认值。
// .env / 配置文件层随部署面补齐；数据根路径 = 品牌位（01 §4.2 数据目录行，
// 形状：单一数据根 = DB 文件 + keyfile + bare repo 存储，备份 = 拷目录）。

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRAND,
  CLAIM_POLL_INTERVAL_MS,
  CLAUDE_CONFIG_FILE_NAME,
  ENV_VARS,
  SKILLS_DIR_DEFAULT,
  TEAM_STREAM_PING_INTERVAL_MS,
} from '@cairn/shared';
import { z } from 'zod';

export const serverConfigSchema = z.object({
  /** HTTP 监听端口（默认值 [设计]——官方端口不可观测）。 */
  port: z.number().int().min(0).max(65535),
  /** 用户数据根（`~/.cairn` 位；DB 等在 `server/` 子目录，legacy-export
   * 升级护栏文件落根，spec 13 #367）。 */
  homeDir: z.string(),
  /** 单一数据根（DB 文件 + keyfile + bare repo 存储，01 §4.2）。 */
  dataDir: z.string(),
  /** 技能根目录（spec 13 #367：本地现扫只读；env ENV_VARS.skillsDir 覆写，
   * 缺省 = SKILLS_DIR_DEFAULT，`~` 前缀在此展开为绝对路径——单源纪律：
   * 运行期只消费本字段，不再各自拼默认值）。 */
  skillsDir: z.string(),
  /** SQLite DB 文件路径；`:memory:` = 内存库（测试面）。 */
  dbPath: z.string(),
  /** SecretBox keyfile 路径（01 §4.2：数据根内、首启生成 0600；文件名
   * `secretbox.key` [设计]，品牌槽归 #44）。 */
  keyfilePath: z.string(),
  /** team stream ping 心跳间隔；默认 ~15s（02 §1.2/r3 §8.1 实测节奏）。 */
  pingIntervalMs: z.number().int().positive(),
  /** claim 长轮询 hold；默认 ~75s（r3 §1.5 实测节奏 ~75–76s，wake SSE 提供
   * 低延迟派发，02 §5.4）。 */
  claimHoldMs: z.number().int().positive(),
  /** cron 调度循环 tick 间隔（02 §9.2 宿主自持；触发精度 = 分档最细 15min，
   * 默认 15s 远细于档位粒度 [设计]）。 */
  schedulerTickMs: z.number().int().positive(),
  /** SPA 静态同源托管根（02/A1，M5）：vite build 产物目录；null = 不托管
   * （纯 API 形态）。env 覆写位 = ENV_VARS.webDir（品牌槽单源，02 §5.8）；
   * 默认 = monorepo `apps/web/dist` 与包内 `web/` 双探测存在即托管（06 §11，
   * 见 defaultWebDir）。 */
  webDir: z.string().nullable(),
  /** OAuth App client 凭证对（#231 握手面；env 双件齐 = 配置，双缺 = null
   *  未配置——authorize 走 400 提示；只配一件 = 启动期报错不静默）。 */
  githubOauth: z.object({ clientId: z.string(), clientSecret: z.string() }).nullable(),
  /** 可选 token 鉴权（#251，06 册 D8）：env ENV_VARS.token 设 = 开、未设/
   *  空串 = null 关（默认，行为与现状一致）。 */
  authToken: z.string().nullable(),
  requireToken: z.boolean(),
  /** HTTP 绑定主机（env HOST，PORT 同款通用基建位不进品牌槽）；null = 默认
   *  绑定（node 缺省 = 全接口）。显式 `0.0.0.0`/`::` 且鉴权关 → 启动 WARN
   *  （insecureBindWarning，#251 验收面 6）。 */
  host: z.string().nullable(),
  /** 本机 MCP config 读路径（spec 13/#368：MCP 页只读投影源；默认
   *  ~/.claude.json，CAIRN_MCP_CONFIG 覆盖。UI 展示读 server 本机、任务
   *  执行读 daemon 本机——多机分歧文档化不桥接）。 */
  mcpConfigPath: z.string(),
  /** GitHub issue 进料轮询（#1406，spec 28 P5a）：env ENV_VARS.issueIntake
   *  为 1 / true / yes 才开，其余（未设、0、false、乱值）关。默认关：开了会把
   *  仓里已打 ready-for-agent 的存量 issue 按最旧先导入并派发——升级不该让
   *  实例自己开工（spec 28 P8 分阶段上线）。 */
  issueIntake: z.boolean(),
});
export type ServerConfig = z.infer<typeof serverConfigSchema>;

function envPort(): number | undefined {
  const raw = process.env.PORT;
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}

/** 非空 env 串读取（空串 = 未设同律，PORT/webDir 既有纪律）。 */
function envStr(name: string): string | null {
  const raw = process.env[name];
  return raw !== undefined && raw !== '' ? raw : null;
}

/** 布尔 env 开关：1 / true / yes（后两者不分大小写）= 开，其余 = 关（仓内既有
 * 写法：daemon pi.ts truthyEnvFlag、pre-commit 的 CAIRN_ALLOW_* 闸）。 */
function envFlag(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return false;
  const lower = raw.toLowerCase();
  return raw === '1' || lower === 'true' || lower === 'yes';
}

/** 全网卡绑定主机名族（显式配置命中 + 鉴权关 = 启动 WARN 判定面）。 */
const ANY_INTERFACE_HOSTS = new Set(['0.0.0.0', '::', '::0']);

/** SPA 产物默认位双探测（06 册 §11 W2 主包形态）：monorepo 布局 `apps/web/dist`
 * 与发布包内 `web/`（files 整形位）。本模块 = apps/server/src/config.ts 或
 * bundle 形态 dist/index.mjs（src/ 与 dist/ 同深，向上两级均落 apps/server），
 * 向上两级到 apps/ 再进 web/dist；包内形态（`<pkg>/dist/index.mjs`）向上两级
 * 落 `<pkg>`，进 `web/`。均不存在 = null（纯 API 形态）。
 * 候选序 = monorepo 在先：pack 期 stage-web.mjs 会在 apps/server/web/ 落一份
 * gitignored 中间拷贝，dev 形态恒取当场新构建的 `apps/web/dist`（探测序即
 * 新者胜，不比 mtime）；staged 拷贝只在 apps/web/dist 缺席或包内形态生效。 */
function defaultWebDir(): string | null {
  const here = resolve(fileURLToPath(import.meta.url), '../..'); // apps/server 或 <pkg>
  const candidates = [join(here, '..', 'web', 'dist'), join(here, 'web')];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) return resolve(candidate);
  }
  return null;
}

/** `~` 前缀展开（SKILLS_DIR_DEFAULT 显示形 → 绝对路径；其余前缀原样）。 */
function expandHome(path: string): string {
  return path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  // 用户主目录槽 = ENV_VARS.home（CAIRN_HOME；r3 §1.1 实测原名 TDS_HOME）；默认 ~/.cairn。
  const home = process.env[ENV_VARS.home] ?? join(homedir(), BRAND.homeDirName);
  // 数据根子目录名 `server` [设计]（品牌位归 #44 一次性替换面）。
  const dataDir = join(home, 'server');
  // 技能根（spec 13 #367）：env 覆写 > SKILLS_DIR_DEFAULT；展开为绝对路径。
  const skillsDirEnv = envStr(ENV_VARS.skillsDir);
  const skillsDir = resolve(expandHome(skillsDirEnv ?? SKILLS_DIR_DEFAULT));
  const webDirEnv = process.env[ENV_VARS.webDir];
  const oauthId = process.env[ENV_VARS.githubOauthClientId] || undefined;
  const oauthSecret = process.env[ENV_VARS.githubOauthClientSecret] || undefined;
  if ((oauthId === undefined) !== (oauthSecret === undefined)) {
    throw new Error(
      `oauth client half-configured: ${ENV_VARS.githubOauthClientId} 与 ${ENV_VARS.githubOauthClientSecret} 必须同设`,
    );
  }
  return serverConfigSchema.parse({
    port: envPort() ?? 8787,
    homeDir: home,
    dataDir,
    skillsDir,
    dbPath: join(dataDir, 'server.db'),
    keyfilePath: join(dataDir, 'secretbox.key'),
    pingIntervalMs: TEAM_STREAM_PING_INTERVAL_MS,
    claimHoldMs: CLAIM_POLL_INTERVAL_MS,
    schedulerTickMs: 15_000,
    webDir: webDirEnv !== undefined && webDirEnv !== '' ? resolve(webDirEnv) : defaultWebDir(),
    githubOauth:
      oauthId !== undefined && oauthSecret !== undefined
        ? { clientId: oauthId, clientSecret: oauthSecret }
        : null,
    authToken: envStr(ENV_VARS.token),
    requireToken: envFlag(ENV_VARS.requireToken),
    host: envStr('HOST'),
    mcpConfigPath: resolve(
      process.env[ENV_VARS.mcpConfig] || join(homedir(), CLAUDE_CONFIG_FILE_NAME),
    ),
    issueIntake: envFlag(ENV_VARS.issueIntake),
    ...overrides,
  });
}

/** `0.0.0.0` 裸绑护栏（#251，06 册 D8）：显式全网卡绑定且鉴权未启用 →
 * 返回警示文案（入口 logger.warn 落日志——WARN 级别由 logger 担，文案不重复
 * 前缀；不阻断启动）；默认绑定（host 未设）、回环绑定或鉴权已开 → null。
 * 纯函数 = 验收面 10 测试缝。 */
export function insecureBindWarning(config: ServerConfig): string | null {
  if (config.authToken !== null) return null;
  if (config.host === null || !ANY_INTERFACE_HOSTS.has(config.host)) return null;
  return `绑定 ${config.host}（全网卡可达）且 ${ENV_VARS.token} 未设——API 面裸奔于所有网络接口；设 ${ENV_VARS.token}=<token> 开启 Bearer 鉴权，或 HOST=127.0.0.1 收回本机`;
}

export function missingRequiredTokenError(config: ServerConfig): string | null {
  if (!config.requireToken || config.authToken !== null) return null;
  return `${ENV_VARS.requireToken} 已开但 ${ENV_VARS.token} 未设或为空——拒绝启动；设 ${ENV_VARS.token}=<随机长串>（例如 openssl rand -hex 32）后重启`;
}

/** 入口接线（index.ts 启动段唯一调用点）：警示行经 logger.warn 落日志。
 * 抽函数 = 接线可钉（stub logger 用例防「判定在、发射丢」回归，spec #247
 * AC6）；pino Logger 结构兼容本最小口。 */
export function warnInsecureBind(logger: { warn(msg: string): void }, config: ServerConfig): void {
  const message = insecureBindWarning(config);
  if (message !== null) logger.warn(message);
}

/** 托管 bare repo 存储根 = 数据根子目录 `repos` [设计]（01 §4.2 单一数据根：
 * DB 文件 + keyfile + bare repo 存储同根，备份 = 拷目录）。 */
export function reposDirOf(config: ServerConfig): string {
  return join(config.dataDir, 'repos');
}

/** 附件存储根 = 数据根子目录 `attachments` [设计]（01 §4.2 单一数据根同律，
 * #310）：`<attachmentsDir>/<teamId>/<id>.<ext>`，备份 = 拷目录。 */
export function attachmentsDirOf(config: ServerConfig): string {
  return join(config.dataDir, 'attachments');
}
