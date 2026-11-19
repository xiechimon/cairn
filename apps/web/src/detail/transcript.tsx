import type { StepPromptOrigin } from '@cairn/shared';
import { CircleAlert } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { CoordinatorFixLinks } from '../chief/chief-message-rows.js';
import { MessageToolbar } from '../chief/message-toolbar.js';
import { TranscriptReportCard } from '../chief/research-report.js';
import { ThinkingRow } from '../components/chat/agent-rows.js';
import { liveTokensLabel, TaskBlockedRow, TaskLiveRow } from '../components/chat/live-row.js';
import { StatusLine } from '../components/chat/status-line.js';
import { UserMessageBubble } from '../components/chat/user-message-bubble.js';
import { Button } from '../components/ui/button.js';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/ui/collapsible.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Marker, MarkerContent, MarkerIcon } from '../components/ui/marker.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import type { RobotPara, TranscriptItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { Clock } from '../icons/index.js';
import { inlineSegments } from '../lib/markdown.js';
import { ChatMarkdown, REPLY_BLOCK_CLS, TaskCard } from './chat-markdown.js';
import { failFactsText } from './fail-facts.js';
import { Segments } from './segments.js';
import { WorkTrace } from './work-trace.js';

interface TranscriptProps {
  transcript: TranscriptItem[];
  result?: ReactNode;
}

const ROW_BASE = 'flex items-start';
const AGENT_ROW = 'chat-row--agent group/message flex flex-col items-start';
const USER_ROW = 'chat-row--user group/message flex flex-col items-end';
const TOOLS_ROW =
  '-ml-4 -mr-[calc(1rem-var(--scrollbar-gutter,0px))] overflow-x-clip pl-4 pr-[calc(1rem-var(--scrollbar-gutter,0px))]';

const SCROLLER_ITEM_STYLE = { contentVisibility: 'visible' } as const;

function endsWithAgentRow(item: TranscriptItem | undefined): boolean {
  if (item == null) return false;
  if (item.kind === 'streaming') return true;
  return item.kind === 'robot' && item.footer == null;
}

function rowMargin(item: TranscriptItem, prev: TranscriptItem | undefined): string {
  if (prev?.kind === 'note') return 'mt-1.5';
  switch (item.kind) {
    case 'robot':
    case 'fail':
    case 'streaming':
    case 'review':
    case 'verify':
    case 'report':
      return endsWithAgentRow(prev) ? 'mt-1' : 'mt-5';
    case 'chief':
      return 'mt-1';
    case 'user':
      return prev?.kind === 'user' ? 'mt-1' : 'mt-5';
    default:
      return prev?.kind === 'step-prompt' ? 'mt-1.5' : '';
  }
}

const PARA = 'chat-para m-0';
const PARA_GAP = 'mt-2';
const FINDING_SEVERITY_LABEL = {
  blocking: '必须修改',
  suggestion: '可改进',
  info: '备注',
} as const;

function RowTools({
  placement,
  copy,
  stamp,
}: {
  placement: 'right' | 'left' | 'below-start' | 'below-end';
  copy: string;
  stamp?: string | undefined;
}) {
  return (
    <MessageToolbar
      placement={placement}
      testId={placement === 'right' || placement === 'left' ? 'msg-tools' : 'msg-tools-touch'}
      stamp={
        stamp == null ? null : (
          <span className="text-caption whitespace-nowrap tabular-nums" data-testid="msg-stamp">
            {stamp}
          </span>
        )
      }
      onCopy={() => {
        void navigator.clipboard.writeText(copy);
      }}
    />
  );
}

