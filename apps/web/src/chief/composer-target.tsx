import { cn } from 'cn';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { X } from '../icons/index.js';
import { mentionChipClass } from '../overlay/mention-chip.js';

export interface ComposerTargetProps {
  seq: number;
  title: string;
  onClear: () => void;
  className?: string;
}

export function ComposerTarget({ seq, title, onClear, className }: ComposerTargetProps) {
  const { t } = useI18n();
  return (
    <div
      data-slot="composer-target"
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-meta text-content-secondary',
        className,
      )}
    >
      <span className="flex-none">{t('对')}</span>
      <span className={cn(mentionChipClass('todo'), 'mx-0 min-w-0 cursor-default')}>
        <span className="flex-none">{`#${seq}`}</span>
        <span className="min-w-0 truncate font-normal">{title}</span>
      </span>
      <span className="flex-none">{t('说，不经过总管')}</span>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={t('改回对总管说')}
        onClick={onClear}
        className="size-5 flex-none text-content-tertiary"
      >
        <X aria-hidden="true" className="size-3" />
      </Button>
    </div>
  );
}
