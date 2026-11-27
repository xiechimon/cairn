import { cn } from 'cn';
import { TextQuote } from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ShortcutHint } from '../components/shortcut-hint.js';
import { Button } from '../components/ui/button.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';
import { useQuoteMarks } from './quote-mark.js';
import { REPLY_SOURCE_ATTR, type ReplyQuoteDraft } from './reply-source-highlight.js';
import { barPosition, replyableText, SETTLE_MS, scrolledAway } from './selection-reply-model.js';

interface Target {
  range: Range;
  sourceMessageId: string;
  text: string;
}

const PILL_CLS =
  'fixed top-0 left-0 z-(--z-dialog) flex h-9 items-center gap-0.5 rounded-(--radius-control) bg-popover p-0.5 text-popover-foreground shadow-(--shadow-popover) select-none';
const PILL_BUTTON_CLS =
  'cursor-pointer gap-1.5 rounded-(--cds-radius-sm) border-0 text-ui font-medium text-foreground hover:bg-menu-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-(--focus-ring) dark:hover:bg-menu-hover [&_svg]:text-content-secondary';
const BOX_CLS =
  'fixed top-0 left-0 z-(--z-dialog) flex w-95 max-w-[calc(100vw-24px)] flex-col gap-2 rounded-(--radius-composer) bg-(--composer-fill) px-3.5 pt-2.5 pb-2 shadow-(--shadow-composer-focus)';

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
  onAddQuote,
  onSendQuote,
}: {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onAddQuote: (draft: ReplyQuoteDraft, text: string) => void;
  onSendQuote: (draft: ReplyQuoteDraft, text: string) => void;
}) {
  const { t } = useI18n();
  const [target, setTarget] = useState<Target | null>(null);
  const [boxOpen, setBoxOpen] = useState(false);
  const [text, setText] = useState('');
  const floatRef = useRef<HTMLDivElement | null>(null);
  const touchRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const dismiss = useCallback(() => {
    containerRef.current?.ownerDocument.getSelection()?.removeAllRanges();
    setTarget(null);
    setBoxOpen(false);
    setText('');
  }, [containerRef]);

  const openBox = useCallback(() => {
    if (target === null) return;
    setBoxOpen(true);
  }, [target]);

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || container === null) {
      setTarget(null);
      setBoxOpen(false);
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
      if (floatRef.current?.contains(doc.activeElement) === true) return;
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
      if (floatRef.current?.contains(event.target as Node)) return;
      touchRef.current = event.pointerType === 'touch' || event.pointerType === 'pen';
      dragging = event.pointerType === 'mouse';
      setBoxOpen(false);
      setText('');
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
    if (target === null || boxOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isEditable(event.target)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        return;
      }
      if (
        event.key.toLowerCase() !== 'r' ||
        event.shiftKey ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey
      )
        return;
      event.preventDefault();
      openBox();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [target, boxOpen, dismiss, openBox]);

  useLayoutEffect(() => {
    if (boxOpen) inputRef.current?.focus({ preventScroll: true });
  }, [boxOpen]);

  useLayoutEffect(() => {
    const float = floatRef.current;
    const container = containerRef.current;
    if (target === null || float === null || container === null) return;
    const shownTop = target.range.getBoundingClientRect().top;
    const place = () => {
      const line = target.range.getBoundingClientRect();
      const bounds = container.getBoundingClientRect();
      const { x, y } = barPosition(
        { left: line.left, width: line.width, top: line.top, bottom: line.bottom },
        { width: float.offsetWidth, height: float.offsetHeight },
        { left: bounds.left, right: bounds.right, top: bounds.top },
      );
      float.style.transform = `translate(${x}px, ${y}px) translateX(-50%)`;
    };
    let frame: number | null = null;
    const onMove = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (!boxOpen && scrolledAway(shownTop, target.range.getBoundingClientRect().top))
          setTarget(null);
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
  }, [target, boxOpen, containerRef]);

  const boxRange = boxOpen ? target?.range : undefined;
  const marked = useMemo(() => (boxRange === undefined ? [] : [boxRange]), [boxRange]);
  useQuoteMarks(marked);

  if (target === null) return null;
  const draft = {
    sourceMessageId: target.sourceMessageId,
    quote: target.text,
    range: target.range.cloneRange(),
  };
  const onBoxKey = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) {
      if (text.trim() === '') return;
      onSendQuote(draft, text.trim());
    } else {
      onAddQuote(draft, text.trim());
    }
    dismiss();
  };
  return createPortal(
    boxOpen ? (
      <div
        ref={floatRef}
        role="dialog"
        aria-label={t('引用这段话')}
        data-testid="selection-quote-box"
        className={BOX_CLS}
      >
        <p
          data-testid="selection-quote-text"
          className="m-0 truncate border-l-2 border-border pl-2.5 text-meta text-content-secondary"
        >
          {target.text}
        </p>
        <Textarea
          data-testid="selection-quote-input"
          aria-label={t('针对这段话说点什么')}
          placeholder={t('针对这段话说点什么…')}
          rows={1}
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onBoxKey}
          className="max-h-30 min-h-6 resize-none border-0 bg-transparent p-0 outline-hidden text-ui text-foreground placeholder:text-content-tertiary focus-visible:ring-0 md:text-ui dark:bg-transparent"
        />
        <div
          data-testid="selection-quote-hint"
          className="flex flex-wrap items-center gap-1 text-caption text-content-tertiary"
        >
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-testid="selection-quote-add"
            className="h-6 gap-1.5 px-1.5 text-caption font-normal text-content-secondary hover:text-foreground"
            onClick={() => {
              onAddQuote(draft, text.trim());
              dismiss();
            }}
          >
            <ShortcutHint keys={['enter']} />
            {t('加到输入框')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-testid="selection-quote-send"
            disabled={text.trim() === ''}
            className="h-6 gap-1.5 px-1.5 text-caption font-normal text-content-secondary hover:text-foreground"
            onClick={() => {
              if (text.trim() === '') return;
              onSendQuote(draft, text.trim());
              dismiss();
            }}
          >
            <ShortcutHint keys={['mod', 'enter']} />
            {t('直接发送')}
          </Button>
        </div>
      </div>
    ) : (
      <div
        ref={floatRef}
        role="toolbar"
        aria-label={t('选中文字的操作')}
        data-testid="selection-reply-bar"
        data-source={target.sourceMessageId}
        className={PILL_CLS}
      >
        <Button
          variant="ghost"
          data-testid="selection-quote"
          aria-keyshortcuts="R"
          className={cn(PILL_BUTTON_CLS, 'pr-1.5')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={openBox}
        >
          <TextQuote aria-hidden strokeWidth={1.75} className="size-4" />
          {t('引用')}
          <ShortcutHint keys={['R']} className="ml-0.5" />
        </Button>
      </div>
    ),
    document.body,
  );
}