function Para({ para, gap = false }: { para: RobotPara; gap?: boolean }) {
  const quoteSkin =
    'border-l-4 border-(--border) bg-(--muted) pt-1.5 pr-2 pb-1.5 pl-4 [background-clip:content-box] text-foreground';
  if (para.quote === true) {
    return (
      <p className={`${PARA} ${quoteSkin}${gap ? ` ${PARA_GAP}` : ''}`}>
        <Segments segments={para.segments} codeClassName="chat-code" />
      </p>
    );
  }
  if (para.ordinal != null) {
    return (
      <p
        className={`${PARA} relative pl-5${gap ? ` ${PARA_GAP}` : ''}`}
        data-ordinal={para.ordinal}
      >
        <span className="absolute left-0">{para.ordinal}.</span>
        <Segments segments={para.segments} codeClassName="chat-code" />
      </p>
    );
  }
  return (
    <p className={`${PARA}${gap ? ` ${PARA_GAP}` : ''}`}>
      <Segments segments={para.segments} codeClassName="chat-code" />
    </p>
  );
}

function Row({
  item,
  prev,
  t,
  defaultExpanded,
  entering,
  enteringUser,
}: {
  item: TranscriptItem;
  prev: TranscriptItem | undefined;
  t: TFunc;
  defaultExpanded: boolean;
  entering: Set<string>;
  enteringUser: string | null;
}) {
  const margin = rowMargin(item, prev);
  switch (item.kind) {
    case 'run':
      return (
        <div
          data-testid="transcript-time-divider"
          className="mt-5 w-full text-meta text-(--text-tertiary)"
        >
          {[item.at, item.machine != null ? t('运行在 {m} 上', { m: item.machine }) : null]
            .filter((part) => part != null)
            .join(' · ')}
          {item.cancelled === true && (
            <span className="chat-stamp-cancelled text-(--fail-fg)">
              {item.at != null || item.machine != null ? ' · ' : ''}
              {t('已取消')}
            </span>
          )}
        </div>
      );
    case 'question':
      return (
        <div
          data-testid="transcript-question"
          className="mt-5 agent-measure flex flex-col gap-2 py-2 text-ui"
        >
          {item.questions.map((q) => (
            <div key={q.header} className="flex flex-col gap-1">
              <div className="text-meta text-(--text-tertiary)">{q.header}</div>
              <div className="text-foreground">{q.question}</div>
              {q.options.length > 0 && (
                <ul
                  className="m-0 flex list-none flex-wrap gap-1.5 p-0"
                  data-slot="question-options"
                >
                  {q.options.map((o) => (
                    <li
                      key={o.label}
                      title={o.description}
                      className="rounded-(--radius-control) bg-(--menu-hover) px-2 py-0.5 text-meta text-foreground"
                    >
                      {o.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <div className="text-meta text-(--text-tertiary)">
            {item.status === 'pending'
              ? t('等待你的回复')
              : item.status === 'answered'
                ? t('已回答')
                : t('已取消')}
          </div>
        </div>
      );
    case 'note':
      return (
        <StatusLine className="mt-5" testId="transcript-note">
          {t(item.text, item.vars)}
        </StatusLine>
      );
    case 'step-prompt':
      return <StepPromptRow item={item} t={t} />;
    case 'scheduled':
      return (
        <div
          data-testid="schedule-wake-marker"
          className="mt-5 flex items-center gap-1.5 text-meta text-(--text-tertiary)"
        >
          <Clock width={13} height={13} />
          {t('由定时发起')}
        </div>
      );
    case 'scheduled-turn':
      return (
        <Collapsible className="mt-5" defaultOpen={false} data-testid="scheduled-turn">
          <CollapsibleTrigger
            render={<Button variant="ghost" className="text-meta text-(--text-secondary)" />}
          >
            <Clock width={13} height={13} />
            {t('由定时发起')}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Transcript transcript={item.items} />
          </CollapsibleContent>
        </Collapsible>
      );
    case 'automation-completed':
      return (
        <div className="mt-5 text-meta text-(--text-tertiary)" data-testid="automation-completed">
          {t('完成')}
        </div>
      );
    case 'chief':
      return (
        <div className={`${ROW_BASE} ${margin}`}>
          <StatusLine className="w-full">{t('由 Coordinator 发起')}</StatusLine>
        </div>
      );
    case 'user': {
      const copy = item.markdown ?? item.text;
      return (
        <div
          className={`${USER_ROW} ${TOOLS_ROW} ${margin} ${item.id != null && item.id === enteringUser ? 'message-enter' : ''}`}
          data-tools-root=""
        >
          <div
            className="group/reply-block relative max-w-[min(85%,42rem)]"
            data-slot="reply-block"
          >
            <UserMessageBubble
              className={`chat-bubble w-fit max-w-full break-words ${
                item.markdown != null
                  ? 'whitespace-normal [&>:first-child]:mt-0 [&>:last-child]:mb-0'
                  : 'whitespace-pre-wrap'
              }`}
              data-testid="user-bubble"
              {...(item.markdown != null ? { 'data-md': 'true' } : {})}
            >
              {item.markdown != null ? <ChatMarkdown text={item.markdown} /> : item.text}
            </UserMessageBubble>
            <RowTools placement="left" copy={copy} stamp={item.at} />
          </div>
          <RowTools placement="below-end" copy={copy} stamp={item.at} />
        </div>
      );
    }
    case 'robot': {
      const copy = robotCopyText(item);
      return (
        <div className={`${AGENT_ROW} ${TOOLS_ROW} ${margin}`} data-row="agent" data-tools-root="">
          <div className="group/reply-block relative w-fit max-w-full" data-slot="reply-block">
            <div
              className="chat-text agent-measure min-w-0 font-sans text-ui leading-5.5 break-words text-(--foreground)"
              data-testid="agent-text"
            >
              {item.markdown != null ? (
                <ChatMarkdown text={item.markdown} />
              ) : (
                (item.paragraphs ?? []).map((raw, i) => (
                  <Para key={i} para={Array.isArray(raw) ? { segments: raw } : raw} gap={i > 0} />
                ))
              )}
            </div>
            <RowTools placement="right" copy={copy} />
          </div>
          <RowTools placement="below-start" copy={copy} />
        </div>
      );
    }
    case 'report':
      return (
        <div className={`${AGENT_ROW} ${margin}`} data-row="agent" data-testid="info-report">
          <TranscriptReportCard content={item.markdown} createdAt={item.createdAt} />
        </div>
      );
    case 'thinking':
      return (
        <div className={`${AGENT_ROW} ${margin}`} data-row="agent">
          <span className="chat-text -mt-px agent-measure min-w-0 text-ui leading-5.5 break-words text-(--foreground)">
            <ThinkingRow text={item.text} />
          </span>
        </div>
      );
    case 'agent-todo':
      return (
        <div className="mt-3.5 agent-measure" data-testid="agent-todo">
          <TaskCard
            items={item.items.map((it) => ({
              state: it.state,
              segments: inlineSegments(it.text),
              blocks: [],
            }))}
          />
        </div>
      );
    case 'fail':
      return <FailRow item={item} margin={margin} t={t} />;
    case 'streaming':
      return (
        <div className={`${AGENT_ROW} ${margin} [&>*]:max-w-full`} data-row="agent">
          {item.blocked === true ? (
            <TaskBlockedRow
              text={t(item.label, item.labelVars)}
              actions={<CoordinatorFixLinks kind={item.blockedKind} />}
            />
          ) : (
            <TaskLiveRow
              testId="live-row"
              label={t(item.label, item.labelVars)}
              seconds={item.seconds}
              startedAt={item.startedAt}
              {...(item.outputTokens !== undefined
                ? { tokens: liveTokensLabel(item.outputTokens, t) }
                : {})}
            />
          )}
        </div>
      );
    case 'work':
      return <WorkTrace item={item} defaultExpanded={defaultExpanded} entering={entering} t={t} />;
    case 'skills':
      return (
        <StatusLine className="mt-5" testId="skills-summary">
          {[
            ...(item.read.length > 0 ? [t('技能：{n}', { n: item.read.join(', ') })] : []),
            ...(item.denied.length > 0 ? [t('挡下：{n}', { n: item.denied.join(', ') })] : []),
          ].join(' · ')}
        </StatusLine>
      );
    case 'review':
      return (
        <div className={`${AGENT_ROW} ${TOOLS_ROW} ${margin}`} data-row="agent" data-tools-root="">
          <div className="group/reply-block relative w-fit max-w-full" data-slot="reply-block">
            <div
              className="chat-text agent-measure min-w-0 text-ui leading-5.5 break-words text-(--foreground)"
              data-testid="agent-text"
            >
              <p className={`${PARA} mb-1.5 flex items-baseline gap-2`}>
                <span
                  className={`chat-review-tag flex-shrink-0 font-semibold ${
                    item.extractionError !== undefined
                      ? 'chat-review-tag--error text-destructive'
                      : 'text-content-secondary'
                  }`}
                >
                  {t(item.extractionError !== undefined ? '判定提取失败' : '审核结论')}
                </span>
                <Segments
                  segments={inlineSegments(item.extractionError ?? item.conclusion)}
                  codeClassName="chat-code"
                />
              </p>
              {item.findings.map((f) => (
                <div key={f.id} className="chat-review-finding mt-3 pl-5">
                  <p className={`${PARA} relative`} data-ordinal={Number.parseInt(f.id, 10) || 0}>
                    <span className="absolute -left-5">{f.id}.</span>
                    <span
                      className={`mr-1.5 font-semibold ${
                        f.severity === 'blocking' ? 'text-destructive' : 'text-content-secondary'
                      }`}
                    >
                      {t(FINDING_SEVERITY_LABEL[f.severity])}
                    </span>
                    <Segments segments={inlineSegments(f.summary)} codeClassName="chat-code" />
                  </p>
                  {f.description !== undefined && f.description !== '' && (
                    <p className={`${PARA} mt-1`}>
                      <Segments
                        segments={inlineSegments(f.description)}
                        codeClassName="chat-code"
                      />
                    </p>
                  )}
                  {(f.file !== undefined || f.line !== undefined) && (
                    <p className={`${PARA} mt-1 text-meta text-content-secondary`}>
                      <Segments
                        segments={inlineSegments(
                          `\`${f.file ?? ''}${f.line !== undefined ? `:${f.line}` : ''}\``,
                        )}
                        codeClassName="chat-code"
                      />
                    </p>
                  )}
                  {f.suggestion !== undefined && f.suggestion !== '' && (
                    <p className={`${PARA} mt-1 text-content-secondary`}>
                      <Segments
                        segments={inlineSegments(t('建议：{body}', { body: f.suggestion }))}
                        codeClassName="chat-code"
                      />
                    </p>
                  )}
                </div>
              ))}
            </div>
            <RowTools placement="right" copy={reviewCopyText(item)} />
          </div>
          <RowTools placement="below-start" copy={reviewCopyText(item)} />
        </div>
      );
    case 'verify':
      return (
        <div className={`${AGENT_ROW} ${TOOLS_ROW} ${margin}`} data-row="agent" data-tools-root="">
          <div className="group/reply-block relative w-fit max-w-full" data-slot="reply-block">
            <div
              className="chat-text agent-measure min-w-0 text-ui leading-5.5 break-words text-(--foreground)"
              data-testid="agent-text"
            >
              <p className={`${PARA} mb-1.5 flex items-baseline gap-2`}>
                <span
                  className={`chat-review-tag flex-shrink-0 font-semibold ${
                    item.passed && item.extractionError === undefined
                      ? 'text-content-secondary'
                      : 'text-destructive'
                  }`}
                >
                  {t(
                    item.extractionError !== undefined
                      ? '判定提取失败'
                      : item.passed
                        ? '验证通过'
                        : '验证未通过',
                  )}
                </span>
                <Segments
                  segments={inlineSegments(item.extractionError ?? item.conclusion)}
                  codeClassName="chat-code"
                />
              </p>
              {item.evidence.map((e) => (
                <p
                  key={e.path}
                  className={`${PARA} mt-1 text-meta text-content-secondary`}
                  data-testid="verify-evidence"
                >
                  <Segments
                    segments={inlineSegments(
                      e.note !== undefined ? `\`${e.path}\` ${e.note}` : `\`${e.path}\``,
                    )}
                    codeClassName="chat-code"
                  />
                </p>
              ))}
            </div>
            <RowTools placement="right" copy={verifyCopyText(item)} />
          </div>
          <RowTools placement="below-start" copy={verifyCopyText(item)} />
        </div>
      );
  }
}

function FailRow({
  item,
  margin,
  t,
}: {
  item: Extract<TranscriptItem, { kind: 'fail' }>;
  margin: string;
  t: TFunc;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  const title =
    item.facts === undefined ? item.title : t('本步异常结束：{reason}', { reason: item.title });
  const facts = failFactsText(item.facts, t);
  const copy = [title, item.body === '' ? '' : t(item.body), facts]
    .filter((part) => part !== '')
    .join('\n');
  return (
    <div className={`${AGENT_ROW} ${TOOLS_ROW} ${margin}`} data-row="agent" data-tools-root="">
      <div className={REPLY_BLOCK_CLS} data-slot="reply-block">
        <span
          className="chat-text -mt-px agent-measure min-w-0 text-ui leading-5.5 break-words text-(--foreground)"
          data-testid="agent-text"
        >
          <Marker
            role="alert"
            className="items-start gap-2 text-ui leading-5.5 text-(--foreground)"
          >
            <MarkerIcon className="flex h-lh items-center text-(--fail-fg)">
              <CircleAlert />
            </MarkerIcon>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <MarkerContent className="chat-para--fail text-(--fail-fg)">{title}</MarkerContent>
              {item.body !== '' && <span className="text-foreground">{t(item.body)}</span>}
              {item.title !== '' && (
                <span className="flex flex-wrap items-center gap-x-3 text-meta text-content-secondary">
                  {facts !== '' && <span>{facts}</span>}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-0 text-meta font-normal text-content-secondary pointer-coarse:h-11"
                    onClick={() => setRawOpen(true)}
                  >
                    {t('查看原始错误')}
                  </Button>
                </span>
              )}
            </span>
          </Marker>
        </span>
        <RowTools placement="right" copy={copy} />
      </div>
      <RowTools placement="below-start" copy={copy} />
      <RawTextDialog
        title={t('原始错误')}
        text={item.raw ?? item.title}
        open={rawOpen}
        onClose={() => setRawOpen(false)}
        testId="fail-raw-error"
      />
    </div>
  );
}

function RawTextDialog({
  title,
  text,
  open,
  onClose,
  testId,
}: {
  title: string;
  text: string;
  open: boolean;
  onClose: () => void;
  testId: string;
}) {
  return (
    <DialogShell title={title} open={open} onClose={onClose} size="l">
      <pre
        className="m-0 rounded-(--cds-radius-sm) border border-(--border) bg-(--muted) px-2.5 py-2 text-left font-mono text-code break-words whitespace-pre-wrap text-(--foreground) [word-break:break-word]"
        data-testid={testId}
      >
        {text}
      </pre>
    </DialogShell>
  );
}

function stepPromptLine(origin: StepPromptOrigin, t: TFunc): string {
  switch (origin.kind) {
    case 'ci-fix': {
      const vars = { round: origin.round, max: origin.roundsMax };
      return origin.trigger === 'pre-push'
        ? t('CI 修复第 {round}/{max} 轮：推送前检查未通过', vars)
        : t('CI 修复第 {round}/{max} 轮：CI 检查未通过', vars);
    }
    case 'merge-conflict':
      return t('解冲突第 {round}/{max} 轮：PR 与默认分支冲突', {
        round: origin.round,
        max: origin.roundsMax,
      });
    case 'rework':
      return t('按反馈返工，继续本会话');
  }
}

function StepPromptRow({
  item,
  t,
}: {
  item: Extract<TranscriptItem, { kind: 'step-prompt' }>;
  t: TFunc;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  const log = item.origin.kind === 'ci-fix';
  return (
    <StatusLine className="mt-5" testId="transcript-step-prompt">
      {stepPromptLine(item.origin, t)}
      <Button
        variant="ghost"
        className="ml-2 h-6 cursor-pointer rounded-none border-none bg-transparent p-0 align-baseline text-meta font-normal text-(--text-tertiary) hover:bg-transparent hover:text-(--foreground) dark:hover:bg-transparent dark:hover:text-(--foreground)"
        onClick={() => setRawOpen(true)}
      >
        {log ? t('查看原始日志') : t('查看完整指令')}
      </Button>
      <RawTextDialog
        title={log ? t('原始日志') : t('完整指令')}
        text={item.raw}
        open={rawOpen}
        onClose={() => setRawOpen(false)}
        testId="step-prompt-raw"
      />
    </StatusLine>
  );
}

function robotCopyText(item: Extract<TranscriptItem, { kind: 'robot' }>): string {
  if (item.markdown != null) return item.markdown;
  return (item.paragraphs ?? [])
    .map((raw) => (Array.isArray(raw) ? raw : raw.segments).map((seg) => seg.text).join(''))
    .join('\n\n');
}

function reviewCopyText(item: Extract<TranscriptItem, { kind: 'review' }>): string {
  return [
    item.extractionError ?? item.conclusion,
    ...item.findings.map((f) => `${f.id}. (${f.severity}) ${f.summary}`),
  ].join('\n');
}

function verifyCopyText(item: Extract<TranscriptItem, { kind: 'verify' }>): string {
  return [
    item.extractionError ?? `${item.passed ? 'PASS' : 'FAIL'} ${item.conclusion}`,
    ...item.evidence.map((e) => (e.note !== undefined ? `${e.path} — ${e.note}` : e.path)),
  ].join('\n');
}

export function Transcript({ transcript, result }: TranscriptProps) {
  const { t } = useI18n();
  const previous = useRef<{ live: boolean; ids: Set<string> }>({ live: false, ids: new Set() });
  const live = transcript.some(
    (item) => item.kind === 'streaming' || (item.kind === 'work' && item.running === true),
  );
  const workItems = transcript.filter((item) => item.kind === 'work');
  const entering = new Set<string>();
  const ids = new Set<string>();
  for (const item of workItems) {
    for (const step of item.steps) {
      ids.add(step.id);
      if (
        live &&
        previous.current.live &&
        previous.current.ids.size > 0 &&
        !previous.current.ids.has(step.id)
      )
        entering.add(step.id);
    }
  }
  useEffect(() => {
    previous.current = { live, ids };
  });
  const lastUserId =
    transcript
      .flatMap((item) => (item.kind === 'user' && item.id != null ? [item.id] : []))
      .at(-1) ?? null;
  const shownBefore = useRef({ lastUserId, rows: transcript.length });
  const [enteringUser, setEnteringUser] = useState<string | null>(null);
  useEffect(() => {
    const before = shownBefore.current;
    shownBefore.current = { lastUserId, rows: transcript.length };
    if (before.lastUserId !== lastUserId && before.rows > 0) setEnteringUser(lastUserId);
  }, [lastUserId, transcript.length]);
  const tailItem = transcript.at(-1);
  const hasLiveTail =
    tailItem?.kind === 'streaming' || (tailItem?.kind === 'work' && tailItem.running === true);
  const resultAt = hasLiveTail ? transcript.length - 1 : transcript.length;
  const rows = transcript.map((item, index) => {
    const id =
      ('id' in item ? item.id : undefined) ?? (item.kind === 'user' ? `user-${index}` : undefined);
    return (
      <MessageScrollerItem key={id ?? index} messageId={id} style={SCROLLER_ITEM_STYLE}>
        <Row
          item={item}
          prev={transcript[index - 1]}
          t={t}
          defaultExpanded={item.kind === 'work' && item.expanded === true}
          entering={entering}
          enteringUser={enteringUser}
        />
      </MessageScrollerItem>
    );
  });

  return (
    <>
      {rows.slice(0, resultAt)}
      {result != null && (
        <MessageScrollerItem key="transcript-result" style={SCROLLER_ITEM_STYLE}>
          {result}
        </MessageScrollerItem>
      )}
      {rows.slice(resultAt)}
    </>
  );
}
