// Team route (issue #70, r7 12): stats bar (`N 个成员` — the r7 capture's
// plan badge / upgrade link are SaaS surface this local-first self-hosted
// app does not carry, #129; the team-light visual baseline diverges here),
// the grid|chart layout tablist and the agent card grid with the dashed
// 创建 Agent slot. Head title is the team-switch dropdown trigger
// (r2 §8.1); the 设置 link sits in the head right slot (r7 12) and routes
// to the account surface — the app's only settings face (#148, 台账 #136
// team 行: 或通或隐, wired rather than hidden so the r7 12 ink survives).
// #148: the tablist is a real toggle persisted to the registered
// client-state key (r2 §1.5 `pacman.teamMembersLayout`); chart drops the
// stats bar (r2 §8.1 17c) and renders the org chart (#490). The tablist
// itself stays in both layouts — 17c shows it absent, but a toggle with no
// way back is a trap (divergence noted, 01 册 §8).
//
// #947 per-face 清零：secondary.css 退役，页内几何改挂 token utility（原值
// 等值迁移：卡 76px = h-[76px]、网格 gap 12 = gap-3、toprow 18/28 与卡片
// 766 版心同属阶梯外一次性实测值走 §3.1(a) arbitrary）。控件全部走
// components/ui 件（Button ghost 底座 + 七通道中和，#908
// comment-6001887439 裁决 3）；类名别名按 #910 裁定 1 退役，e2e 载体换
// role/text 一级 + data-testid 二级（agent 卡 = 计数锚，见卡位注）。
//
// #490: chart 此前是把 17c 捕获到的空态当成了唯一状态 —— 那份捕获的团队是
// 0 个成员，于是 chart 分支写死 暂无成员 字面量，同一份数据下与 grid 自相
// 矛盾。现在按成员数分流：0 个成员才走空态，否则由 ./team-chart.tsx 出树。
import { useCallback, useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
  useApiMutations,
  useChief,
  useMachines,
  useMembers,
  useModelSources,
  useTeams,
  useTodos,
} from '../api/hooks.js';
import { mapMachines, mapTeam, toDisplayTodo, toModelOptions } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { buttonVariants } from '../components/ui/button.js';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs.js';
import { toastError } from '../components/ui/toaster.js';
import { isDeleted } from '../fixtures/deletions.js';
import { TEAM_NAME, TEAM_R7 } from '../fixtures/fixtures.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { ChartNetwork, ChevronDown, Grid2x2 } from '../icons/index.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import { SecondaryShell } from '../secondary/shell.js';
import { CreateAgentDialog } from './create-agent-dialog.js';
import { TeamAgentGrid } from './team-agent-grid.js';
import { TeamChart } from './team-chart.js';

/** r2 §1.5 registered client-state key (packages/shared protocol/
 *  client-state.ts): the team view switch, grid | chart; absent = grid. */
export const TEAM_LAYOUT_STORAGE_KEY = 'pacman.teamMembersLayout';

type TeamLayout = 'grid' | 'chart';

function readStoredLayout(storage: Storage | null): TeamLayout {
  // #1091：null / getItem 抛 = 无记忆，回落 grid（本页首渲染路径）。
  try {
    return storage?.getItem(TEAM_LAYOUT_STORAGE_KEY) === 'chart' ? 'chart' : 'grid';
  } catch {
    return 'grid';
  }
}

