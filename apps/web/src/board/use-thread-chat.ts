import {
  isBuildStepKind,
  resolvedBuildPrNumber,
  STOP_MESSAGE,
  type StepKind,
  type TodoRecord as WireTodo,
} from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router';
import { activityStore } from '../api/activity.js';
import { agentTodoStore } from '../api/agent-todo.js';
import { ApiError } from '../api/client.js';
import {
  useApiMutations,
  useBuild,
  useBuildChanges,
  useConversationMessages,
  useMachines,
  usePlans,
  useSteps,
  useTodo,
} from '../api/hooks.js';
import { invalidateConverged } from '../api/invalidate.js';
import { liveTextStore } from '../api/live-text.js';
import { liveThinkingStore } from '../api/live-thinking.js';
import { mapPlanDoc, mapPlanVersions, mapTranscript, toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings } from '../api/routing-settings.js';
import { useConversationStream } from '../api/sse.js';
import { useSendKey } from '../api/use-send-key.js';
import type { EarlierPages } from '../components/chat/earlier-loader.js';
import type { QueuedCapsule } from '../components/queued-capsules.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite, DEMO_MODE } from '../demo/demo-gate.js';
import { isTranscriptSettled } from '../detail/scroll-anchor.js';
import type { DocBlock, PlanVersion, TodoRecord, TranscriptItem } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { uploadMessageAttachments } from '../overlay/attachment-paste.js';
import { useThreadPresence } from '../pwa/thread-presence.js';
import type { EngineRun, EngineRunStage } from './engine-run.js';
import { deriveThreadChanges, type ThreadChanges } from './thread-changes.js';
import { useMarkThreadRead } from './use-mark-thread-read.js';

export type ThreadChatLoad = 'ready' | 'loading' | 'error' | 'missing';

export interface ThreadChat {
  load: ThreadChatLoad;
  todo: TodoRecord | null;
  transcript: TranscriptItem[];
  hasEarlier: boolean;
  earlier?: EarlierPages;
  buildId: string | null;
  buildLegDone: boolean;
  transcriptSettled: boolean;
  infoOutput: boolean;
  planDoc: DocBlock[] | undefined;
  planVersions: PlanVersion[] | undefined;
  changes: ThreadChanges;
  engineRun?: EngineRun;
  engineStage?: EngineRunStage;
  changesExpanded: boolean;
  toggleChangesExpanded: () => void;
  retryChanges: () => void;
  wire: WireTodo | null;
  started: boolean;
  locked: boolean;
  running: boolean;
  waitingOnChecks: boolean;
  machineName: string | null;
  stopped: boolean;
  sendError: string | null;
  queuedMessages: QueuedCapsule[] | undefined;
  retry: () => void;
  send?: (text: string) => Promise<void>;
  queue?: (text: string) => Promise<void>;
  stopAndSend?: (text: string) => Promise<void>;
  stop?: () => void;
  attach?: (files: File[]) => Promise<string[]>;
  sendQueuedNow?: (id: string, content: string) => Promise<unknown>;
  removeQueued?: (id: string, content: string) => Promise<unknown>;
  editQueued?: (id: string, content: string) => Promise<unknown>;
}

const ACTIVE_STEP = new Set(['claimed', 'pending', 'waiting_quota']);

export function hasDoneBuildLeg(steps: readonly { kind: StepKind; status: string }[]): boolean {
  return steps.some((step) => isBuildStepKind(step.kind) && step.status === 'done');
}

export function replyRouteOf(
  phase: TodoRecord['phase'],
  steps: readonly { status: string }[],
): 'queue' | 'message' {
  if (phase === 'todo')
    return steps.some((step) => step.status === 'stopped') ? 'queue' : 'message';
  const waitingForMachine =
    (phase === 'queued' || phase === 'planning') &&
    !steps.some((step) => step.status === 'claimed') &&
    steps.some((step) => step.status === 'pending' || step.status === 'waiting_quota');
  return waitingForMachine ? 'queue' : 'message';
}

