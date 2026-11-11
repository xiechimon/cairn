import { cn } from 'cn';
import { Ellipsis, Reply } from 'lucide-react';
import type { ReactNode } from 'react';
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

const PLACEMENT_CLS: Record<ToolbarPlacement, string> = {
  right: `absolute top-1/2 left-full z-10 -translate-y-1/2 pl-3 ${HOVER_REVEAL}`,
  left: `absolute top-1/2 right-full z-10 -translate-y-1/2 pr-3 ${HOVER_REVEAL}`,
  'below-start': 'mt-1 hidden pointer-coarse:flex',
  'below-end': 'mt-1 hidden justify-end self-end pointer-coarse:flex',
};

export function MessageToolbar({
  placement,
  stamp,
  note,
  onReply,
  onCopy,
  onRewind,
  testId,
}: {
  placement: ToolbarPlacement;
  stamp: ReactNode;
  note?: ReactNode;
  onReply?: (() => void) | undefined;
  onCopy: () => void;
  onRewind?: (() => void) | undefined;
  testId: string;
}) {
  const { t } = useI18n();
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
          <Reply width={18} height={18} />
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
            <Ellipsis width={18} height={18} />
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            {t('更多')}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" aria-label={t('更多')} className="w-auto min-w-40">
          <DropdownMenuItem data-action="copy" data-testid="chief-msg-copy" onClick={onCopy}>
            <Copy width={16} height={16} />
            {t('复制')}
          </DropdownMenuItem>
          {onRewind !== undefined && (
            <DropdownMenuItem data-action="rewind" onClick={onRewind}>
              <Restore width={16} height={16} />
              {t('恢复到此处')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
  const meta = (
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
      className={cn('flex items-center gap-3', PLACEMENT_CLS[placement])}
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
