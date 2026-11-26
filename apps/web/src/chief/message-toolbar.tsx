import { cn } from 'cn';
import { Check, Ellipsis, Undo } from 'lucide-react';
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { IconTooltip } from '../components/icon-tooltip.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { Button, PlainButton } from '../components/ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { useI18n } from '../i18n/provider.js';
import { Copy, Restore } from '../icons/index.js';

export type ToolbarPlacement =
  | 'left'
  | 'below-start'
  | 'below-start-hover'
  | 'top-end-hover'
  | 'below-end';

const TOOL_BTN_CLS =
  "size-8 cursor-pointer pointer-coarse:size-11 rounded-(--radius-control) border-none bg-transparent text-(--text-tertiary) transition-none hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover) aria-expanded:bg-(--menu-hover) aria-expanded:text-foreground [&_svg:not([class*='size-'])]:size-auto group-data-clamped/toolbar:size-6 group-data-clamped/toolbar:[&_svg]:size-4! group-data-[placement=below-start-hover]/toolbar:size-7 group-data-[placement=below-start-hover]/toolbar:[&_svg]:size-4! group-data-[placement=top-end-hover]/toolbar:size-7 group-data-[placement=top-end-hover]/toolbar:[&_svg]:size-4!";

const TOOLS_CLS = 'flex flex-none items-center';

const HOVER_REVEAL =
  'pointer-events-none opacity-0 transition-opacity duration-(--dur-fast) ease-(--ease-standard) group-hover/reply-block:pointer-events-auto group-hover/reply-block:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100 motion-reduce:transition-none pointer-coarse:hidden';

const TOUCH_REVEAL = 'pointer-coarse:group-data-[tools-open]/message:flex';

const CLAMPED_BASE =
  'data-clamped:translate-y-0 data-clamped:gap-2 data-[clamped=below]:top-full data-[clamped=above]:top-auto data-[clamped=above]:bottom-full';

const PLACEMENT_CLS: Record<ToolbarPlacement, string> = {
  left: `absolute top-1/2 right-full z-10 -translate-y-1/2 pr-3 data-clamped:right-0 data-clamped:pr-0 ${CLAMPED_BASE} ${HOVER_REVEAL}`,
  'below-start': `mt-1 hidden ${TOUCH_REVEAL}`,
  'below-start-hover': `absolute top-full left-0 z-10 mt-0.5 rounded-(--radius-control) bg-background/95 before:absolute before:inset-x-0 before:-top-0.5 before:h-0.5 before:content-[''] ${HOVER_REVEAL}`,
  'top-end-hover': `absolute -top-px right-0 z-10 rounded-(--radius-control) border border-border bg-background ${HOVER_REVEAL}`,
  'below-end': `mt-1 hidden justify-end self-end ${TOUCH_REVEAL}`,
};

const EDGE_GAP = 8;

function clipEdges(node: HTMLElement): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  let left = EDGE_GAP;
  let right = document.documentElement.clientWidth - EDGE_GAP;
  let top = 0;
  let bottom = document.documentElement.clientHeight;
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
    if (style.overflowY !== 'visible' || paintsInside) {
      top = Math.max(top, box.top);
      bottom = Math.min(bottom, box.bottom);
    }
  }
  return { left, right, top, bottom };
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
    if (node == null || block == null || placement !== 'left') return;
    const fit = () => {
      node.style.transform = '';
      delete node.dataset.clamped;
      const edges = clipEdges(node);
      if (node.getBoundingClientRect().left >= edges.left) return;
      node.dataset.clamped = 'below';
      let box = node.getBoundingClientRect();
      if (
        box.bottom > edges.bottom + 1 &&
        block.getBoundingClientRect().top - box.height >= edges.top
      ) {
        node.dataset.clamped = 'above';
        box = node.getBoundingClientRect();
      }
      let shift = 0;
      if (box.right > edges.right) shift = edges.right - box.right;
      if (box.left + shift < edges.left) shift = edges.left - box.left;
      if (shift !== 0) node.style.transform = `translateX(${shift}px)`;
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
  onCopy,
  onRewind,
  rewindDisabled = false,
  onWithdraw,
  testId,
}: {
  placement: ToolbarPlacement;
  stamp: ReactNode;
  note?: ReactNode;
  onCopy: () => void;
  onRewind?: (() => void) | undefined;
  rewindDisabled?: boolean;
  onWithdraw?: (() => void) | undefined;
  testId: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  const armed = useArmed(ref);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  useKeepInside(ref, placement);
  const hasMenu = onWithdraw !== undefined || onRewind !== undefined;
  const handleCopy = () => {
    onCopy();
    setCopied(true);
  };
  const pill = !armed ? (
    <div className={TOOLS_CLS} data-slot="message-toolbar-tools" data-unarmed>
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
      <IconTooltip
        label={copied ? t('已复制') : t('复制')}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className={TOOL_BTN_CLS}
            data-testid="chief-msg-copy"
            data-tool="copy"
            data-copied={copied ? '' : undefined}
            onClick={handleCopy}
          />
        }
      >
        <span className="relative inline-grid place-items-center" aria-hidden="true">
          <span
            data-slot="copy-icon"
            className={cn(
              'col-start-1 row-start-1 grid place-items-center transition-[opacity,scale] duration-(--dur-fast) ease-(--ease-out-strong) motion-reduce:transition-none',
              copied ? 'scale-50 opacity-0' : 'scale-100 opacity-100',
            )}
          >
            <Copy width={20} height={20} />
          </span>
          <span
            data-slot="check-icon"
            className={cn(
              'check-scale col-start-1 row-start-1 grid place-items-center',
              copied ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
            )}
          >
            <Check width={20} height={20} />
          </span>
        </span>
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
            {onWithdraw !== undefined && (
              <KeyedMenuItem shortcut="W" data-testid="chief-steer-withdraw" onClick={onWithdraw}>
                <Undo width={20} height={20} />
                {t('撤回')}
              </KeyedMenuItem>
            )}
            {onRewind !== undefined && (
              <KeyedMenuItem
                shortcut="R"
                data-action="rewind"
                disabled={rewindDisabled}
                onClick={onRewind}
              >
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
        className="flex items-center gap-2 text-caption whitespace-nowrap text-(--text-tertiary)"
        data-slot="message-toolbar-meta"
      >
        {stamp}
        {note}
      </span>
    );
  return (
    <div
      ref={ref}
      className={cn(
        'group/toolbar flex items-center gap-3',
        PLACEMENT_CLS[placement],
        placement === 'below-start-hover' && meta !== null && 'pr-1.5',
      )}
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
