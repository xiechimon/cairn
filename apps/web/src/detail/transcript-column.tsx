// Detail transcript column (#1009 A2 + CDS PR-6): the center column's chat
// scroller rides the registry MessageScroller primitive — the same swap the
// chief drawer took in A1. Retired here: the hand-written `column-reverse`
// layout with its `mb-auto` pin and the shared `useChatFollow` hook.
//
// CDS stick-to-bottom (plan SP) on top of #873:
// 贴底阈值 40px = `scrollEdgeThreshold={FOLLOW_THRESHOLD}`；向上滚 / 滚轮 /
// 触控 / 方向键立刻 unpin（原语 userScrollIntent）；流式增长只在仍 pinned
// 时跟随（behavior:'auto'）。原语 ~180ms autoscrolling 旗位（scrollbar 隐藏）
// 覆盖 plan 的 150ms no-pull-back——unpin 后直到读者回到边缘才再钉，比 150ms
// 防回拉更强。jump-to-latest 独立阈值 JUMP_THRESHOLD 120px（MessageScrollerJumpButton）；
// 开列落最新 = defaultScrollPosition "end"；读者自己发出去的那条永远跳到
// 最新 = `scrollToEnd()`（旧 requestFollow 等价）。
//
// 列宽/内垫：Viewport 承接旧 `.chat-col` 端口（testid transcript-col）；
// 底垫改 `--chat-extra-space` 35vh（detail-3pane colPadBottom ≥16 仍满足）；
// Content 中和为 block + gap-0，并 `max-w-(--chat-max-w)` 768 居中。

import { forwardRef, useImperativeHandle } from 'react';
import {
  FOLLOW_THRESHOLD,
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerJumpButton,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from '../components/ui/message-scroller.js';
import type { TranscriptItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ArrowDown } from '../icons/index.js';
import { SpecBlock } from './spec-block.js';
import { type LiveStep, Transcript } from './transcript.js';

/** Root 中和：原语 size-full 的 h-full 会顶爆 detail-center 的 flex 链。 */
const ROOT_CLS = 'h-auto min-h-0 flex-1';
/** Viewport = 旧 `.chat-col` 的滚动端口；底垫走 --chat-extra-space（35vh）。 */
const VIEWPORT_CLS = 'chat-col pt-[19px] pr-4 pb-(--chat-extra-space) pl-[19px]';
/** Content：行距在行自身 margin；列宽钉 --chat-max-w 768。 */
const CONTENT_CLS = 'mx-auto block w-full max-w-(--chat-max-w) gap-0';

/** 页面层持有的列 API：读者的 send 必须看得见自己那条（#873 第二律）。 */
export interface TranscriptColumnHandle {
  scrollToEnd: () => void;
}

interface TranscriptColumnProps {
  transcript: TranscriptItem[];
  /** #873：活行披露面（在跑步）；fixture 面 null。 */
  liveStep: LiveStep | null;
  /** XMON-105：agent 消息行头像的身份（board card / team page 同源）。 */
  agent: { displayName: string; avatarUrl: string | null } | null;
  /** #366：线程内 plan 卡激活 = 右 pane 切文档面。 */
  onOpenPlan?: () => void;
  /** 简报卡（#827，live 且有 spec 才在场；fixture 面 undefined）。 */
  spec?: string;
  /** 增长跟随的武装位（旧 hook 的 active：live 且有行）。 */
  autoScroll: boolean;
}

/** Provider 与消费者不能同组件（hook 吃不到自己渲染树的 context）——
 *  外层渲染 Provider，内层消费 useMessageScroller 并把星形 API 交给页面。 */
export const TranscriptColumn = forwardRef<TranscriptColumnHandle, TranscriptColumnProps>(
  function TranscriptColumn({ autoScroll, ...rest }, ref) {
    return (
      <MessageScrollerProvider
        autoScroll={autoScroll}
        scrollEdgeThreshold={FOLLOW_THRESHOLD}
        defaultScrollPosition="end"
      >
        <TranscriptColumnInner {...rest} handleRef={ref} />
      </MessageScrollerProvider>
    );
  },
);

function TranscriptColumnInner({
  transcript,
  liveStep,
  agent,
  onOpenPlan,
  spec,
  handleRef,
}: Omit<TranscriptColumnProps, 'autoScroll'> & {
  handleRef: React.ForwardedRef<TranscriptColumnHandle>;
}) {
  const { t } = useI18n();
  const { scrollToEnd } = useMessageScroller();
  useImperativeHandle(handleRef, () => ({ scrollToEnd: () => void scrollToEnd() }), [scrollToEnd]);
  return (
    <MessageScroller className={ROOT_CLS}>
      {/* 旧 `.chat-col` 的滚动端口：testid 与内垫随迁（detail-3pane 的
          colPadBottom / detail-narrow 的横滚断言读这里）。 */}
      <MessageScrollerViewport data-testid="transcript-col" className={VIEWPORT_CLS}>
        <MessageScrollerContent className={CONTENT_CLS}>
          {/* #827：简报卡住线程列首（随流滚动，不钉住）。fixture 面无 spec
              数据，捕获字节不动。 */}
          {spec != null && <SpecBlock spec={spec} />}
          <Transcript
            transcript={transcript}
            liveStep={liveStep}
            agent={agent}
            onOpenPlan={onOpenPlan}
          />
        </MessageScrollerContent>
      </MessageScrollerViewport>
      {/* CDS PR-6：jump past 120px（独立于 40px follow 阈值）。 */}
      <MessageScrollerJumpButton>
        <ArrowDown width={16} height={16} />
        <span className="sr-only">{t('滚动到最新')}</span>
      </MessageScrollerJumpButton>
    </MessageScroller>
  );
}
