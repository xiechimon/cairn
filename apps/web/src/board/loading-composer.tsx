import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';
import { ArrowUp } from '../icons/index.js';

interface LoadingComposerProps {
  draft: string;
  onDraftChange: (next: string) => void;
  placeholder: string;
}

export function LoadingComposer({ draft, onDraftChange, placeholder }: LoadingComposerProps) {
  const { t } = useI18n();
  const reason = t('加载完成后才能发送。');
  return (
    <div
      data-testid="loading-composer"
      className="mx-auto mt-2 mb-[max(var(--composer-bottom-gap),env(safe-area-inset-bottom))] w-[calc(100%-2rem)] max-w-chat flex-none"
    >
      <p className="m-0 mb-1.5 px-1 text-meta text-content-tertiary">{reason}</p>
      <div className="rounded-(--radius-composer) border-0 bg-(--composer-fill) px-3.5 pt-3 pb-2.5 shadow-(--shadow-composer) focus-within:shadow-(--shadow-composer-focus)">
        <Textarea
          value={draft}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => onDraftChange(event.target.value)}
          className="h-9 min-h-0 resize-none border-none bg-transparent px-0.5 pt-0.5 pb-2.5 text-card-title shadow-none outline-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex justify-end">
          <IconTooltip
            label={reason}
            trigger={
              <Button
                variant="ghost"
                aria-label={t('发送')}
                aria-disabled="true"
                className="flex size-7 cursor-not-allowed items-center justify-center rounded-(--radius-control) border-none bg-secondary p-0 text-content-tertiary hover:bg-secondary hover:text-content-tertiary"
              />
            }
          >
            <ArrowUp width={16} height={16} />
          </IconTooltip>
        </div>
      </div>
    </div>
  );
}
