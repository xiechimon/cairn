import { cn } from 'cn';
import { createContext, Fragment, type ReactNode, useContext, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import {
  attachmentOpener,
  FileSetContext,
  OpenDesignPageContext,
  OpenFileContext,
} from '../board/file-pane.js';
import { useThreadHref } from '../board/thread-link.js';
import { echoTaskRef, hoverTaskRef, useTaskRefSignal } from '../chief/task-ref-signal.js';
import { MachineName } from '../components/machine-label.js';
import { type GlyphKind, StatusGlyph } from '../components/status-glyph.js';
import type { DocSegment, Phase } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { Eye } from '../icons/index.js';
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

const TASK_NUMBER_LABEL = /^#\d+$/;
const TASK_NUMBER = /(任务\s*)?#(\d+)/g;
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
    if (known === undefined || at < cursor || NOT_A_TASK_NUMBER.test(text.slice(cursor, at)))
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

const TONE_CLASS: Record<StatusTone, { ink: string; tile: string; chip: string }> = {
  working: { ink: 'text-tint-working-ink', tile: 'bg-tint-working', chip: 'text-tint-working-ink' },
  wait: {
    ink: 'text-(--task-wait-ink)',
    tile: 'bg-(--task-wait-tint)',
    chip: 'text-foreground',
  },
  quiet: {
    ink: 'text-tint-quiet-ink',
    tile: 'bg-tint-quiet',
    chip: 'text-(color:--task-chip-quiet-ink)',
  },
  fail: { ink: 'text-tint-fail-ink', tile: 'bg-tint-fail', chip: 'text-tint-fail-ink' },
};

const CONVERSATION_STATUS: Record<Phase, { glyph: GlyphKind; tone: StatusTone }> = {
  todo: { glyph: 'todo', tone: 'quiet' },
  queued: { glyph: 'queued', tone: 'quiet' },
  planning: { glyph: 'progress', tone: 'working' },
  building: { glyph: 'progress', tone: 'working' },
  confirm: { glyph: 'attention', tone: 'wait' },
  needs_input: { glyph: 'attention', tone: 'wait' },
  review: { glyph: 'attention', tone: 'wait' },
  failed: { glyph: 'failed', tone: 'fail' },
  done: { glyph: 'done', tone: 'quiet' },
  stopped: { glyph: 'closed', tone: 'quiet' },
  closed: { glyph: 'closed', tone: 'quiet' },
};

const TASK_CHIP_CLS =
  'mr-1 ml-0 inline cursor-pointer rounded-sm bg-(color:--task-chip-fill) px-1.5 py-0 align-baseline font-sans text-ui leading-[inherit] font-normal text-popover-foreground break-keep no-underline shadow-(--e1-lift) [overflow-wrap:anywhere]';
const TASK_CHIP_WHOLE_MAX = 16;

export function taskChipClass(phase: Phase | undefined): string {
  return cn(
    TASK_CHIP_CLS,
    TONE_CLASS[phase === undefined ? 'quiet' : CONVERSATION_STATUS[phase].tone].chip,
  );
}

export function taskStatusInk(phase: Phase): string {
  return TONE_CLASS[CONVERSATION_STATUS[phase].tone].ink;
}

export function TodoStatus({ phase, draw = false }: { phase: Phase; draw?: boolean }) {
  const { t } = useI18n();
  const { glyph, tone } = CONVERSATION_STATUS[phase];
  if (tone === 'wait')
    return (
      <span
        role="img"
        aria-label={t(PHASE_UI[phase].chip)}
        data-glyph="eye"
        className="grid size-3 flex-none place-items-center text-(--task-wait-ink)"
      >
        <Eye width={12} height={12} />
      </span>
    );
  return (
    <StatusGlyph
      kind={glyph}
      label={t(PHASE_UI[phase].chip)}
      className={cn('size-3', TONE_CLASS[tone].ink)}
      draw={draw}
    />
  );
}

export function TodoStatusTile({
  phase,
  className,
}: {
  phase: Phase;
  className?: string | undefined;
}) {
  const sealed = useJustSealed(phase);
  return (
    <span
      data-sealed={sealed ? '' : undefined}
      className={cn(
        'grid size-5 flex-none place-items-center rounded-sm transition-colors duration-(--dur-overlay)',
        TONE_CLASS[CONVERSATION_STATUS[phase].tone].tile,
        className,
      )}
    >
      <TodoStatus phase={phase} draw={sealed} />
    </span>
  );
}

const SEAL_MS = 1500;

function useJustSealed(phase: Phase): boolean {
  const seen = useRef(phase);
  const sealedAt = useRef<number | null>(null);
  const done = CONVERSATION_STATUS[phase].glyph === 'done';
  if (seen.current !== phase) {
    sealedAt.current =
      done && CONVERSATION_STATUS[seen.current].glyph !== 'done' ? Date.now() : null;
    seen.current = phase;
  }
  return done && sealedAt.current !== null && Date.now() - sealedAt.current < SEAL_MS;
}

function MentionChip({ seg }: { seg: DocSegment }) {
  const { t } = useI18n();
  const glances = useContext(TodoGlanceContext);
  const href = mentionHref(seg, useThreadHref());
  const chipClass = mentionChipClass(seg.mentionKind);
  const todoId = seg.mentionKind === 'todo' ? seg.mentionId : undefined;
  const glance = todoId != null ? glances?.get(todoId) : undefined;
  const phase = glance?.phase;
  const label =
    todoId != null && TASK_NUMBER_LABEL.test(seg.text) ? (glance?.title ?? t('任务')) : seg.text;
  const signal = useTaskRefSignal(todoId);
  useEffect(() => {
    if (todoId != null) echoTaskRef(todoId);
  }, [todoId]);
  if (seg.mentionKind === 'agent') return <span data-slot="agent-mention">{label}</span>;
  return href != null ? (
    <>
      {' '}
      <Link
        className={cn(
          chipClass,
          taskChipClass(phase),
          label.length <= TASK_CHIP_WHOLE_MAX && 'whitespace-nowrap',
        )}
        to={href}
        data-phase={phase}
        data-slot="task-mention"
        data-hl={signal.hovered ? '' : undefined}
        {...(todoId != null
          ? {
              onPointerEnter: () => hoverTaskRef(todoId),
              onPointerLeave: () => hoverTaskRef(null),
            }
          : {})}
      >
        {phase != null && (
          <span className="mr-1.5 inline-flex align-[-0.125em]">
            <TodoStatus phase={phase} />
          </span>
        )}
        {label}
      </Link>
    </>
  ) : (
    <span className={chipClass}>
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
  const openers = {
    file: useContext(OpenFileContext),
    designPage: useContext(OpenDesignPageContext),
  };
  const fileSet = useContext(FileSetContext);
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
              {...attachmentOpener(openers, fileSet, seg.text, seg.attachmentKey)}
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
