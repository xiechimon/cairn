// Chief surface wiring (issue #129): the view state + live-data block the
// board route carried inline, lifted into one hook so every shell family
// (board / pages / resources / secondary / detail) drives the same drawer
// from its FAB. The three-state view (`none | drawer | settings`) lives in
// the gesture machine. The settings swap stays a board-route render
// decision. The hook still owns the
// live envelope/threads/messages queries, the conversation SSE while the
// drawer is open, the unread badge count and the send/thread callbacks.
// #631 失败反馈也归它：发送/恢复/PATCH 被拒 + 回合异步失败 → toast（sonner）。
// Fixture mode stays fully inert (queries enabled = live), so fixture
// captures keep their zero-request guarantee.
// #389/#442/#468: ⌘J joins the wake path as the FAB's keyboard cousin.
// The toggle, the FAB open, and Minimize are events on the gesture machine
// (#1267). The editable-outside-drawer guard still lives in overlays/hotkeys.
// This hook is the one chief instance for the app, so it installs the
// machine's key listener.

import type { AskUserAnswer, TranscriptRow } from '@cairn/shared';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { toast } from 'sonner';
import { activityStore } from '../api/activity.js';
import {
  useApiMutations,
  useChief,
  useChiefThreads,
  useMessages,
  useNotifications,
} from '../api/hooks.js';
import { liveTextStore } from '../api/live-text.js';
import { liveThinkingStore } from '../api/live-thinking.js';
import { chiefTurnErrorOfContent, mapChief } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { useConversationStream } from '../api/sse.js';
import { toastError } from '../components/ui/toaster.js';
import { chiefDefault } from '../fixtures/fixtures.js';
import type { ChiefContent, FixtureSet } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import {
  type ChiefView,
  ensureGestureKeys,
  type GestureEvent,
  getGestureStore,
} from '../overlays/gesture-machine.js';

/** One three-state view: drawer and settings are mutually exclusive by
 *  construction (r5: the gear swaps the drawer for the full-content view).
 *  The value lives in the gesture machine (#1267). */
export type { ChiefView };

export interface ChiefSurface {
  chiefView: ChiefView;
  setChiefView: (view: ChiefView) => void;
  chiefData: ChiefContent;
  /** Unread chief threads — the FAB badge (live: notifications; fixture:
   *  the capture's chiefUnread field). */
  chiefUnread: number;
  chiefBusy: boolean;
  /** Composer send (live only; absent = fixture static face, read-only
   *  draft + inert send). 返回 Promise = 异步发送（#631：rejected 时
   *  drawer 保留 draft 不丢字，detail composer 同契）。 */
  onSend?: (text: string) => void | Promise<void>;
  /** Thread switch (live only). */
  onThread?: (title: string, index: number) => void;
  /** 新主题 (#146, live only): drop back to the fresh-thread view — hero
   *  examples + `新主题` chip; the next send opens a new chief thread
   *  (threadId null, same wire as the hero-example click). */
  onNewThread?: () => void;
  /** #615 返工 live only：恢复钮「恢复到此处」= POST chief threads rewind
   *  （threadId 由 surface 持活动线程闭包携带）。 */
  onRewind?: (messageId: string) => void;
  /** #1049 live only：问答卡提交回答 / 取消提问（POST questions 端点；
   *  threadId 同 rewind 闭包携带；409（已答/已取消竞态）→ toast，不重试）。 */
  onAnswerQuestion?: (input: { requestId: string; answers: AskUserAnswer[] }) => void;
  onCancelQuestion?: (requestId: string) => void;
}

/** activeThreadIdx sentinel (#146): the fresh-thread view while threads
 *  exist — `null` keeps the list default (newest first), `-1` opts out. */
const NEW_THREAD = -1;

/** XMON-106 chief 深链（通知点击落地 `/app?chief=<threadId>`）：live 面等
 *  线程列表落定后按 id 定位——命中则开 drawer 切到该线程；未命中（线程已
 *  删）安静降级不开。两路结局都调 onConsumed（调用方剥 URL 参，一次性
 *  消费，防刷新/残留参重开）。fixture 面无线程 id，不消费（采集确定性）。 */
export interface ChiefDeepLink {
  threadId: string | null;
  onConsumed: () => void;
}

/** 开态持久化键（ADR 0013 D5，0004 D9「开态刷新即关」的反转）：品牌前缀
 *  纪律照 `cairn.sidebar-collapsed` 先例（app-sidebar.ts）；默认 = 关
 *  （Multica "never pops uninvited" 同律）。fixture 面永不读写（采集
 *  确定性——scenario 的 chief.view 是捕获形唯一开态源）。 */
export const CHIEF_OPEN_STORAGE_KEY = 'cairn.chief-open';

function readStoredChiefOpen(): boolean {
  try {
    return localStorage.getItem(CHIEF_OPEN_STORAGE_KEY) === '1';
  } catch {
    return false; // 隐私模式等 Storage 不可用——回落默认关
  }
}

