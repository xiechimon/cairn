export interface RestEndpoint {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly query?: readonly string[];
  readonly note?: string;
}

export const WEB_REST_ENDPOINTS: readonly RestEndpoint[] = [
  { method: 'GET', path: '/api/user/me' },
  { method: 'GET', path: '/api/teams', note: '恒 seed 一行（02 §2.2）' },
  { method: 'GET', path: '/api/teams/{id}/members', note: 'Agent 列表实际走此端点（r5 §1）' },
  { method: 'GET', path: '/api/teams/{id}/machines' },
  { method: 'GET', path: '/api/computers', note: 'the team computers (D75 P8a)' },
  {
    method: 'GET',
    path: '/api/computers/steps',
    note: 'the browser or screen step an agent of this user is taking on each machine right now',
  },
  {
    method: 'GET',
    path: '/api/computers/steps/{callId}/shot',
    note: 'the screenshot a screen tool call captured, for the machine card',
  },
  {
    method: 'POST',
    path: '/api/teams/{teamId}/computers/{computerId}/screen',
    note: 'D75: mint one sealed viewer capability for a screen or controlled terminal',
  },
  {
    method: 'POST',
    path: '/api/teams/{teamId}/computers/{computerId}/control',
    note: 'D75: acquire the user control lease',
  },
  {
    method: 'PATCH',
    path: '/api/teams/{teamId}/computers/{computerId}/control',
    note: 'D75: renew the matching live user control lease',
  },
  {
    method: 'DELETE',
    path: '/api/teams/{teamId}/computers/{computerId}/control',
    note: 'D75: release user control and close its live channels',
  },
  {
    method: 'GET',
    path: '/api/server/backup',
    note: 'backup-status.json next to server.db (#2162)',
  },
  {
    method: 'GET',
    path: '/api/server/deploy',
    note: 'deploy.json next to server.db, written by deploy-self.sh (#2427)',
  },
  { method: 'GET', path: '/api/teams/{id}/providers', note: 'presets[] 38 项原样（r3 §2）' },
  { method: 'GET', path: '/api/teams/{id}/mcp-servers' },
  { method: 'GET', path: '/api/teams/{id}/models' },
  { method: 'GET', path: '/api/teams/{id}/model-routing' },
  {
    method: 'GET',
    path: '/api/teams/{id}/routing-settings',
    note: 'D60 PR8: routing_rule + work_policy settings (flag state included)',
  },
  {
    method: 'POST',
    path: '/api/teams/{id}/routing-settings/seed',
    note: 'D60 PR8: seed missing session/review rules and policies from agents',
  },
  {
    method: 'GET',
    path: '/api/teams/{id}/usage/daily',
    note: 'tokens per local day, Coordinator and tasks apart (?days=1..371&tz=IANA)',
  },
  { method: 'GET', path: '/api/teams/{id}/top-models', note: 'team Top Models list or null' },
  { method: 'PUT', path: '/api/teams/{id}/top-models', note: 'replace the Top Models list' },
  { method: 'DELETE', path: '/api/teams/{id}/top-models', note: 'reset to the suggested list' },
  {
    method: 'PATCH',
    path: '/api/teams/{id}/routing-rules/{use}',
    note: 'D60 PR8: upsert a routing_rule by use',
  },
  {
    method: 'PATCH',
    path: '/api/teams/{id}/work-policies/{use}',
    note: 'D60 PR8: upsert a work_policy by use',
  },
  { method: 'GET', path: '/api/teams/{id}/notifications', note: '→ {unreadThreadIds}（02 §9.1）' },
  { method: 'GET', path: '/api/teams/{id}/progress' },
  { method: 'GET', path: '/api/teams/{id}/stream', note: 'SSE，见 protocol/sse.ts' },
  {
    method: 'GET',
    path: '/api/teams/{id}/skills/import-candidates',
    note: 'read-only scan of ~/.agents/skills and ~/.claude/skills for the import picker; skills already in the Cairn skills directory are left out',
  },
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
  {
    method: 'GET',
    path: '/api/teams/{id}/chief',
    query: ['threadId'],
    note: '{chief, agentActor, context, watches, wakes, orchestration, outage}; orchestration = latest orchestrate turn {todoId, state, error} or null',
  },
  {
    method: 'GET',
    path: '/api/teams/{id}/chief/threads',
    note: 'the main Coordinator thread first, then one thread per opened project channel',
  },
  {
    method: 'GET',
    path: '/api/teams/{id}/chief/memory-usage',
    note: '{usage|null}: the newest chief step carrying a memoryTrace, with stepId, threadId, createdAt and the injected/recalled id lists',
  },
  {
    method: 'POST',
    path: '/api/teams/{id}/chief/channels/{projectId}',
    note: 'find or create the project channel thread; 201 with a greeting turn queued when created, 200 when it exists; 404 for a project outside the team, 409 when archived',
  },
  { method: 'GET', path: '/api/projects', query: ['teamId'] },
  { method: 'GET', path: '/api/projects/{id}/todos' },
  { method: 'GET', path: '/api/projects/{id}/branches' },
  { method: 'GET', path: '/api/projects/{id}/builds' },
  {
    method: 'GET',
    path: '/api/projects/{id}/preview-token',
    query: ['ref'],
    note: '02 §9.3 在册不设计；触发条件 = 04 册附录 B',
  },
  { method: 'GET', path: '/api/todos', query: ['teamId'] },
  { method: 'GET', path: '/api/tasks', query: ['teamId', 'sectioned'] },
  { method: 'GET', path: '/api/todos/{id}' },
  {
    method: 'POST',
    path: '/api/todos/{id}/runner',
    note: 'body {machineId}; runs a waiting task on that Runner this time; 409 once claimed, after a session, for a local-path project or when the Runner fails a hard gate',
  },
  {
    method: 'POST',
    path: '/api/todos/{id}/messages',
    note: 'body {content, clientMessageId}; a repeated clientMessageId returns the first response and delivers nothing again; a person messages the thread directly (steer, plan revision or restart by phase) and the Coordinator gets a thread-message row (D65)',
  },
  {
    method: 'GET',
    path: '/api/todos/{id}/design',
    note: 'artifacts of the task with their kind: current version, version count, open comments, live share token; shareOrigin is the relay origin or null',
  },
  { method: 'GET', path: '/api/todos/{id}/design/{fileName}/versions', note: 'by seq descending' },
  {
    method: 'POST',
    path: '/api/todos/{id}/design/{fileName}/versions',
    note: 'saves a whiteboard edited in the artifact panel as a user version',
  },
  {
    method: 'GET',
    path: '/api/attachments/{id}/artifact',
    note: 'the task artifact this attachment is a version of: file, kind, version seq and count, open comments',
  },
  {
    method: 'POST',
    path: '/api/todos/{id}/design/versions/{versionId}/restore',
    note: 'appends a restore version on the old version file',
  },
  {
    method: 'GET',
    path: '/api/design/versions/{versionId}/page',
    note: 'the version HTML under the Open Design sandbox CSP; ?print=1 adds allow-modals and print()',
  },
  {
    method: 'GET',
    path: '/api/attachments/{id}/document-preview',
    note: 'docx, pptx, xlsx text sections (borrowed from Open Design)',
  },
  {
    method: 'GET',
    path: '/api/attachments/{id}/thumbnail',
    note: 'JPEG of the first screen of a ready deliverable page, captured once by the desktop app; 404 without it',
  },
  {
    method: 'GET',
    path: '/api/todos/{id}/design/{fileName}/comments',
    note: 'all statuses, by pin',
  },
  {
    method: 'POST',
    path: '/api/todos/{id}/design/comments',
    note: 'body {versionId, viewport, note, target fields, markAttachmentId?}; inserts an open comment with the next pin',
  },
  {
    method: 'PATCH',
    path: '/api/todos/{id}/design/comments/{commentId}',
    note: 'body {note?} on an open comment, {status: resolved|open} to resolve or reopen; 409 otherwise',
  },
  {
    method: 'DELETE',
    path: '/api/todos/{id}/design/comments/{commentId}',
    note: 'open comments only; 409 once sent',
  },
  {
    method: 'POST',
    path: '/api/todos/{id}/design/marks',
    note: 'body {pngBase64}; stores the baked mark-up PNG as a design-scope attachment',
  },
  {
    method: 'POST',
    path: '/api/todos/{id}/design/{fileName}/share',
    note: 'returns the live share link through the relay or creates one; 409 relay-missing without a relay',
  },
  {
    method: 'DELETE',
    path: '/api/todos/{id}/design/{fileName}/share',
    note: 'revokes the live link',
  },
  { method: 'POST', path: '/api/projects/{id}/archive', note: 'sets project.archivedAt' },
  { method: 'POST', path: '/api/projects/{id}/unarchive', note: 'clears project.archivedAt' },
  { method: 'GET', path: '/api/builds/{id}' },
  { method: 'GET', path: '/api/builds/{id}/steps' },
  { method: 'GET', path: '/api/conversations/{id}/messages', note: 'chief 会话同族（r5 §3.6）' },
  { method: 'GET', path: '/api/conversations/{id}/stream', note: 'SSE，见 protocol/sse.ts' },
  {
    method: 'PUT',
    path: '/api/streams/{connectionId}/conversations',
    note: '设定团队流连接订阅的会话集合，见 protocol/sse.ts',
  },
  {
    method: 'GET',
    path: '/api/documents/{id}/diff',
    note: 'plan.md unified diff（02 §4.2/r5 §4）',
  },
  { method: 'GET', path: '/api/schedules', query: ['team'] },
  { method: 'POST', path: '/api/webhook/schedule/{token}' },
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
    note: 'body {title,spec,output?}; retired category assignments are rejected before writes',
  },
  {
    method: 'POST',
    path: '/api/projects/{id}/builds',
    note: '开始/重跑；body {todoIds[],assignment,withPlan}（r5 §3.4）',
  },
  {
    method: 'POST',
    path: '/api/teams/{id}/notifications/{entityId}/read',
    note: 'flips readAt; 404 without a row',
  },
  {
    method: 'POST',
    path: '/api/teams/{id}/notifications/{entityId}/unread',
    note: 'clears readAt; creates the row for an existing todo',
  },
  { method: 'POST', path: '/api/builds/{id}/merge', note: '→ 202 {delegated:true}（r3 §3.6）' },
  { method: 'POST', path: '/api/builds/{id}/steps', note: '确认/驳回回路（02 §4.2/r5 §4）' },
  { method: 'POST', path: '/api/teams/{id}/providers' },
  { method: 'POST', path: '/api/teams/{id}/mcp-servers' },
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
    path: '/api/teams/{id}/push/apns-devices',
    note: '#4632: iOS app registers its APNs device token for the needs-you pushes',
  },
  { method: 'DELETE', path: '/api/teams/{id}/push/apns-devices' },
  { method: 'POST', path: '/api/teams/{id}/push/receipts' },
  { method: 'POST', path: '/api/teams/{id}/push/test' },
  { method: 'GET', path: '/api/teams/{id}/push/test/{deliveryId}' },
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
  { method: 'PATCH', path: '/api/teams/{id}/providers/{pid}' },
  {
    method: 'POST',
    path: '/api/teams/{id}/providers/oauth/{preset}/authorize',
    note: '#231 [设计]：签发授权 URL（state 入册，TTL 10min 单次核销）',
  },
  {
    method: 'POST',
    path: '/api/teams/{id}/providers/oauth/xai/device',
    note: 'SuperGrok device-code start; device_code stays on the server',
  },
  {
    method: 'POST',
    path: '/api/teams/{id}/providers/oauth/xai/device/poll',
    note: 'SuperGrok device-code poll; stores the refresh token, not the access token',
  },
  {
    method: 'POST',
    path: '/api/teams/{id}/providers/oauth/openai-codex/device',
    note: 'ChatGPT Codex device-code start; device_auth_id stays on the server',
  },
  {
    method: 'POST',
    path: '/api/teams/{id}/providers/oauth/openai-codex/device/poll',
    note: 'ChatGPT Codex device-code poll; stores the sealed OAuth secret as the openai-codex provider',
  },
  {
    method: 'GET',
    path: '/api/oauth/callback',
    query: ['code', 'state', 'error'],
    note: '#231 [设计]：收码 → token 密封落 provider 行（02 §8）→ 302 回 providers 页',
  },
  {
    method: 'POST',
    path: '/api/webhook/github/{token}',
    note: 'seq-32：GitHub webhook——只做投递去重，事件不消费；202 一律，未知 token 401',
  },
];

export const DELETE_FACE = {
  status: '[推断]',
  rule: 'REST 同名 DELETE（02 §6.1）',
  resources: [
    'teams/{id}/machines',
    'teams/{id}/skills',
    'teams/{id}/mcp-servers',
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
