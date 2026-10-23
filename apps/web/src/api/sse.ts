// SSE 接线（M5，02 §1.2 全 SSE 无 WS）：原生 EventSource（同源 cookie 会话，
// 01 §4.1 锁定）。策略 = S8 canon「SSE 事件仅作 invalidateQueries 提示信号，
// server state 全走查询失效重取」；conversation stream 的 text_delta 例外
// 进 liveTextStore（流式打字面，终稿 message 行落库记 handoff、消费侧收敛后
// 交接——#857，见 live-text.ts）。
// 通知 divergence（04 §5/A5）：in-app 事件 1:1 + document.hidden 时页内
// new Notification()（无 Web Push）。鉴权开时（#253）两条流以 ?token= 建流
// （streamUrl，协议例外见 api/auth.ts 头注）；门页开着不建流，放行即重连。
// 连接看护（重连 resync / 静默看门狗 / 漏事件对账）单缝在 sse-connection.ts，
// team 事件的失效键映射单缝在 sse-team-events.ts（#666），本文件负责挂流、
// 消费映射并承载副作用（桌面通知 / liveTextStore / 透传回调）。

import type {
  ConversationActivityEvent,
  ConversationAgentTodoEvent,
  ConversationStepEvent,
  NotificationRecord,
  TranscriptRow,
} from '@cairn/shared';
import { isChiefConversationId } from '@cairn/shared';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { readNotifyPref } from '../board/notify-pref.js';
import { EN } from '../i18n/en.js';
import { readStoredLocale } from '../i18n/locale.js';
import { translate } from '../i18n/translate.js';
import { safeLocalStorage } from '../safe-storage.js';
import { activityStore } from './activity.js';
import { agentTodoStore } from './agent-todo.js';
import { readStoredToken, useAuth } from './auth.js';
import { invalidateConverged } from './invalidate.js';
import { liveTextStore } from './live-text.js';
import { liveThinkingStore } from './live-thinking.js';
import { textOfContent, thinkingOfContent } from './mappers.js';
import { connect } from './sse-connection.js';
import { streamGuards } from './sse-guards.js';
import { teamEventInvalidations } from './sse-team-events.js';

/** 鉴权开时 stream URL 附 ?token=（#253）——EventSource 无法设 header 的协议
 *  例外，server 仅对两条 stream 端点收 query token（token-auth.ts 契约）。
 *  无存量 token（鉴权关 / 门页未过）= 原样 URL，零行为差。 */
function streamUrl(path: string): string {
  const token = readStoredToken();
  return token === null ? path : `${path}?token=${encodeURIComponent(token)}`;
}

/** team stream：todo/build 文档事件 + notification + machine_presence →
 *  相关查询失效重取（02 §1.2 双保险的重取半）；notification 事件兼发桌面
 *  通知（document.hidden 时弹，02 §9.1 canon）。 */
export function useTeamStream(teamId: string | undefined, enabled: boolean): void {
  const qc = useQueryClient();
  // 门页开着 = token 缺/坏，不建流——对 401 建流只会立即 fatal CLOSED
  // （connect() 处注）；passGate 的 snapshot 换引用触发本 effect 重跑，
  // 以新 token 建流（#253）。
  const auth = useAuth();
  useEffect(() => {
    if (teamId === undefined || !enabled || auth.gateOpen) return;
    // resync（#462）：重连/看门狗重建即全量失效重取——补上断线窗口内丢失的
    // 边沿事件（活跃查询才重取，成本有界；重连本身罕见）。
    const resync = () => {
      void invalidateConverged(qc);
    };
    return connect(
      streamUrl(`/api/teams/${teamId}/stream`),
      (ev) => {
        // 事件 → 失效键映射单源 = sse-team-events.ts（纯函数，node 单测
        // 铺真 wire 形状；#666：todo/build 文档事件带上 ['plans']，方案卡
        // 与相位 chip 同事件收敛，不再独赌 conv 流活着）。
        // 失效一律走 invalidate.ts 的收敛缝（#717）：挂载取数在飞时到达的
        // 提示会被 query-core 去重吞掉，收敛缝在 settle 后补一轮。
        for (const queryKey of teamEventInvalidations(ev, teamId)) {
          void invalidateConverged(qc, { queryKey });
        }
        if (ev.type === 'notification') {
          fireDesktopNotification(ev.notification as NotificationRecord);
        }
      },
      resync,
      streamGuards(qc),
    );
  }, [teamId, enabled, qc, auth]);
}

/** 通知点击落地 href（XMON-106）：todo 类事件直指详情页；chief_message 走
 *  看板 `?chief=<threadId>` 深链（board-page 消费：开 drawer 定位线程后剥参）。 */
function notificationHref(record: NotificationRecord): string {
  return record.type === 'chief_message'
    ? `/app?chief=${encodeURIComponent(record.entityId)}`
    : `/app/todo/${encodeURIComponent(record.entityId)}`;
}

