import { cn } from 'cn';
import { createContext, Fragment, type ReactNode, useContext } from 'react';
import { Link } from 'react-router';
import { useThreadHref } from '../board/thread-link.js';
import { type GlyphKind, StatusGlyph } from '../components/status-glyph.js';
import type { DocSegment, Phase } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { Eye } from '../icons/index.js';
import { mentionChipClass } from '../overlay/mention-chip.js';
import { PHASE_UI } from '../phase.js';
import { AttachmentChip, AttachmentPreviewHandler } from './attachment-chip.js';

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
}

export const TodoGlanceContext = createContext<ReadonlyMap<string, TodoGlance> | null>(null);

export const TaskMentionAsLinkContext = createContext(false);

const TASK_NUMBER_LABEL = /^#\d+$/;

type StatusTone = 'working' | 'wait' | 'quiet' | 'fail';

const TONE_CLASS: Record<StatusTone, { ink: string; tile: string; chip: string }> = {
  working: {
    ink: 'text-tint-working-ink',
    tile: 'bg-tint-working',
    chip: 'bg-tint-working-soft text-tint-working-ink',
  },
  wait: {
    ink: 'text-(--task-wait-ink)',
    tile: 'bg-(--task-wait-tint)',
    chip: 'bg-(--task-chip-fill) text-(--chat-link)',
  },
  quiet: {
    ink: 'text-tint-quiet-ink',
    tile: 'bg-tint-quiet',
    chip: 'bg-tint-quiet-soft text-tint-quiet-ink',
  },
  fail: {
    ink: 'text-tint-fail-ink',
    tile: 'bg-tint-fail',
    chip: 'bg-tint-fail-soft text-tint-fail-ink',
  },
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
  closed: { glyph: 'closed', tone: 'quiet' },
};

const TASK_CHIP_CLS =
  'mx-0.5 inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-0 align-top font-sans text-ui leading-[inherit] font-normal no-underline';

export function taskChipClass(phase: Phase): string {
  return cn(TASK_CHIP_CLS, TONE_CLASS[CONVERSATION_STATUS[phase].tone].chip);
}

export function taskStatusInk(phase: Phase): string {
  return TONE_CLASS[CONVERSATION_STATUS[phase].tone].ink;
}

export function TodoStatus({ phase }: { phase: Phase }) {
  const { t } = useI18n();
  const { glyph, tone } = CONVERSATION_STATUS[phase];
  if (tone === 'wait')
    return (
      <span
        role="img"
        aria-label={t(PHASE_UI[phase].chip)}
        data-glyph="eye"
        className="grid size-4 flex-none place-items-center rounded-full bg-(--task-wait-tint) text-(--task-wait-ink)"
      >
        <Eye width={11} height={11} />
      </span>
    );
  return (
    <StatusGlyph
      kind={glyph}
      label={t(PHASE_UI[phase].chip)}
      className={cn('size-3', TONE_CLASS[tone].ink)}
    />
  );
}

export function TodoStatusTile({ phase }: { phase: Phase }) {
  return (
    <span
      className={cn(
        'grid size-5 flex-none place-items-center rounded-sm',
        TONE_CLASS[CONVERSATION_STATUS[phase].tone].tile,
      )}
    >
      <TodoStatus phase={phase} />
    </span>
  );
}

export function TaskMentionLink({
  todoId,
  phase,
  children,
}: {
  todoId: string;
  phase: Phase | undefined;
  children: ReactNode;
}) {
  const threadHref = useThreadHref();
  return (
    <Link
      className={CHAT_ANCHOR_SKIN}
      to={threadHref(todoId)}
      data-slot="task-mention"
      data-phase={phase}
    >
      {children}
    </Link>
  );
}

function MentionChip({ seg }: { seg: DocSegment }) {
  const { t } = useI18n();
  const glances = useContext(TodoGlanceContext);
  const asLink = useContext(TaskMentionAsLinkContext);
  const href = mentionHref(seg, useThreadHref());
  const chipClass = mentionChipClass(seg.mentionKind);
  const todoId = seg.mentionKind === 'todo' ? seg.mentionId : undefined;
  const glance = todoId != null ? glances?.get(todoId) : undefined;
  const phase = glance?.phase;
  const label =
    todoId != null && TASK_NUMBER_LABEL.test(seg.text) ? (glance?.title ?? t('任务')) : seg.text;
  if (seg.mentionKind === 'agent') return <span data-slot="agent-mention">{label}</span>;
  if (asLink && todoId != null)
    return (
      <TaskMentionLink todoId={todoId} phase={phase}>
        {label}
      </TaskMentionLink>
    );
  return href != null ? (
    <Link
      className={cn(chipClass, phase != null ? taskChipClass(phase) : 'cursor-pointer')}
      to={href}
      data-phase={phase}
    >
      {phase != null && <TodoStatus phase={phase} />}
      <span className="max-w-48 truncate">{label}</span>
    </Link>
  ) : (
    <span className={chipClass}>{label}</span>
  );
}

function decorate(seg: DocSegment, key: number, node: ReactNode): ReactNode {
  if (seg.em !== true && seg.del !== true) return node;
  const struck = seg.del === true ? <del className="text-(--text-tertiary)">{node}</del> : node;
  return seg.em === true ? <em key={key}>{struck}</em> : <Fragment key={key}>{struck}</Fragment>;
}

export function Segments({ segments, codeClassName }: SegmentsProps) {
  const onPreview = useContext(AttachmentPreviewHandler);
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
              {...(onPreview !== undefined ? { onPreview } : {})}
            />
          ) : seg.style === 'anchor' ? (
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
            <span key={j}>{seg.text}</span>
          ),
        ),
      )}
    </>
  );
}
