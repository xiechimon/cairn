import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/provider.js';
import { countdownLabel, type PlanAutoState } from './plan-auto-approve.js';

export function PlanAutoReason({
  state,
  deadline,
}: {
  state: PlanAutoState;
  deadline: number | undefined;
}) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.kind !== 'counting') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.kind]);
  if (state.kind === 'held') {
    return <>{t('已暂停自动开工，批准后才会开工。要改计划，直接在下面回复。')}</>;
  }
  if (state.kind === 'counting' && deadline !== undefined) {
    return (
      <>
        <span data-testid="plan-auto-countdown" className="tabular-nums">
          {t('{time} 后自动开工', { time: countdownLabel(deadline - now) })}
        </span>
        {t('。要改计划，直接在下面回复。')}
      </>
    );
  }
  return <>{t('计划已就绪。要改计划，直接在下面回复。')}</>;
}
