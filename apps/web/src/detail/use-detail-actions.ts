// 详情页动作簇 hook（#1127 自 todo-detail-page 提取）：开始/指派/完成/关闭/
// 重跑钉选/审核候选——相位机的规则集中在这里（#702/#864 的边判定），页面
// 只剩状态与 JSX 装配。逻辑逐字搬移；todo 可空守卫 = hook 悬挂在提前
// return 之上（原代码靠 `if (todo == null) return null` 保证非空，hook 化后
// 守卫内收进各回调）。

import type { Assignment } from '@pacman/shared';
import { type Dispatch, type SetStateAction, useCallback, useMemo } from 'react';
import type { useNavigate } from 'react-router';
import type { useApiMutations, useMachines, useMembers, useSteps } from '../api/hooks.js';
import type { toDisplayTodo } from '../api/mappers.js';
import { assignOptionsFromMembers, type ChiefAgentOption } from '../chief/chief-agent-dialog.js';
import { toastError } from '../components/ui/toaster.js';
import { markClosed } from '../fixtures/deletions.js';
import type { OverlayState, Phase } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { resolveReviewDefault } from './review-default.js';
import type { ReviewAgentOption } from './review-dialog.js';

type DisplayTodo = ReturnType<typeof toDisplayTodo>;
type Mutations = ReturnType<typeof useApiMutations>;
type MemberRows = ReturnType<typeof useMembers>['data'];
type MachineRows = ReturnType<typeof useMachines>['data'];
type StepRows = NonNullable<ReturnType<typeof useSteps>['data']>;

export interface DetailActionsInput {
  live: boolean;
  todo: DisplayTodo | undefined;
  wireTodo: Parameters<typeof toDisplayTodo>[0] | null;
  phase: Phase;
  buildId: string | null;
  steps: StepRows;
  members: MemberRows;
  machines: MachineRows;
  mutations: Mutations;
  navigate: ReturnType<typeof useNavigate>;
  setOverlay: Dispatch<SetStateAction<OverlayState | null>>;
  setMoreOpen: Dispatch<SetStateAction<boolean>>;
  setAssignOpen: Dispatch<SetStateAction<boolean>>;
}

