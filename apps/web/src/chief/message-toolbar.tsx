import { cn } from 'cn';
import { Ellipsis, Reply, Undo } from 'lucide-react';
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { IconTooltip } from '../components/icon-tooltip.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { Button, PlainButton } from '../components/ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { useI18n } from '../i18n/provider.js';
import { Copy, Restore } from '../icons/index.js';

export type ToolbarPlacement = 'right' | 'left' | 'below-start' | 'below-end';

const TOOL_BTN_CLS =
  "size-8 cursor-pointer pointer-coarse:size-11 rounded-(--radius-control) border-none bg-transparent text-(--text-tertiary) transition-none hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover) aria-expanded:bg-(--menu-hover) aria-expanded:text-foreground [&_svg:not([class*='size-'])]:size-auto";

const TOOLS_CLS = 'flex flex-none items-center';

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

const CONTROL_SELECTOR = 'button, a[href], [role="button"], input, select, textarea';

function blockControls(block: HTMLElement, toolbar: HTMLElement): DOMRect[] {
  return [...block.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)]
    .filter((control) => !toolbar.contains(control))
    .map((control) => control.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0);
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
      let shift = shiftFor(onEdge);
      let drop = Math.max(0, edges.top - onEdge.top);
      const covered = () =>
        blockControls(block, node).filter(
          (control) =>
            control.left < onEdge.right + shift &&
            onEdge.left + shift < control.right &&
            control.top < onEdge.bottom + drop &&
            onEdge.top + drop < control.bottom,
        );
      const underToolbar = covered();
      if (underToolbar.length > 0) {
        shift =
          placement === 'right'
            ? Math.max(
                edges.left - onEdge.left,
                Math.min(...underToolbar.map((c) => c.left)) - EDGE_GAP - onEdge.right,
              )
            : Math.min(
                edges.right - onEdge.right,
                Math.max(...underToolbar.map((c) => c.right)) + EDGE_GAP - onEdge.left,
              );
        const controlsTop = Math.min(...underToolbar.map((c) => c.top));
        const controlsBottom = Math.max(...underToolbar.map((c) => c.bottom));
        drop = (controlsTop + controlsBottom - onEdge.top - onEdge.bottom) / 2;
        const stillUnder = covered();
        if (stillUnder.length > 0)
          drop = Math.max(...stillUnder.map((c) => c.bottom)) + EDGE_GAP - onEdge.top;
      }
      node.style.transform = `translate(${shift}px, ${drop}px)`;
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
  onWithdraw,
  testId,
}: {
  placement: ToolbarPlacement;
  stamp: ReactNode;
  note?: ReactNode;
  onReply?: (() => void) | undefined;
  onCopy: () => void;
  onRewind?: (() => void) | undefined;
  onWithdraw?: (() => void) | undefined;
  testId: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  const armed = useArmed(ref);
  useKeepInside(ref, placement);
  const withdraw = onWithdraw !== undefined && (
    <IconTooltip
      label={t('撤回')}
      trigger={
        <Button
          variant="ghost"
          size="icon"
          className={TOOL_BTN_CLS}
          data-testid="chief-steer-withdraw"
          data-tool="withdraw"
          onClick={onWithdraw}
        />
      }
    >
      <Undo width={20} height={20} />
    </IconTooltip>
  );
  const hasMenu = onRewind !== undefined;
  const pill = !armed ? (
    <div className={TOOLS_CLS} data-slot="message-toolbar-tools" data-unarmed>
      {withdraw}
      {onReply !== undefined && (
        <PlainButton
          variant="ghost"
          size="icon"
          className={TOOL_BTN_CLS}
          aria-label={t('回复')}
          data-testid="chief-msg-reply"
          data-tool="reply"
        >
          <Reply width={20} height={20} />
        </PlainButton>
      )}
      <PlainButton
        variant="ghost"
        size="icon"
        className={TOOL_BTN_CLS}
        aria-label={t('复制')}
        data-testid="chief-msg-copy"
        data-tool="copy"
      >
        <Copy width={20} height={20} />
      </PlainButton>
      {hasMenu && (
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
          <Ellipsis width={20} height={20} />
        </PlainButton>
      )}
    </div>
  ) : (
    <div className={TOOLS_CLS} data-slot="message-toolbar-tools">
      {withdraw}
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
          <Reply width={20} height={20} />
        </IconTooltip>
      )}
      <IconTooltip
        label={t('复制')}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className={TOOL_BTN_CLS}
            data-testid="chief-msg-copy"
            data-tool="copy"
            onClick={onCopy}
          />
        }
      >
        <Copy width={20} height={20} />
      </IconTooltip>
      {hasMenu && (
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
              <Ellipsis width={20} height={20} />
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              {t('更多')}
            </TooltipContent>
          </Tooltip>
          <KeyedMenuContent align="start" aria-label={t('更多')} className="w-auto min-w-40">
            {onRewind !== undefined && (
              <KeyedMenuItem shortcut="R" data-action="rewind" onClick={onRewind}>
                <Restore width={20} height={20} />
                {t('恢复到此处')}
              </KeyedMenuItem>
            )}
          </KeyedMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
  const meta =
    stamp == null && note == null ? null : (
      <span
        className="flex items-center gap-2 text-caption whitespace-nowrap text-(--text-tertiary) group-data-clamped/toolbar:rounded-(--radius-control) group-data-clamped/toolbar:bg-popover group-data-clamped/toolbar:px-1.5 group-data-clamped/toolbar:py-0.5 group-data-clamped/toolbar:shadow-(--e1)"
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
