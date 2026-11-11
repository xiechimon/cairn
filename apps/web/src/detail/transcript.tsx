import type { StepPromptOrigin } from '@cairn/shared';
import { useEffect, useRef, useState } from 'react';
import { ThinkingRow } from '../components/chat/agent-rows.js';
import { LiveRow, LiveSignal } from '../components/chat/live-row.js';
import { StatusLine } from '../components/chat/status-line.js';
import { UserMessageBubble } from '../components/chat/user-message-bubble.js';
import { Button } from '../components/ui/button.js';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/ui/collapsible.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import type { RobotPara, TranscriptItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { Clock, Copy, ExternalLink, FileTab } from '../icons/index.js';
import { inlineSegments } from '../lib/markdown.js';
import { ChatMarkdown, REPLY_BUBBLE_CLS, TaskCard } from './chat-markdown.js';
import { Segments } from './segments.js';
import { shouldExpandLastWork } from './work-expansion.js';
import { InjectedSkills, WorkTrace } from './work-trace.js';

export interface LiveStep {
  step: string;
  machine: string | null;
}

interface TranscriptProps {
  transcript: TranscriptItem[];
  liveStep?: LiveStep | null;
  agent?: { displayName: string; avatarUrl: string | null } | null;
  onOpenPlan?: () => void;
}

function formatElapsed(seconds: number, t: TFunc): string {
  const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return t('完成 {elapsed}', { elapsed });
}

const ROW_BASE = 'chat-row flex items-start';
const AGENT_ROW = 'chat-row chat-row--agent flex flex-col items-start';

const SCROLLER_ITEM_STYLE = { contentVisibility: 'visible' } as const;

function prevRunningWork(prev: TranscriptItem | undefined): boolean {
  return prev?.kind === 'work' && prev.steps.some((step) => step.kind === 'call' && step.running);
}

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

function ActionRow({
  seconds,
  bare,
  copy,
  stamp,
  t,
  align = 'start',
  overlay = false,
}: {
  seconds?: number;
  bare?: boolean;
  copy?: string;
  stamp?: string;
  t: TFunc;
  align?: 'start' | 'end';
  overlay?: boolean;
}) {
  return (
    <div
      className={`chat-row-icons flex items-center gap-3.5 text-(--text-tertiary) ${align === 'end' ? 'justify-end' : ''} ${overlay ? 'mt-1 h-0 overflow-visible' : 'mt-1.5'}`}
      data-testid="msg-actions"
    >
      {stamp != null && (
        <span className="text-caption tabular-nums" data-testid="msg-stamp">
          {stamp}
        </span>
      )}
      {(seconds != null || bare === true) && (
        <span className="text-meta whitespace-nowrap text-(--text-tertiary)">
          {seconds != null ? formatElapsed(seconds, t) : t('完成')}
        </span>
      )}
      {copy != null && (
        <Button
          variant="ghost"
          className="chat-copy h-auto justify-start rounded-none border-none bg-transparent p-0 hover:bg-transparent hover:text-inherit dark:hover:bg-transparent dark:hover:text-inherit [&_svg:not([class*='size-'])]:size-auto"
          aria-label={t('复制')}
          onClick={() => {
            void navigator.clipboard.writeText(copy);
          }}
        >
          <Copy width={13} height={13} />
        </Button>
      )}
    </div>
  );
}

function Para({ para, gap = false }: { para: RobotPara; gap?: boolean }) {
  const quoteSkin =
    'border-l-4 border-(--border) bg-(--muted) pt-1.5 pr-2 pb-1.5 pl-4 [background-clip:content-box] text-(--text-secondary)';
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
  onOpenPlan,
  agent,
  liveStep,
  defaultExpanded,
  entering,
}: {
  item: TranscriptItem;
  prev: TranscriptItem | undefined;
  t: TFunc;
  onOpenPlan?: () => void;
  agent: { displayName: string; avatarUrl: string | null } | null;
  liveStep: LiveStep | null;
  defaultExpanded: boolean;
  entering: Set<string>;
}) {
  const margin = rowMargin(item, prev);
  switch (item.kind) {
    case 'run':
      return (
        <div
          data-testid="transcript-time-divider"
          className="mt-5 w-full text-center text-caption text-(--text-tertiary)"
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
          className={`mt-5 flex flex-col gap-2 py-2 text-ui ${REPLY_BUBBLE_CLS}`}
        >
          {item.questions.map((q) => (
            <div key={q.header} className="flex flex-col gap-1">
              <div className="text-meta text-(--text-tertiary)">{q.header}</div>
              <div className="text-foreground">{q.question}</div>
              {q.options.length > 0 && (
                <ul className="list-disc pl-5 text-(--text-secondary)">
                  {q.options.map((o) => (
                    <li key={o.label}>
                      {o.label}
                      {o.description !== undefined && ` — ${o.description}`}
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
        <StatusLine className="mt-5 justify-center text-center" testId="transcript-note">
          {t(item.text)}
        </StatusLine>
      );
    case 'step-prompt':
      return <StepPromptRow item={item} t={t} />;
    case 'scheduled':
      return (
        <div
          data-testid="schedule-wake-marker"
          className="chat-scheduled mt-3.5 flex items-center gap-1.5 text-meta text-(--text-tertiary)"
        >
          <Clock width={13} height={13} />
          {t('由定时发起')}
        </div>
      );
    case 'scheduled-turn':
      return (
        <Collapsible className="mt-3.5" defaultOpen={false} data-testid="scheduled-turn">
          <CollapsibleTrigger
            render={<Button variant="ghost" className="text-meta text-(--text-secondary)" />}
          >
            <Clock width={13} height={13} />
            {t('由定时发起')}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Transcript transcript={item.items} agent={agent} onOpenPlan={onOpenPlan} />
          </CollapsibleContent>
        </Collapsible>
      );
    case 'automation-completed':
      return (
        <div className="mt-3.5 text-meta text-(--text-tertiary)" data-testid="automation-completed">
          {t('完成')}
        </div>
      );
    case 'injected-skills':
      return <InjectedSkills skills={item.skills} t={t} />;
    case 'chief':
      return (
        <div className={`${ROW_BASE} ${margin}`}>
          <StatusLine className="w-full">{t('由 Coordinator 发起')}</StatusLine>
        </div>
      );
    case 'user':
      return (
        <>
          <div className={`${ROW_BASE} chat-row--user justify-end ${margin}`}>
            <UserMessageBubble
              className={`chat-bubble max-w-[min(85%,42rem)] break-words ${
                item.markdown != null
                  ? 'whitespace-normal [&>:first-child]:mt-0 [&>:last-child]:mb-0'
                  : 'whitespace-pre-wrap'
              }`}
              data-testid="user-bubble"
              {...(item.markdown != null ? { 'data-md': 'true' } : {})}
            >
              {item.markdown != null ? <ChatMarkdown text={item.markdown} /> : item.text}
            </UserMessageBubble>
          </div>
          {item.seq != null && item.title != null && (
            <div className="mt-1.5 flex items-center justify-end" data-testid="taskline">
              <span className="flex h-5 flex-none items-center rounded-(--cds-radius-sm) bg-(--muted) px-2 text-caption text-(--text-secondary)">
                #{item.seq}
              </span>
              <span className="ml-1 min-w-0 truncate text-meta leading-5 text-(--text-secondary)">
                {item.title}
              </span>
            </div>
          )}
          <ActionRow copy={item.markdown ?? item.text} stamp={item.at} t={t} align="end" overlay />
        </>
      );
    case 'robot':
      return (
        <>
          <div className={`${AGENT_ROW} ${margin}`} data-row="agent">
            {item.markdown != null ? (
              <div
                className="chat-text min-w-0 max-w-full font-sans text-ui leading-5 break-words text-(--foreground)"
                data-testid="agent-text"
              >
                <ChatMarkdown text={item.markdown} bubbles />
              </div>
            ) : (
              <div
                className={`chat-text min-w-0 font-sans text-ui leading-5 break-words text-(--foreground) ${REPLY_BUBBLE_CLS}`}
                data-slot="reply-bubble"
                data-testid="agent-text"
              >
                {(item.paragraphs ?? []).map((raw, i) => (
                  <Para key={i} para={Array.isArray(raw) ? { segments: raw } : raw} gap={i > 0} />
                ))}
              </div>
            )}
            {item.footer != null && (
              <ActionRow seconds={item.footer.seconds} copy={robotCopyText(item)} t={t} />
            )}
          </div>
          {item.footer?.seconds != null && item.footer.seconds >= 60 && (
            <StatusLine className="mt-3" testId="worked-for-rule">
              {t('已工作 {n} 分钟', { n: Math.floor(item.footer.seconds / 60) })}
            </StatusLine>
          )}
        </>
      );
    case 'report':
      return (
        <div className={`${AGENT_ROW} ${margin}`} data-row="agent">
          <div
            className="chat-text min-w-0 max-w-full font-sans text-ui leading-5 break-words text-(--foreground)"
            data-testid="info-report"
          >
            <ChatMarkdown text={item.markdown} bubbles />
          </div>
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
          <LiveRow
            variant="detail"
            label={item.label}
            labelVars={item.labelVars}
            quiet={prevRunningWork(prev) && liveStep == null}
            disclosure={
              liveStep != null ? { expand: '展开实时步骤', collapse: '收起实时步骤' } : null
            }
          >
            {liveStep != null && (
              <div className="mt-1 flex flex-col gap-0.5 text-meta text-(--text-tertiary)">
                <span className="[overflow-wrap:anywhere]">
                  {t('本步：{n}', { n: liveStep.step })}
                </span>
                {liveStep.machine != null && (
                  <span className="[overflow-wrap:anywhere]">
                    {t('执行机器：{n}', { n: liveStep.machine })}
                  </span>
                )}
                {(item.skills ?? []).map((s) => (
                  <span
                    key={`${s.name}:${s.denied ? 'x' : 'r'}`}
                    className="[overflow-wrap:anywhere]"
                    data-testid="skill-line"
                  >
                    {s.denied
                      ? t('✕ skill: {n}（已挡下）', { n: s.name })
                      : t('skill: {n}', { n: s.name })}
                  </span>
                ))}
                <LiveSignal at={item.signalAt} className="[overflow-wrap:anywhere]" />
              </div>
            )}
          </LiveRow>
        </div>
      );
    case 'plan':
      return (
        <>
          <div className="chat-plan mt-3.5 flex items-center text-meta text-(--text-secondary) [&_svg]:text-(--text-tertiary)">
            <FileTab width={16} height={16} />
            <span className="chat-plan-title ml-1.5">{item.title}</span>
            {onOpenPlan != null ? (
              <Button
                variant="ghost"
                className="ml-auto mr-1.5 flex h-auto cursor-pointer justify-start rounded-none border-none bg-transparent p-0 text-[length:inherit] leading-[inherit] font-normal text-(--text-tertiary) hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent dark:hover:text-(--text-tertiary) [&_svg:not([class*='size-'])]:size-auto"
                aria-label={t('打开方案')}
                onClick={onOpenPlan}
              >
                <ExternalLink width={12} height={12} />
              </Button>
            ) : (
              <span className="ml-auto mr-1.5 flex">
                <ExternalLink width={12} height={12} />
              </span>
            )}
          </div>
          <div className="chat-preview mt-2 max-h-10 flex-none overflow-hidden pr-6 text-meta leading-5 text-(--text-tertiary) [mask-image:linear-gradient(to_bottom,black_50%,transparent)]">
            {item.preview}
          </div>
          <ActionRow
            seconds={item.seconds}
            bare={item.seconds == null}
            copy={`${item.title}\n${item.preview}`}
            t={t}
          />
        </>
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
    case 'elapsed':
      return <ActionRow seconds={item.seconds} t={t} />;
    case 'review':
      return (
        <div className={`${AGENT_ROW} ${margin}`} data-row="agent">
          <div
            className={`chat-text min-w-0 text-ui leading-5 break-words text-(--foreground) ${REPLY_BUBBLE_CLS}`}
            data-slot="reply-bubble"
            data-testid="agent-text"
          >
            <p className={`${PARA} mb-1.5 flex items-baseline gap-2`}>
              <span
                className={`chat-review-tag flex-shrink-0 rounded-(--cds-radius-sm) bg-secondary px-1.5 py-px text-caption leading-[1.5] font-semibold text-content-secondary${
                  item.extractionError !== undefined
                    ? ' chat-review-tag--error bg-(--danger-soft) text-destructive'
                    : ''
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
              <div
                key={f.id}
                className={`chat-review-finding chat-review-finding--${f.severity} mt-1 mb-2 border-l-[3px] pl-2.5 ${
                  f.severity === 'blocking'
                    ? '[border-left-color:var(--destructive)]'
                    : f.severity === 'suggestion'
                      ? '[border-left-color:var(--badge-attention)]'
                      : '[border-left-color:var(--border)]'
                }`}
              >
                <p
                  className={`${PARA} relative pl-5`}
                  data-ordinal={Number.parseInt(f.id, 10) || 0}
                >
                  <span className="absolute left-0">{f.id}.</span>
                  <span
                    className={`ml-1.5 inline-block text-caption font-semibold ${
                      f.severity === 'blocking'
                        ? 'text-destructive'
                        : f.severity === 'suggestion'
                          ? 'text-(--badge-attention)'
                          : 'text-(--text-secondary)'
                    }`}
                  >
                    {t(`(${f.severity})` as '(blocking)' | '(suggestion)' | '(info)')}
                  </span>
                  <Segments segments={inlineSegments(f.summary)} codeClassName="chat-code" />
                </p>
                {f.description !== undefined && f.description !== '' && (
                  <p className={`${PARA} ${PARA_GAP}`}>
                    <Segments segments={inlineSegments(f.description)} codeClassName="chat-code" />
                  </p>
                )}
                {(f.file !== undefined || f.line !== undefined) && (
                  <p
                    className={`${PARA} ${PARA_GAP} border-l-4 border-(--border) bg-(--muted) pt-1.5 pr-2 pb-1.5 pl-4 text-meta [background-clip:content-box] text-(--text-secondary)`}
                  >
                    <Segments
                      segments={inlineSegments(
                        `${f.file ?? ''}${f.line !== undefined ? `:${f.line}` : ''}`,
                      )}
                      codeClassName="chat-code"
                    />
                  </p>
                )}
                {f.suggestion !== undefined && f.suggestion !== '' && (
                  <p
                    className={`${PARA} ${PARA_GAP} border-l-4 border-(--border) bg-(--muted) pt-1.5 pr-2 pb-1.5 pl-4 text-meta [background-clip:content-box] text-(--text-secondary)`}
                  >
                    <Segments
                      segments={inlineSegments(t('建议：{body}', { body: f.suggestion }))}
                      codeClassName="chat-code"
                    />
                  </p>
                )}
              </div>
            ))}
          </div>
          <ActionRow copy={reviewCopyText(item)} t={t} />
        </div>
      );
    case 'verify':
      return (
        <div className={`${AGENT_ROW} ${margin}`} data-row="agent">
          <div
            className={`chat-text min-w-0 text-ui leading-5 break-words text-(--foreground) ${REPLY_BUBBLE_CLS}`}
            data-slot="reply-bubble"
            data-testid="agent-text"
          >
            <p className={`${PARA} mb-1.5 flex items-baseline gap-2`}>
              <span
                className={`chat-review-tag flex-shrink-0 rounded-(--cds-radius-sm) px-1.5 py-px text-caption leading-[1.5] font-semibold ${
                  item.extractionError !== undefined
                    ? 'bg-(--danger-soft) text-destructive'
                    : item.passed
                      ? 'bg-secondary text-content-secondary'
                      : 'bg-(--danger-soft) text-destructive'
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
                className={`${PARA} ${PARA_GAP} border-l-4 border-(--border) bg-(--muted) pt-1.5 pr-2 pb-1.5 pl-4 text-meta [background-clip:content-box] text-(--text-secondary)`}
                data-testid="verify-evidence"
              >
                <Segments
                  segments={inlineSegments(e.note !== undefined ? `${e.path} — ${e.note}` : e.path)}
                  codeClassName="chat-code"
                />
              </p>
            ))}
          </div>
          <ActionRow copy={verifyCopyText(item)} t={t} />
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
  const facts =
    item.facts === undefined
      ? ''
      : [
          item.facts.files !== null ? t('改动 {n} 个文件', { n: item.facts.files }) : null,
          item.facts.commits.length > 0
            ? t('提交 {shas}', { shas: item.facts.commits.join(', ') })
            : null,
          item.facts.pr !== null ? t('PR #{n}', { n: item.facts.pr }) : t('未开 PR'),
        ]
          .filter((part): part is string => part !== null)
          .join(' · ');
  return (
    <div className={`${AGENT_ROW} ${margin}`} data-row="agent">
      <span
        className="chat-text -mt-px agent-measure min-w-0 text-ui leading-5.5 break-words text-(--foreground)"
        data-testid="agent-text"
      >
        <p className={`${PARA} chat-para--fail text-(--fail-fg)`}>{title}</p>
        {item.body !== '' && (
          <p className={`${PARA} ${PARA_GAP} text-(--text-tertiary)`}>{t(item.body)}</p>
        )}
        {item.title !== '' && (
          <p
            className={`${PARA} ${PARA_GAP} flex flex-wrap gap-3 text-meta text-(--text-tertiary)`}
          >
            {facts !== '' && <span>{facts}</span>}
            <Button
              variant="ghost"
              className="h-auto cursor-pointer justify-start rounded-none border-none bg-transparent p-0 text-meta font-normal text-(--text-tertiary) hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent dark:hover:text-(--text-tertiary)"
              onClick={() => setRawOpen(true)}
            >
              {t('查看原始错误')}
            </Button>
          </p>
        )}
      </span>
      <ActionRow
        copy={[title, item.body === '' ? '' : t(item.body), facts]
          .filter((part) => part !== '')
          .join('\n')}
        t={t}
      />
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

export function Transcript({
  transcript,
  agent = null,
  onOpenPlan,
  liveStep = null,
}: TranscriptProps) {
  const { t } = useI18n();
  const previous = useRef<{ live: boolean; ids: Set<string> }>({ live: false, ids: new Set() });
  const live = transcript.some((item) => item.kind === 'streaming');
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
  const lastWork = shouldExpandLastWork(workItems) ? workItems.at(-1) : undefined;

  return (
    <>
      {transcript.map((item, index) => {
        const id = 'id' in item ? item.id : undefined;
        return (
          <MessageScrollerItem key={id ?? index} messageId={id} style={SCROLLER_ITEM_STYLE}>
            <Row
              item={item}
              prev={transcript[index - 1]}
              t={t}
              onOpenPlan={onOpenPlan}
              agent={agent}
              liveStep={liveStep}
              defaultExpanded={item === lastWork}
              entering={entering}
            />
          </MessageScrollerItem>
        );
      })}
    </>
  );
}
