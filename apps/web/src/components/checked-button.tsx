import { cn } from 'cn';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { relativeTime } from '../board/rel-time.js';
import { useI18n } from '../i18n/provider.js';
import { Button } from './ui/button.js';

const CHECKED_TICK_MS = 30_000;

export function CheckedButton({
  updatedAt,
  fetching,
  onRefresh,
}: {
  updatedAt: number;
  fetching: boolean;
  onRefresh?: () => void;
}) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CHECKED_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const ago = relativeTime(updatedAt, Math.max(now, updatedAt), t);
  const label = t('已检查 {ago}', { ago });
  const icon = (
    <RefreshCw
      aria-hidden
      strokeWidth={1.75}
      className={cn('size-4', fetching && 'animate-spin')}
    />
  );
  if (onRefresh === undefined) {
    return (
      <span
        data-testid="settings-checked"
        className="inline-flex items-center gap-1.5 text-meta text-content-tertiary"
      >
        {icon}
        {label}
      </span>
    );
  }
  return (
    <Button
      variant="ghost"
      size="xs"
      data-testid="settings-checked"
      className="gap-1.5 text-content-tertiary"
      onClick={onRefresh}
    >
      {icon}
      {label}
    </Button>
  );
}