/** 经 SW 发通知（XMON-106）：通知挂 data.href，点击落 sw.js notificationclick
 *  ——已开窗口聚焦 + postMessage 客户端路由（PwaBridge 消费），无窗口
 *  openWindow(href) 新开。SW 未就绪（首访尚在装/注册失败）超 2s 回 false，
 *  调用方落页内回退——通知不得因等 ready 整个丢失。 */
async function showViaServiceWorker(
  title: string,
  body: string,
  tag: string,
  href: string,
): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    if (registration === null) return false;
    await registration.showNotification(title, { body, tag, data: { href } });
    return true;
  } catch {
    return false;
  }
}

/** 桌面通知（04 §5 divergence 口径）：仅 document.hidden 时弹；权限未授予
 *  静默跳过（权限请求面 = 真人一次项，M6 清单）。
 *  XMON-106：主路经 SW 发（点击可路由回应用，见 showViaServiceWorker）；
 *  SW 不可用回退页内 Notification + onclick（focus + 整页跳 href）——原
 *  裸 new Notification() 无 onclick 正是「通知点了没反应」的病灶。
 *  标题文案走 i18n 纯函数面（非组件位——zh 权威 + en 兜底，01/S6）。 */
function fireDesktopNotification(record: NotificationRecord): void {
  if (!document.hidden) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  // #1031 偏好档闸门：帐号页开关关档（cairn.notifyEnabled=0）即使用户已授权
  // 也不弹——「关」是能落地的动作，不只是控件视觉。permission 是能力面、
  // 偏好是意愿面，两层都过才发。
  // #1091：获取点走安全缝——通知事件是运行期路径，裸 `localStorage` 实参在
  // Storage 不可用环境会把 fireDesktopNotification 整个炸掉。
  if (readNotifyPref(safeLocalStorage()) === 'off') return;
  const t = (source: string) => translate(readStoredLocale(safeLocalStorage()), EN, source);
  const title =
    record.type === 'plan_ready'
      ? t('方案已就绪')
      : record.type === 'build_review'
        ? t('构建待审核')
        : record.type === 'quota_wait'
          ? t('等额度')
          : record.type === 'model_fallback'
            ? t('已换备用模型')
            : record.entityRef.title;
  const body =
    record.snippet ??
    (record.entityRef.seqNum !== null
      ? `#${record.entityRef.seqNum} ${record.entityRef.title}`
      : record.entityRef.title);
  const href = notificationHref(record);
  void showViaServiceWorker(title, body, record.id, href).then((shown) => {
    if (shown) return;
    try {
      const fallback = new Notification(title, { body, tag: record.id });
      fallback.onclick = () => {
        window.focus();
        window.location.assign(href);
      };
    } catch {
      // 平台拒绝（移动端等）静默——in-app 未读面兜底
    }
  });
}

export interface ConversationStreamHandlers {
  /** message 事件透传行（#631 起）：调用方可检载荷分流（如 chief 失败行）。
   *  旧契约（无参回调）继续兼容——传 () => void 的调用面不变。 */
  onMessage?: (row: TranscriptRow) => void;
  /** step 事件透传载荷（#631 起）：同上，状态分流由调用方自取。 */
  onStep?: (step: ConversationStepEvent['step']) => void;
}

/** conversation stream（详情页 live transcript）：text_delta → liveTextStore；
 *  message/step → 失效重取（messages/steps/todo/build）。挂载即订阅——
 *  build 未启时为空流 + ping（服务端容忍）。 */
export function useConversationStream(
  conversationId: string | undefined,
  enabled: boolean,
  handlers: ConversationStreamHandlers,
): void {
  const qc = useQueryClient();
  const onMessage = handlers.onMessage;
  const onStep = handlers.onStep;
  // 门页/token 面同 useTeamStream（#253）：gateOpen 不建流，passGate 重建。
  const auth = useAuth();
  useEffect(() => {
    if (conversationId === undefined || !enabled || auth.gateOpen) return;
    return startConversationStream(conversationId, qc, { onMessage, onStep });
  }, [conversationId, enabled, qc, onMessage, onStep, auth]);
}

/** 建会话流（非 React 缝——node 单测直驱，#740）。订阅重置语义：流（重）
 *  建立即先 liveTextStore.clear 再消费事件。服务端在 subscribe 时把在飞段
 *  缓冲作为一条 text_delta 快照补发（#740 hub 半边），客户端旧缓冲（断线前
 *  /关抽屉前累积的）若不作废，补发叠加成双份。顺序保证：clear 同步发生在
 *  connect() 之前、重连清在 resync（onopen）里——EventSource 的任何事件最早
 *  也在 open 之后到达，不存在「补发先于 clear」的窗口。 */