export function useThreadChat(todoId: string, listed: TodoRecord | undefined): ThreadChat {
  const { live, teamId, userName } = useLiveData();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const mutations = useApiMutations(teamId);
  const sendKey = useSendKey();
  const [stopping, setStopping] = useState(false);
  const stopRequested = useRef(false);

  const todoQ = useTodo(live ? todoId : undefined, live);
  const wire = todoQ.data ?? null;
  useThreadPresence(teamId, wire?.id, live);
  useMarkThreadRead(todoId);
  const buildId = wire !== null ? wire.latestBuildId : (listed?.latestBuildId ?? null);
  const buildQ = useBuild(buildId, live);
  const changesQ = useBuildChanges(buildId, live);
  const [changesExpanded, setChangesExpanded] = useState(true);
  const stepsQ = useSteps(buildId, live);
  const { query: messagesQ, messages, newest } = useConversationMessages(buildId, live);
  const plansQ = usePlans(buildId, live);
  const machinesQ = useMachines(teamId, live);
  const routingQ = useRoutingSettings(teamId, live);

  const known = useMemo(() => new Set(messages.map((m) => m.id)), [messages]);
  const liveText = useSyncExternalStore(liveTextStore.subscribe, () =>
    buildId != null ? liveTextStore.getVisible(buildId, known) : '',
  );
  const liveThinking = useSyncExternalStore(liveThinkingStore.subscribe, () =>
    buildId != null ? liveThinkingStore.getVisible(buildId, known) : '',
  );
  useEffect(() => {
    if (buildId == null) return;
    liveTextStore.prune(buildId, known);
    liveThinkingStore.prune(buildId, known);
  }, [buildId, known]);
  const activity = useSyncExternalStore(activityStore.subscribe, () =>
    buildId != null ? activityStore.get(buildId) : null,
  );
  const agentTodo = useSyncExternalStore(agentTodoStore.subscribe, () =>
    buildId != null ? agentTodoStore.get(buildId) : null,
  );
  const streamHandlers = useMemo(
    () => ({
      onMessage: () => {
        void invalidateConverged(qc, { queryKey: ['todo', todoId] });
      },
      onStep: () => {
        void invalidateConverged(qc, { queryKey: ['todo', todoId] });
        if (buildId !== null) void invalidateConverged(qc, { queryKey: ['usage', buildId] });
      },
    }),
    [qc, todoId, buildId],
  );
  useConversationStream(buildId ?? undefined, live, streamHandlers);

  const steps = stepsQ.data ?? [];
  const running = live
    ? steps.some((step) => ACTIVE_STEP.has(step.status))
    : listed?.phase === 'building' || listed?.phase === 'planning' || listed?.phase === 'queued';
  useEffect(() => {
    if (running) return;
    setStopping(false);
    stopRequested.current = false;
  }, [running]);
  useEffect(() => {
    setStopping(false);
    stopRequested.current = false;
  }, [buildId]);

  const machineName = useMemo(() => {
    const claimed = machinesQ.data?.find((m) => steps.some((s) => s.machineId === m.id))?.name;
    if (claimed != null) return claimed;
    const pinned =
      listed?.routeOverride?.machineId ??
      routingQ.data?.rules?.find((rule) => rule.use === 'session')?.machineId ??
      null;
    return machinesQ.data?.find((m) => m.id === pinned)?.name ?? null;
  }, [machinesQ.data, steps, listed?.routeOverride?.machineId, routingQ.data]);
  const todo = live ? (wire != null ? toDisplayTodo(wire) : (listed ?? null)) : (listed ?? null);
  const fixture = resolveScenario(searchParams);
  const fixtureDetail = fixture.details?.[todoId] ?? fixture.detail;
  const fixtureTranscript = fixtureDetail?.transcript;
  const plans = plansQ.data ?? [];
  const latestPlan = plans.length > 0 ? plans[plans.length - 1] : undefined;

  const transcript = useMemo<TranscriptItem[]>(() => {
    if (!live) return fixtureTranscript ?? [];
    if (wire == null || buildId == null) return [];
    return mapTranscript({
      messages,
      hasEarlier: messagesQ.hasNextPage,
      steps,
      plans: plansQ.data ?? [],
      build: buildQ.data ?? null,
      todo: toDisplayTodo(wire),
      machineName,
      userName,
      liveText,
      liveThinking,
      stopping,
      activity,
      agentTodo,
    });
  }, [
    live,
    fixtureTranscript,
    wire,
    buildId,
    messages,
    messagesQ.hasNextPage,
    steps,
    plansQ.data,
    buildQ.data,
    machineName,
    userName,
    liveText,
    liveThinking,
    stopping,
    activity,
    agentTodo,
  ]);

  const load: ThreadChatLoad = !live
    ? listed != null
      ? 'ready'
      : 'missing'
    : wire != null
      ? 'ready'
      : todoQ.isPending
        ? 'loading'
        : todoQ.error != null && !(todoQ.error instanceof ApiError && todoQ.error.status === 404)
          ? 'error'
          : 'missing';

  const started = buildId != null;
  const open = started && todo?.archivedAt == null && todo?.phase !== 'closed';
  const writable = live && open;
  const fixtureSend = DEMO_MODE
    ? async () => {
        blockDemoWrite();
      }
    : () => Promise.resolve();

  const queueReply = todo != null && replyRouteOf(todo.phase, steps) === 'queue';
  const postQueued =
    writable && buildId != null
      ? (text: string, deliverAfterStop: boolean, clientMessageId: string) =>
          mutations.sendSteer.mutateAsync({
            conversationId: buildId,
            content: text,
            mode: 'queue',
            deliverAfterStop,
            clientMessageId,
          })
      : undefined;
  const queueSteer =
    postQueued !== undefined
      ? async (text: string, deliverAfterStop: boolean) => {
          const { key } = sendKey.attempt([todoId, deliverAfterStop, text].join('\n'), 'queue');
          await postQueued(text, deliverAfterStop, key);
          sendKey.settle();
        }
      : undefined;
  const send = writable
    ? async (text: string) => {
        const { key, route } = sendKey.attempt(
          [todoId, false, text].join('\n'),
          queueReply && postQueued !== undefined ? 'queue' : 'thread',
        );
        if (route === 'queue' && postQueued !== undefined) await postQueued(text, false, key);
        else
          await mutations.messageThread.mutateAsync({
            todoId,
            content: text,
            clientMessageId: key,
          });
        sendKey.settle();
      }
    : !live && open
      ? fixtureSend
      : undefined;
  const stop =
    writable && buildId != null && running
      ? () => {
          if (stopRequested.current) return;
          stopRequested.current = true;
          setStopping(true);
          mutations.stopBuild.mutate(
            { buildId, discard: false },
            {
              onSuccess: (res) => {
                if (res.delegated) return;
                stopRequested.current = false;
                setStopping(false);
              },
              onError: (error) => {
                stopRequested.current = false;
                setStopping(false);
                toastError(t('停止失败，请重试。'), error);
              },
            },
          );
        }
      : undefined;

  const changes = deriveThreadChanges({
    live,
    buildId,
    query: { status: changesQ.status, data: changesQ.data },
    fixture: fixtureDetail?.changes,
    expanded: changesExpanded,
  });

  const { fetchNextPage, isFetchingNextPage, isFetchNextPageError } = messagesQ;
  const loadEarlier = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  return {
    load,
    todo,
    transcript,
    hasEarlier: live && messagesQ.hasNextPage,
    ...(live
      ? {
          earlier: {
            loading: isFetchingNextPage,
            failed: isFetchNextPageError,
            onLoad: loadEarlier,
          },
        }
      : {}),
    buildId,
    infoOutput: wire?.output === 'info',
    planDoc: live
      ? latestPlan !== undefined
        ? mapPlanDoc(latestPlan.content)
        : undefined
      : fixtureDetail?.doc,
    planVersions: live ? mapPlanVersions(plans) : fixtureDetail?.planVersions,
    changes,
    ...(!live && fixtureDetail?.engineRun !== undefined
      ? { engineRun: fixtureDetail.engineRun, engineStage: fixtureDetail.engineStage }
      : {}),
    changesExpanded,
    toggleChangesExpanded: () => setChangesExpanded((value) => !value),
    retryChanges: () => {
      void changesQ.refetch();
    },
    wire,
    buildLegDone: hasDoneBuildLeg(steps),
    transcriptSettled: isTranscriptSettled({
      live,
      todoPending: todoQ.isPending,
      buildId,
      buildPending: buildQ.isPending,
      stepsPending: stepsQ.isPending,
      messagesPending: messagesQ.isPending,
    }),
    started,
    locked: !open,
    running,
    waitingOnChecks:
      todo?.phase === 'building' &&
      !running &&
      buildQ.data != null &&
      resolvedBuildPrNumber(buildQ.data) != null,
    machineName,
    stopped: buildQ.data?.errorMessage === STOP_MESSAGE,
    sendError: mutations.messageThread.isError
      ? mutations.messageThread.error?.message || t('发送失败，请重试。')
      : mutations.sendSteer.isError &&
          mutations.sendSteer.variables?.cancelQueued !== true &&
          mutations.sendSteer.variables?.editQueued !== true
        ? mutations.sendSteer.error?.message || t('发送失败，请重试。')
        : null,
    queuedMessages: live ? newest?.queuedMessages : undefined,
    retry: () => {
      void todoQ.refetch();
    },
    ...(send !== undefined ? { send } : {}),
    ...(queueSteer !== undefined && running
      ? {
          queue: (text: string) => queueSteer(text, false),
          stopAndSend: (text: string) => queueSteer(text, true),
        }
      : {}),
    ...(stop !== undefined ? { stop } : {}),
    ...(writable ? { attach: (files: File[]) => uploadMessageAttachments(files, t) } : {}),
    ...(live && buildId != null
      ? {
          sendQueuedNow: (queuedMessageId: string, content: string) =>
            mutations.sendSteer.mutateAsync({ conversationId: buildId, content, queuedMessageId }),
          removeQueued: (queuedMessageId: string, content: string) =>
            mutations.sendSteer.mutateAsync({
              conversationId: buildId,
              content,
              queuedMessageId,
              cancelQueued: true,
            }),
          editQueued: (queuedMessageId: string, content: string) =>
            mutations.sendSteer.mutateAsync({
              conversationId: buildId,
              content,
              queuedMessageId,
              editQueued: true,
            }),
        }
      : {}),
  };
}
