import { type RefObject, useLayoutEffect, useMemo, useRef } from 'react';
import {
  type DisplayMention,
  findDisplayMentions,
  type MentionRegistry,
} from './mention-display.js';
import type { MentionKind } from './mention-token.js';
import { findListMarkers, type ListMarkerKind, type ListMarkerSpan } from './ordered-list.js';

const MIRRORED = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariantNumeric',
  'letterSpacing',
  'lineHeight',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'textIndent',
  'tabSize',
  'wordSpacing',
] as const;

const KIND_SKIN: Record<MentionKind, string> = {
  agent: 'bg-secondary text-content-secondary',
  skill: 'bg-secondary text-content-secondary',
  machine: 'bg-secondary text-content-secondary',
  project: 'bg-secondary text-content-secondary',
  todo: 'bg-(--spot-soft) text-(--spot-text-on-tint)',
};

export const MENTION_TEXTAREA_CLS =
  'relative z-10 bg-transparent text-transparent caret-foreground selection:bg-(--focus-halo) selection:text-transparent placeholder:text-content-tertiary';

type Piece =
  | { text: string; kind?: undefined; listKind?: undefined }
  | { text: string; kind: MentionKind; listKind?: undefined }
  | { text: string; kind?: undefined; listKind: ListMarkerKind };

function pieces(text: string, mentions: DisplayMention[], markers: ListMarkerSpan[]): Piece[] {
  const spans: (
    | { start: number; end: number; kind: MentionKind; listKind?: undefined }
    | { start: number; end: number; kind?: undefined; listKind: ListMarkerKind }
  )[] = [
    ...mentions.map((hit) => ({ start: hit.start, end: hit.end, kind: hit.kind })),
    ...markers.map((marker) => ({ start: marker.start, end: marker.end, listKind: marker.kind })),
  ].sort((a, b) => a.start - b.start);

  const out: Piece[] = [];
  let cursor = 0;
  for (const hit of spans) {
    if (hit.start < cursor) continue;
    if (hit.start > cursor) out.push({ text: text.slice(cursor, hit.start) });
    out.push(
      hit.kind !== undefined
        ? { text: text.slice(hit.start, hit.end), kind: hit.kind }
        : { text: text.slice(hit.start, hit.end), listKind: hit.listKind },
    );
    cursor = hit.end;
  }
  out.push({ text: `${text.slice(cursor)}​` });
  return out;
}

function syncGeometry(ta: HTMLTextAreaElement, mirror: HTMLDivElement) {
  mirror.style.left = `${ta.offsetLeft}px`;
  mirror.style.top = `${ta.offsetTop}px`;
  mirror.style.width = `${ta.offsetWidth}px`;
  mirror.style.height = `${ta.offsetHeight}px`;
  mirror.scrollTop = ta.scrollTop;
}

export function MentionHighlight({
  text,
  registry,
  textareaRef,
  suppressedListLines,
}: {
  text: string;
  registry: MentionRegistry;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  suppressedListLines?: ReadonlySet<number> | null;
}) {
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const parts = useMemo(
    () =>
      pieces(text, findDisplayMentions(text, registry), findListMarkers(text, suppressedListLines)),
    [text, registry, suppressedListLines],
  );

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    const mirror = mirrorRef.current;
    if (ta == null || mirror == null) return;
    mirror.style.boxSizing = 'border-box';
    const sync = () => {
      const style = getComputedStyle(ta);
      for (const key of MIRRORED) mirror.style[key] = style[key];
      syncGeometry(ta, mirror);
    };
    sync();
    const frame = requestAnimationFrame(sync);
    const observer = new ResizeObserver(sync);
    observer.observe(ta);
    ta.addEventListener('scroll', sync);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      ta.removeEventListener('scroll', sync);
    };
  }, [textareaRef]);

  useLayoutEffect(() => {
    let current = true;
    queueMicrotask(() => {
      const ta = textareaRef.current;
      const mirror = mirrorRef.current;
      if (current && ta != null && mirror != null) syncGeometry(ta, mirror);
    });
    return () => {
      current = false;
    };
  });

  return (
    <div
      ref={mirrorRef}
      aria-hidden="true"
      data-testid="mention-highlight"
      className="pointer-events-none absolute overflow-hidden border-solid border-transparent break-words whitespace-pre-wrap text-foreground"
    >
      {parts.map((part, i) =>
        part.kind !== undefined ? (
          <span
            key={i}
            data-mention-kind={part.kind}
            className={`box-decoration-clone rounded-(--cds-radius-sm) ${KIND_SKIN[part.kind]}`}
          >
            {part.text}
          </span>
        ) : part.listKind !== undefined ? (
          <span key={i} data-list-marker={part.listKind}>
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </div>
  );
}
