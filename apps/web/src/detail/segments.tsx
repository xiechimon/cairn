import { cn } from 'cn';
import { Link } from 'react-router';

import type { DocSegment } from '../fixtures/records.js';
import { mentionChipClass } from '../overlay/mention-chip.js';
import { AGENTS_HREF } from '../routes/agent-detail-page.js';

const CODE_SKIN: Record<string, string> = {
  'chat-code': 'mx-0.5 rounded-[4px] bg-(--muted) px-1 py-px font-mono text-caption leading-3',
  'doc-code': 'mx-0.5 rounded-[4px] bg-(--muted) px-1 py-px font-mono text-caption',
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

function MentionChip({ seg }: { seg: DocSegment }) {
  const href = mentionHref(seg);
  const className = mentionChipClass(seg.mentionKind);
  return href != null ? (
    <Link className={`${className} cursor-pointer`} to={href}>
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
