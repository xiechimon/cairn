// Team route (issue #70, r7 12): stats line (`N 个成员` — the r7 capture's
// plan badge / upgrade link are SaaS surface this local-first self-hosted
// app does not carry, #129) and the agent card grid. Head title is the
// team-switch dropdown trigger (r2 §8.1); the top bar right side carries the
// grid|chart switch, the 设置 link (routes to the account surface — the
// app's only settings face, #148) and the page's one primary action,
// 创建 Agent.
// #148: the tablist is a real toggle persisted to the registered
// client-state key (r2 §1.5 `pacman.teamMembersLayout`); chart drops the
// stats bar (r2 §8.1 17c) and renders the org chart (#490). The tablist
// itself stays in both layouts — 17c shows it absent, but a toggle with no
// way back is a trap (divergence noted, 01 册 §8).
//
// #490: chart 此前是把 17c 捕获到的空态当成了唯一状态 —— 那份捕获的团队是
// 0 个成员，于是 chart 分支写死 暂无成员 字面量，同一份数据下与 grid 自相
// 矛盾。现在按成员数分流：0 个成员才走空态，否则由 ./team-chart.tsx 出树。
import { Grid2x2, Network, Plus } from 'lucide-react';
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
import { TOPBAR_PRIMARY_BUTTON, TOPBAR_TEXT_BUTTON } from '../board/filter-panel.js';
import { Button, buttonVariants } from '../components/ui/button.js';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs.js';
import { toastError } from '../components/ui/toaster.js';
import { isDeleted } from '../fixtures/deletions.js';
import { TEAM_NAME, TEAM_R7 } from '../fixtures/fixtures.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown } from '../icons/index.js';
import { PageShell } from '../pages/shell.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import { CreateAgentDialog } from './create-agent-dialog.js';
import { TeamAgentGrid } from './team-agent-grid.js';
import { TeamChart } from './team-chart.js';

/** r2 §1.5 registered client-state key (packages/shared protocol/
 *  client-state.ts): the team view switch, grid | chart; absent = grid. */
export const TEAM_LAYOUT_STORAGE_KEY = 'pacman.teamMembersLayout';

type TeamLayout = 'grid' | 'chart';

/** grid|chart switch in the SettingsSegmented look (paper track, the chosen
 *  tab white with a 1px ring), kept on Tabs so it stays a tablist. */
const LAYOUT_TRACK_CLS = 'mr-1 h-8 gap-0.5 rounded-md bg-canvas p-0.5';
const LAYOUT_TAB_CLS =
  'h-7 flex-none rounded-(--cds-radius-md) border-0 px-2 text-content-secondary hover:text-foreground data-active:bg-card data-active:text-foreground data-active:shadow-xs data-active:ring-1 data-active:ring-border dark:text-content-secondary dark:data-active:bg-card group-data-[variant=default]/tabs-list:data-active:shadow-xs';

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
  // #170: the top-bar 创建 Agent opens the dialog-family form; live submit =
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
  // Cards show home-machine status only once the machine list has loaded;
  // an empty list mid-fetch would flag every agent 未设归属机.
  const cardMachines = live && machinesQ.data === undefined ? undefined : machines;
  return (
    <PageShell
      route="team"
      fixture={live ? { ...fixture, todos: (todosQ.data ?? []).map(toDisplayTodo) } : fixture}
      selected="team"
      title={
        <span className="inline-flex items-center gap-1.5">
          {teamName}
          <ChevronDown width={12} height={12} className="text-content-tertiary" />
        </span>
      }
      actions={
        <>
          <Tabs value={layout} onValueChange={(value) => switchLayout(value as TeamLayout)}>
            <TabsList className={LAYOUT_TRACK_CLS}>
              <TabsTrigger value="grid" aria-label="grid" className={LAYOUT_TAB_CLS}>
                <Grid2x2 aria-hidden strokeWidth={1.75} className="size-3.5" />
              </TabsTrigger>
              <TabsTrigger value="chart" aria-label="chart" className={LAYOUT_TAB_CLS}>
                <Network aria-hidden strokeWidth={1.75} className="size-3.5" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Link
            className={buttonVariants({ variant: 'ghost', className: TOPBAR_TEXT_BUTTON })}
            to={{ pathname: '/app/account', search }}
          >
            {t('设置')}
          </Link>
          <Button className={TOPBAR_PRIMARY_BUTTON} onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden strokeWidth={1.75} className="size-3.5" />
            {t('创建 Agent')}
          </Button>
        </>
      }
    >
      {layout === 'grid' ? (
        <>
          {team.agents.length > 0 && (
            <p className="m-0 mb-3 text-meta text-content-tertiary">
              {t('{n} 个成员', { n: team.members })}
            </p>
          )}
          <TeamAgentGrid
            agents={team.agents}
            machines={cardMachines}
            search={search}
            isDeleted={isDeleted}
          />
        </>
      ) : (
        <TeamChart agents={team.agents} chiefAgentId={chiefAgentId} />
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
    </PageShell>
  );
}
