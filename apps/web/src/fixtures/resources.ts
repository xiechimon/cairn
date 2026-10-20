import type { ModelSource } from '@pacman/shared';
import {
  legacyDone,
  legacyReview,
  MACHINE_ID,
  MACHINE_NAME,
  MACHINE_REMOTE_ID,
  MACHINE_REMOTE_NAME,
  r7,
} from './core.js';
import type { FixtureSet, ResourcesContent } from './records.js';

/** Resource surfaces (r7 06–10, issue #69): the r3 session left one skill,
 *  one MCP server, the online r3 machine and a custom gateway on the free
 *  team, so the captures show populated rows rather than empty states
 *  (secrets excepted — its empty state is the capture). Row content is
 *  verbatim from the bitmaps; `2 天前` on the MCP row is the capture's own
 *  relative label (created on the r3 day), carried verbatim like the
 *  board's relative labels. */
// providers 页 runtime tabs canon（spec 11 §A1-A4，#356）：pi 段 = custom
// provider models[] 投影的展示样（承接 r7 07「R3 网关」canon 的量感）；
// claude-code 段 = 本机 settings.json 槽位映射样。hostname 与 machines
// canon（MACHINE_NAME）同源。两段提成命名常量 = 未安装分支变体（resources
// CcMissing）的复用源。
const PROVIDER_SOURCE_PI: ModelSource = {
  runtime: 'pi',
  installed: true,
  hostname: MACHINE_NAME,
  models: [
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5（R3 网关）' },
    { id: 'claude-opus-4-5', name: 'Claude Opus 4.5（R3 网关）' },
    { id: 'gpt-5.2', name: 'GPT-5.2（R3 网关）' },
  ],
};

const PROVIDER_SOURCE_CC: ModelSource = {
  runtime: 'claude-code',
  installed: true,
  // #1259：claude-code 段挂 remote canon 机（本机 canon 保持 pi-only，
  // machines-local 的亮度分态不动）；hostname 与该机同名。
  hostname: MACHINE_REMOTE_NAME,
  machineId: MACHINE_REMOTE_ID,
  // #1050：canon fixture 带上两个可用性事实位（装了 + 已登录），三态的另两支
  // 由 e2e 按 scenario 覆写（页面断言需要「装了没配」与「没装」同时可见）。
  bin: { path: '/home/u/.local/bin/claude', version: '2.1.289' },
  auth: { state: 'logged-in', method: 'oauth_token', provider: 'firstParty' },
  models: [
    { id: 'claude-opus-4-5', name: 'claude-opus-4-5', slot: 'default' },
    { id: 'claude-opus-4-1', name: 'claude-opus-4-1', slot: 'opus' },
    { id: 'claude-sonnet-5', name: 'claude-sonnet-5', slot: 'sonnet' },
    { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5', slot: 'haiku' },
  ],
};

export const RESOURCES: ResourcesContent = {
  skills: [{ name: 'r3-probe-skill', description: 'R3 盘点测试技能' }],
  mcpServers: [
    {
      name: 'r3-mcp',
      kind: '远程（HTTP）',
      url: 'https://example.invalid/mcp',
      ago: '2 天前',
    },
  ],
  // spec 11 A8（#357）：本机行钉首（hostname canon + per-runtime 品牌 mark，
  // pi 开 / Claude Code 关 = 两态展示）；托管 facade 行已除。
  machines: [
    {
      id: MACHINE_ID,
      kind: 'local',
      name: MACHINE_NAME,
      online: true,
      enabledRuntimes: ['pi'],
      // XMON-113：机器层 shell 闸，fixture canon = 关（与 server migration
      // 回填 false 同态——存量机器默认不给 shell）。
      shellEnabled: false,
      // #1108：并发面 fixture canon = 历史默认 3 / 空载 0（与 migration 回填
      // DEFAULT 3 同态）。
      maxConcurrent: 3,
      runningSteps: 0,
    },
    {
      id: MACHINE_REMOTE_ID,
      kind: 'remote',
      name: MACHINE_REMOTE_NAME,
      online: true,
      enabledRuntimes: ['pi', 'claude-code'],
      shellEnabled: false,
      maxConcurrent: 3,
      runningSteps: 0,
    },
  ],
  providerSources: [PROVIDER_SOURCE_PI, PROVIDER_SOURCE_CC],
};

export const resourcesDefault: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  resources: RESOURCES,
};

