import type { Assignment } from '@cairn/shared';
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
    mutations,
    navigate,
    setOverlay,
    setMoreOpen,
    setAssignOpen,
  } = input;
  const { t } = useI18n();

  const firstAgentId = useMemo(() => {
    const member = (members ?? []).find((m) => m.memberType === 'agent');
    return member?.actorId ?? null;
  }, [members]);

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
        { onError: (error) => toastError(t('开始运行失败，请重试。'), error) },
      );
      setOverlay(null);
    },
    [live, wireTodo, mutations.startBuilds, firstAgentId, personaAgentId, t, setOverlay],
  );

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
              onError: (error) => toastError(t('保存失败，请重试。'), error),
            },
          )
      : undefined;

  const buildLegDone = steps.some((s) => s.kind === 'build' && s.status === 'done');
  const canComplete =
    phase === 'review' ||
    (live && phase === 'confirm') ||
    (live && phase === 'failed' && buildLegDone);
  const canClose = phase === 'todo' || phase === 'failed' || phase === 'queued';
  const completeTask = () => {
    setMoreOpen(false);
    if (phase === 'review' || phase === 'failed') {
      setOverlay({ kind: 'accept' });
      return;
    }
    if (live && phase === 'confirm' && buildId != null)
      mutations.stepAction.mutate({ buildId, body: { action: 'confirm' } });
  };

  const closeTask = () => {
    setMoreOpen(false);
    if (todo == null) return;
    if (live) {
      mutations.patchTodo.mutate(
        { id: todo.id, body: { phase: 'closed' } },
        {
          onSuccess: () => navigate('/app'),
          onError: (error) => toastError(t('关闭任务失败，请重试。'), error),
        },
      );
      return;
    }
    markClosed(todo.id);
    navigate('/app');
  };

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
  const reviewPick = resolveReviewDefault({
    candidates: reviewAgents ?? [],
    assignment: wireTodo?.assignment ?? null,
  });
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
    reviewAgents,
    reviewDefaultId,
    reviewProducerProvider,
    fanoutAvailable,
  };
}
