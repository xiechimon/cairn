export interface RestEndpoint {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly query?: readonly string[];
  readonly note?: string;
}

export const WEB_REST_ENDPOINTS: readonly RestEndpoint[] = [
  { method: 'GET', path: '/api/teams/{id}/feishu' },
  { method: 'PUT', path: '/api/teams/{id}/feishu' },
  { method: 'DELETE', path: '/api/teams/{id}/feishu' },
  { method: 'GET', path: '/api/auth/session', note: '保形返回 seed 用户（02 §2.1）' },
  { method: 'GET', path: '/api/user/me' },
  { method: 'GET', path: '/api/teams', note: '恒 seed 一行（02 §2.2）' },
  { method: 'GET', path: '/api/teams/{id}/members', note: 'Agent 列表实际走此端点（r5 §1）' },
  { method: 'GET', path: '/api/teams/{id}/machines' },
  { method: 'GET', path: '/api/teams/{id}/providers', note: 'presets[] 38 项原样（r3 §2）' },
  { method: 'GET', path: '/api/teams/{id}/mcp-servers' },
  { method: 'GET', path: '/api/teams/{id}/models' },
  { method: 'GET', path: '/api/teams/{id}/notifications', note: '→ {unreadThreadIds}（02 §9.1）' },
  { method: 'GET', path: '/api/teams/{id}/progress' },
  { method: 'GET', path: '/api/teams/{id}/stream', note: 'SSE，见 protocol/sse.ts' },
  {
    method: 'GET',
    path: '/api/teams/{id}/skills/{sid}',
    note: 'spec 13 #367：本地目录现扫投影（sid = frontmatter name 回落目录名）',
  },
  {
    method: 'GET',
    path: '/api/teams/{id}/skills/{sid}/file',
    query: ['fileName'],
    note: 'spec 13 #367：技能目录文件读面（磁盘现读，文本投影）',
  },
  { method: 'GET', path: '/api/teams/{id}/agents/{aid}' },
  { method: 'GET', path: '/api/teams/{id}/agents/{aid}/tasks' },
  { method: 'GET', path: '/api/teams/{id}/agents/{aid}/memories', note: '02 §4.4/r5 §6 实测' },
  { method: 'GET', path: '/api/teams/{id}/chief' },
  { method: 'GET', path: '/api/teams/{id}/chief/threads' },
  { method: 'GET', path: '/api/projects', query: ['teamId'] },
  { method: 'GET', path: '/api/projects/{id}/todos' },
  { method: 'GET', path: '/api/projects/{id}/branches' },
  { method: 'GET', path: '/api/projects/{id}/tags' },
  { method: 'GET', path: '/api/projects/{id}/builds' },
  {
    method: 'GET',
    path: '/api/projects/{id}/tree',
    query: ['ref'],
    note: '读裸库 ref 树（02 §3）',
  },
  { method: 'GET', path: '/api/projects/{id}/file', query: ['path', 'ref'] },
  {
    method: 'GET',
    path: '/api/projects/{id}/preview-token',
    query: ['ref'],
    note: '02 §9.3 在册不设计；触发条件 = 04 册附录 B',
  },
  { method: 'GET', path: '/api/todos', query: ['teamId'] },
  { method: 'GET', path: '/api/todos/{id}' },
  { method: 'GET', path: '/api/builds/{id}' },
  { method: 'GET', path: '/api/builds/{id}/steps' },
  { method: 'GET', path: '/api/conversations/{id}/messages', note: 'chief 会话同族（r5 §3.6）' },
  { method: 'GET', path: '/api/conversations/{id}/stream', note: 'SSE，见 protocol/sse.ts' },
  {
    method: 'GET',
    path: '/api/documents/{id}/diff',
    note: 'plan.md unified diff（02 §4.2/r5 §4）',
  },
  { method: 'GET', path: '/api/schedules', query: ['team'] },
  {
    method: 'GET',
    path: '/api/skills',
    query: ['teamId'],
    note: 'spec 13 #367：每次请求现扫本地技能目录，无缓存不入库',
  },
  {
    method: 'GET',
    path: '/api/capabilities',
    note: '[设计] 能力读面（XMON-16 / #499 B3 裁决 A）：引擎能力词表送 web——载荷 = 思考强度档位，单源 shared THINKING_LEVELS',
  },
  { method: 'GET', path: '/api/search', query: ['q'], note: '⌘K [设计] 自设（02 §6.3）' },
  {
    method: 'POST',
    path: '/api/projects/{id}/todos',
    note: 'body {title,spec}（r3 §3.1）+ 可选 tagIds[]（r9 §3.4 实测携带位）',
  },
  {
    method: 'POST',
    path: '/api/projects/{id}/tags',
    note: 'body {name,color} → 201 tag record 全形（r9 §3.4 实测；#309）',
  },
  {
    method: 'POST',
    path: '/api/projects/{id}/builds',
    note: '开始/重跑；body {todoIds[],assignment,withPlan}（r5 §3.4）',
  },
  { method: 'POST', path: '/api/builds/{id}/merge', note: '→ 202 {delegated:true}（r3 §3.6）' },
  { method: 'POST', path: '/api/builds/{id}/steps', note: '确认/驳回回路（02 §4.2/r5 §4）' },
  { method: 'POST', path: '/api/teams/{id}/providers' },
  { method: 'POST', path: '/api/teams/{id}/mcp-servers' },
  { method: 'POST', path: '/api/teams/{id}/agents', note: '→ 201 {id}（r5 §1/§8 补录）' },
  {
    method: 'GET',
    path: '/api/teams/{id}/push/key',
    note: '#1686: VAPID public-key endpoint for pushManager.subscribe applicationServerKey',
  },
  {
    method: 'POST',
    path: '/api/teams/{id}/push/subscriptions',
    note: '#1686: Web Push subscription upload with shared validation and endpoint upsert',
  },
  {
    method: 'DELETE',
    path: '/api/teams/{id}/push/subscriptions',
  },
  {
    method: 'POST',
    path: '/api/skills',
    query: ['teamId'],
    note: 'XMON-109（spec 13 回摆）：写路径——建技能目录（body {name,description,files[]}，frontmatter 是唯一真值）；→ 201 record',
  },
  {
    method: 'PUT',
    path: '/api/teams/{id}/skills/{sid}',
    note: 'XMON-109（spec 13 回摆）：写路径——覆写式更新（列出者覆写、未列者保留；改名须携带新 SKILL.md）',
  },
  {
    method: 'POST',
    path: '/api/teams/{id}/skills/import',
    note: '#1170：导入通道——body {localPath} 或 {url} 二选一（本地目录 / GitHub 公共仓子目录）；落盘复用 createLocalSkill 校验；SSRF/路径守卫见 services/skill-import.ts',
  },
  {
    method: 'POST',
    path: '/api/teams/{id}/skills/{sid}/refresh',
    note: '#1170：按记录的来源重拉（技能 id 不变，复用 updateLocalSkill 覆写语义）；无来源记录 = 409',
  },
  { method: 'POST', path: '/api/schedules' },
  { method: 'POST', path: '/api/analytics/first-touch', note: '形状保留、内容自选；可空实现' },
  {
    method: 'POST',
    path: '/_mp/api/track',
    note: '埋点端点（r3 §8.2 PostHog 风格 base64 batch）；复刻可空实现（02 §6.1）',
  },
  { method: 'PATCH', path: '/api/teams/{id}/providers/{pid}' },
  { method: 'PATCH', path: '/api/teams/{id}/agents/{aid}' },
  { method: 'PATCH', path: '/api/teams/{id}/chief', note: '绑定 Agent（r5 §2 抓包）' },
  {
    method: 'POST',
    path: '/api/teams/{id}/providers/oauth/{preset}/authorize',
    note: '#231 [设计]：签发授权 URL（state 入册，TTL 10min 单次核销）',
  },
  {
    method: 'GET',
    path: '/api/oauth/callback',
    query: ['code', 'state', 'error'],
    note: '#231 [设计]：收码 → token 密封落 provider 行（02 §8）→ 302 回 providers 页',
  },
];

export const DELETE_FACE = {
  status: '[推断]',
  rule: 'REST 同名 DELETE（02 §6.1）',
  resources: [
    'teams/{id}/machines',
    'teams/{id}/agents/{aid}',
    'teams/{id}/skills',
    'teams/{id}/mcp-servers',
    'teams/{id}/agents/{aid}/memories',
    'teams/{id}/providers',
    'teams/{id}/secrets',
    'todos',
    'schedules',
  ],
} as const;

export const NON_REPLICATED_ENDPOINTS = [
  {
    method: 'POST',
    path: '/api/push',
    reason: 'Web Push 订阅上传——R1 已裁决有意 divergence（02 §9.1 终裁、04 §5）',
  },
] as const;
