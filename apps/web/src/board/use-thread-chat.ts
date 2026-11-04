import {
  isBuildStepKind,
  STOP_MESSAGE,
  type StepKind,
  type TodoRecord as WireTodo,
} from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router';
import { activityStore } from '../api/activity.js';
import { agentTodoStore } from '../api/agent-todo.js';
import { ApiError } from '../api/client.js';
import {
  useApiMutations,
  useBuild,
  useMachines,
  useMessages,
  usePlans,
  useSteps,
  useTodo,
} from '../api/hooks.js';
import { invalidateConverged } from '../api/invalidate.js';
import { liveTextStore } from '../api/live-text.js';
import { liveThinkingStore } from '../api/live-thinking.js';
import { mapPlanDoc, mapPlanVersions, mapTranscript, toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { useConversationStream } from '../api/sse.js';
import type { QueuedCapsule } from '../components/queued-capsules.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite, DEMO_MODE } from '../demo/demo-gate.js';
import type { DocBlock, PlanVersion, TodoRecord, TranscriptItem } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { uploadMessageAttachments } from '../overlay/attachment-paste.js';
import { useThreadPresence } from '../pwa/thread-presence.js';
import { useMarkThreadRead } from './use-mark-thread-read.js';

export type ThreadChatLoad = 'ready' | 'loading' | 'error' | 'missing';

export interface ThreadChat {
  load: ThreadChatLoad;
  todo: TodoRecord | null;
  transcript: TranscriptItem[];
  buildId: string | null;
  buildLegDone: boolean;
  infoOutput: boolean;
  buildAgentId: string | null;
  planDoc: DocBlock[] | undefined;
  planVersions: PlanVersion[] | undefined;
  wire: WireTodo | null;
  started: boolean;
  locked: boolean;
  running: boolean;
  workingFor: { startedAt?: number; seconds?: number } | undefined;
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
  const [stopping, setStopping] = useState(false);
  const stopRequested = useRef(false);

  const todoQ = useTodo(live ? todoId : undefined, live);
  const wire = todoQ.data ?? null;
  useThreadPresence(teamId, wire?.id, live);
  useMarkThreadRead(todoId);
  const buildId = live ? (wire?.latestBuildId ?? null) : (listed?.latestBuildId ?? null);
  const buildQ = useBuild(buildId, live);
  const stepsQ = useSteps(buildId, live);
  const messagesQ = useMessages(buildId, live);
  const plansQ = usePlans(buildId, live);
  const machinesQ = useMachines(teamId, live);

  const known = useMemo(
    () => new Set((messagesQ.data?.messages ?? []).map((m) => m.id)),
    [messagesQ.data],
  );
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
    }),
    [qc, todoId],
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

  const machineName = useMemo(
    () => machinesQ.data?.find((m) => steps.some((s) => s.machineId === m.id))?.name ?? null,
    [machinesQ.data, steps],
  );
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
      messages: messagesQ.data?.messages ?? [],
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
    messagesQ.data,
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
  const queueSteer =
    writable && buildId != null
      ? (text: string, deliverAfterStop: boolean) =>
          mutations.sendSteer
            .mutateAsync({
              conversationId: buildId,
              content: text,
              mode: 'queue',
              deliverAfterStop,
            })
            .then(() => undefined)
      : undefined;
  const send = writable
    ? queueReply && queueSteer !== undefined
      ? (text: string) => queueSteer(text, false)
      : async (text: string) => {
          await mutations.messageThread.mutateAsync({ todoId, content: text });
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

  const streamingItem = transcript.findLast((item) => item.kind === 'streaming');

  return {
    load,
    todo,
    transcript,
    buildId,
    infoOutput: wire?.output === 'info',
    buildAgentId: wire?.assignment?.build?.agentId ?? null,
    planDoc: live
      ? latestPlan !== undefined
        ? mapPlanDoc(latestPlan.content)
        : undefined
      : fixtureDetail?.doc,
    planVersions: live ? mapPlanVersions(plans) : fixtureDetail?.planVersions,
    wire,
    buildLegDone: hasDoneBuildLeg(steps),
    started,
    locked: !open,
    running,
    workingFor:
      running && streamingItem?.kind === 'streaming'
        ? { startedAt: streamingItem.startedAt, seconds: streamingItem.seconds }
        : undefined,
    machineName,
    stopped: buildQ.data?.errorMessage === STOP_MESSAGE,
    sendError: mutations.messageThread.isError
      ? mutations.messageThread.error?.message || t('发送失败，请重试。')
      : mutations.sendSteer.isError && mutations.sendSteer.variables?.cancelQueued !== true
        ? mutations.sendSteer.error?.message || t('发送失败，请重试。')
        : null,
    queuedMessages: live ? messagesQ.data?.queuedMessages : undefined,
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
        }
      : {}),
  };
}
