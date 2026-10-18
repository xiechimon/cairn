// Inline segment renderer shared by the doc pane (doc-code chips) and the
// transcript (chat-code chips): one shape, the chip class is the only
// parameter (issue #57 — code review dedup). Mention segments (issue
// #311) render with the per-kind accent color of the mention-chip family
// so the chip face stays consistent with the composer overlay.
// #948：家族皮肤单源迁 overlay/mention-chip.ts（原 mention-picker.css 规则
// 1:1 utility 化 + kind→实测槽映射，头注即正典注记）；本文件与
// composer-chips.tsx 共吃同一 helper，类名钩子（mention-chip--*）原样保留。

import { cn } from 'cn';
import { Link } from 'react-router';

import type { DocSegment } from '../fixtures/records.js';
import { mentionChipClass } from '../overlay/mention-chip.js';
import { AGENTS_HREF } from '../routes/agent-detail-page.js';

/** #945（detail.css 清零）：inline code chip 皮肤从 per-face 规则迁
 *  utilities，单源住在这里（两族只差行高——chat-code 11px/13px 紧排，
 *  doc-code 只钉字号、chip 不长 24px 行盒，r7 17b/26d 实测 13–15px 底矩形）。
 *  --link 变体 = plan 蓝墨 + 同色底（r8 56 文件/提交引用 chip）。类名保留
 *  作惰性别名（chief-stream-markdown 等它域 spec 与单测按它定位）。 */
const CODE_SKIN: Record<string, string> = {
  'chat-code': 'mx-0.5 rounded-[4px] bg-(--muted) px-1 py-px font-mono text-caption leading-3',
  'doc-code': 'mx-0.5 rounded-[4px] bg-(--muted) px-1 py-px font-mono text-caption',
};
const CODE_LINK_SKIN = 'bg-(--chip-plan-bg) text-(--chip-plan-fg)';

interface SegmentsProps {
  segments: DocSegment[];
  /** Chip class for `code` segments: `doc-code` (doc pane) or
   *  `chat-code` (transcript). */
  codeClassName: string;
}

/** Mention wire kinds whose chip navigates — reference-measured behaviors
 *  (todos.dev, live-captured): todo click goes to the todo detail (#675),
 *  agent click routes same-tab to the agent settings page (#741 — the whole
 *  chip is cursor-pointer, hover changes only the cursor, no popover). A
 *  router Link (real anchor) keeps keyboard activation, middle-click and
 *  open-in-new-tab for free. skill/project/machine stay non-clickable spans
 *  until their own navigation tickets: the reference landing surfaces for
 *  those three were never captured (project has a pacman route but no
 *  captured chip behavior; skill/machine have no per-entity route at all).
 *  No mentionId, no navigation — the chip stays an inert span. */
function mentionHref(seg: DocSegment): string | null {
  if (seg.mentionId == null) return null;
  if (seg.mentionKind === 'todo') return `/app/todo/${seg.mentionId}`;
  if (seg.mentionKind === 'agent') return `${AGENTS_HREF}/${seg.mentionId}`;
  return null;
}

/** One mention segment: navigable kinds render a router Link, the rest an
 *  inert span — same chip face either way (mention-chip.ts helper)。
 *  #741：可点 chip（Link 形）整卡 cursor-pointer——旧 `a.mention-chip--agent`
 *  元素限定选择器的 utility 等价形（无 id 的 inert span 永不装作可点）。 */
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
          // #650: `**bold**` run — a real <strong>, not the old strip-to-
          // plain. Must precede the generic styled-chip branch below
          // (that one turns any unknown style into a mono chip).
          <strong key={j}>{seg.text}</strong>
        ) : seg.style != null ? (
          // fixture order is stable; segments carry no ids
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
