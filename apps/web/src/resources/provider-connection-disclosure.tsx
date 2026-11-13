import type { ReactNode } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/ui/collapsible.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronRight } from '../icons/index.js';

export function ProviderConnectionDisclosure({
  summary,
  open,
  onOpenChange,
  children,
}: {
  summary: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="group/conn rounded-md ring-1 ring-border"
    >
      <CollapsibleTrigger className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <ChevronRight className="size-4 flex-none text-content-tertiary transition-transform duration-(--dur-fast) group-data-open/conn:rotate-90" />
        <span className="flex-none text-ui font-medium text-foreground">{t('连接设置')}</span>
        <span className="min-w-0 truncate text-meta text-content-tertiary">{summary}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 border-t border-border px-3 pt-3 pb-4">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