export function useChiefSurface(fixture: FixtureSet, deepLink?: ChiefDeepLink): ChiefSurface {
  const { live, teamId } = useLiveData();
  const { t } = useI18n();
  const chiefQ = useChief(teamId, live);
  const chiefThreadsQ = useChiefThreads(teamId, live);
  const notificationsQ = useNotifications(teamId, live);
  // #615 主模型候选数据源（chief-settings 同配方：model-sources 非 pi 段，
  // spec 11 §A10；#770 起 providers 段已除）——查询 enabled=live，fixture
  // 面零请求不动。
  const mutations = useApiMutations(teamId);

  const chief = fixture.chief;
  // 初始视图（ADR 0013 D5）：fixture 捕获形（scenario 的 chief.view）优先
  // ——dev/capture 面零存储读取；live 面回落持久化开态（默认关）。
  // 之后的开合只经 gesture machine，本 hook 不再持有一份 useState。
  const initialChief: ChiefView =
    chief?.view ?? (live && readStoredChiefOpen() ? 'drawer' : 'none');
  getGestureStore(initialChief);
  const chiefView = useSyncExternalStore(
    (listener) => getGestureStore().subscribe(listener),
    () => getGestureStore().getState().chief,
    () => getGestureStore().getState().chief,
  );
  const setChiefView = useCallback((view: ChiefView) => {
    const type: GestureEvent['type'] =
      view === 'none' ? 'chief/minimize' : view === 'settings' ? 'chief/settings' : 'chief/open';
    getGestureStore().dispatch({ type });
  }, []);
  useLayoutEffect(() => {
    ensureGestureKeys();
  }, []);
  const chiefViewOpen = chiefView === 'drawer';
  // 开态持久化写入（live 面专属；幂等，StrictMode 双跑无害）。settings
  // 视图落 '0'——它是 board 路由的内容交换态，不是窗的开态。
  useEffect(() => {
    if (!live) return;
    try {
      localStorage.setItem(CHIEF_OPEN_STORAGE_KEY, chiefView === 'drawer' ? '1' : '0');
    } catch {
      // Storage 不可用（隐私模式）——持久化静默降级，会话内行为不变
    }
  }, [live, chiefView]);
  // ⌘J 的开关在 gesture machine。开后焦点落草稿框（drawer 的 autofocus
  // 律，首开限 closed→open 迁移。持久化开态的加载不抢焦点）。

  // —— chief live 面（r5 §2/§3.6）：envelope + threads + 活动线程消息 +
  // 会话流订阅；发送 = POST threads / conversations messages。——
  const [activeThreadIdx, setActiveThreadIdx] = useState<number | null>(null);
  const liveThreads = chiefThreadsQ.data ?? [];
  const activeThread =
    live && liveThreads.length > 0 && activeThreadIdx !== NEW_THREAD
      ? (liveThreads[activeThreadIdx ?? 0] ?? null)
      : null;
  // XMON-106 chief 深链消费（定义见 ChiefDeepLink）：等线程查询落定再定位，
  // 未决期间不动作（误开新主题面比晚开一拍更糟）。
  const deepLinkId = deepLink?.threadId ?? null;
  const onDeepLinkConsumed = deepLink?.onConsumed;
  useEffect(() => {
    // #615: `?chief=settings` 哨兵（非 board 面 gear 的落点）——不等线程
    // 查询（与线程定位无关），fixture 面同消费（零请求，仅视图态）。
    if (deepLinkId === 'settings') {
      setChiefView('settings');
      onDeepLinkConsumed?.();
      return;
    }
    if (!live || deepLinkId === null || !chiefThreadsQ.isSuccess) return;
    const idx = liveThreads.findIndex((thread) => thread.id === deepLinkId);
    if (idx >= 0) {
      setActiveThreadIdx(idx);
      setChiefView('drawer');
    }
    onDeepLinkConsumed?.();
  }, [live, deepLinkId, chiefThreadsQ.isSuccess, liveThreads, onDeepLinkConsumed, setChiefView]);
  const chiefMessagesQ = useMessages(live ? (activeThread?.id ?? null) : null, live);
  // #631 失败闭环（异步半）：chief_turn_error 行经会话流 message 事件到达
  // → 即时 toast；持久行由该事件的 messages 失效重取渲染（mapChiefStream
  // error 项）。handlers 必须引用稳定（sse.ts effect 依赖位——内联箭头会
  // 逐 render 重订阅流）。
  const streamHandlers = useMemo(
    () => ({
      onMessage: (row: TranscriptRow) => {
        const reason = chiefTurnErrorOfContent(row.content);
        if (reason === null) return;
        toast.error(t('总管本轮执行失败'), { description: reason });
      },
    }),
    [t],
  );
  useConversationStream(
    live ? (activeThread?.id ?? undefined) : undefined,
    live && chiefViewOpen,
    streamHandlers,
  );
  // #651 打字面读侧：conversation stream 的 text_delta 已由 sse.ts 按会话
  // 累积进 liveTextStore。#857 收敛交接：终稿 message 事件只记 handoff，缓冲
  // 的丢弃推迟到 messages 已含该行——读数走 getVisible（纯函数，无闪清无双份），
  // 落盘走 prune effect。键 = 活动线程 id（chief 步 buildId ≡ conv id ≡ thread id，
  // server chief.ts）。
  const activeThreadId = live ? (activeThread?.id ?? null) : null;
  const chiefMessagesData = chiefMessagesQ.data;
  const knownChiefIds = useMemo(
    () => new Set((chiefMessagesData?.messages ?? []).map((m) => m.id)),
    [chiefMessagesData],
  );
  const liveText = useSyncExternalStore(liveTextStore.subscribe, () =>
    activeThreadId !== null ? liveTextStore.getVisible(activeThreadId, knownChiefIds) : '',
  );
  const liveThinking = useSyncExternalStore(liveThinkingStore.subscribe, () =>
    activeThreadId !== null ? liveThinkingStore.getVisible(activeThreadId, knownChiefIds) : '',
  );
  useEffect(() => {
    if (activeThreadId !== null) {
      liveTextStore.prune(activeThreadId, knownChiefIds);
      liveThinkingStore.prune(activeThreadId, knownChiefIds);
    }
  }, [activeThreadId, knownChiefIds]);
  // #905 活动相位读侧（键 = 线程 id，liveText 同律）：单槽快照引用稳定，
  // useSyncExternalStore 直读安全。
  const activity = useSyncExternalStore(activityStore.subscribe, () =>
    activeThreadId !== null ? activityStore.get(activeThreadId) : null,
  );
  const liveChief = useMemo(() => {
    if (!live || !chiefQ.data) return null;
    return mapChief(chiefQ.data, {
      threads: liveThreads,
      activeThreadId: activeThread?.id ?? null,
      messages: chiefMessagesQ.data?.messages ?? [],
      liveText,
      liveThinking,
      activity,
    });
  }, [
    live,
    chiefQ.data,
    liveThreads,
    activeThread,
    chiefMessagesQ.data,
    liveText,
    liveThinking,
    activity,
  ]);

  const chiefData = live ? (liveChief ?? chiefDefault) : (chief ?? chiefDefault);
  const liveUnread = live
    ? (notificationsQ.data?.unreadThreadIds ?? []).filter((id) => id.startsWith('chief-')).length
    : 0;
  const chiefUnread = live ? liveUnread : (fixture.chiefUnread ?? 0);
  const chiefBusy = live
    ? liveThreads.some((thread) => thread.activeRun != null)
    : fixture.chiefBusy === true;

  // #631 失败反馈（同步半）：PATCH / rewind / 发送失败 → toastError（共享
  // 原语住 components/ui/toaster.tsx：server 原因进 description 透传不翻译
  // ——server 数据同 user 内容律；#638 由本文件局部版提为全站单源）。
  // #1260：chief 无模型覆盖槽——模型读绑定 Agent 自身配置，本面不设写位。
  const onRewind = live
    ? (messageId: string) => {
        if (activeThread === null) return;
        mutations.chiefRewind.mutate(
          { threadId: activeThread.id, messageId },
          { onError: (e) => toastError(t('恢复失败，请重试。'), e) },
        );
      }
    : undefined;
  // #1049 问答卡回调：失败（含 409 竞态——卡已翻面后重复提交）toast 呈报；
  // 成功翻面走 SSE message 事件 + invalidateAll 重取（S8 同律，不持乐观态）。
  const onAnswerQuestion = live
    ? (input: { requestId: string; answers: AskUserAnswer[] }) => {
        if (activeThread === null) return;
        mutations.chiefAnswerQuestion.mutate(
          { threadId: activeThread.id, ...input },
          { onError: (e) => toastError(t('提交回答失败，请重试。'), e) },
        );
      }
    : undefined;
  const onCancelQuestion = live
    ? (requestId: string) => {
        if (activeThread === null) return;
        mutations.chiefCancelQuestion.mutate(
          { threadId: activeThread.id, requestId },
          { onError: (e) => toastError(t('取消提问失败，请重试。'), e) },
        );
      }
    : undefined;

  const onSend = live
    ? (text: string) => {
        // #631：mutateAsync → promise 契约（drawer 被拒保留 draft）；失败
        // toast 在此承担后 rethrow 交契约面。
        return mutations.chiefSend
          .mutateAsync({ threadId: activeThread?.id ?? null, content: text })
          .then(() => {
            // 新主题落线程首位（listChiefThreads 新在前）——切回 0 位。
            if (activeThread === null) setActiveThreadIdx(0);
          })
          .catch((error: unknown) => {
            toastError(t('发送失败，请重试。'), error);
            throw error;
          });
      }
    : undefined;
  const onThread = live ? (_title: string, index: number) => setActiveThreadIdx(index) : undefined;
  const onNewThread = live ? () => setActiveThreadIdx(NEW_THREAD) : undefined;

  return {
    chiefView,
    setChiefView,
    chiefData,
    chiefUnread,
    chiefBusy,
    onSend,
    onThread,
    onNewThread,
    onRewind,
    onAnswerQuestion,
    onCancelQuestion,
  };
}
