import { type KeyboardEvent, useEffect, useRef } from 'react';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';

export function MadeSearch({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (next: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  return (
    <div className="flex flex-none px-4 pb-3">
      <Input
        ref={ref}
        data-testid="made-search"
        aria-label={t('搜索成果')}
        placeholder={t('搜索成果…')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
