import { cn } from 'cn';
import { Ellipsis, ListChecks, Reply, X } from 'lucide-react';
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button, PlainButton } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { useI18n } from '../i18n/provider.js';
import { Copy, Restore } from '../icons/index.js';

export type ToolbarPlacement = 'right' | 'left' | 'below-start' | 'below-end';

const TOOL_BTN_CLS =
  "size-8 cursor-pointer rounded-(--radius-control) border-none bg-transparent text-(--foreground) transition-none hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover) aria-expanded:bg-(--menu-hover) [&_svg:not([class*='size-'])]:size-auto";

const PILL_CLS =
  'flex flex-none items-center rounded-(--radius-tile) bg-popover p-px shadow-(--e2)';

const HOVER_REVEAL =
  'pointer-events-none opacity-0 group-hover/reply-block:pointer-events-auto group-hover/reply-block:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100 pointer-coarse:hidden';

const TOUCH_REVEAL = 'pointer-coarse:group-data-[tools-open]/message:flex';

const PLACEMENT_CLS: Record<ToolbarPlacement, string> = {
  right: `absolute top-1/2 left-full z-10 -translate-y-1/2 pl-3 data-clamped:top-0 ${HOVER_REVEAL}`,
  left: `absolute top-1/2 right-full z-10 -translate-y-1/2 pr-3 data-clamped:top-0 ${HOVER_REVEAL}`,
  'below-start': `mt-1 hidden ${TOUCH_REVEAL}`,
  'below-end': `mt-1 hidden justify-end self-end ${TOUCH_REVEAL}`,
};

const EDGE_GAP = 8;

function clipEdges(node: HTMLElement): { left: number; right: number; top: number } {
  let left = EDGE_GAP;
  let right = document.documentElement.clientWidth - EDGE_GAP;
  let top = 0;
  for (let up = node.parentElement; up !== null; up = up.parentElement) {
    const style = getComputedStyle(up);
    const clipsOverflow = style.overflowX !== 'visible' || style.overflowY !== 'visible';
    const paintsInside =
      style.contentVisibility === 'auto' || /paint|content|strict/.test(style.contain);
    if (!clipsOverflow && !paintsInside) continue;
    const box = up.getBoundingClientRect();
    const inset = clipsOverflow ? EDGE_GAP : 0;
    left = Math.max(left, box.left + inset);
    right = Math.min(right, box.right - inset);
    if (style.overflowY !== 'visible' || paintsInside) top = Math.max(top, box.top);
  }
  return { left, right, top };
}

function useArmed(ref: RefObject<HTMLDivElement | null>): boolean {
  const [armed, setArmed] = useState(false);
  const focusTool = useRef<string | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    const block = node?.parentElement;
    if (armed || node == null || block == null) return;
    const arm = (event: Event) => {
      const tool = event.target instanceof Element ? event.target.closest('[data-tool]') : null;
      if (event.type === 'focusin' && tool !== null)
        focusTool.current = tool.getAttribute('data-tool');
      flushSync(() => setArmed(true));
    };
    node.addEventListener('pointerenter', arm);
    node.addEventListener('focusin', arm);
    block.addEventListener('pointerdown', arm);
    return () => {
      node.removeEventListener('pointerenter', arm);
      node.removeEventListener('focusin', arm);
      block.removeEventListener('pointerdown', arm);
    };
  }, [armed, ref]);
  useLayoutEffect(() => {
    const tool = focusTool.current;
    if (!armed || tool === null) return;
    focusTool.current = null;
    ref.current?.querySelector<HTMLElement>(`[data-tool="${tool}"]`)?.focus();
  }, [armed, ref]);
  return armed;
}

function useKeepInside(ref: RefObject<HTMLDivElement | null>, placement: ToolbarPlacement) {
  useLayoutEffect(() => {
    const node = ref.current;
    const block = node?.parentElement;
    if (node == null || block == null || (placement !== 'right' && placement !== 'left')) return;
    const fit = () => {
      node.style.transform = '';
      delete node.dataset.clamped;
      const edges = clipEdges(node);
      const shiftFor = (box: DOMRect) =>
        placement === 'right'
          ? Math.min(0, edges.right - box.right)
          : Math.max(0, edges.left - box.left);
      if (shiftFor(node.getBoundingClientRect()) === 0) return;
      node.dataset.clamped = '';
      const onEdge = node.getBoundingClientRect();
      const drop = Math.max(0, edges.top - onEdge.top);
      node.style.transform = `translate(${shiftFor(onEdge)}px, ${drop}px)`;
    };
    block.addEventListener('pointerenter', fit);
    block.addEventListener('focusin', fit);
    return () => {
      block.removeEventListener('pointerenter', fit);
      block.removeEventListener('focusin', fit);
    };
  }, [placement, ref]);
}

