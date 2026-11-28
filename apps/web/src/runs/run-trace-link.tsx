import { Link, useLocation, useSearchParams } from 'react-router';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { TRACE_PARAM, TRACE_RUN_PARAM, TRACE_STEP_PARAM } from './trace-nav.js';

const TURN_ROW_PREFIXES = ['chief-err-', 'chief-stop-'] as const;

export function turnRunIdOf(rowId: string | number | null | undefined): string | null {
  if (typeof rowId !== 'string') return null;
  const prefix = TURN_ROW_PREFIXES.find((p) => rowId.startsWith(p));
  return prefix === undefined ? null : rowId.slice(prefix.length) || null;
}

export function RunTraceLink({ runId, className = '' }: { runId: string; className?: string }) {
  const { t } = useI18n();
  const location = useLocation();
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set(TRACE_PARAM, '1');
  next.set(TRACE_RUN_PARAM, runId);
  next.delete(TRACE_STEP_PARAM);
  return (
    <Button
      variant="ghost"
      size="sm"
      data-testid="run-trace-link"
      className={`h-6 flex-none px-1 font-normal text-content-tertiary hover:text-foreground pointer-coarse:h-11 ${className}`}
      render={<Link to={{ pathname: location.pathname, search: `?${next.toString()}` }} />}
    >
      {t('看轨迹')}
    </Button>
  );
}
