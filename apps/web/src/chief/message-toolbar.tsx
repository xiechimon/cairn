import { cn } from 'cn';
import { Ellipsis, ListChecks, Reply, X } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
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

const HOVER_REVEAL =
  'pointer-events-none opacity-0 group-hover/reply-block:pointer-events-auto group-hover/reply-block:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100 pointer-coarse:hidden';

const TOUCH_REVEAL = 'pointer-coarse:group-data-[tools-open]/message:flex';

const PLACEMENT_CLS: Record<ToolbarPlacement, string> = {
  right: `absolute top-1/2 left-full z-10 -translate-y-1/2 pl-3 ${HOVER_REVEAL}`,
  left: `absolute top-1/2 right-full z-10 -translate-y-1/2 pr-3 ${HOVER_REVEAL}`,
  'below-start': `mt-1 hidden ${TOUCH_REVEAL}`,
  'below-end': `mt-1 hidden justify-end self-end ${TOUCH_REVEAL}`,
};

function clipEdges(node: HTMLElement): { left: number; right: number } {
  let left = 0;
  let right = document.documentElement.clientWidth;
  for (let up = node.parentElement; up !== null; up = up.parentElement) {
    const style = getComputedStyle(up);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const box = up.getBoundingClientRect();
    left = Math.max(left, box.left);
    right = Math.min(right, box.right);
  }
  return { left, right };
}

const EDGE_GAP = 8;

function useKeepInside(placement: ToolbarPlacement) {
  const ref = useRef<HTMLDivElement | null>(null);
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
          ? Math.min(0, edges.right - EDGE_GAP - box.right)
          : Math.max(0, edges.left + EDGE_GAP - box.left);
      if (shiftFor(node.getBoundingClientRect()) === 0) return;
      node.dataset.clamped = '';
      node.style.transform = `translateX(${shiftFor(node.getBoundingClientRect())}px)`;
    };
    block.addEventListener('pointerenter', fit);
    block.addEventListener('focusin', fit);
    return () => {
      block.removeEventListener('pointerenter', fit);
      block.removeEventListener('focusin', fit);
    };
  }, [placement]);
  return ref;
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
  const keepInside = useKeepInside(placement);
  const pill = (
    <div
      className="flex flex-none items-center rounded-(--radius-tile) bg-popover p-px shadow-(--e2)"
      data-slot="message-toolbar-pill"
    >
      {onReply !== undefined && (
        <IconTooltip
          label={t('回复')}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className={TOOL_BTN_CLS}
              data-testid="chief-msg-reply"
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
  const meta = (
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
      ref={keepInside}
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
