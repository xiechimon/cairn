import { useI18n } from '../i18n/provider.js';
import { Skeleton } from './ui/skeleton.js';

const REPLY_LINES = ['w-full', 'w-11/12', 'w-4/5', 'w-2/3'];

export function ConversationSkeleton({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <div
      data-testid="conversation-skeleton"
      aria-busy="true"
      className={`mx-auto flex w-[calc(100%-2rem)] max-w-chat flex-col gap-8 pt-[10vh] ${className ?? ''}`}
    >
      <span role="status" className="sr-only">
        {t('正在加载对话')}
      </span>
      <Skeleton className="ml-auto h-9 w-2/5 rounded-2xl animate-none" />
      <div className="flex flex-col gap-3">
        {REPLY_LINES.map((width) => (
          <Skeleton key={width} className={`h-3.5 ${width} animate-none`} />
        ))}
      </div>
    </div>
  );
}
