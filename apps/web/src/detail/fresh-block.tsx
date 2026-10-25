import { Button } from '../components/ui/button.js';
import { TagChip, type TagChipData } from '../components/ui/tag-chip.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';

export function formatCreatedAt(ms: number, t: TFunc): string {
  const base = {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  } as const;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    ...base,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const monthShort =
    new Intl.DateTimeFormat('en-US', { ...base, month: 'short' })
      .formatToParts(ms)
      .find((p) => p.type === 'month')?.value ?? '';
  return t('{y}年{mo}月{d}日 {hh}:{mm} 创建', {
    y: get('year'),
    mo: get('month'),
    d: get('day'),
    hh: get('hour'),
    mm: get('minute'),
    monthShort,
  });
}

interface FreshBlockProps {
  todo: TodoRecord;
  tags?: TagChipData[];
  action?: string | null;
  onAction?: () => void;
  actionInFlight?: boolean;
  hasSpec?: boolean;
}

export function FreshBlock({
  todo,
  tags,
  action,
  onAction,
  actionInFlight,
  hasSpec,
}: FreshBlockProps) {
  const { t } = useI18n();
  return (
    <div className="fresh-block mx-auto max-w-180 px-4 pt-18" data-testid="fresh-block">
      <h2 className="fresh-title m-0 text-page font-medium break-words text-(--foreground)">
        {todo.title}
      </h2>
      {(tags ?? []).length > 0 && (
        <div className="fresh-tags mt-4 flex items-center gap-4 text-(--text-tertiary)">
          {(tags ?? []).map((tag) => (
            <TagChip key={tag.id} tag={tag} className="fresh-tag-chip" />
          ))}
        </div>
      )}
      {hasSpec !== true && (
        <div className="fresh-nodesc mt-4 text-ui text-(--text-tertiary)">{t('尚无描述')}</div>
      )}
      <div className="mt-5 flex items-center text-(--text-tertiary)">
        <span className="text-meta">{formatCreatedAt(todo.phaseAt, t)}</span>
      </div>
      {action != null && onAction != null && (
        <div className="mt-8 flex items-center gap-3">
          {actionInFlight === true ? (
            <Button className="fresh-start" data-orchestrating="true" disabled>
              {t('编排中')}
            </Button>
          ) : (
            <Button className="fresh-start" onClick={onAction}>
              {t(action)}
            </Button>
          )}
          {action === '开始' && (
            <span className="text-meta text-(--text-tertiary)">
              {t('点开始后由总管编排派发，Agent 在你的机器上跑')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
