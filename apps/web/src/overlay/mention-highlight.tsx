import { type RefObject, useLayoutEffect, useMemo, useRef } from 'react';
import {
  type DisplayMention,
  findDisplayMentions,
  type MentionRegistry,
} from './mention-display.js';
import type { MentionKind } from './mention-token.js';

const MIRRORED = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
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
  agent: 'bg-(--chip-done-bg) text-(--chip-done-fg)',
  skill: 'bg-(--chip-idle-bg) text-(--chip-idle-fg)',
  machine: 'bg-(--chip-idle-bg) text-(--chip-idle-fg)',
  project: 'bg-(--tile-orange-bg) text-(--tile-orange-fg)',
  todo: 'bg-(--spot-soft) text-(--spot-text-on-tint)',
};

export const MENTION_TEXTAREA_CLS =
  'relative z-10 bg-transparent text-transparent caret-foreground selection:bg-(--focus-halo) selection:text-transparent placeholder:text-content-tertiary';

function pieces(text: string, hits: DisplayMention[]) {
  const out: { text: string; kind?: MentionKind }[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start > cursor) out.push({ text: text.slice(cursor, hit.start) });
    out.push({ text: text.slice(hit.start, hit.end), kind: hit.kind });
    cursor = hit.end;
  }
  out.push({ text: `${text.slice(cursor)}​` });
  return out;
}

export function MentionHighlight({
  text,
  registry,
  textareaRef,
}: {
  text: string;
  registry: MentionRegistry;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const parts = useMemo(() => pieces(text, findDisplayMentions(text, registry)), [text, registry]);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    const mirror = mirrorRef.current;
    if (ta == null || mirror == null) return;
    mirror.style.boxSizing = 'border-box';
    const sync = () => {
      const style = getComputedStyle(ta);
      for (const key of MIRRORED) mirror.style[key] = style[key];
      mirror.style.left = `${ta.offsetLeft}px`;
      mirror.style.top = `${ta.offsetTop}px`;
      mirror.style.width = `${ta.offsetWidth}px`;
      mirror.style.height = `${ta.offsetHeight}px`;
      mirror.scrollTop = ta.scrollTop;
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
    const ta = textareaRef.current;
    const mirror = mirrorRef.current;
    if (ta != null && mirror != null) mirror.scrollTop = ta.scrollTop;
  });

  return (
    <div
      ref={mirrorRef}
      aria-hidden="true"
      data-testid="mention-highlight"
      className="pointer-events-none absolute overflow-hidden border-solid border-transparent break-words whitespace-pre-wrap text-foreground"
    >
      {parts.map((part, i) =>
        part.kind === undefined ? (
          <span key={i}>{part.text}</span>
        ) : (
          <span
            key={i}
            data-mention-kind={part.kind}
            className={`box-decoration-clone rounded-(--cds-radius-sm) ${KIND_SKIN[part.kind]}`}
          >
            {part.text}
          </span>
        ),
      )}
    </div>
  );
}
