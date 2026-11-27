import { Link } from 'react-router';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { useRunLinkTo } from './run-trace-api.js';
import { markRunTraceHintSeen } from './run-trace-hint.js';

const TURN_ROW_PREFIXES = ['chief-err-', 'chief-stop-'] as const;

export function turnRunIdOf(rowId: string | number | null | undefined): string | null {
  if (typeof rowId !== 'string') return null;
  const prefix = TURN_ROW_PREFIXES.find((p) => rowId.startsWith(p));
  return prefix === undefined ? null : rowId.slice(prefix.length) || null;
}

export function RunTraceLink({ runId, className = '' }: { runId: string; className?: string }) {
  const { t } = useI18n();
  const linkTo = useRunLinkTo();
  return (
    <Button
      variant="ghost"
      size="sm"
      data-testid="run-trace-link"
      className={`h-6 flex-none px-1 font-normal text-content-tertiary hover:text-foreground pointer-coarse:h-11 ${className}`}
      render={<Link to={linkTo(runId)} onClick={markRunTraceHintSeen} />}
    >
      {t('运行记录')}
    </Button>
  );
}
