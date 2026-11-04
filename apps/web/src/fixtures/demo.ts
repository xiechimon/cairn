import { at, TEAM_ID } from './core.js';
import type {
  ChangesContent,
  ChiefStreamItem,
  DetailContent,
  DocBlock,
  FixtureSet,
  MachineRow,
  TodoRecord,
} from './records.js';
import { RESOURCES } from './resources.js';

function demoFixtureOf(): FixtureSet {
  const DEMO_DAY = '2026-10-25';
  const NOW = at(DEMO_DAY, 15, 0);
  const PROJECT = 'demo-shop';
  const PROJECT_ID_DEMO = 'demo-shop-project';
  const BUILDER = { id: 'demo-builder', displayName: 'demo-builder' };
  const SCRIBE = { id: 'demo-scribe', displayName: 'demo-scribe' };
  const REVIEWER = { id: 'demo-reviewer', displayName: 'reviewer-turing' };

  function demoTodo(input: {
    id: string;
    seqNum: number;
    title: string;
    phase: TodoRecord['phase'];
    phaseAt: number;
    orderIndex: number;
    agent?: typeof BUILDER;
    latestBuildId?: string;
    lastRunAt?: number;
    hasPlan?: boolean;
    hasChanges?: boolean;
    buildHistory?: TodoRecord['buildHistory'];
    awaitingReply?: boolean;
  }): TodoRecord {
    return {
      id: input.id,
      teamId: TEAM_ID,
      projectId: PROJECT_ID_DEMO,
      title: input.title,
      spec: input.title,
      phase: input.phase,
      phaseAt: input.phaseAt,
      seqNum: input.seqNum,
      orderIndex: input.orderIndex,
      tagIds: [],
      assignment: input.agent != null ? { agentId: input.agent.id } : null,
      agent: input.agent ?? null,
      latestBuildId: input.latestBuildId ?? null,
      lastRunAt: input.lastRunAt ?? null,
      hasChanges: input.hasChanges ?? false,
      hasPlan: input.hasPlan ?? false,
      buildHistory: input.buildHistory ?? [],
      sourceTodo: null,
      v: 3,
      ...(input.awaitingReply === true ? { awaitingReply: true } : {}),
    };
  }

  const DEMO_TASKS: TodoRecord[] = [
    demoTodo({
      id: 'demo-cart-merge',
      seqNum: 21,
      title: '登录后合并游客购物车',
      phase: 'confirm',
      phaseAt: at(DEMO_DAY, 14, 31),
      orderIndex: 0,
      agent: BUILDER,
      latestBuildId: 'demo-conv-cart-3',
      lastRunAt: at(DEMO_DAY, 14, 12),
      hasPlan: true,
      hasChanges: true,
      buildHistory: [
        { buildId: 'demo-conv-cart-3', createdAt: at(DEMO_DAY, 13, 58) },
        { buildId: 'demo-conv-cart-2', createdAt: at(DEMO_DAY, 12, 20) },
        { buildId: 'demo-conv-cart-1', createdAt: at(DEMO_DAY, 10, 5) },
      ],
    }),
    demoTodo({
      id: 'demo-rate-limit',
      seqNum: 22,
      title: '给登录接口加限流与防刷',
      phase: 'review',
      phaseAt: at(DEMO_DAY, 14, 40),
      orderIndex: 1,
      agent: BUILDER,
      latestBuildId: 'demo-conv-rate-1',
      lastRunAt: at(DEMO_DAY, 14, 2),
      hasPlan: true,
      hasChanges: true,
      buildHistory: [{ buildId: 'demo-conv-rate-1', createdAt: at(DEMO_DAY, 13, 47) }],
    }),
    demoTodo({
      id: 'demo-order-migration',
      seqNum: 23,
      title: '订单库迁移到新 schema',
      phase: 'failed',
      phaseAt: at(DEMO_DAY, 14, 44),
      orderIndex: 2,
      agent: BUILDER,
      latestBuildId: 'demo-conv-migration-1',
      lastRunAt: at(DEMO_DAY, 14, 41),
      hasPlan: true,
      buildHistory: [{ buildId: 'demo-conv-migration-1', createdAt: at(DEMO_DAY, 14, 5) }],
    }),
    demoTodo({
      id: 'demo-search-ranking',
      seqNum: 24,
      title: '重写商品搜索排序',
      phase: 'building',
      phaseAt: at(DEMO_DAY, 14, 55),
      orderIndex: 0,
      agent: SCRIBE,
      latestBuildId: 'demo-conv-search-2',
      lastRunAt: at(DEMO_DAY, 14, 55),
      hasPlan: true,
      buildHistory: [{ buildId: 'demo-conv-search-2', createdAt: at(DEMO_DAY, 14, 50) }],
    }),
    demoTodo({
      id: 'demo-coupon-page',
      seqNum: 25,
      title: '优惠券结算页',
      phase: 'done',
      phaseAt: at(DEMO_DAY, 13, 40),
      orderIndex: 0,
      agent: BUILDER,
      latestBuildId: 'demo-conv-coupon-1',
      lastRunAt: at(DEMO_DAY, 13, 12),
      hasPlan: true,
      hasChanges: true,
      buildHistory: [{ buildId: 'demo-conv-coupon-1', createdAt: at(DEMO_DAY, 12, 45) }],
    }),
    demoTodo({
      id: 'demo-stock-badge',
      seqNum: 26,
      title: '商品页加库存角标',
      phase: 'todo',
      phaseAt: at(DEMO_DAY, 11, 10),
      orderIndex: 0,
    }),
    demoTodo({
      id: 'demo-checkout-events',
      seqNum: 27,
      title: '补齐结算页埋点',
      phase: 'todo',
      phaseAt: at(DEMO_DAY, 11, 25),
      orderIndex: 1,
    }),
    demoTodo({
      id: 'demo-readme',
      seqNum: 28,
      title: '写演示项目的 README',
      phase: 'todo',
      phaseAt: at(DEMO_DAY, 11, 40),
      orderIndex: 2,
    }),
  ];

  const para = (text: string): DocBlock => ({ kind: 'para', segments: [{ text }] });
  const head = (text: string): DocBlock => ({ kind: 'head', segments: [{ text }] });
  const bullet = (text: string): DocBlock => ({ kind: 'bullet', segments: [{ text }] });

  const CART_DOC: DocBlock[] = [
    head('目标'),
    para('游客加购不登录也能买：登录后把游客购物车并进正式购物车，不丢件、不重复计价。'),
    head('方案（v3）'),
    bullet('登录成功事件触发合并，后台任务异步执行，不阻塞跳转。'),
    bullet('按 SKU 合并数量；两边都有的行取最新加入时间那条的单价。'),
    bullet(
      'v1 被 AI 审核以 blocking 驳回（合并会覆盖促销价），v2 改为保留低价，v3 补幂等键防重复合并。',
    ),
    bullet('合并结果写审计行，购物车 icon 角标实时刷新。'),
  ];

  const SEARCH_DOC: DocBlock[] = [
    head('目标'),
    para('搜索从纯相关度排序改成相关度 + 销量 + 有货加权，无结果时给纠错建议。'),
    head('方案'),
    bullet('索引层加 sales30d 与 stock 两个字段，重建离线索引。'),
    bullet('查询层三因子加权，权重走项目设置，可调。'),
    bullet('零结果回落到拼音分词再试一次，仍无结果出建议词。'),
  ];

  const CART_DETAIL: DetailContent = {
    transcript: [
      { kind: 'run', at: '14:12', machine: 'dev-mac' },
      {
        kind: 'user',
        text: '登录后合并游客购物车，两边都有的商品保留低价。',
        seq: 21,
        title: '登录后合并游客购物车',
      },
      {
        kind: 'robot',
        paragraphs: [[{ text: '收到。先读结算与购物车两块的现状，v1 方案稍后向你汇报。' }]],
        footer: { seconds: 12 },
      },
      {
        kind: 'plan',
        title: '方案 · v3',
        preview: '登录成功事件触发异步合并，按 SKU 合并数量，两边都有的行保留低价。',
        seconds: 29,
      },
      {
        kind: 'review',
        conclusion: 'AI 审核：v1 的合并逻辑会用正式购物车单价覆盖促销价，需修复后再确认。',
        findings: [
          {
            id: '1',
            severity: 'blocking',
            summary: '合并覆盖了促销价',
            description: 'mergeGuestCart 直接以 guest 行的 updatedAt 取价，会把闪购价顶掉。',
            file: 'src/cart/merge.ts',
            line: 42,
            suggestion: '两边都有的 SKU 保留低价那行。',
          },
          {
            id: '2',
            severity: 'suggestion',
            summary: '缺幂等键',
            description: '双击登录可能触发两次合并。',
            file: 'src/cart/merge.ts',
            line: 88,
          },
        ],
      },
      {
        kind: 'robot',
        paragraphs: [
          [
            {
              text: 'AI 审核的 blocking 项已修：合并改为保留低价，并加了幂等键，这是 v3，麻烦确认。',
            },
          ],
        ],
        footer: { seconds: 31 },
      },
    ],
    doc: CART_DOC,
    planVersions: [
      { v: 'v3', at: at(DEMO_DAY, 14, 31) },
      { v: 'v2', at: at(DEMO_DAY, 12, 20) },
    ],
  };

  const RATE_CHANGES: ChangesContent = {
    expanded: true,
    files: [
      {
        path: 'src/auth/rate-limit.ts',
        added: 24,
        removed: 3,
        hunks: [
          {
            header: '@@ -1,6 +1,20 @@',
            lines: [
              { kind: 'context', text: 'import { Redis } from "ioredis";', oldNo: 1, newNo: 1 },
              { kind: 'add', text: 'const WINDOW_MS = 60_000;', newNo: 2 },
              { kind: 'add', text: 'const MAX_PER_IP = 20;', newNo: 3 },
              { kind: 'del', text: 'export function checkLogin(req) {', oldNo: 2 },
              { kind: 'add', text: 'export async function checkLogin(req, ip) {', newNo: 4 },
              { kind: 'context', text: '  return true;', oldNo: 3, newNo: 5 },
            ],
          },
        ],
      },
      {
        path: 'src/auth/login.ts',
        added: 6,
        removed: 1,
        hunks: [
          {
            header: '@@ -8,4 +8,9 @@',
            lines: [
              {
                kind: 'context',
                text: 'app.post("/login", async (req, res) => {',
                oldNo: 8,
                newNo: 8,
              },
              { kind: 'add', text: '  await checkLogin(req, req.ip);', newNo: 9 },
              {
                kind: 'context',
                text: '  const user = await findUser(req.body);',
                oldNo: 9,
                newNo: 10,
              },
            ],
          },
        ],
      },
    ],
  };

  const RATE_DETAIL: DetailContent = {
    transcript: [
      { kind: 'run', at: '14:02', machine: 'build-box' },
      {
        kind: 'user',
        text: '给登录接口加限流与防刷：单 IP 每分钟最多 20 次，超限给明确提示。',
        seq: 22,
        title: '给登录接口加限流与防刷',
      },
      {
        kind: 'robot',
        paragraphs: [
          [{ text: '方案：固定窗口限流，超限返回 429 与重试提示，控制台可观测命中数。' }],
        ],
        footer: { seconds: 18 },
      },
      {
        kind: 'work',
        id: 'demo-rate-work',
        expanded: false,
        steps: [
          {
            kind: 'call',
            id: 'demo-rate-edit-1',
            action: 'edit',
            label: 'edit',
            target: 'src/auth/rate-limit.ts',
            seconds: 16,
            output: null,
            error: false,
            running: false,
            unfinished: false,
          },
          {
            kind: 'call',
            id: 'demo-rate-edit-2',
            action: 'edit',
            label: 'edit',
            target: 'src/auth/login.ts',
            seconds: 14,
            output: null,
            error: false,
            running: false,
            unfinished: false,
          },
          {
            kind: 'call',
            id: 'demo-rate-run',
            action: 'run',
            label: 'bash',
            command: 'pnpm test auth',
            seconds: 17,
            output: null,
            error: false,
            running: false,
            unfinished: false,
          },
        ],
      },
      {
        kind: 'verify',
        passed: true,
        conclusion: 'auth 套件 41 条全绿，限流窗口与提示文案均有覆盖。',
        evidence: [{ path: 'src/auth/rate-limit.test.ts', note: '新增 9 条' }],
      },
      {
        kind: 'verify',
        passed: false,
        conclusion: 'e2e 登录流有 2 条用例失败，疑似新 429 响应未进用例断言。',
        evidence: [
          { path: 'e2e/auth/login.spec.ts' },
          { path: 'test-results/auth-e2e.log', note: '第 3/41 条' },
        ],
      },
    ],
    changes: RATE_CHANGES,
  };

  const SEARCH_DETAIL: DetailContent = {
    transcript: [
      { kind: 'run', at: '14:55', machine: 'dev-mac' },
      {
        kind: 'user',
        text: '重写商品搜索排序：相关度 + 销量 + 有货加权，无结果给建议词。',
        seq: 24,
        title: '重写商品搜索排序',
      },
      { kind: 'streaming', seconds: 42, label: '调用工具：bash pnpm reindex …' },
    ],
    doc: SEARCH_DOC,
  };

  const MIGRATION_DETAIL: DetailContent = {
    transcript: [
      { kind: 'run', at: '14:41', machine: 'build-box' },
      {
        kind: 'user',
        text: '订单库迁移到新 schema：orders 表拆出 items，历史数据回填。',
        seq: 23,
        title: '订单库迁移到新 schema',
      },
      {
        kind: 'robot',
        paragraphs: [[{ text: '迁移脚本与回填任务已写好，正在 dry-run 校验历史订单。' }]],
      },
      {
        kind: 'work',
        id: 'demo-migration-work',
        expanded: true,
        steps: [
          {
            kind: 'call',
            id: 'demo-migration-edit',
            action: 'edit',
            label: 'edit',
            target: 'scripts/migrate-orders.ts',
            seconds: 18,
            output: null,
            error: false,
            running: false,
            unfinished: false,
          },
          {
            kind: 'call',
            id: 'demo-migration-run',
            action: 'run',
            label: 'bash',
            command: 'pnpm migrate:dry',
            seconds: 18,
            output: null,
            error: false,
            running: false,
            unfinished: false,
          },
        ],
      },
      {
        kind: 'fail',
        title: '执行失败',
        body: 'dry-run 发现 2019 年前的订单缺 currency 字段，回填默认值与账务对不上，已停止迁移。',
      },
    ],
  };

  const COUPON_DETAIL: DetailContent = {
    transcript: [
      { kind: 'run', at: '13:12', machine: 'dev-mac' },
      {
        kind: 'user',
        text: '做优惠券结算页：领券、用券、过期提醒，结算时自动选最优券。',
        seq: 25,
        title: '优惠券结算页',
      },
      {
        kind: 'robot',
        paragraphs: [[{ text: '页面与最优券计算都完成了，结算流 e2e 全绿。' }]],
        footer: { seconds: 26 },
      },
      { kind: 'elapsed', seconds: 26 },
    ],
    changes: {
      expanded: false,
      files: [
        {
          path: 'src/checkout/coupon-picker.ts',
          added: 58,
          removed: 0,
          hunks: [
            {
              header: '@@ -0,0 +1,12 @@',
              lines: [
                { kind: 'add', text: 'export function bestCoupon(cart, coupons) {', newNo: 1 },
                { kind: 'add', text: '  return coupons', newNo: 2 },
                { kind: 'add', text: '    .filter((c) => c.validUntil > Date.now())', newNo: 3 },
                {
                  kind: 'add',
                  text: '    .sort((a, b) => discount(b) - discount(a))[0] ?? null;',
                  newNo: 4,
                },
                { kind: 'add', text: '}', newNo: 5 },
              ],
            },
          ],
        },
      ],
    },
  };

  const DEFAULT_DETAIL: DetailContent = {
    transcript: [
      {
        kind: 'user',
        text: '这个任务还在待开始，方案将在开始后由 agent 产出。',
        seq: 26,
        title: '待开始',
      },
    ],
  };

  const DEMO_MACHINES: MachineRow[] = [
    {
      id: 'demo-machine-dev-mac',
      kind: 'local',
      name: 'dev-mac',
      online: true,
      enabledRuntimes: ['pi', 'claude-code'],
      chiefHost: true,
      maxConcurrent: 4,
      runningSteps: 1,
    },
    {
      id: 'demo-machine-build-box',
      kind: 'remote',
      name: 'build-box',
      online: true,
      enabledRuntimes: ['pi'],
      maxConcurrent: 2,
      runningSteps: 1,
    },
  ];

  const DEMO_CHIEF_STREAM = [
    { kind: 'note', text: '14:05' },
    { kind: 'note', text: '运行在 ', machineName: 'dev-mac' },
    {
      kind: 'user',
      text: '把今天购物车相关的事排一下：登录合并游客购物车、结算页用最优券、补结算埋点。',
    },
    {
      kind: 'robot',
      paragraphs: [
        [{ text: '收到，拆成三张票并派下去了：' }],
        [{ text: '1. 登录后合并游客购物车 → demo-builder（方案确认中，v3 待你拍板）' }],
        [{ text: '2. 优惠券结算页自动选最优券 → demo-builder（已完成，等你验收）' }],
        [{ text: '3. 补齐结算页埋点 → 排在购物车合并之后，有依赖。' }],
        [{ text: '订单库迁移那张失败的卡我没有自动重试，等你决定是修脚本还是先回滚。' }],
      ],
      seconds: '38',
      tools: [{ label: 'git status' }, { label: 'gh issue list' }],
    },
  ] satisfies ChiefStreamItem[];

  return {
    todos: DEMO_TASKS,
    now: NOW,
    detail: DEFAULT_DETAIL,
    details: {
      'demo-cart-merge': CART_DETAIL,
      'demo-rate-limit': RATE_DETAIL,
      'demo-search-ranking': SEARCH_DETAIL,
      'demo-order-migration': MIGRATION_DETAIL,
      'demo-coupon-page': COUPON_DETAIL,
    },
    usageNav: true,
    projectNames: { [PROJECT_ID_DEMO]: PROJECT },
    team: {
      members: 4,
      agents: [
        {
          id: BUILDER.id,
          displayName: BUILDER.displayName,
          model: 'claude-sonnet-5',
          isDefault: true,
          machineId: 'demo-machine-dev-mac',
          role: '负责功能实现与重构，先看测试再动手。',
          provider: 'anthropic',
        },
        {
          id: SCRIBE.id,
          displayName: SCRIBE.displayName,
          model: 'claude-opus-4-5',
          isDefault: false,
          machineId: 'demo-machine-dev-mac',
          role: '负责文档、发布说明与演示内容。',
          provider: 'anthropic',
        },
        {
          id: REVIEWER.id,
          displayName: REVIEWER.displayName,
          model: 'gpt-5.2',
          isDefault: false,
          machineId: 'demo-machine-build-box',
          role: '审阅每个合并请求，blocking 问题一律打回。',
          provider: 'openai',
        },
        {
          id: 'demo-scout',
          displayName: 'demo-scout',
          model: 'claude-sonnet-5',
          isDefault: false,
          machineId: null,
          role: null,
          provider: 'anthropic',
        },
      ],
    },
    resources: {
      ...RESOURCES,
      machines: DEMO_MACHINES,
    },
    chief: {
      view: 'none',
      bound: true,
      modelSlot: 'claude-sonnet-5 · 默认',
      threadTitle: '把购物车相关的事排一下…',
      agent: { id: BUILDER.id, displayName: BUILDER.displayName, avatarUrl: null },
      stream: DEMO_CHIEF_STREAM,
    },
    schedules: [
      {
        id: 'demo-schedule-nightly',
        teamId: TEAM_ID,
        projectId: PROJECT_ID_DEMO,
        todoId: 'demo-search-ranking',
        kind: 'daily',
        at: at(DEMO_DAY, 3, 30),
        tz: 'Asia/Shanghai',
        nextRunAt: at(DEMO_DAY, 3, 30) + 86_400_000,
        createdBy: 'u-xmon-dai',
        todo: {
          seqNum: 24,
          title: '重建搜索索引',
          phase: 'todo',
          projectName: PROJECT,
          ownerId: 'u-xmon-dai',
        },
      },
      {
        id: 'demo-schedule-reindex',
        teamId: TEAM_ID,
        projectId: PROJECT_ID_DEMO,
        todoId: 'demo-order-migration',
        kind: 'once',
        at: at(DEMO_DAY, 16, 0),
        tz: 'Asia/Shanghai',
        nextRunAt: at(DEMO_DAY, 16, 0),
        createdBy: 'u-xmon-dai',
        todo: {
          seqNum: 23,
          title: '重试订单库迁移（dry-run 通过后）',
          phase: 'failed',
          projectName: PROJECT,
          ownerId: 'u-xmon-dai',
        },
      },
    ],
  };
}

export const demoFixture: FixtureSet = /*#__PURE__*/ demoFixtureOf();