/** #1416 技能多行命名场景（无 capture，chief-md 先例）：三行可点的技能行，
 *  钉住按钮行之间的分隔线（单行的默认集画不出「行间」）。 */
export const resourcesSkillsList: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    skills: [
      { name: 'r3-probe-skill', description: 'R3 盘点测试技能' },
      { name: 'release-notes', description: '按提交历史起草发布说明' },
      { name: 'repo-audit', description: '盘点仓库依赖与许可证' },
    ],
  },
};

/** #356 未安装分支 canon（spec 11 §A4）：机器上既没有 settings.json 也没有
 *  claude 二进制 → header 转「未安装」指引态、模型行零渲染。#1050 起
 *  「没装」在 wire 上是 `bin: null`（探过了没有），不是键缺席。 */
export const resourcesCcMissing: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    providerSources: [
      PROVIDER_SOURCE_PI,
      {
        runtime: 'claude-code',
        installed: false,
        hostname: MACHINE_NAME,
        models: [],
        bin: null,
      },
    ],
  },
};

/** #1050 配置文件在但二进制没了：settings.json 照常解出模型槽，探测结论是
 *  没有二进制 → 主句「未安装」（消掉旧行为的假绿）。scenario = 10-cc-bin-gone。 */
export const resourcesCcBinGone: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    providerSources: [{ ...PROVIDER_SOURCE_CC, bin: null }],
  },
};

/** #1050 老 daemon（没探过）：`bin` 键整个缺席 → 页面维持「只看 installed」
 *  的旧行为，且不出现细字行、不写「未知」。scenario = 10-cc-legacy。 */
export const resourcesCcLegacy: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    providerSources: [{ ...PROVIDER_SOURCE_CC, bin: undefined }],
  },
};

/** #1050 装了没配态：二进制在、settings.json 缺（或没写槽）→ 主句「已安装，
 *  未配置模型槽」+ 配置补法句（与「没装」的补法不同），模型行零渲染。
 *  scenario = 10-cc-noconfig。 */
export const resourcesCcNoConfig: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    providerSources: [
      PROVIDER_SOURCE_PI,
      {
        runtime: 'claude-code',
        installed: false,
        hostname: MACHINE_NAME,
        models: [],
        bin: { path: '/home/u/.local/bin/claude', version: '2.1.289' },
      },
    ],
  },
};

/** #1050 未登录态：二进制与配置都在、凭据态 = not-logged-in → 细字行尾加
 *  「未登录」角标（主句不变——「装没装」与「登没登」是两个维度）。
 *  scenario = 10-cc-loggedout。 */
export const resourcesCcLoggedOut: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    providerSources: [
      PROVIDER_SOURCE_PI,
      { ...PROVIDER_SOURCE_CC, auth: { state: 'not-logged-in', provider: 'firstParty' } },
    ],
  },
};

/** #895 机器页三态读标注命名场景（无 capture，newtask-machines 先例）：
 *  resourcesDefault 面 + 三机行集——本机（主力机徽标）+ 在线远端（回合
 *  进行中）+ 离线远端（等待机器）。e2e 钉三态标注的展示形与「标注零
 *  控件」纪律；live 全链真值归 verify 证据（docs/verify/865/）。 */
export const machinesChiefState: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    machines: [
      {
        id: MACHINE_ID,
        kind: 'local',
        name: MACHINE_NAME,
        online: true,
        enabledRuntimes: ['pi'],
        shellEnabled: false,
        chiefHost: true,
      },
      { id: 'mea-wsl-online', kind: 'remote', name: 'mea-wsl', online: true, chiefRunning: true },
      {
        id: 'vps-relay-offline',
        kind: 'remote',
        name: 'vps-relay',
        online: false,
        chiefWaiting: true,
      },
    ],
  },
};
