import { cn } from 'cn';
import { createContext, Fragment, type ReactNode, useContext, useRef } from 'react';
import { Link } from 'react-router';
import { OpenFileContext } from '../board/file-pane.js';
import { useThreadHref } from '../board/thread-link.js';
import { MachineName } from '../components/machine-label.js';
import { type GlyphKind, StatusGlyph } from '../components/status-glyph.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import type { DocSegment, Phase } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { mentionChipClass } from '../overlay/mention-chip.js';
import { PHASE_UI } from '../phase.js';
import { AttachmentChip } from './attachment-chip.js';

const CODE_SKIN: Record<string, string> = {
  'chat-code':
    'rounded-(--cds-radius-sm) bg-(--prose-code-fill) px-1 py-px font-prose-mono text-code-inline whitespace-pre-wrap [overflow-wrap:anywhere]',
  'doc-code': 'mx-0.5 rounded-(--cds-radius-sm) bg-(--muted) px-1 py-px font-mono text-code',
};
const ANCHOR_SKIN =
  'text-inherit underline decoration-current/40 underline-offset-3 hover:decoration-current';
const CHAT_ANCHOR_SKIN =
  'text-(--chat-link) underline decoration-(--chat-link)/40 underline-offset-3 hover:decoration-(--chat-link)';
const CODE_LINK_SKIN = 'bg-secondary text-content-secondary';

interface SegmentsProps {
  segments: DocSegment[];
  codeClassName: string;
}

function mentionHref(seg: DocSegment, threadHref: (id: string) => string): string | null {
  if (seg.mentionId == null) return null;
  if (seg.mentionKind === 'todo') return threadHref(seg.mentionId);
  return null;
}

export interface TodoGlance {
  phase: Phase;
  seq?: number;
  title?: string;
  internal?: boolean;
  blockedBy?: readonly string[];
  report?: boolean;
  buildId?: string;
  projectId?: string;
}

export const TodoGlanceContext = createContext<ReadonlyMap<string, TodoGlance> | null>(null);
export const ThreadUnreadContext = createContext<ReadonlySet<string> | null>(null);

const TASK_NUMBER_LABEL = /^#\d+$/;
const TASK_NUMBER = /((?:任务|\btask)\s*)?#(\d+)/gi;
const NOT_A_TASK_NUMBER = /(?:[\w/]|\b(?:PR|issue|pull)\s*)$/i;
const TITLE_QUOTES: Record<string, string> = { '「': '」', '“': '”', '"': '"', '《': '》' };
const PAREN_CLOSE: Record<string, string> = { '（': '）', '(': ')' };

function titleAfter(text: string, title: string): number | null {
  const lead = /^\s*/.exec(text)?.[0].length ?? 0;
  const open = text[lead] ?? '';
  const close = TITLE_QUOTES[open];
  const start = close === undefined ? lead : lead + 1;
  if (!text.startsWith(title, start)) return null;
  const end = start + title.length;
  if (close === undefined) return end;
  return text[end] === close ? end + 1 : null;
}

export function linkTaskNumbers(
  text: string,
  glances: ReadonlyMap<string, TodoGlance>,
): DocSegment[] | null {
  const bySeq = new Map<number, [string, TodoGlance]>();
  for (const entry of glances) if (entry[1].seq !== undefined) bySeq.set(entry[1].seq, entry);
  if (bySeq.size === 0) return null;
  const out: DocSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TASK_NUMBER)) {
    const known = bySeq.get(Number(match[2]));
    const prefix = match[1] ?? '';
    const at = match.index + prefix.length;
    if (
      known === undefined ||
      at < cursor ||
      NOT_A_TASK_NUMBER.test(text.slice(cursor, prefix === '' ? at : match.index))
    )
      continue;
    const [todoId, glance] = known;
    const end = at + 1 + (match[2] ?? '').length;
    const titled = glance.title === undefined ? null : titleAfter(text.slice(end), glance.title);
    if (titled === null && prefix === '') continue;
    const after = end + (titled ?? 0);
    const wrapped = PAREN_CLOSE[text[at - 1] ?? ''] === text[after] && prefix === '';
    out.push({ text: text.slice(cursor, wrapped ? at - 1 : at) });
    out.push({ text: `#${glance.seq}`, style: 'mention', mentionKind: 'todo', mentionId: todoId });
    cursor = wrapped ? after + 1 : after;
  }
  if (out.length === 0) return null;
  out.push({ text: text.slice(cursor) });
  return out.filter((seg) => seg.text !== '');
}

type StatusTone = 'working' | 'wait' | 'quiet' | 'fail';

