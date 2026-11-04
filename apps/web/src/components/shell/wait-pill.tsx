import { useI18n } from '../../i18n/provider.js';
import { StatusChip } from '../ui/status-chip.js';

export function WaitPill({ count }: { count: number }) {
  const { t } = useI18n();
  return (
    <StatusChip tone="confirm" className="h-5.5 rounded-full px-2 text-meta">
      {t('{n} 项待你处理', { n: count })}
    </StatusChip>
  );
}