export function TeamPage() {
  const { t } = useI18n();
  // the 设置 link carries the scenario string along like the shell's back
  // chevron, so dev/fixture selection survives the hop
  const { search } = useLocation();
  const fixture = resolveScenario(new URLSearchParams(search));
  // M5 live：成员/Agent 网格 = GET members 真值（r5 §1：Agent 列表实际走
  // members，memberType:"agent" 行内嵌 actor）；团队名 = GET /api/teams。
  const { live, teamId } = useLiveData();
  const membersQ = useMembers(teamId, live);
  const teamsQ = useTeams(live);
  const todosQ = useTodos(teamId, live);
  const team = live && membersQ.data ? mapTeam(membersQ.data) : (fixture.team ?? TEAM_R7);
  const teamName = live ? (teamsQ.data?.[0]?.name ?? TEAM_NAME) : TEAM_NAME;
  // #490: 组织图的根 = 总管绑定的 agent。live 直读 GET chief 的
  // chief.agent.agentId；fixture 走场景里的 chief.agent.id；未绑定 → null，
  // 此时 TeamChart 退到首个成员当根。
  const chiefQ = useChief(teamId, live);
  const chiefAgentId = live
    ? (chiefQ.data?.chief.agent?.agentId ?? null)
    : (fixture.chief?.agent?.id ?? null);
  const [layout, setLayout] = useState<TeamLayout>(() => readStoredLayout(safeLocalStorage()));
  const switchLayout = useCallback((next: TeamLayout) => {
    setLayout(next);
    safeSetItem(TEAM_LAYOUT_STORAGE_KEY, next);
  }, []);
  // #170: the 创建 Agent slot opens the dialog-family form; live submit =
  // POST agents then close (invalidateAll refetches members → the new
  // agent card lands in the grid), fixture = accept-dialog 律 (close only)
  const mutations = useApiMutations(teamId);
  const [createOpen, setCreateOpen] = useState(false);
  // #485: 创建弹窗的模型候选——数据源与投影同 Agent 详情页概览（同一份
  // toModelOptions；#770 起 providers 段已除，只剩 model-sources 非 pi 段）。
  // 清单非空 = 弹窗出模型选择器；空 = 落「配置服务商」告警行（原版 capture 20 态）。
  const modelSourcesQ = useModelSources(teamId, live);
  const modelOptions = live
    ? toModelOptions(modelSourcesQ.data?.sources ?? [])
    : toModelOptions(fixture.resources?.providerSources ?? []);
  // #1259 归属机：创建弹窗的机器候选（live = GET machines；fixture 同
  //  machines 页面）。
  const machinesQ = useMachines(teamId, live);
  const machines = live ? mapMachines(machinesQ.data ?? []) : (fixture.resources?.machines ?? []);
  return (
    <SecondaryShell
      route="team"
      fixture={live ? { ...fixture, todos: (todosQ.data ?? []).map(toDisplayTodo) } : fixture}
      sidebarSelected="team"
      title={
        <>
          {teamName}
          <ChevronDown width={12} height={12} />
        </>
      }
      right={
        /* 头右「设置」文本链：品牌墨当文字色按 2026-10-08 实审裁决收敛到
           registry link 档（--primary 保 neutral、品牌墨只做 spot 强调，
           同 shell.tsx + 新建 / #1006 R4 / #1055 口径）。 */
        <Link
          className={buttonVariants({ variant: 'link' })}
          to={{ pathname: '/app/account', search }}
          aria-label={t('设置')}
        >
          {t('设置')}
        </Link>
      }
    >
      <div className="mt-[18px] flex h-7 items-center justify-between">
        {layout === 'grid' && (
          <div className="flex items-center">
            <span className="mr-1.5 text-xs text-(--text-secondary)">
              {t('{n} 个成员', { n: team.members })}
            </span>
          </div>
        )}
        {/* XMON-103 布局切换片；#1005 registry 对齐：SEG_* 分段皮肤退役，
            Tabs 走 registry default 档原生形态（bg-muted 组盒 +
            data-active bg-background 选中片，#982 tabs 判决终态）。受控
            value/onValueChange 落回 switchLayout（照旧写 localStorage），
            role=tablist/tab 与 aria-selected 由 Base UI 承载；e2e 载体 =
            role=tab + aria-label（grid/chart）。chart 布局下 stats bar
            退场，ml-auto 把 tablist 顶回 r7 12 的右缘。 */}
        <Tabs
          value={layout}
          onValueChange={(value) => switchLayout(value as TeamLayout)}
          className={layout === 'chart' ? 'ml-auto' : undefined}
        >
          <TabsList>
            <TabsTrigger value="grid" aria-label="grid">
              <Grid2x2 />
            </TabsTrigger>
            <TabsTrigger value="chart" aria-label="chart">
              <ChartNetwork />
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {layout === 'grid' ? (
        <TeamAgentGrid
          agents={team.agents}
          machines={machines}
          onCreate={() => setCreateOpen(true)}
          search={search}
          isDeleted={isDeleted}
        />
      ) : (
        <TeamChart
          agents={team.agents}
          chiefAgentId={chiefAgentId}
          onCreate={() => setCreateOpen(true)}
        />
      )}
      <CreateAgentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        modelOptions={modelOptions}
        machines={machines}
        onCreate={
          live
            ? (input) =>
                mutations.createAgent.mutate(input, {
                  onSuccess: () => setCreateOpen(false),
                  // #638：失败 = 弹窗留着（关挂在 onSuccess）但零反馈。
                  onError: (error) => toastError(t('创建 Agent 失败，请重试。'), error),
                })
            : undefined
        }
      />
    </SecondaryShell>
  );
}
