import { cn } from 'cn';
import { Ellipsis, Reply, Undo, X } from 'lucide-react';
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { IconTooltip } from '../components/icon-tooltip.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { Button, PlainButton } from '../components/ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { useI18n } from '../i18n/provider.js';
import { Copy, Restore } from '../icons/index.js';

export type ToolbarPlacement = 'below-start' | 'below-end';
export type ToolbarMode = 'both' | 'hover' | 'touch';

const TOOL_BTN_CLS =
  "size-6 cursor-pointer pointer-coarse:size-11 rounded-(--radius-control) border-none bg-transparent text-(--text-tertiary) transition-none hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover) aria-expanded:bg-(--menu-hover) aria-expanded:text-foreground [&_svg:not([class*='size-'])]:size-auto";

const TOOLS_CLS = 'flex flex-none items-center gap-1';

const HOVER_REVEAL =
  'pointer-events-none opacity-0 group-hover/reply-block:pointer-events-auto group-hover/reply-block:opacity-100 has-focus-visible:pointer-events-auto has-focus-visible:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100';

const PLACEMENT_CLS: Record<ToolbarPlacement, string> = {
  'below-start': 'left-0 justify-start',
  'below-end': 'right-0 justify-end',
};

const TOUCH_ALIGN_CLS: Record<ToolbarPlacement, string> = {
  'below-start': 'pointer-coarse:self-start',
  'below-end': 'pointer-coarse:self-end',
};

const MODE_CLS: Record<ToolbarMode, string> = {
  both: `absolute top-full z-10 flex w-max ${HOVER_REVEAL} pointer-coarse:static pointer-coarse:mt-1 pointer-coarse:hidden pointer-coarse:w-auto pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:group-data-[tools-open]/message:flex`,
  hover: `absolute top-full z-10 flex w-max ${HOVER_REVEAL} pointer-coarse:hidden`,
  touch: 'mt-1 hidden pointer-coarse:group-data-[tools-open]/message:flex',
};

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
    block.addEventListener('pointerenter', arm);
    block.addEventListener('pointerdown', arm);
    return () => {
      node.removeEventListener('pointerenter', arm);
      node.removeEventListener('focusin', arm);
      block.removeEventListener('pointerenter', arm);
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

export function MessageToolbar({
  placement,
  mode = 'both',
  stamp,
  note,
  onReply,
  onCopy,
  onRewind,
  onDismiss,
  onWithdraw,
  testId,
}: {
  placement: ToolbarPlacement;
  mode?: ToolbarMode;
  stamp: ReactNode;
  note?: ReactNode;
  onReply?: (() => void) | undefined;
  onCopy: () => void;
  onRewind?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
  onWithdraw?: (() => void) | undefined;
  testId: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  const armed = useArmed(ref);
  const hasMenu = onRewind !== undefined || onDismiss !== undefined;
  const tools = !armed ? (
    <div className={TOOLS_CLS} data-slot="message-toolbar-tools" data-unarmed>
      <PlainButton
        variant="ghost"
        size="icon"
        className={TOOL_BTN_CLS}
        aria-label={t('复制')}
        data-testid="chief-msg-copy"
        data-tool="copy"
      >
        <Copy width={16} height={16} />
      </PlainButton>
      {onReply !== undefined && (
        <PlainButton
          variant="ghost"
          size="icon"
          className={TOOL_BTN_CLS}
          aria-label={t('回复')}
          data-testid="chief-msg-reply"
          data-tool="reply"
        >
          <Reply width={16} height={16} />
        </PlainButton>
      )}
      {onWithdraw !== undefined && (
        <PlainButton
          variant="ghost"
          size="icon"
          className={TOOL_BTN_CLS}
          aria-label={t('撤回')}
          data-testid="chief-steer-withdraw"
          data-tool="withdraw"
        >
          <Undo width={16} height={16} />
        </PlainButton>
      )}
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
          <Ellipsis width={16} height={16} />
        </PlainButton>
      )}
    </div>
  ) : (
    <div className={TOOLS_CLS} data-slot="message-toolbar-tools">
      <IconTooltip
        label={t('复制')}
        side="bottom"
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
        <Copy width={16} height={16} />
      </IconTooltip>
      {onReply !== undefined && (
        <IconTooltip
          label={t('回复')}
          side="bottom"
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
          <Reply width={16} height={16} />
        </IconTooltip>
      )}
      {onWithdraw !== undefined && (
        <IconTooltip
          label={t('撤回')}
          side="bottom"
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
          <Undo width={16} height={16} />
        </IconTooltip>
      )}
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
              <Ellipsis width={16} height={16} />
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              {t('更多')}
            </TooltipContent>
          </Tooltip>
          <KeyedMenuContent
            align={placement === 'below-end' ? 'end' : 'start'}
            aria-label={t('更多')}
            className="w-auto min-w-40"
          >
            {onRewind !== undefined && (
              <KeyedMenuItem shortcut="R" data-action="rewind" onClick={onRewind}>
                <Restore width={20} height={20} />
                {t('恢复到此处')}
              </KeyedMenuItem>
            )}
            {onDismiss !== undefined && (
              <KeyedMenuItem
                shortcut="D"
                variant="destructive"
                data-testid="chief-question-dismiss"
                onClick={onDismiss}
              >
                <X width={20} height={20} />
                {t('取消提问')}
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
        'group/toolbar items-center gap-2',
        MODE_CLS[mode],
        mode === 'touch'
          ? placement === 'below-end'
            ? 'justify-end self-end'
            : 'justify-start self-start'
          : PLACEMENT_CLS[placement],
        mode === 'both' && TOUCH_ALIGN_CLS[placement],
      )}
      data-testid={testId}
      data-placement={placement}
    >
      {placement === 'below-end' ? (
        <>
          {meta}
          {tools}
        </>
      ) : (
        <>
          {tools}
          {meta}
        </>
      )}
    </div>
  );
}
