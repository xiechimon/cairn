import { ComposerSurface } from '../chief/composer-surface.js';
import { useI18n } from '../i18n/provider.js';

interface LoadingComposerProps {
  draft: string;
  onDraftChange: (next: string) => void;
  placeholder: string;
}

export function LoadingComposer({ draft, onDraftChange, placeholder }: LoadingComposerProps) {
  const { t } = useI18n();
  return (
    <div data-testid="loading-composer" className="flex min-h-0 flex-none flex-col">
      <ComposerSurface
        binding={{ draft, setDraft: onDraftChange }}
        editable
        send={{
          label: t('发送'),
          testId: 'loading-composer-send',
          enabled: false,
          onClick: () => {},
        }}
        placeholder={placeholder}
        invalid={false}
        above={null}
        tools={null}
        inputTestId="loading-composer-input"
      />
    </div>
  );
}
