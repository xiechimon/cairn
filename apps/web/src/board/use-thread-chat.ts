import {
  isBuildStepKind,
  isInfoOutput,
  type RunnerOs,
  resolvedBuildPrNumber,
  STOP_MESSAGE,
  type StepKind,
  type TranscriptRow,
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
  useChief,
  useChiefThreads,
  useConversationMessages,
  useMachines,
  usePlans,
  useSteps,
  useTodo,
} from '../api/hooks.js';
import { refreshQueries } from '../api/invalidate.js';
import { liveTextStore } from '../api/live-text.js';
import { liveThinkingStore } from '../api/live-thinking.js';
import {
  mapOrchestrationFeedback,
  mapPlanDoc,
  mapTranscript,
  toDisplayTodo,
} from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings } from '../api/routing-settings.js';
import { useConversationStream } from '../api/sse.js';
import { globalCoordinatorThread } from '../chief/coordinator-load.js';
import { resolveCoordinatorOutage } from '../chief/coordinator-outage.js';
import { threadTurnInFlight } from '../chief/orchestration-inflight.js';
import type { UnsentSends } from '../chief/outbox.js';
import type { EarlierPages } from '../components/chat/earlier-loader.js';
import type { NamedMachine } from '../components/machine-label.js';
import type { QueuedCapsule } from '../components/queued-capsules.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite, DEMO_MODE } from '../demo/demo-gate.js';
import { docBlocksToMarkdown } from '../detail/docpane.js';
import { isTranscriptSettled } from '../detail/scroll-anchor.js';
import type { DocBlock, TodoRecord, TranscriptItem } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { describeError } from '../lib/error-copy.js';
import { markErrorSurfaced } from '../lib/mutation-error-report.js';
import { randomId } from '../lib/random-id.js';
import { uploadMessageAttachments } from '../overlay/attachment-paste.js';
import { useThreadPresence } from '../pwa/thread-presence.js';
import type { EngineRun, EngineRunStage } from './engine-run.js';
import { liveEngineRun } from './live-engine-run.js';
import {
  consumeTaskReadyToSettle,
  discardTaskFailed,
  enqueueTaskSend,
  failedTaskOutbox,
  markTaskReadyToSettle,
  taskOutbox,
  taskOutboxErrors,
  unlandedTaskBubbles,
} from './task-outbox.js';
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
  planMarkdown: string | null;
  changes: ThreadChanges;
  engineRun?: EngineRun;
  engineStage?: EngineRunStage;
  retryChanges: () => void;
  wire: WireTodo | null;
  started: boolean;
  locked: boolean;
  running: boolean;
  stopping: boolean;
  waitingOnChecks: boolean;
  machine: NamedMachine | null;
  platformWait: { machine: string | null; platform: RunnerOs } | null;
  stopped: boolean;
  sendError: string | null;
  unsent?: UnsentSends;
  queuedMessages: QueuedCapsule[] | undefined;
  retry: () => void;
  send?: (text: string) => void | Promise<void>;
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
  if (phase === 'stopped') return 'queue';
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
  const [stopping, setStopping] = useState(false);
  const stopRequested = useRef(false);

  const todoQ = useTodo(live ? todoId : undefined, live);
  const wire = todoQ.data ?? null;
  useThreadPresence(teamId, wire?.id, live);
  useMarkThreadRead(todoId);
  const buildId = wire !== null ? wire.latestBuildId : (listed?.latestBuildId ?? null);
  const buildQ = useBuild(buildId, live);
  const changesQ = useBuildChanges(buildId, live);
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
  const outbox = useSyncExternalStore(taskOutbox.subscribe, taskOutbox.entries);
  const outboxError = useSyncExternalStore(taskOutboxErrors.subscribe, () =>
    taskOutboxErrors.get(todoId),
  );
  const streamHandlers = useMemo(
    () => ({
      todoId,
      onMessage: (row: TranscriptRow, clientMessageId?: string) => {
        if (row.role === 'user' && clientMessageId !== undefined) {
          taskOutbox.land(clientMessageId, row.id);
        }
      },
    }),
    [todoId],
  );
  useConversationStream(buildId ?? undefined, live, streamHandlers);
  useEffect(() => {
    if (!live || buildId == null) return;
    const messagesState = qc.getQueryState(['messages', buildId, 'pages']);
    const fetchSettled =
      !messagesQ.isPending && !messagesQ.isFetching && messagesState?.isInvalidated !== true;
    for (const entry of outbox) {
      if (
        entry.scope === todoId &&
        entry.state === 'sent' &&
        entry.threadId === buildId &&
        entry.messageId === null &&
        fetchSettled &&
        consumeTaskReadyToSettle(entry.key)
      ) {
        taskOutbox.markRefetched(entry.key);
      }
    }
    taskOutbox.settle(buildId, known, todoId);
  }, [
    live,
    qc,
    outbox,
    todoId,
    buildId,
    known,
    messagesQ.isPending,
    messagesQ.isFetching,
    messagesQ.dataUpdatedAt,
  ]);

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

  const machine = useMemo(() => {
    const claimed = machinesQ.data?.find((m) => steps.some((s) => s.machineId === m.id));
    if (claimed != null) return claimed;
    const pinned =
      listed?.routeOverride?.machineId ??
      routingQ.data?.rules?.find((rule) => rule.use === 'session')?.machineId ??
      null;
    return machinesQ.data?.find((m) => m.id === pinned) ?? null;
  }, [machinesQ.data, steps, listed?.routeOverride?.machineId, routingQ.data]);
  const machineName = machine?.name ?? null;
  const platformWait = useMemo(() => {
    const queue = steps.find(
      (step) => step.status === 'pending' && step.queue?.blocked?.platform !== undefined,
    )?.queue;
    const platform = queue?.blocked?.platform;
    if (queue == null || platform === undefined) return null;
    return { machine: queue.waitingFor?.name ?? null, platform };
  }, [steps]);
  const todo = live ? (wire != null ? toDisplayTodo(wire) : (listed ?? null)) : (listed ?? null);
  const fixture = resolveScenario(searchParams);
  const fixtureDetail = fixture.details?.[todoId] ?? fixture.detail;
  const fixtureTranscript = fixtureDetail?.transcript;
  const plans = plansQ.data ?? [];
  const latestPlan = plans.length > 0 ? plans[plans.length - 1] : undefined;

  const optimisticUsers = useMemo(
    () => (live ? unlandedTaskBubbles(outbox, todoId, known) : []),
    [live, outbox, todoId, known],
  );

  const transcript = useMemo<TranscriptItem[]>(() => {
    if (!live) return fixtureTranscript ?? [];
    if (wire == null || buildId == null) return [];
    return mapTranscript({
      messages,
      hasEarlier: messagesQ.hasNextPage,
      steps,
      build: buildQ.data ?? null,
      todo: toDisplayTodo(wire),
      machineName,
      userName,
      liveText,
      liveThinking,
      stopping,
      activity,
      agentTodo,
      pageTodo: newest?.agentTodo ?? null,
      optimisticUsers,
      sentKey: taskOutbox.sentKey,
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
    newest?.agentTodo,
    optimisticUsers,
  ]);

  const awaitingStart =
    wire?.phase === 'todo' || wire?.phase === 'stopped' || wire?.phase === 'failed';
  const chiefQ = useChief(teamId, live && awaitingStart);
  const chiefThreadsQ = useChiefThreads(teamId, live && awaitingStart);
  const threads = chiefThreadsQ.data ?? [];
  const coordinator =
    live && awaitingStart
      ? (threads.find((thread) => thread.orchestration?.todoId === wire?.id) ??
        globalCoordinatorThread(threads))
      : null;
  const coordinatorOutage = live
    ? resolveCoordinatorOutage(chiefQ.data?.outage ?? null, coordinator)
    : null;
  const coordinatorId = coordinator?.id ?? null;
  const { messages: coordinatorMessages } = useConversationMessages(coordinatorId, live);
  useConversationStream(coordinatorId ?? undefined, live, {});
  const coordinatorTurn =
    coordinator === null ? null : `${coordinator.lastTurnAt}:${threadTurnInFlight(coordinator)}`;
  useEffect(() => {
    if (coordinatorId === null || coordinatorTurn === null) return;
    void refreshQueries(qc, { queryKey: ['messages', coordinatorId, 'pages'] });
  }, [qc, coordinatorId, coordinatorTurn]);
  const orchestration = useMemo(
    () =>
      wire == null
        ? []
        : mapOrchestrationFeedback(wire, coordinator, coordinatorMessages, coordinatorOutage),
    [wire, coordinator, coordinatorMessages, coordinatorOutage],
  );
  const shownTranscript = useMemo(
    () => (orchestration.length === 0 ? transcript : [...transcript, ...orchestration]),
    [transcript, orchestration],
  );

  const liveRun = useMemo(
    () =>
      live
        ? liveEngineRun({
            messages,
            steps,
            agentTodo,
            pageTodo: newest?.agentTodo ?? null,
            build: buildQ.data ?? null,
            liveText,
          })
        : null,
    [live, messages, steps, agentTodo, newest?.agentTodo, buildQ.data, liveText],
  );

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
          await postQueued(text, deliverAfterStop, randomId()).catch((error: unknown) => {
            markErrorSurfaced(error);
            throw error;
          });
        }
      : undefined;
  const send =
    writable && buildId != null
      ? (text: string) => {
          if (mutations.sendSteer.isError) mutations.sendSteer.reset();
          const route = queueReply && postQueued !== undefined ? 'queue' : 'thread';
          enqueueTaskSend({
            todoId,
            buildId,
            text,
            queueOnly: route === 'queue',
            deliver: async (entry) => {
              if (route === 'queue' && postQueued !== undefined) {
                await postQueued(entry.text, false, entry.key);
                return { threadId: buildId, messageId: null };
              }
              const result = await mutations.messageThread.mutateAsync({
                todoId,
                conversationId: buildId,
                content: entry.text,
                clientMessageId: entry.key,
              });
              const targetId = result?.conversationId ?? buildId;
              markTaskReadyToSettle(entry.key);
              if (targetId === buildId) {
                void qc.refetchQueries(
                  { queryKey: ['messages', targetId, 'pages'], type: 'active' },
                  { cancelRefetch: false },
                );
              }
              return { threadId: targetId, messageId: null };
            },
            onError: (error) => {
              taskOutboxErrors.set(todoId, describeError(error, t) ?? t('发送失败，请重试。'));
            },
          });
        }
      : !live && open
        ? fixtureSend
        : undefined;
  const unsent = useMemo<UnsentSends | undefined>(
    () =>
      live
        ? {
            failed: failedTaskOutbox(outbox, todoId),
            discard: discardTaskFailed,
          }
        : undefined,
    [live, outbox, todoId],
  );
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
    expanded: true,
  });

  const { fetchNextPage, isFetchingNextPage, isFetchNextPageError } = messagesQ;
  const loadEarlier = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  return {
    load,
    todo,
    transcript: shownTranscript,
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
    infoOutput: isInfoOutput(wire?.output),
    planDoc: live
      ? latestPlan !== undefined
        ? mapPlanDoc(latestPlan.content)
        : undefined
      : fixtureDetail?.doc,
    planMarkdown: live
      ? latestPlan !== undefined && latestPlan.content.trim() !== ''
        ? latestPlan.content
        : null
      : fixtureDetail?.doc !== undefined && fixtureDetail.doc.length > 0
        ? docBlocksToMarkdown(fixtureDetail.doc)
        : null,
    changes,
    ...(live
      ? { ...(liveRun !== null ? { engineRun: liveRun } : {}) }
      : fixtureDetail?.engineRun !== undefined
        ? { engineRun: fixtureDetail.engineRun, engineStage: fixtureDetail.engineStage }
        : {}),
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
    stopping,
    waitingOnChecks:
      todo?.phase === 'building' &&
      !running &&
      buildQ.data != null &&
      resolvedBuildPrNumber(buildQ.data) != null,
    machine,
    platformWait,
    stopped: buildQ.data?.errorMessage === STOP_MESSAGE,
    sendError:
      outboxError ??
      (mutations.sendSteer.isError &&
      mutations.sendSteer.variables?.cancelQueued !== true &&
      mutations.sendSteer.variables?.editQueued !== true
        ? (describeError(mutations.sendSteer.error, t) ?? t('发送失败，请重试。'))
        : null),
    ...(unsent !== undefined ? { unsent } : {}),
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
