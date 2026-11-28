import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { useI18n } from '../i18n/provider.js';
import { useRunLinkTo } from './run-trace-api.js';
import { markRunTraceHintSeen, useRunTraceHintSeen } from './run-trace-hint.js';

export function RunLogButton({
  threadId,
  state,
  tooltip,
  hintWanted,
  hintBelow,
  className,
  children,
}: {
  threadId: string;
  state: string;
  tooltip: string;
  hintWanted: boolean;
  hintBelow: boolean;
  className: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const linkTo = useRunLinkTo();
  const hintSeen = useRunTraceHintSeen();
  const open = () => {
    markRunTraceHintSeen();
    navigate(linkTo(null, { thread: threadId, scope: null, problems: null }));
  };
  return (
    <div className="pointer-events-auto relative">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              aria-label={t('Coordinator 运行记录')}
              aria-description={state}
              data-slot="status-mark-glyph"
              data-testid="chief-status-mark-button"
              className={`${className} cursor-pointer rounded-full border-0 p-0 hover:bg-transparent dark:hover:bg-transparent`}
              onClick={open}
            />
          }
        >
          {children}
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8}>
          {`${tooltip} · ${t('点击查看运行记录')}`}
        </TooltipContent>
      </Tooltip>
      {hintWanted && !hintSeen && (
        <span
          data-testid="run-trace-hint"
          data-side={hintBelow ? 'below' : 'right'}
          className="absolute flex items-center data-[side=below]:top-full data-[side=below]:left-1/2 data-[side=below]:-translate-x-1/2 data-[side=right]:top-1/2 data-[side=right]:left-full data-[side=right]:ml-1 data-[side=right]:-translate-y-1/2 gap-0.5 rounded-full bg-popover py-0.5 pr-0.5 pl-3 text-meta whitespace-nowrap text-foreground shadow-(--shadow-popover)"
        >
          <Button
            variant="ghost"
            size="xs"
            className="rounded-full pointer-coarse:min-h-11"
            onClick={open}
          >
            {t('点这里看每一轮做了什么')}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('不再提示')}
            data-testid="run-trace-hint-close"
            className="rounded-full text-content-tertiary pointer-coarse:size-11"
            onClick={markRunTraceHintSeen}
          >
            <X />
          </Button>
        </span>
      )}
    </div>
  );
}