const TONE_INK: Record<StatusTone, string> = {
  working: 'text-tint-working-ink',
  wait: 'text-(--task-wait-ink)',
  quiet: 'text-tint-quiet-ink',
  fail: 'text-tint-fail-ink',
};

const PHASE_TONE: Record<Phase, StatusTone> = {
  todo: 'quiet',
  queued: 'quiet',
  planning: 'working',
  building: 'working',
  confirm: 'wait',
  needs_input: 'wait',
  review: 'wait',
  failed: 'fail',
  done: 'quiet',
  stopped: 'quiet',
  closed: 'quiet',
};

export function taskStatusInk(phase: Phase): string {
  return TONE_INK[PHASE_TONE[phase]];
}

const TONE_TILE: Record<StatusTone, string> = {
  working: 'bg-tint-working',
  wait: 'bg-(--task-wait-tint)',
  quiet: 'bg-tint-quiet',
  fail: 'bg-tint-fail',
};

export function TaskTile({ phase }: { phase: Phase }) {
  return (
    <span
      data-slot="task-tile"
      className={cn(
        'grid size-5 flex-none place-items-center rounded-sm',
        TONE_TILE[PHASE_TONE[phase]],
      )}
    >
      <TaskGlyph phase={phase} className={cn('size-3', taskStatusInk(phase))} />
    </span>
  );
}

const QUIET_GLYPH = 'text-content-tertiary';
const WAIT_GLYPH = { glyph: 'attention', ink: 'text-tint-wait-ink' } as const;
const RUN_GLYPH = { glyph: 'working', ink: 'text-running' } as const;

const TASK_GLYPH: Record<Phase, { glyph: GlyphKind; ink: string }> = {
  todo: { glyph: 'todo', ink: QUIET_GLYPH },
  queued: { glyph: 'todo', ink: QUIET_GLYPH },
  planning: RUN_GLYPH,
  building: RUN_GLYPH,
  confirm: WAIT_GLYPH,
  needs_input: WAIT_GLYPH,
  review: WAIT_GLYPH,
  failed: { glyph: 'failed', ink: 'text-tint-fail-ink' },
  done: { glyph: 'done', ink: QUIET_GLYPH },
  stopped: { glyph: 'closed', ink: QUIET_GLYPH },
  closed: { glyph: 'closed', ink: QUIET_GLYPH },
};

export function TaskGlyph({
  phase,
  label,
  className,
}: {
  phase: Phase;
  label?: string;
  className?: string;
}) {
  const { glyph, ink } = TASK_GLYPH[phase];
  const sealed = useJustSealed(phase);
  return (
    <StatusGlyph
      kind={glyph}
      {...(label === undefined ? {} : { label })}
      className={cn('size-3.5 transition-colors duration-(--dur-fast)', ink, className)}
      draw={sealed}
    />
  );
}

const SEAL_MS = 1500;

function useJustSealed(phase: Phase): boolean {
  const seen = useRef(phase);
  const sealedAt = useRef<number | null>(null);
  const done = phase === 'done';
  if (seen.current !== phase) {
    sealedAt.current = done && seen.current !== 'done' ? Date.now() : null;
    seen.current = phase;
  }
  return done && sealedAt.current !== null && Date.now() - sealedAt.current < SEAL_MS;
}

export function useStartsAfter(todoId: string, phase: Phase | undefined): string | undefined {
  const { t } = useI18n();
  const glances = useContext(TodoGlanceContext);
  if (phase === undefined || phase === 'done' || phase === 'failed') return undefined;
  const waitingFor = (glances?.get(todoId)?.blockedBy ?? []).filter(
    (id) => glances?.get(id)?.phase !== 'done',
  );
  if (waitingFor.length === 0) return undefined;
  return waitingFor.length === 1
    ? t('等「{title}」', { title: glances?.get(waitingFor[0] ?? '')?.title ?? t('任务') })
    : t('等 {n} 个任务', { n: waitingFor.length });
}

const TASK_WORD_CLS =
  'mx-0.5 inline-flex max-w-[min(22em,calc(100%-20px))] cursor-pointer items-baseline rounded-sm pr-px align-baseline font-sans text-ui font-medium text-foreground no-underline decoration-current/40 underline-offset-3 hover:bg-(--menu-hover) hover:underline focus-visible:underline';