export function startConversationStream(
  conversationId: string,
  qc: QueryClient,
  handlers: ConversationStreamHandlers,
): () => void {
  const onMessage = handlers.onMessage;
  const onStep = handlers.onStep;
  liveTextStore.clear(conversationId);
  liveThinkingStore.clear(conversationId);
  activityStore.clear(conversationId);
  agentTodoStore.clear(conversationId);
  // resync（#462）：重连/看门狗重建即全量失效重取，补断线窗口内丢失的
  // message/step 事件（plan 卡/进度行停更的根治面）；#740 另加清缓冲——
  // 新订阅上服务端补发的是当前段全量快照（含断线窗口内流掉的增量）。
  // 全量失效走 #767 收敛缝（invalidateConverged，#717 根因：挂载取数在飞时
  // 到达的提示会被 query-core 去重吞掉）。活动单槽同清（#905 W2）——新订阅
  // 的进场补发（hub lastActivity）接管，陈旧相位不跨连接残留。
  const resync = () => {
    liveTextStore.clear(conversationId);
    liveThinkingStore.clear(conversationId);
    activityStore.clear(conversationId);
    agentTodoStore.clear(conversationId);
    void invalidateConverged(qc);
  };
  return connect(
    streamUrl(`/api/conversations/${conversationId}/stream`),
    (ev) => {
      switch (ev.type) {
        case 'text_delta':
          liveTextStore.append(conversationId, ev.text as string);
          break;
        case 'thinking_delta':
          liveThinkingStore.append(conversationId, ev.text as string);
          break;
        case 'activity': {
          // #905：步活动相位（瞬态单槽；stepId 对在跑步的过滤在消费侧）。
          const activity = (ev as ConversationActivityEvent).activity;
          // 与 hub 同律：仅 resetLive 清在飞思考/正文（#1308 Bugbot）。
          if (activity.resetLive === true) {
            liveTextStore.clear(conversationId);
            liveThinkingStore.clear(conversationId);
          }
          activityStore.set(conversationId, activity);
          break;
        }
        case 'agent_todo': {
          const todo = (ev as ConversationAgentTodoEvent).todo;
          agentTodoStore.set(conversationId, todo);
          break;
        }
        case 'message': {
          const row = ev.message as TranscriptRow;
          // #857 收敛交接：终稿行到达只记 handoff，不清缓冲——messages 重取在
          // 飞时打字面保留，收敛（消费侧 knownIds 含该行）才交接给落库行。只记
          // assistant 文本行：工具行/用户行到达时缓冲前缀尚无落库行覆盖。
          if (row.role === 'assistant' && textOfContent(row.content).trim() !== '') {
            liveTextStore.noteSettled(conversationId, row.id);
          }
          if (row.role === 'assistant' && thinkingOfContent(row.content) !== null) {
            liveThinkingStore.noteSettled(conversationId, row.id);
          }
          void invalidateConverged(qc, { queryKey: ['messages', conversationId] });
          void invalidateConverged(qc, { queryKey: ['plans'] });
          onMessage?.(row);
          break;
        }
        case 'step': {
          // #857：步终态兜底清缓冲（hub 同律）——失败/停止无终稿行时 stale 不
          // 跨回合累积；正常收尾时 handoff 早已收敛交接，清即 no-op。
          // #905：活动单槽同清（W2 死相位不跨步残留）。
          const step = (ev as ConversationStepEvent).step;
          if (step.status === 'done' || step.status === 'failed' || step.status === 'stopped') {
            liveTextStore.clear(conversationId);
            liveThinkingStore.clear(conversationId);
            activityStore.clear(conversationId);
            agentTodoStore.clear(conversationId);
          }
          void invalidateConverged(qc, { queryKey: ['steps', conversationId] });
          void invalidateConverged(qc, { queryKey: ['build', conversationId] });
          void invalidateConverged(qc, { queryKey: ['changes', conversationId] });
          // plan 行经 upload 缝静默落库（routes-machine PUT upload 不发事件），
          // 仅 message 事件失效 plans 会与 daemon 的 plan.md/transcript 并发
          // 上传赛跑：message 先到时该轮重取落空，其后无人再失效。step 事件
          // （finishStep 发，恒在 plan 落库后）补一次失效兜住该 race。
          void invalidateConverged(qc, { queryKey: ['plans'] });
          // #684：chief 会话的步终态（done/failed，含失联超时 sweep）必须
          // 失效线程列表——activeRun 收口只落 chief_thread 行，成功路径靠
          // notifyChiefTurn 的 notification 事件兜住，失败路径（#631 起零
          // 通知）此前无人失效：drawer 的 steer 占位符会一直谎称回合在飞。
          // 前缀失效（无 teamId 限位）与 ['plans'] 同律——活跃查询至多一个。
          if (isChiefConversationId(conversationId)) {
            void invalidateConverged(qc, { queryKey: ['chiefThreads'] });
          }
          onStep?.(step);
          break;
        }
        default:
          break; // ping
      }
    },
    resync,
    streamGuards(qc),
  );
}
