// 存储表清单——01 §6（02 §6.2 record 形状 + §1.3 数据所有权的投影，锁定清单）。
// migration 纪律（01 §6）：drizzle-kit 生成、进 repo、CI 校验 drift；
// 不发明 02 之外的字段形状——协议面字段即契约（02/A9）。
// 列细节 = M2 实现期按 record 形状展开（record schema 见 records/，24 表投影源；
// `todo_tag` 为纯 join 表，无 wire record 形状，故 record 投影为 24 张）。

export const DB_TABLES = [
  'user', // seed 一行（02 §2.1）
  'team', // seed 一行；plan 字段形状保留、不参与门控（02 §2.2/A3）
  'project', // repo 形态字段：托管 bare / GitHub 接入（02 §3/A4）
  'todo', // 02 §4.1 字段表全量
  'tag',
  'todo_tag', // 多对多 join（CONTEXT.md：tag 是 todo 的多对多标签）
  'build', // buildId ≡ conversationId（CONTEXT.md/r3 §3.0）
  'step', // 三类步队列 + journal 状态（02 §4.2/A6）
  'steer_pending', // W3 #278：build 会话运行中补话单槽（06 册 D9，自有功能）
  'stop_pending', // M7 #308：停止钮中断请求单槽（steer_pending 同形，自有功能）
  'message', // transcript 消息/工具行，经 upload-urls 回传落库（02 §1.3）
  'plan', // build facet：版本 v1/v2 + 四段卡（02 §4.2）
  // document_diff 已退役（#1029 死 schema）：diff 端点自 plan 行现算
  // （services/documents.ts structuredPatch），从未有行写入，drop migration
  // 摘除表位；wire 形状 documentDiffSchema（端点响应）保留在 records/。
  'schedule', // 02 §6.2 形状；kind 枚举含 [推断] 词
  'notification', // 02 §9.1 三事件矩阵（r5 §7.2 改判）
  'agent', // 含 6 工具开关/secrets/skills/mcpServers 关联（02 §6.2）
  'agent_memory', // 02 §4.4 条目集（r5 §6 改判）
  // skill 表已退役（spec 13 #367：技能 = 本地目录现扫只读投影，不入库；
  // drop migration 前导出旧行到 <home>/legacy-export-<ts>.json）。
  // 'mcp_server' 已随 spec 13（#368）本地 config 只读制撤除（migration 导出
  // 旧行后 drop）；MCP 面数据源 = ~/.claude.json，无表位。
  'provider', // 38 presets + custom；apiKey 密文经 SecretBox（02 §6.2/§8）
  'secret', // 值密文经 SecretBox，只写不读（02 §8）
  'api_key', // 哈希 + gitAccess/mcpAccess/toolGrants 白名单（02 §6.2/§8）
  'machine', // 02 §6.2 + presence 状态（02 §1.2）
  'token_usage', // build×model 四维计数（02 §6.2/r3 §3.8）
  'chief', // 02 §4.3 Chief 记录面（r5 §3.6 GET /chief 的 chief 字段：绑定 Agent/charter/watches/wakes；M4a 回写 01 §6——原清单仅列线程面两表，记录本体无表位）
  'chief_thread', // 02 §4.3 线程面（r5 §3.6）
  'chief_message', // 02 §4.3 线程面（r5 §3.6）
  'whats_new', // 形状保留内容自选（02 §6.1）
  'attachment', // M7 #310：composer/新建任务附件 grant/upload/read 三步 wire（r9 §3.1/§4）
  'branch_sync', // M7 #319 分支对话框「同步到机器」状态机（pending/running/synced/failed）；内部状态表无独立 record 投影面
  'github_connection', // spec 12 / #359：GitHub OAuth 连接行（teamId 单行；accessToken 经 SecretBox 密封，token 只写不读出 wire）
  'skill_audit', // XMON-109 S1：技能写审计行（REST/relay 三入口同表；actor_type member|agent + action create|update + bytes）
  'shell_command', // XMON-108 R1 机器 shell 审计行（预检 denied/running → done/failed 终态一次）；内部审计表无 record 投影
  'webhook_token', // #1137：GitHub webhook 入口路径 token（哈希反查 + 行掩码，api_key 凭证同族）
  // #1404 合并就绪闸四表（server 独占，机器回传路径不写；判定不再从 message 行读）
  'gate_digest', // 构建的 PR 在某个 head 上的补丁摘要
  'gate_round', // 每 (buildId, patchDigest) 一轮：视角、超时、派步计数、修复轮序号
  'gate_verdict', // 每步一条判定，绑派步时的 head 与摘要
  'gate_state', // 每构建最新一份 readiness 快照
  // #1491 后台自动任务触发闸（server 独占）
  'autonomy_state', // 每 (项目, 任务种类) 一行：上次开跑、休眠基线、最近一次被拦原因
  'member_activity', // 人最近一次写操作的时刻（人在用就让路）
  'build_feedback',
] as const;

export type DbTable = (typeof DB_TABLES)[number];

/** join 表（无 wire record 形状）——record 投影面 = DB_TABLES 减去此集。 */
export const JOIN_ONLY_TABLES = ['todo_tag'] as const;

/** 内部状态表（无 wire record 形状，读位内嵌于既有封套或为 wire 二进制）——
 * record 投影面同减此集。W3 #278：steer_pending 读位 = conversation messages
 * 封套的 steerPending 数组（spec #277）。M7 #319：branch_sync 读位 =
 * `GET /api/builds/{id}/branch-sync` 端点封套与 team stream `branch_sync`
 * 事件载荷（web 实时结果卡数据面），不另开 record projection——投影在 server
 * 端组装，wire 形状见 protocol/sse.ts branchSyncEvent。M7 #308：stop_pending
 * 读位 = GET /api/machine/stop 拉取响应（{discard}），无独立 record。M7 #310：
 * attachment 读位 = GET /api/attachments/{id} 二进制流（r9 §3.1），无 JSON
 * record 形状。spec 12 / #359：github_connection 为凭证表——accessToken 只写
 * 不读出（server 出站边界 Authorization 头唯一消费点，02 §8 同族纪律），
 * 连接状态读位（login/scope）内嵌于认证面端点封套，不立 record 投影。
 * #1137：webhook_token 为路径 token 凭证表——tokenHash 只写不读出（receiver
 * 按路径段哈希反查，02 §8 同律），读位 = team webhook token 管理端点封套
 * （masked 投影），不立 record 投影。 */
export const INTERNAL_ONLY_TABLES = [
  'steer_pending',
  'branch_sync',
  'stop_pending',
  'attachment',
  'github_connection',
  // XMON-109：技能写审计只写不读出 wire（读位 = 直接查库运维面，无 record 投影）
  'skill_audit',
  // XMON-108 R1：shell_command 读位 = 无 REST 读面（审计消费——团队审计
  // 视图归后续票；本票只有预检/回写两个写端点 + server 侧直查）。
  'shell_command',
  // #1137：webhook_token 读位 = 管理三端点自有封套（masked 列表行）。
  'webhook_token',
  // #1404：闸四表的读位 = 构建记录上的 readiness 与 chief 工具 merge_readiness，
  // 不立 record 投影。
  'gate_digest',
  'gate_round',
  'gate_verdict',
  'gate_state',
  // #1491：闸状态读位 = GET /api/projects/{id}/autonomy 封套；member_activity
  // 只给闸读，不出 wire。
  'autonomy_state',
  'member_activity',
  'build_feedback',
] as const;