function TaskWord({ todoId, label, href }: { todoId: string; label: string; href: string }) {
  const { t } = useI18n();
  const phase = useContext(TodoGlanceContext)?.get(todoId)?.phase;
  const startsAfter = useStartsAfter(todoId, phase);
  const unread = useContext(ThreadUnreadContext)?.has(todoId) === true;
  const lines = [
    label,
    phase === undefined ? null : t(PHASE_UI[phase].chip),
    startsAfter ?? null,
  ].filter((line): line is string => line !== null);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to={href}
            data-phase={phase}
            data-slot="task-mention"
            data-testid="task-mention"
            aria-label={lines.join(t('，'))}
            className={TASK_WORD_CLS}
          />
        }
      >
        {phase !== undefined && <TaskGlyph phase={phase} className="mr-1 self-center" />}
        <span className="min-w-0 truncate">{label}</span>
        {unread && (
          <span
            role="img"
            aria-label={t('有新动态')}
            data-slot="task-mention-unread"
            className="ml-1 size-1.5 flex-none self-center rounded-full bg-(--card-button)"
          />
        )}
      </TooltipTrigger>
      <TooltipContent
        side="top"
        data-testid="task-mention-tip"
        className="max-w-80 flex-col items-start gap-0"
      >
        {lines.map((line, n) => (
          <span key={line} className={cn(n === 0 ? 'font-medium' : 'opacity-70')}>
            {line}
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

function MentionChip({ seg }: { seg: DocSegment }) {
  const { t } = useI18n();
  const glances = useContext(TodoGlanceContext);
  const href = mentionHref(seg, useThreadHref());
  const todoId = seg.mentionKind === 'todo' ? seg.mentionId : undefined;
  const label =
    todoId != null && TASK_NUMBER_LABEL.test(seg.text)
      ? (glances?.get(todoId)?.title ?? t('任务'))
      : seg.text;
  if (seg.mentionKind === 'agent') return <span data-slot="agent-mention">{label}</span>;
  if (todoId != null && href != null) return <TaskWord todoId={todoId} label={label} href={href} />;
  return (
    <span className={mentionChipClass(seg.mentionKind)}>
      {seg.mentionKind === 'machine' ? (
        <MachineName machine={{ id: seg.mentionId, name: label }} compact />
      ) : (
        label
      )}
    </span>
  );
}

function decorate(seg: DocSegment, key: number, node: ReactNode): ReactNode {
  if (seg.em !== true && seg.del !== true) return node;
  const struck = seg.del === true ? <del className="text-(--text-tertiary)">{node}</del> : node;
  return seg.em === true ? <em key={key}>{struck}</em> : <Fragment key={key}>{struck}</Fragment>;
}

export function Segments({ segments, codeClassName }: SegmentsProps) {
  const openFile = useContext(OpenFileContext);
  const glances = useContext(TodoGlanceContext);
  return (
    <>
      {segments.map((seg, j) =>
        decorate(
          seg,
          j,
          seg.style === 'break' ? (
            <br key={j} />
          ) : seg.style === 'mention' ? (
            <MentionChip key={j} seg={seg} />
          ) : seg.style === 'attachment' && seg.attachmentKey != null ? (
            <AttachmentChip
              key={j}
              name={seg.text}
              attachmentKey={seg.attachmentKey}
              onOpen={
                openFile === undefined
                  ? undefined
                  : () => openFile({ name: seg.text, key: seg.attachmentKey ?? '' })
              }
            />
          ) : seg.style === 'anchor' ? (
            seg.internal === true ? (
              <Link
                key={j}
                to={seg.href ?? ''}
                className={cn(
                  codeClassName === 'chat-code' ? CHAT_ANCHOR_SKIN : ANCHOR_SKIN,
                  seg.strong === true && 'font-semibold',
                )}
              >
                {seg.text}
              </Link>
            ) : (
              <a
                key={j}
                href={seg.href}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  codeClassName === 'chat-code' ? CHAT_ANCHOR_SKIN : ANCHOR_SKIN,
                  seg.strong === true && 'font-semibold',
                )}
              >
                {seg.text}
              </a>
            )
          ) : seg.style === 'strong' ? (
            <strong key={j}>{seg.text}</strong>
          ) : seg.style != null ? (
            <code
              key={j}
              className={cn(
                codeClassName,
                CODE_SKIN[codeClassName],
                seg.style === 'link' && `${codeClassName}--link`,
                seg.style === 'link' && CODE_LINK_SKIN,
              )}
            >
              {seg.text}
            </code>
          ) : (
            <span key={j}>
              {(glances === null ? null : linkTaskNumbers(seg.text, glances))?.map((part, n) =>
                part.style === 'mention' ? <MentionChip key={n} seg={part} /> : part.text,
              ) ?? seg.text}
            </span>
          ),
        ),
      )}
    </>
  );
}
