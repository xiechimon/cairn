# 头像(dicebear Lorelei,#387)

头像 = dicebear HTTP API 按 displayName 种子生成(style `lorelei`,9.x)——同名恒同像,无需存储。`avatarUrl` 列语义:null = dicebear 生成(默认);非 null = 显式覆盖。加载失败(离线/API 挂)经 `img onError` 回退 #387 前的静态资产(user=`/avatar-user.png`,agent=`/avatar-robot-1.svg`),CSS 定尺寸不裂图。单源组件 = `components/ui/seeded-avatar.tsx`（XMON-14 建，落到 shadcn 落点 `components/ui/avatar.tsx` 上；#1003 随 #983 判决**弃 contents 根**——上游 after: 发丝环需要真实 containing block，Root 是**定尺盒**：几何落点在 Root，消费点必须显式传 `className="size-N"`，漏传即回落 registry 默认 size-8 被外盒裁图（#1156 的文档面根因——本条曾停在旧 contents 模型）；img 由 registry 件 size-full 随 Root）。

## Sub-features

- `avatar-seed-user` 侧栏 chip(rail+expanded)与 user-menu 头部按展示名种子化(USER_NAME fixture canon,live/fixture 两态一致)。
- `avatar-seed-agent` 团队页卡 / 看板任务卡执行者 / chip popover 执行对话行 / rerun dialog Agent 行按 agent displayName 种子化;live members 投影(mapTeam)透传 avatarUrl,非 null 时覆盖生效。
- `avatar-create-preview` 创建 Agent dialog 头像行随名称输入即时预览;空名退静态资产。
- `avatar-fallback` dicebear 不可达 → onError 一次性换静态资产(按失败 URL 记账,换名重试,fallback 自身失败不死循环)。
- 种子编码走 `encodeURIComponent`(fixture 用户名含空格;中文名实测 `%E9%AA%8C…`)。

## How to get to it (user POV)

- 侧栏底部头像 chip(展开/收起两态);点开 = user-menu 头部。
- 团队页 `/app/team`:「创建 Agent」dialog 头像行 + 网格卡。
- 看板任务卡左下执行者头像(fresh 卡无 agent 时是 UserCircle 占位,非头像面)。
- 驱动:本 feature 没有 current case;已登记的都判 stale,不带 `--force` 拒跑(拒跑时打印原因),`vp.mjs list avatars` 列出 usage:
  - `vp.mjs drive avatars dicebear-avatars`:读的选择子已不在 apps/web/src。

## Driving it with verify-cairn

Preconditions:

- `launch.mjs` 起栈 + `doctor.mjs` 全 PASS(全新库:无 agent,团队页先建)。

- **全链。** Run `node <skill>/scripts/drive-avatars.mjs`。链路:侧栏 chip/user-menu src 断言(种子 `Xmon%20Dai`)→ 团队页建两个不同名 Agent(中文名 + 英文名,dialog 内预览随输入翻种子)→ 网格两卡 src 各异 → 真值三件套(`GET /api/user/me` avatarUrl=null / members actor.avatarUrl=null / SQLite `agent` 行 avatarUrl IS NULL)+ 拦截器实记 dicebear 出站请求数。证据 3 张截图 + `result.json`。

## Gotchas

- **探针拦截 dicebear,不打真外网**:`page.route('**/api.dicebear.com/**')` 回固定 SVG。断言对象是 src 契约 + 真服务端数据;外网可达性不是被测项。onError 换 src 后**属性值会变成 fallback**——不拦截时网络抖动会把 src 断言打成假红。
- 离线兜底链路由 fixture e2e(`apps/web/e2e/avatar-dicebear.spec.ts` 的 route.abort 测)钉,live probe 不重复。
- live 模式侧栏仍渲染 fixture canon 的 USER_NAME(既有 chrome 纪律,非本票面)——种子随展示名,别拿 `/api/user/me` 的 Owner 去对侧栏。
- rerun dialog「未指派」行无种子(占位文案非人名),渲染静态资产;`displayFor` 的 `seed` 字段是判据,别回退成拿 `name` 直接当种子。
