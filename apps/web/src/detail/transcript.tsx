import { useEffect, useRef, useState } from 'react';
import { inlineSegments } from '../api/mappers.js';
import { ThinkingRow } from '../components/chat/agent-rows.js';
import { LiveRow, LiveSignal } from '../components/chat/live-row.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import type { RobotPara, TranscriptItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { Clock, Copy, ExternalLink, FileTab } from '../icons/index.js';
import { ChatMarkdown, TaskCard } from './chat-markdown.js';
import { Segments } from './segments.js';
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
    case 'report':
      return endsWithAgentRow(prev) ? 'mt-3' : 'mt-5';
    case 'chief':
      return 'mt-1';
    case 'user':
      return 'mt-4';
    default:
      return '';
  }
}

const PARA = 'chat-para m-0';
const PARA_GAP = 'mt-2';

function ActionRow({
  seconds,
  bare,
  copy,
  t,
  align = 'start',
}: {
  seconds?: number;
  bare?: boolean;
  copy?: string;
  t: TFunc;
  align?: 'start' | 'end';
}) {
  const tail = (
    <>
      {(seconds != null || bare === true) && (
        <span className="border-l border-(--input) pl-2 text-meta whitespace-nowrap text-(--text-tertiary)">
          {seconds != null ? formatElapsed(seconds, t) : t('完成')}
        </span>
      )}
    </>
  );
  return (
    <div
      className={`chat-row-icons mt-5 flex items-center gap-3.5 text-(--text-tertiary) ${align === 'end' ? 'justify-end' : 'pl-8'}`}
      data-testid="msg-actions"
    >
      {copy != null && (
        <Button
          variant="ghost"
          className="chat-copy h-auto justify-start rounded-none border-none bg-transparent p-0 hover:bg-transparent hover:text-inherit dark:hover:bg-transparent dark:hover:text-inherit active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
          aria-label={t('复制')}
          onClick={() => {
            void navigator.clipboard.writeText(copy);
          }}
        >
          <Copy width={13} height={13} />
        </Button>
      )}
      {tail}
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

function AgentRowAvatar({
  agent,
  busy = false,
}: {
  agent: { displayName: string; avatarUrl: string | null } | null;
  busy?: boolean;
}) {
  return (
    <span
      className="chat-avatar -mt-1 flex-none size-5 [&_img]:block [&_img]:size-5"
      data-testid="msg-avatar"
    >
      <SeededAvatar
        className="size-5"
        name={agent?.displayName}
        src={agent?.avatarUrl}
        fallback="/avatar-robot-1.svg"
        busy={busy}
      />
    </span>
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
        <div className="flex-none text-center text-meta text-(--text-tertiary)">
          {item.at != null && <div>{item.at}</div>}
          {item.machine != null && (
            <div className="mt-1 text-caption leading-3 text-(--text-tertiary) [&_span]:underline">
              {t('运行在 {m} 上', { m: item.machine ?? '' })
                .split(item.machine ?? '')
                .map((part, i) =>
                  i === 0 ? (
                    <span key={i}>
                      {part}
                      <span>{item.machine}</span>
                    </span>
                  ) : (
                    <span key={i}>{part}</span>
                  ),
                )}
            </div>
          )}
          {item.cancelled === true && (
            <div className="chat-stamp-cancelled mt-1 text-caption leading-3 text-(--fail-fg)">
              {t('已取消')}
            </div>
          )}
        </div>
      );
    case 'note':
      return (
        <div
          className="chat-note mx-auto mt-5 max-w-[68ch] text-center text-meta text-(--text-tertiary)"
          data-testid="transcript-note"
        >
          {t(item.text)}
        </div>
      );
    case 'scheduled':
      return (
        <div className="chat-scheduled mt-3.5 flex items-center gap-1.5 text-meta text-(--text-tertiary)">
          <Clock width={13} height={13} />
          {t('由定时发起')}
        </div>
      );
    case 'injected-skills':
      return <InjectedSkills skills={item.skills} t={t} />;
    case 'chief':
      return (
        <div className={`${ROW_BASE} chat-row--chief ${margin}`}>
          <span
            className="chat-avatar flex-none size-5 [&_img]:block [&_img]:size-5"
            data-testid="msg-avatar"
          >
            <img src="/avatar-robot-2.svg" alt="" />
          </span>
          <span className="ml-3 text-meta text-(--text-tertiary)">{t('由总管发起')}</span>
        </div>
      );
    case 'user':
      return (
        <>
          <div className={`${ROW_BASE} chat-row--user justify-end ${margin}`}>
            <span
              className={`chat-bubble anim-message-fade-up mt-1 min-h-6 min-w-0 max-w-[min(80%,56ch)] rounded-(--radius-bubble) rounded-br-(--cds-radius-md) bg-(--secondary) px-3.5 py-1 text-card-title leading-6 break-words text-(--foreground) ${
                item.markdown != null
                  ? 'whitespace-normal [&>:first-child]:mt-0 [&>:last-child]:mb-0'
                  : 'whitespace-pre-wrap'
              }`}
              data-testid="user-bubble"
              {...(item.markdown != null ? { 'data-md': 'true' } : {})}
            >
              {item.markdown != null ? <ChatMarkdown text={item.markdown} /> : item.text}
            </span>
          </div>
          {item.seq != null && item.title != null && (
            <div className="mt-1.5 flex items-center justify-end" data-testid="taskline">
              <span className="flex h-5 flex-none items-center rounded-(--cds-radius-sm) bg-(--muted) px-2 text-caption text-(--text-secondary)">
                #{item.seq}
              </span>
              <span className="ml-1 min-w-0 break-words text-card-title leading-5 font-medium text-(--foreground)">
                {item.title}
              </span>
            </div>
          )}
          <ActionRow copy={item.markdown ?? item.text} t={t} align="end" />
        </>
      );
    case 'robot':
      return (
        <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
          <AgentRowAvatar agent={agent} />
          <span
            className="chat-text -mt-px ml-3 max-w-[68ch] min-w-0 text-card-title leading-[1.6] break-words text-(--foreground)"
            data-testid="agent-text"
          >
            {item.markdown != null ? (
              <ChatMarkdown text={item.markdown} />
            ) : (
              (item.paragraphs ?? []).map((raw, i) => (
                <Para key={i} para={Array.isArray(raw) ? { segments: raw } : raw} gap={i > 0} />
              ))
            )}
          </span>
          {item.footer != null && (
            <ActionRow seconds={item.footer.seconds} copy={robotCopyText(item)} t={t} />
          )}
        </div>
      );
    case 'report':
      return (
        <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
          <AgentRowAvatar agent={agent} />
          <span
            className="chat-text -mt-px ml-3 max-w-[68ch] min-w-0 text-card-title leading-[1.6] break-words text-(--foreground)"
            data-testid="info-report"
          >
            <ChatMarkdown text={item.markdown} />
          </span>
        </div>
      );
    case 'thinking':
      return (
        <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
          <AgentRowAvatar agent={agent} />
          <span className="chat-text -mt-px ml-3 max-w-[68ch] min-w-0 text-card-title leading-[1.6] break-words text-(--foreground)">
            <ThinkingRow text={item.text} />
          </span>
        </div>
      );
    case 'agent-todo':
      return (
        <div className="mt-3.5 max-w-[68ch] pl-8" data-testid="agent-todo">
          <TaskCard
            items={item.items.map((it) => ({
              state: it.state,
              segments: inlineSegments(it.text),
            }))}
          />
        </div>
      );
    case 'fail':
      return <FailRow item={item} margin={margin} t={t} agent={agent} />;
    case 'streaming':
      return (
        <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
          <AgentRowAvatar agent={agent} busy />
          <LiveRow
            variant="detail"
            label={item.label}
            labelVars={item.labelVars}
            startedAt={item.startedAt}
            seconds={item.seconds}
            disclosure={
              liveStep != null ? { expand: '展开实时步骤', collapse: '收起实时步骤' } : null
            }
          >
            {liveStep != null && (
              <div className="mt-1 flex flex-col gap-0.5 pl-8 text-meta text-(--text-tertiary)">
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
                      : t('▶ skill: {n}', { n: s.name })}
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
          <div className="chat-plan mt-3.5 flex items-center pl-8 text-meta text-(--text-secondary) [&_svg]:text-(--text-tertiary)">
            <FileTab width={14} height={14} />
            <span className="chat-plan-title ml-1.5">{item.title}</span>
            {onOpenPlan != null ? (
              <Button
                variant="ghost"
                className="ml-auto mr-1.5 flex h-auto cursor-pointer justify-start rounded-none border-none bg-transparent p-0 text-[length:inherit] leading-[inherit] font-normal text-(--text-tertiary) hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent dark:hover:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
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
          <div className="chat-preview mt-2 max-h-10 flex-none overflow-hidden pl-8 pr-6 text-meta leading-5 text-(--text-tertiary) [mask-image:linear-gradient(to_bottom,black_50%,transparent)]">
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
        <div
          className="chat-note mx-auto mt-5 flex max-w-[68ch] flex-wrap items-baseline justify-center gap-x-1.5 text-center text-meta text-(--text-tertiary)"
          data-testid="skills-summary"
        >
          {item.read.length > 0 && <span>{t('技能：{n}', { n: item.read.join(', ') })}</span>}
          {item.read.length > 0 && item.denied.length > 0 && <span aria-hidden="true">·</span>}
          {item.denied.length > 0 && <span>{t('挡下：{n}', { n: item.denied.join(', ') })}</span>}
        </div>
      );
    case 'elapsed':
      return <ActionRow seconds={item.seconds} t={t} />;
    case 'review':
      return (
        <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
          <AgentRowAvatar agent={agent} />
          <span
            className="chat-text -mt-px ml-3 max-w-[68ch] min-w-0 text-card-title leading-[1.6] break-words text-(--foreground)"
            data-testid="agent-text"
          >
            <p className={`${PARA} mb-1.5 flex items-baseline gap-2`}>
              <span
                className={`chat-review-tag flex-shrink-0 rounded-(--cds-radius-sm) bg-(--chip-plan-bg) px-1.5 py-px text-caption leading-[1.5] font-semibold text-(--chip-plan-fg)${
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
          </span>
          <ActionRow copy={reviewCopyText(item)} t={t} />
        </div>
      );
    case 'verify':
      return (
        <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
          <AgentRowAvatar agent={agent} />
          <span
            className="chat-text -mt-px ml-3 max-w-[68ch] min-w-0 text-card-title leading-[1.6] break-words text-(--foreground)"
            data-testid="agent-text"
          >
            <p className={`${PARA} mb-1.5 flex items-baseline gap-2`}>
              <span
                className={`chat-review-tag flex-shrink-0 rounded-(--cds-radius-sm) px-1.5 py-px text-caption leading-[1.5] font-semibold ${
                  item.extractionError !== undefined
                    ? 'bg-(--danger-soft) text-destructive'
                    : item.passed
                      ? 'bg-(--chip-plan-bg) text-(--chip-plan-fg)'
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
          </span>
          <ActionRow copy={verifyCopyText(item)} t={t} />
        </div>
      );
  }
}

function FailRow({
  item,
  margin,
  t,
  agent,
}: {
  item: Extract<TranscriptItem, { kind: 'fail' }>;
  margin: string;
  t: TFunc;
  agent: { displayName: string; avatarUrl: string | null } | null;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  return (
    <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
      <AgentRowAvatar agent={agent} />
      <span
        className="chat-text -mt-px ml-3 max-w-[68ch] min-w-0 text-card-title leading-[1.6] break-words text-(--foreground)"
        data-testid="agent-text"
      >
        <p className={`${PARA} chat-para--fail text-(--fail-fg)`}>{item.title}</p>
        <p className={`${PARA} ${PARA_GAP} text-(--text-tertiary)`}>{t(item.body)}</p>
        {item.title !== '' && (
          <p className={`${PARA} ${PARA_GAP} flex gap-3 text-meta text-(--text-tertiary)`}>
            <Button
              variant="ghost"
              className="h-auto cursor-pointer justify-start rounded-none border-none bg-transparent p-0 text-meta font-normal text-(--text-tertiary) hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent dark:hover:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0"
              onClick={() => setRawOpen(true)}
            >
              {t('查看原始错误')}
            </Button>
          </p>
        )}
      </span>
      <ActionRow copy={[item.title, item.body].join('\n')} t={t} />
      <DialogShell title={t('原始错误')} open={rawOpen} onClose={() => setRawOpen(false)} size="l">
        <pre
          className="m-0 rounded-(--cds-radius-sm) border border-(--border) bg-(--muted) px-2.5 py-2 text-left font-mono text-caption break-words whitespace-pre-wrap text-(--foreground) [word-break:break-word]"
          data-testid="fail-raw-error"
        >
          {item.title}
        </pre>
      </DialogShell>
    </div>
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
  const lastWork = workItems.at(-1);

  return (
    <>
      {transcript.map((item, i) => {
        const id = 'id' in item ? item.id : undefined;
        return (
          <MessageScrollerItem key={id ?? i} messageId={id} style={SCROLLER_ITEM_STYLE}>
            <Row
              item={item}
              prev={transcript[i - 1]}
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