export function MessageToolbar({
  placement,
  stamp,
  note,
  onReply,
  onCopy,
  onRewind,
  onSteps,
  onDismiss,
  testId,
}: {
  placement: ToolbarPlacement;
  stamp: ReactNode;
  note?: ReactNode;
  onReply?: (() => void) | undefined;
  onCopy: () => void;
  onRewind?: (() => void) | undefined;
  onSteps?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
  testId: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  const armed = useArmed(ref);
  useKeepInside(ref, placement);
  const pill = !armed ? (
    <div className={PILL_CLS} data-slot="message-toolbar-pill">
      {onReply !== undefined && (
        <PlainButton
          variant="ghost"
          size="icon"
          className={TOOL_BTN_CLS}
          aria-label={t('回复')}
          data-testid="chief-msg-reply"
          data-tool="reply"
        >
          <Reply width={22} height={22} />
        </PlainButton>
      )}
      <PlainButton
        variant="ghost"
        size="icon"
        className={TOOL_BTN_CLS}
        aria-label={t('更多')}
        aria-haspopup="menu"
        aria-expanded="false"
        data-testid="chief-msg-more"
        data-tool="more"
      >
        <Ellipsis width={22} height={22} />
      </PlainButton>
    </div>
  ) : (
    <div className={PILL_CLS} data-slot="message-toolbar-pill">
      {onReply !== undefined && (
        <IconTooltip
          label={t('回复')}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className={TOOL_BTN_CLS}
              data-testid="chief-msg-reply"
              data-tool="reply"
              onClick={onReply}
            />
          }
        >
          <Reply width={22} height={22} />
        </IconTooltip>
      )}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className={TOOL_BTN_CLS}
                    aria-label={t('更多')}
                    data-testid="chief-msg-more"
                    data-tool="more"
                  />
                }
              />
            }
          >
            <Ellipsis width={22} height={22} />
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            {t('更多')}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" aria-label={t('更多')} className="w-auto min-w-40">
          <DropdownMenuItem data-action="copy" data-testid="chief-msg-copy" onClick={onCopy}>
            <Copy width={20} height={20} />
            {t('复制')}
          </DropdownMenuItem>
          {onSteps !== undefined && (
            <DropdownMenuItem data-action="steps" data-testid="chief-msg-steps" onClick={onSteps}>
              <ListChecks width={20} height={20} />
              {t('查看步骤')}
            </DropdownMenuItem>
          )}
          {onRewind !== undefined && (
            <DropdownMenuItem data-action="rewind" onClick={onRewind}>
              <Restore width={20} height={20} />
              {t('恢复到此处')}
            </DropdownMenuItem>
          )}
          {onDismiss !== undefined && (
            <DropdownMenuItem
              variant="destructive"
              data-testid="chief-question-dismiss"
              onClick={onDismiss}
            >
              <X width={20} height={20} />
              {t('取消提问')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
  const meta =
    stamp == null && note == null ? null : (
      <span
        className="flex items-center gap-2 text-caption whitespace-nowrap text-(--text-tertiary) group-data-clamped/toolbar:rounded-(--radius-control) group-data-clamped/toolbar:bg-popover group-data-clamped/toolbar:px-1.5 group-data-clamped/toolbar:py-0.5 group-data-clamped/toolbar:shadow-(--e2)"
        data-slot="message-toolbar-meta"
      >
        {stamp}
        {note}
      </span>
    );
  return (
    <div
      ref={ref}
      className={cn('group/toolbar flex items-center gap-3', PLACEMENT_CLS[placement])}
      data-testid={testId}
      data-placement={placement}
    >
      {placement === 'left' || placement === 'below-end' ? (
        <>
          {meta}
          {pill}
        </>
      ) : (
        <>
          {pill}
          {meta}
        </>
      )}
    </div>
  );
}
