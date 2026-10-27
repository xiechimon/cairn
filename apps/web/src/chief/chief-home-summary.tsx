import { Link, useLocation } from 'react-router';
import type { HomeOverview } from '../board/board.js';
import { withColumnParam } from '../board/columns.js';
import { useI18n } from '../i18n/provider.js';

export function HomeSummary({
  needsYou,
  running,
  doneToday,
}: Omit<HomeOverview, 'sections' | 'brief'>) {
  const { t } = useI18n();
  const { search } = useLocation();
  return (
    <>
      {t('{running} 个任务运行中，今天合并了 {done} 个', { running, done: doneToday })}
      {needsYou > 0 ? (
        <>
          {t('，')}
          <Link
            data-testid="chief-home-needs-you"
            to={{ search: withColumnParam(search, 'pending') }}
            className="font-medium text-foreground underline underline-offset-4"
          >
            {t('{n} 项待你处理', { n: needsYou })}
          </Link>
        </>
      ) : (
        t('，没有需要你的事')
      )}
    </>
  );
}
