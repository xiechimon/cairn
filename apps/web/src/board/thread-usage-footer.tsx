import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import { StatStrip } from '../components/stat-strip.js';
import { Button } from '../components/ui/button.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { ThreadUsageSummary } from './thread-usage-model.js';
import { useThreadUsage } from './use-thread-usage.js';

export function ThreadUsageFooter({ todo }: { todo: TodoRecord }) {
  const { summary, state, hasRuns, retry } = useThreadUsage(todo);
  return hasRuns ? (
    <ThreadUsageDisclosure key={todo.id} summary={summary} state={state} onRetry={retry} />
  ) : null;
}

export function ThreadUsageDisclosure({
  summary,
  state,
  onRetry,
  defaultOpen = false,
}: {
  summary: ThreadUsageSummary;
  state: 'ready' | 'loading' | 'error';
  onRetry: () => void;
  defaultOpen?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const models =
    summary.models.length === 0
      ? '—'
      : summary.models.length === 1
        ? summary.models[0]
        : t('{n} 个模型', { n: summary.models.length });
  const caption =
    state === 'loading'
      ? t('正在加载用量…')
      : state === 'error'
        ? t('用量加载失败')
        : t('{cost} · {tokens} 个 token · — · {models}', {
            cost: summary.cost,
            tokens: summary.tokens,
            models: models ?? '—',
          });
  return (
    <section
      data-testid="thread-usage"
      data-state={state}
      aria-label={t('thread 用量')}
      className="mx-auto mb-2 flex w-[calc(100%-2rem)] max-w-(--chat-max-w) flex-none flex-col gap-2"
    >
      {open && (
        <div id={contentId} className="flex min-w-0 flex-col gap-2">
          <div data-testid="thread-usage-stats">
            <StatStrip
              items={[
                { value: summary.cost, label: t('花费') },
                { value: summary.tokens, label: t('Token 数') },
                { value: '—', label: t('总时长') },
              ]}
            />
          </div>
          <dl className="m-0 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-1 text-meta">
            <dt className="text-content-tertiary">{t('缓存命中')}</dt>
            <dd className="m-0 text-content-secondary">{summary.cached}</dd>
            <dt className="text-content-tertiary">{t('模型列表')}</dt>
            <dd className="m-0 break-words text-content-secondary">
              {summary.models.length === 0 ? '—' : summary.models.join(' · ')}
            </dd>
            <dt className="text-content-tertiary">{t('机器')}</dt>
            <dd className="m-0 break-words text-content-secondary">
              {summary.machines.length === 0 ? '—' : summary.machines.join(' · ')}
            </dd>
          </dl>
          <p className="m-0 px-1 text-caption text-content-tertiary">
            {t('包含全部运行；总时长暂不可用。')}
          </p>
          {state === 'error' && (
            <div className="flex items-center gap-2 px-1 text-meta text-destructive" role="status">
              <span>{t('用量加载失败')}</span>
              <Button variant="outline" size="xs" onClick={onRetry}>
                {t('重试')}
              </Button>
            </div>
          )}
          {state === 'loading' && (
            <span className="px-1 text-meta text-content-tertiary" role="status">
              {t('正在加载用量…')}
            </span>
          )}
        </div>
      )}
      <Button
        variant="ghost"
        size="xs"
        aria-label={t('thread 用量')}
        aria-expanded={open}
        aria-controls={open ? contentId : undefined}
        onClick={() => setOpen((previous) => !previous)}
        className="w-full justify-start gap-1.5 px-1 text-left"
      >
        <ChevronRight data-icon="inline-start" className={cn(open && '-rotate-90')} />
        <span className="min-w-0 truncate tabular-nums" title={caption}>
          {caption}
        </span>
      </Button>
    </section>
  );
}
