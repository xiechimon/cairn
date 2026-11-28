import { SegmentedTabs } from '../components/segmented.js';
import { useI18n } from '../i18n/provider.js';

export function TraceTabs({
  tracing,
  onChange,
  className,
}: {
  tracing: boolean;
  onChange: (tracing: boolean) => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <SegmentedTabs
      quiet
      value={tracing ? 'trace' : 'chat'}
      onChange={(next) => onChange(next === 'trace')}
      label={t('对话和轨迹')}
      className={className}
      options={[
        { value: 'chat', label: t('对话'), testId: 'trace-tab-chat' },
        { value: 'trace', label: t('轨迹'), testId: 'trace-tab' },
      ]}
    />
  );
}
