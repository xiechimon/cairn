// 客户端状态——02 §6.4：localStorage 键名清单 r2 §1.5 实测，直接作复刻契约
// （键名前缀 = 品牌位，brand.ts localStoragePrefix 槽）。
// 命名规范（r2 §1.5 要点，原形 `tds.cache.<entity>-v<N>:<scope…>`），scope 为
// userId/teamId 组合 → cache-first + 版本化 + 多租户分片。
// 替换相位（D3 已触发 2026-09-23，#109）：`cairn-` / `cairn.` 同形替换
// （素材替换计划 §2）；source 列 = r2/r5 观测出处（原键形证据）。

export interface ClientStateKey {
  readonly key: string;
  readonly valueShape: string;
  readonly source: string;
}

export const LOCAL_STORAGE_KEYS: readonly ClientStateKey[] = [
  { key: 'cairn-theme', valueShape: 'light | dark', source: 'r2 §1.5' },
  { key: 'cairn.locale', valueShape: 'zh', source: 'r2 §1.5（与 cairn-locale 双形，原键同构）' },
  { key: 'cairn-locale', valueShape: 'zh', source: 'r2 §1.5' },
  { key: 'cairn.sidebarProjectsCollapsed', valueShape: '"1"', source: 'r2 §1.5' },
  {
    key: 'cairn.sidebarResourcesCollapsed',
    valueShape: '"1"',
    source: '[推断] #147（资源组折叠，与 sidebarProjectsCollapsed 同形；原键未观测）',
  },
  { key: 'cairn.panel-maximized', valueShape: '"0"', source: 'r2 §1.5' },
  {
    key: 'cairn.teamMembersLayout',
    valueShape: 'grid | chart',
    source: 'r2 §1.5（团队页视图切换）',
  },
  {
    key: 'cairn.projectTasksLayout',
    valueShape: 'list | grid',
    source: '[推断] #178（project 任务页视图切换，与 teamMembersLayout 同形；原键未观测）',
  },
  {
    key: 'cairn.cache.session-v1',
    valueShape: '{token:"",cookieName:"",expiresAt,user{…}}——会话走 cookie，token 字段留空',
    source: 'r2 §1.5',
  },
  {
    key: 'cairn.cache.me-v1:<userId>',
    valueShape: '{type:"user",id,displayName,avatarUrl,…}',
    source: 'r2 §1.5',
  },
  {
    key: 'cairn.cache.teams-v1:<userId>',
    valueShape: '[{id,name,createdAt,plan:"free",avatarStyle:"notionist…"}]',
    source: 'r2 §1.5',
  },
  {
    key: 'cairn.cache.members-v1:<userId>:<teamId>',
    valueShape: '[{id,teamId,actorId,memberType:"user",…}]',
    source: 'r2 §1.5',
  },
  { key: 'cairn.cache.projects-v1:<userId>:<teamId>', valueShape: '[]', source: 'r2 §1.5' },
  { key: 'cairn.cache.team-models-v1:<teamId>', valueShape: '{"models":[]}', source: 'r2 §1.5' },
  { key: 'cairn.cache.team-machines-v1:<teamId>', valueShape: '[]', source: 'r2 §1.5' },
  {
    key: 'cairn.cache.progress-v2:<userId>:<teamId>',
    valueShape: '{"todos":[],"builds":[]}',
    source: 'r2 §1.5',
  },
  {
    key: 'cairn.cache.notifications-v2:<userId>:<teamId>',
    valueShape: '{"unreadThreadIds":[]}',
    source: 'r2 §1.5',
  },
  {
    key: 'cairn.cache.chief-data-v3:<userId>:<teamId>',
    valueShape: '{"chief":{id:"chief-<user>-<team>",userId,teamId,…}}',
    source: 'r2 §1.5',
  },
  { key: 'cairn.cache.chief-threads-v1:<userId>:<teamId>', valueShape: '[]', source: 'r2 §1.5' },
  {
    key: 'cairn.cache.chief-draft-v1:<teamId>:new',
    valueShape: '草稿文本（跨会话恢复实测）',
    source: 'r5 §3.6 补录',
  },
];

/** 缓存键命名规范（r2 §1.5 要点原文形状）。 */
export const CACHE_KEY_PATTERN = '<brand>.cache.<entity>-v<N>:<scope…>';

/** 非品牌第三方键（r2 §1.5 实测同表）：复刻处置各归其面——
 * nextauth.message = todos.dev 认证库痕迹，复刻无 auth 库（01 §4.2 认证行：
 * httpOnly cookie 自设），处置归 M2 [推断]；mp_ 与 __mpq_ 前缀族 = 埋点，
 * 复刻埋点端点可空实现（02 §6.1）。 */
export const THIRD_PARTY_CLIENT_KEYS = [
  {
    key: 'nextauth.message',
    valueShape: '{"event":"session","data":{"trigger":"getSession"}}',
    note: '复刻无 auth 库（01 §4.2）；形状处置归 M2 [推断]',
  },
  {
    key: 'mp_* / __mpq_*',
    valueShape: 'mixpanel 埋点（distinct_id = userId）',
    note: '埋点可空实现（02 §6.1）',
  },
] as const;
