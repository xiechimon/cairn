// 详情页 composer 的发送/附件分流 hook（#1127 自 todo-detail-page 提取）：
// onSend 的四条 live 出口（confirm 关口 = revision 驳回回路 / building·运行中
// review = steer 补话 / review 静息 = 人肉打回 / failed = 带反馈重启）+
// fixture 面的 reject-chain 预演腿；onAttachment = 共享的逐文件 grant+upload
// 循环（overlay/attachment-paste.js 单源，chief drawer 同消费）。
// 逻辑逐字搬移；相位机的注释随分支随迁。

import type { Dispatch, SetStateAction } from 'react';
import type { useApiMutations } from '../api/hooks.js';
import type { Phase } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { uploadMessageAttachments } from '../overlay/attachment-paste.js';

/** Reject-chain walk state (AC3): idle = the fixture's confirm surface;
 *  streaming = the replan round (r8 67); landed = v(N+1) 待确认 (r8 68);
 *  building = the 确认 round opened after the chain's last step. */
export type ChainState = 'idle' | 'streaming' | 'landed' | 'building';

type Mutations = ReturnType<typeof useApiMutations>;

export interface DetailComposerInput {
  live: boolean;
  phase: Phase;
  buildId: string | null;
  running: boolean;
  mutations: Mutations;
  /** 发送时先跳最新端（#873 律的正文注释在 onSend 分支处）。 */
  scrollToEnd: () => void;
  /** steer 成功后的清稿口（draft state 留页面，Composer 受控消费）。 */
  clearDraft: () => void;
  chain: ChainState;
  setChain: Dispatch<SetStateAction<ChainState>>;
  /** fixture 面：detail.revision 在场 = reject-chain 可预演（live 面忽略）。 */
  revisionAvailable: boolean;
  /** 2026-10-12 dsh 发送流对齐：live 各分支点火即挂乐观回声（自己的气泡 +
   *  「处理中...」待定行立刻上屏），不等服务端落库 + daemon 认领的回路
   *  （实测该回路 ~3s 零反馈）。fixture 面本就有 chain 预演同形，不调用。 */
  onOptimisticSend?: (text: string) => void;
  /** 写入被拒（409 竞态等）即清回声：消息从未落库，屏上不留谎；draft
   *  保留律（各分支既有语义）不动。 */
  clearOptimisticSend?: () => void;
}

export function useDetailComposer(input: DetailComposerInput) {
  const { live, phase, buildId, running, mutations, chain, setChain, revisionAvailable } = input;
  const { t } = useI18n();

  // M7 #310 附件 wire（r9 §3.1）：live 面把 draft 提到页面层，附件 token 才能
  // 注入；#729 起 token 注入住 useComposerWire（行原子 + caret 位）。循环本体
  // #1127 收编共享——失败 toast 点名原因，成功 token 仍落，draft 不动。
  const onAttachment = live ? (files: File[]) => uploadMessageAttachments(files, t) : undefined;

  const onSend = live
    ? (text: string) => {
        // #873：读者自己发出去的那条必须看得见——这一刻先跳到
        // 最新端（四个分流出口共用；被拒 409 不清稿，落在最新端
        // 也无害）。增长跟随的其余判断在原语 autoScroll 里。
        if (text !== '') input.scrollToEnd();
        // 驳回回路（r5 §4）：confirm 关口发送 = revision + feedback
        // → 重规划步入队 → plan v(N+1)（会话流即时呈现）。
        if (phase === 'confirm' && buildId && text !== '') {
          input.onOptimisticSend?.(text);
          mutations.stepAction.mutate(
            {
              buildId,
              body: {
                action: 'revision',
                side: 'plan',
                feedback: text,
                clientMessageId: crypto.randomUUID(),
              },
            },
            { onError: () => input.clearOptimisticSend?.() },
          );
          return;
        }
        // W3 steer（#280，06 册 D9 / spec #277）：building 态发送 =
        // 运行中补话；review 态仅在运行中（AI 审核步在跑等）保持
        // 本面——运行补话与静息打回各走各的道，不互抢。server 门
        // （claimed 步在跑）收则 201，无在跑步 409 明确拒绝（提示行
        // + draft 保留，不丢字）。返回 Promise = composer 异步清稿面。
        if ((phase === 'building' || (phase === 'review' && running)) && buildId && text !== '') {
          input.onOptimisticSend?.(text);
          return mutations.sendSteer
            .mutateAsync({ conversationId: buildId, content: text })
            .then(() => {
              input.clearDraft();
              return undefined;
            })
            .catch((error: unknown) => {
              input.clearOptimisticSend?.();
              throw error;
            });
        }
        // #701（B-C12）：review 关口静息态发送 = 人肉打回——confirm
        // 驳回的动作面复用（POST steps revision → review→planning +
        // 重规划步入队，边与 #330 自动回流同一条），不再撞 steer 面
        // 的 409 死路；「请求修改…」占位符从此诚实（可填即可发）。
        // Promise 面 = restart 同律：成功清稿、被拒（409 竞态）保留。
        if (phase === 'review' && !running && buildId && text !== '') {
          input.onOptimisticSend?.(text);
          return mutations.stepAction
            .mutateAsync({
              buildId,
              body: {
                action: 'revision',
                side: 'plan',
                feedback: text,
                clientMessageId: crypto.randomUUID(),
              },
            })
            .then(() => undefined)
            .catch((error: unknown) => {
              input.clearOptimisticSend?.();
              throw error;
            });
        }
        // #320 失败面发送 = 带反馈重启（r9 §3.3：原站 failed 态发消息
        // 触发新一轮，消息随新轮入会话——非 steer 语义）。走 steps
        // restart 动作位：新 build + 反馈行落新 conv + failed→queued。
        // Promise 面 = 成功清稿、被拒（相位漂移 409）保留 draft。
        if (phase === 'failed' && buildId && text !== '') {
          input.onOptimisticSend?.(text);
          return mutations.stepAction
            .mutateAsync({
              buildId,
              body: {
                action: 'restart',
                feedback: text,
                clientMessageId: crypto.randomUUID(),
              },
            })
            .then(() => undefined)
            .catch((error: unknown) => {
              input.clearOptimisticSend?.();
              throw error;
            });
        }
      }
    : revisionAvailable && chain === 'idle'
      ? () => {
          setChain('streaming');
          window.setTimeout(() => setChain('landed'), 900);
        }
      : undefined;

  return { onSend, onAttachment };
}
