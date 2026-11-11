import { cn } from 'cn';
import { Archive } from 'lucide-react';
import { Button } from '../components/ui/button.js';
import { Spinner } from '../components/ui/spinner.js';
import { useI18n } from '../i18n/provider.js';

export interface ArchivedProjectState {
  pending: boolean;
  onUnarchive: () => void;
}

export const ARCHIVED_PROJECT_WRITE_REASON = '这个项目已归档。取消归档后才能修改。';

export function ArchivedProjectBar({
  state,
  className,
}: {
  state: ArchivedProjectState;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      data-testid="archived-project-bar"
      className={cn(
        'flex min-h-11.5 flex-none flex-wrap items-center gap-x-3 gap-y-2 rounded-(--radius-composer) border-0 bg-background py-2 pr-2 pl-4 shadow-(--shadow-composer)',
        className,
      )}
    >
      <Archive aria-hidden className="size-5 flex-none text-content-tertiary" strokeWidth={1.75} />
      <p className="m-0 min-w-0 flex-1 basis-48 text-ui text-foreground">
        {t('这个项目已归档。取消归档后才能发消息。')}
      </p>
      <Button
        variant="secondary"
        size="sm"
        data-testid="archived-project-bar-unarchive"
        onClick={state.onUnarchive}
        disabled={state.pending}
        className="h-7.5 border-border px-3 text-ui font-medium text-foreground"
      >
        {state.pending && <Spinner data-icon="inline-start" />}
        {t('取消归档')}
      </Button>
    </div>
  );
}
