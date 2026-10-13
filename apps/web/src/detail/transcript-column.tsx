// Detail transcript column (#1009 A2): the center column's chat scroller
// rides the registry MessageScroller primitive — the same swap the chief
// drawer took in A1. Retired here: the hand-written `column-reverse`
// layout with its `mb-auto` pin and the shared `useChatFollow` hook.
//
// 滚动律映射（#873 逐条 → 原语机制，与 A1 同律）：
// 贴底阈值 80px = `scrollEdgeThreshold={80}`（FOLLOW_THRESHOLD 同值）；增长
// 只在读者已贴最新端时拖动 = 原语 autoScroll；开列落最新 = defaultScrollPosition
// "end"（旧 hook 的 bind→scrollToNewest 等价）；读者自己发出去的那条永远跳到
// 最新 = `scrollToEnd()`（旧 requestFollow 等价，消费点住本组件的 imperative
// handle，页面的 onSend 经 ref 调用）。
//
// 列宽/内垫/行距语义逐字保留：Viewport 承接旧 `.chat-col` 的滚动端口身份
// （testid transcript-col + 19/16/16/19 内垫——detail-3pane 的 colPadBottom
// 断言读的就是这里），Content 中和为 block + gap-0（行距留在行自身的 margin
// 上，原语默认 flex gap-6 会双倍行距）。

import { forwardRef, useImperativeHandle, useMemo } from 'react';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from '../components/ui/message-scroller.js';
import type { TranscriptItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ArrowDown } from '../icons/index.js';
import { SpecBlock } from './spec-block.js';
import { type LiveStep, Transcript } from './transcript.js';
import { TurnRail, turnsFromTranscript } from './turn-rail.js';

/** Root 中和：原语 size-full 的 h-full 会顶爆 detail-center 的 flex 链。 */
const ROOT_CLS = 'h-auto min-h-0 flex-1';
/** Viewport = 旧 `.chat-col` 的滚动端口（testid 与内垫逐字随迁）。 */
const VIEWPORT_CLS = 'chat-col pt-[19px] pr-4 pb-4 pl-[19px]';
/** Content 的 block + gap-0：行距语义保持在行自身的 margin 上。 */
const CONTENT_CLS = 'block gap-0';

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
        scrollEdgeThreshold={80}
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
  const turns = useMemo(() => turnsFromTranscript(transcript), [transcript]);
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
      {/* #991 Q6：jump-to-latest 随原语带入（删除才是定制；原型实审过目）。
          落位/显隐动效 = 原语默认（底缘居中、近底自动退场）。 */}
      <MessageScrollerButton direction="end">
        <ArrowDown width={16} height={16} />
        <span className="sr-only">{t('滚动到最新')}</span>
      </MessageScrollerButton>
      <TurnRail turns={turns} />
    </MessageScroller>
  );
}