export function useDetailActions(input: DetailActionsInput) {
  const {
    live,
    todo,
    wireTodo,
    phase,
    buildId,
    steps,
    members,
    machines,
    mutations,
    navigate,
    setOverlay,
    setMoreOpen,
    setAssignOpen,
  } = input;
  const { t } = useI18n();

  // live 指派：dialog 未给显式 assignment 时取团队首个 Agent（02 §6.2 双槽
  // 同值）；#318 开始 dialog 统一面携带选定双槽（分用开关 OFF = 同值，
  // ON = plan/build 独立，r9 §3.6）。
  const firstAgentId = useMemo(() => {
    const member = (members ?? []).find((m) => m.memberType === 'agent');
    return member?.actorId ?? null;
  }, [members]);

  // #1250（ADR 0018 层 1）：persona 槽位解析——按角色取团队 persona agent
  //（members 读面 actor.persona；seeded 六员名册的命中键）。fan-out 可用 =
  // 三视角任一在位（server fan-out 按 persona 三员各入队，缺谁少谁）。
  const personaAgentId = useCallback(
    (role: string): string | null => {
      const member = (members ?? []).find(
        (m) =>
          m.memberType === 'agent' &&
          (m.actor as { persona?: string } | undefined)?.persona === role,
      );
      return member?.actorId ?? null;
    },
    [members],
  );
  const fanoutAvailable = useMemo(
    () =>
      (['code_reviewer', 'security_auditor', 'test_engineer'] as const).some(
        (role) => personaAgentId(role) !== null,
      ),
    [personaAgentId],
  );

  const startBuild = useCallback(
    (withPlan: boolean, assignment?: Assignment) => {
      if (!live || !wireTodo) return;
      // 缺省四槽（#1250 扩 review/verify 槽）：plan/build 优先 persona
      //（Planner/Implementer，无 persona 回落首 Agent 同旧值）；review/
      // verify 只在 persona 在位时落（无 persona = 留空，行为 = 不 fan-out
      // / 不入队 verify 步——存量语义零变化）。
      const planner = personaAgentId('planner') ?? firstAgentId;
      const implementer = personaAgentId('implementer') ?? firstAgentId;
      const reviewer = personaAgentId('code_reviewer');
      const verifier = personaAgentId('verifier');
      mutations.startBuilds.mutate(
        {
          projectId: wireTodo.projectId,
          todoIds: [wireTodo.id],
          assignment: assignment ?? {
            plan: planner !== null ? { agentId: planner } : null,
            build: implementer !== null ? { agentId: implementer } : null,
            review: reviewer !== null ? { agentId: reviewer } : null,
            verify: verifier !== null ? { agentId: verifier } : null,
          },
          withPlan,
        },
        // #638 破坏性后果面（票面优先级 1）：弹层已关、任务停在半启动态却
        // 零解释——toast 点名失败，server 原因进 description。
        { onError: (error) => toastError(t('开始运行失败，请重试。'), error) },
      );
      setOverlay(null);
    },
    [live, wireTodo, mutations.startBuilds, firstAgentId, personaAgentId, t, setOverlay],
  );

  // —— #209 编辑分配:chip popover「编辑分配」→ agent 选择弹层(#182 家族
  // 形态)→ PATCH assignment.build 槽(执行对话选中行 = build 槽派生投影,
  // services/todos.ts;server 槽级 merge #208 保 plan 槽)→ mutation 自带
  // invalidateAll 重取回显。候选 = members 读面 memberType:"agent" 行
  // (chief-settings 同投影);fixture 面 onBind 缺省 → accept 律(选择即关)。——
  // #318: model 副题并入投影(r9 §2.6 选择器行形「name · model」;开始
  // dialog 与编辑分配共用同一候选集)。
  // #616: 投影收编进 assignOptionsFromMembers（board 页的拖拽落位开始面
  // 共用，单源在 chief-agent-dialog.tsx；XMON-105 avatarUrl 覆盖律随行）。
  const assignOptions: ChiefAgentOption[] | undefined = live
    ? assignOptionsFromMembers(members ?? [])
    : undefined;
  const bindAssign =
    live && todo
      ? (agentId: string) =>
          mutations.patchTodo.mutate(
            { id: todo.id, body: { assignment: { build: { agentId } } } },
            {
              onSuccess: () => setAssignOpen(false),
              // #638：失败时弹层留着（关挂在 onSuccess）但零解释——toast 补上。
              onError: (error) => toastError(t('保存失败，请重试。'), error),
            },
          )
      : undefined;

  // —— #318 更多菜单生命周期行(r1 changelog 09-16:Complete 走看板自带
  // confirm-and-merge、相位适配;Close 关闭语义)。完成 = review 开验收弹层
  // (既有 accept→merge 链)/ confirm 关口确认(live wire);关闭 = PATCH phase
  // closed 后回看板(卡片立即隐藏;延迟 Undo 窗口 [设计] wontfix,r1 语义
  // 归 closed→todo reopen 面)。server 漏斗现有边 todo/failed→closed;
  // review/confirm/done→closed 边缺,归 W3 server 票(票面授权前端+注记),
  // 故 canClose 只放行有边的相位,其余 disabled(运行中禁用 = r1 Delete-in-
  // turn 先例)。fixture 面无 wire:关闭走 deletions.ts 会话覆面同律。——
  // #702(B-C17):failed 且 build 腿已交付 → 「完成」出口重新出现(服务端
  // 恢复闸是权威判定,此处只是钮面可达性:steps 投影里执行步 done)。点开
  // 同一 accept 弹层 → merge API → server 恢复回 review 关口 + 正常合并委派;
  // 未交付的 failed(执行步失败/零产物)不亮钮——重跑面(rerun dialog)才是
  // 它的出口。fixture 面无 steps 数据,不启用(live 判据钉死)。
  const buildLegDone = steps.some((s) => s.kind === 'build' && s.status === 'done');
  const canComplete =
    phase === 'review' ||
    (live && phase === 'confirm') ||
    (live && phase === 'failed' && buildLegDone);
  const canClose = phase === 'todo' || phase === 'failed';
  const completeTask = () => {
    setMoreOpen(false);
    if (phase === 'review' || phase === 'failed') {
      setOverlay({ kind: 'accept' });
      return;
    }
    if (live && phase === 'confirm' && buildId != null)
      mutations.stepAction.mutate({ buildId, body: { action: 'confirm' } });
  };
  // —— #864 T3：重跑面的钉选出口。重跑沿用任务钉选（orchestrate 读
  // todo.machineId），钉着离线机 = 再失败一轮，所以失败面给「改为自动」。
  // machines 读面未到时判「不知道」而不是「离线」（不把未取到错读成不在线）；
  // 钉的机器行已不在（被删/换团队）= 服务端同离线语义，文案走「（已移除）」。
  const pinnedTodoMachine =
    wireTodo?.machineId != null && machines != null
      ? (machines.find((m) => m.id === wireTodo.machineId) ?? null)
      : undefined;
  const rerunPin =
    pinnedTodoMachine === undefined
      ? null
      : {
          machineName: pinnedTodoMachine?.name ?? null,
          offline: pinnedTodoMachine?.online !== true,
        };
  const unpinForRerun = () => {
    if (todo == null) return;
    mutations.patchTodo.mutate(
      { id: todo.id, body: { machineId: null } },
      { onError: (error) => toastError(t('改为自动失败，请重试。'), error) },
    );
  };

  const closeTask = () => {
    setMoreOpen(false);
    if (todo == null) return;
    if (live) {
      mutations.patchTodo.mutate(
        { id: todo.id, body: { phase: 'closed' } },
        {
          onSuccess: () => navigate('/app'),
          // #638：关闭失败 = 留在详情页、任务没关，此前零反馈。
          onError: (error) => toastError(t('关闭任务失败，请重试。'), error),
        },
      );
      return;
    }
    markClosed(todo.id);
    navigate('/app');
  };

  // AI 审核候选 Agent（M7 #312，r8 §3.1）：live = members 读面 memberType:"agent"
  // 行投影（#509 起带 provider，供跨厂商判定）；fixture 面 undefined =
  // ReviewDialog 兜底 DEFAULT_AGENT（行 A：r8 §3.1 仅一处 Agent 选取，canon
  // 单默认行）。
  const reviewAgents: ReviewAgentOption[] | undefined = live
    ? (members ?? [])
        .filter((m) => m.memberType === 'agent')
        .map((m) => {
          const actor = m.actor as
            | { displayName?: string; modelId?: string | null; provider?: string | null }
            | undefined;
          return {
            id: m.actorId,
            name: actor?.displayName ?? m.actorId,
            model: actor?.modelId ?? '默认',
            provider: actor?.provider ?? null,
          };
        })
    : undefined;
  // 默认选人 + 独立性判定（#509）：跨厂商优先，产出步 Agent = 执行侧槽优先、
  // 规划槽回退（与服务端 per-step 凭据解析同一条链）；两槽都空 = 无基准，默认
  // 值退到候选集稳定序第一且不声称独立。判定规则单源 = detail/review-default.ts
  // ——用户改选后的复判走同一条 classifyReviewChoice（ReviewDialog 内）。
  const reviewPick = resolveReviewDefault({
    candidates: reviewAgents ?? [],
    assignment: wireTodo?.assignment ?? null,
  });
  // fixture 面不做判定：reviewAgents undefined → 走 ReviewDialog 兜底单默认行，
  // producerProvider 也保持 undefined（undefined = 本面不判定）。
  const reviewDefaultId = live ? reviewPick.defaultAgentId : undefined;
  const reviewProducerProvider = live ? reviewPick.producerProvider : undefined;

  return {
    startBuild,
    assignOptions,
    bindAssign,
    canComplete,
    completeTask,
    canClose,
    closeTask,
    rerunPin,
    unpinForRerun,
    reviewAgents,
    reviewDefaultId,
    reviewProducerProvider,
    fanoutAvailable,
  };
}
