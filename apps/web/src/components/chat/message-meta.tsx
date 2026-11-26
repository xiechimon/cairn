import { cn } from 'cn';
import { Undo } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { CopyIconButton } from '../copy-icon-button.js';
import { Button } from '../ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import type { MessageSide } from './message-bubble.js';
import {
  type MessageActions,
  MessagePressMenu,
  useMessagePressMenu,
} from './message-press-menu.js';
import { MessageTime } from './message-time.js';

const TOOL_CLS =
  'size-7 cursor-pointer rounded-(--radius-control) text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-foreground';

const REVEAL_CLS =
  'opacity-0 transition-opacity duration-(--dur-fast) ease-(--ease-standard) group-hover/message:opacity-100 focus-within:opacity-100 motion-reduce:transition-none';

const PLACE_CLS = {
  owner: 'absolute right-full bottom-1 mr-2',
  coordinator: 'absolute left-full bottom-1 ml-2 flex-row-reverse',
} as const;

export function MessageMeta({
  side,
  actions,
  note,
  disabled = false,
  streaming = false,
  placement = 'beside',
  children,
}: {
  side: MessageSide;
  actions: MessageActions;
  note?: ReactNode;
  disabled?: boolean;
  streaming?: boolean;
  placement?: 'beside' | 'below';
  children: ReactElement;
}) {
  const pressMenu = useMessagePressMenu();
  if (pressMenu)
    return (
      <>
        <MessagePressMenu actions={actions} disabled={disabled || streaming}>
          {children}
        </MessagePressMenu>
        {note != null && <MessageNote side={side}>{note}</MessageNote>}
      </>
    );
  const tools = !streaming && <MessageTools side={side} actions={actions} placement={placement} />;
  return (
    <>
      {placement === 'beside' ? (
        <div className="relative w-fit max-w-full" data-slot="message-anchor">
          {children}
          {tools}
        </div>
      ) : (
        <>
          {children}
          {tools}
        </>
      )}
      {note != null && <MessageNote side={side}>{note}</MessageNote>}
    </>
  );
}

function MessageNote({ side, children }: { side: MessageSide; children: ReactNode }) {
  return (
    <div
      className={cn(
        'mt-1 flex min-w-0 items-center text-caption text-(--text-tertiary)',
        side === 'owner' ? 'self-end' : 'self-start',
      )}
      data-slot="message-note"
    >
      {children}
    </div>
  );
}

function MessageTools({
  side,
  actions,
  placement,
}: {
  side: MessageSide;
  actions: MessageActions;
  placement: 'beside' | 'below';
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 whitespace-nowrap text-caption text-(--text-tertiary)',
        REVEAL_CLS,
        placement === 'beside' ? PLACE_CLS[side] : 'min-h-7 self-start',
      )}
      data-slot="message-meta"
    >
      <MessageTime
        at={actions.at}
        fallback={actions.fallbackAt}
        className={placement === 'beside' && side === 'coordinator' ? 'ml-1.5' : 'mr-1.5'}
      />
      <CopyIconButton
        text={actions.text}
        testId="message-copy"
        size="icon-sm"
        className={TOOL_CLS}
        replaceClassName
      />
      {actions.onWithdraw !== undefined && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className={TOOL_CLS}
                aria-label={t('撤回')}
                data-testid="chief-steer-withdraw"
                onClick={actions.onWithdraw}
              />
            }
          >
            <Undo width={16} height={16} />
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            {t('撤回')}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
