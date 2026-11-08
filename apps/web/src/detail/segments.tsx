import { cn } from 'cn';
import { createContext, useContext } from 'react';
import { Link } from 'react-router';
import { useThreadHref } from '../board/thread-link.js';
import { StatusGlyph } from '../components/status-glyph.js';
import type { DocSegment, Phase } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { mentionChipClass } from '../overlay/mention-chip.js';
import { PHASE_STATUS, PHASE_UI } from '../phase.js';

const CODE_SKIN: Record<string, string> = {
  'chat-code':
    'rounded-(--cds-radius-sm) bg-(--prose-code-fill) px-1 py-px font-prose-mono text-[0.9em] leading-none whitespace-pre-wrap [overflow-wrap:anywhere]',
  'doc-code': 'mx-0.5 rounded-(--cds-radius-sm) bg-(--muted) px-1 py-px font-mono text-code',
};
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

export function TodoStatus({ phase }: { phase: Phase }) {
  const { t } = useI18n();
  const { glyph, ink } = PHASE_STATUS[phase];
  return <StatusGlyph kind={glyph} label={t(PHASE_UI[phase].chip)} className={cn('size-3', ink)} />;
}

function MentionChip({ seg }: { seg: DocSegment }) {
  const glances = useContext(TodoGlanceContext);
  const href = mentionHref(seg, useThreadHref());
  const className = mentionChipClass(seg.mentionKind);
  const todoId = seg.mentionKind === 'todo' ? seg.mentionId : undefined;
  const glance = todoId != null ? glances?.get(todoId) : undefined;
  const phase = glance?.phase;
  return href != null ? (
    <Link className={`${className} cursor-pointer`} to={href} data-phase={phase}>
      {phase != null && <TodoStatus phase={phase} />}
      {seg.text}
    </Link>
  ) : (
    <span className={className}>{seg.text}</span>
  );
}

export function Segments({ segments, codeClassName }: SegmentsProps) {
  return (
    <>
      {segments.map((seg, j) =>
        seg.style === 'mention' ? (
          <MentionChip key={j} seg={seg} />
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
      )}
    </>
  );
}
