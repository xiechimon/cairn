import { Reply } from 'lucide-react';
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import {
  barPosition,
  REPLY_SOURCE_ATTR,
  replyableText,
  SETTLE_MS,
  scrolledAway,
} from './selection-reply-model.js';

export interface ReplyQuoteDraft {
  sourceMessageId: string;
  quote: string;
}

interface Target {
  range: Range;
  sourceMessageId: string;
  text: string;
}

const BAR_CLS =
  'fixed top-0 left-0 z-(--z-dialog) flex items-center rounded-lg border border-(--selection-bar-ring) bg-(--selection-bar-bg) text-(--selection-bar-ink) shadow-(--shadow-selection-bar) backdrop-blur-sm select-none';
const BAR_BUTTON_CLS =
  "h-8 gap-1 rounded-lg border-0 px-3 py-1.5 text-ui font-medium text-(--selection-bar-ink) transition-none hover:bg-(--selection-bar-hover) hover:text-(--selection-bar-ink) dark:hover:bg-(--selection-bar-hover) [&_svg:not([class*='size-'])]:size-5";

function sourceOf(node: Node, container: HTMLElement): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const source = element?.closest<HTMLElement>(`[${REPLY_SOURCE_ATTR}]`) ?? null;
  return source !== null && container.contains(source) ? source : null;
}

function targetOf(container: HTMLElement): Target | null {
  const selection = container.ownerDocument.getSelection();
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const start = sourceOf(range.startContainer, container);
  if (start === null || start !== sourceOf(range.endContainer, container)) return null;
  const sourceMessageId = start.getAttribute(REPLY_SOURCE_ATTR);
  const text = replyableText(selection.toString());
  if (sourceMessageId === null || sourceMessageId === '' || text === null) return null;
  return { range: range.cloneRange(), sourceMessageId, text };
}

function isEditable(node: EventTarget | null): boolean {
  return (
    node instanceof HTMLElement &&
    (node.isContentEditable || node.closest('input, textarea, select, [role="menu"]') !== null)
  );
}

export function SelectionReply({
  containerRef,
  enabled,
  onReply,
}: {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onReply: (draft: ReplyQuoteDraft) => void;
}) {
  const { t } = useI18n();
  const [target, setTarget] = useState<Target | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const touchRef = useRef(false);

  const reply = useCallback(() => {
    if (target === null) return;
    onReply({ sourceMessageId: target.sourceMessageId, quote: target.text });
    containerRef.current?.ownerDocument.getSelection()?.removeAllRanges();
    setTarget(null);
  }, [target, onReply, containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || container === null) {
      setTarget(null);
      return;
    }
    const doc = container.ownerDocument;
    let timer: number | null = null;
    let dragging = false;
    const cancel = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const read = () => {
      cancel();
      setTarget(touchRef.current ? null : targetOf(container));
    };
    const onSelectionChange = () => {
      const selection = doc.getSelection();
      if (selection === null || selection.isCollapsed) {
        cancel();
        setTarget(null);
        return;
      }
      if (dragging) return;
      cancel();
      timer = window.setTimeout(read, SETTLE_MS);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (barRef.current?.contains(event.target as Node)) return;
      touchRef.current = event.pointerType === 'touch' || event.pointerType === 'pen';
      dragging = event.pointerType === 'mouse';
      if (dragging) setTarget(null);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!dragging || event.pointerType !== 'mouse') return;
      dragging = false;
      read();
    };
    doc.addEventListener('selectionchange', onSelectionChange);
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('pointerup', onPointerUp, true);
    return () => {
      cancel();
      doc.removeEventListener('selectionchange', onSelectionChange);
      doc.removeEventListener('pointerdown', onPointerDown, true);
      doc.removeEventListener('pointerup', onPointerUp, true);
    };
  }, [enabled, containerRef]);

  useLayoutEffect(() => {
    if (target === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isEditable(event.target)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        containerRef.current?.ownerDocument.getSelection()?.removeAllRanges();
        setTarget(null);
        return;
      }
      if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey)
        return;
      event.preventDefault();
      reply();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [target, reply, containerRef]);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const container = containerRef.current;
    if (target === null || bar === null || container === null) return;
    const shownTop = target.range.getBoundingClientRect().top;
    const place = () => {
      const line = target.range.getBoundingClientRect();
      const bounds = container.getBoundingClientRect();
      const { x, y } = barPosition(
        { left: line.left, width: line.width, top: line.top, bottom: line.bottom },
        { width: bar.offsetWidth, height: bar.offsetHeight },
        { left: bounds.left, right: bounds.right, top: bounds.top },
      );
      bar.style.transform = `translate(${x}px, ${y}px) translateX(-50%)`;
    };
    let frame: number | null = null;
    const onMove = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (scrolledAway(shownTop, target.range.getBoundingClientRect().top)) setTarget(null);
        else place();
      });
    };
    place();
    window.addEventListener('scroll', onMove, { capture: true, passive: true });
    window.addEventListener('resize', onMove);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onMove, { capture: true });
      window.removeEventListener('resize', onMove);
    };
  }, [target, containerRef]);

  if (target === null) return null;
  return createPortal(
    <div
      ref={barRef}
      role="toolbar"
      aria-label={t('选中文字的操作')}
      data-testid="selection-reply-bar"
      data-source={target.sourceMessageId}
      className={BAR_CLS}
    >
      <Button
        variant="ghost"
        data-testid="selection-reply"
        aria-keyshortcuts="Enter"
        className={BAR_BUTTON_CLS}
        onMouseDown={(event) => event.preventDefault()}
        onClick={reply}
      >
        {t('回复')}
        <Reply aria-hidden="true" />
      </Button>
    </div>,
    document.body,
  );
}
