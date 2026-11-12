import { Ban, CircleCheck } from 'lucide-react';
import { useI18n } from '../i18n/provider.js';
import type { ChiefQuestionItem } from './question-chips.js';

export function QuestionAnsweredLine({ item }: { item: ChiefQuestionItem }) {
  const { t } = useI18n();
  const cancelled = item.status === 'cancelled';
  const Icon = cancelled ? Ban : CircleCheck;
  const text = cancelled ? t('已取消提问') : t('已回答');
  return (
    <p
      data-testid="chief-question-line"
      data-status={item.status}
      title={text}
      className="m-0 flex min-w-0 items-center gap-1.5 text-meta text-content-tertiary"
    >
      <Icon aria-hidden strokeWidth={1.75} className="size-4 flex-none" />
      <span className="min-w-0 truncate">{text}</span>
    </p>
  );
}
