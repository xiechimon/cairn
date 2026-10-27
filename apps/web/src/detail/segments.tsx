import { cn } from 'cn';
import { createContext, useContext } from 'react';
import { Link } from 'react-router';

import type { DocSegment, Phase } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { mentionChipClass } from '../overlay/mention-chip.js';
import { PHASE_STATUS, PHASE_UI } from '../phase.js';
import { AGENTS_HREF } from '../routes/agent-detail-page.js';

const CODE_SKIN: Record<string, string> = {
  'chat-code':
    'mx-0.5 rounded-(--cds-radius-sm) bg-(--muted) px-1 py-px font-mono text-caption leading-3',
  'doc-code': 'mx-0.5 rounded-(--cds-radius-sm) bg-(--muted) px-1 py-px font-mono text-caption',
};
const CODE_LINK_SKIN = 'bg-(--chip-plan-bg) text-(--chip-plan-fg)';

interface SegmentsProps {
  segments: DocSegment[];
  codeClassName: string;
}

function mentionHref(seg: DocSegment): string | null {
  if (seg.mentionId == null) return null;
  if (seg.mentionKind === 'todo') return `/app/todo/${seg.mentionId}`;
  if (seg.mentionKind === 'agent') return `${AGENTS_HREF}/${seg.mentionId}`;
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
  const { icon: Icon, ink } = PHASE_STATUS[phase];
  return (
    <Icon
      role="img"
      aria-label={t(PHASE_UI[phase].chip)}
      strokeWidth={2}
      className={cn('size-3 flex-none', ink)}
    />
  );
}

function MentionChip({ seg }: { seg: DocSegment }) {
  const glances = useContext(TodoGlanceContext);
  const href = mentionHref(seg);
  const className = mentionChipClass(seg.mentionKind);
  const phase =
    seg.mentionKind === 'todo' && seg.mentionId != null
      ? glances?.get(seg.mentionId)?.phase
      : undefined;
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
