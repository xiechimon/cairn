import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useI18n } from '../i18n/provider.js';
import { EngineLabel, ModelLabel, RunnerLabel } from './model-identity.js';
import { Button } from './ui/button.js';

export interface UsageEngineItem {
  label: string;
  runtime: string | null;
}

export interface UsageModelItem {
  raw: string;
  provider: string | null;
  providerLabel: string | null;
  modelId: string;
  modelName: string;
  runtime: string | null;
}

export interface UsageRunnerItem {
  id: string | null;
  name: string;
  osPlatform?: string | null;
  osDistribution?: string | null;
}

export interface UsageBreakdownData {
  turns?: number;
  duration: string;
  cost: string;
  tokens: string;
  cached: string;
  latestEngine: UsageEngineItem | null;
  historyEngines: UsageEngineItem[];
  latestModel: UsageModelItem | null;
  historyModels: UsageModelItem[];
  latestRunner: UsageRunnerItem | null;
  historyRunners: UsageRunnerItem[];
}

function sameProviderSlug(model: UsageModelItem): boolean {
  if (model.providerLabel == null || model.providerLabel === '') return false;
  return model.providerLabel.toLowerCase() === model.modelName.toLowerCase();
}

export function UsageBreakdownSection({
  data,
  testId,
  statsTestId,
  headerAction,
  footer,
  as = 'section',
  className,
}: {
  data: UsageBreakdownData;
  testId: string;
  statsTestId: string;
  headerAction?: ReactNode;
  footer?: ReactNode;
  as?: 'section' | 'div';
  className?: string;
}) {
  const { t } = useI18n();
  const [historyOpen, setHistoryOpen] = useState(false);

  const statRows: { id: string; label: string; value: ReactNode; testId?: string }[] = [
    data.turns !== undefined && data.turns > 0
      ? { id: 'turns', label: t('轮次'), value: String(data.turns) }
      : null,
    data.latestEngine !== null
      ? {
          id: 'engine',
          label: t('引擎'),
          testId: 'usage-current-engine',
          value: (
            <EngineLabel
              engine={data.latestEngine.label}
              runtime={data.latestEngine.runtime}
              className="justify-end"
            />
          ),
        }
      : null,
    data.duration !== '' ? { id: 'duration', label: t('时长'), value: data.duration } : null,
    data.cost !== '' ? { id: 'cost', label: t('花费'), value: data.cost } : null,
    data.tokens !== '' ? { id: 'tokens', label: t('Token 数'), value: data.tokens } : null,
    data.cached !== '' ? { id: 'cached', label: t('缓存命中'), value: data.cached } : null,
    data.latestModel !== null
      ? {
          id: 'model',
          label: t('模型'),
          testId: 'usage-current-model',
          value: (
            <ModelLabel
              modelId={data.latestModel.modelId}
              modelName={data.latestModel.modelName}
              provider={data.latestModel.provider}
              runtime={data.latestModel.runtime}
              className="justify-end"
            />
          ),
        }
      : null,
    data.latestRunner !== null
      ? {
          id: 'runner',
          label: t('执行机'),
          testId: 'usage-current-runner',
          value: <RunnerLabel machine={data.latestRunner} className="justify-end" />,
        }
      : null,
  ].filter((row): row is NonNullable<typeof row> => row !== null);

  const historyCount =
    data.historyEngines.length + data.historyModels.length + data.historyRunners.length;

  if (statRows.length === 0 && historyCount === 0 && footer === undefined) return null;

  const Container = as;

  return (
    <Container
      data-testid={testId}
      aria-label={as === 'section' ? t('对话用量') : undefined}
      className={cn('flex min-w-0 flex-col gap-2 text-ui', className)}
    >
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 className="m-0 text-ui font-medium text-foreground">{t('用量')}</h3>
        {headerAction}
      </div>
      {statRows.length > 0 && (
        <dl
          data-testid={statsTestId}
          className="m-0 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 text-ui"
        >
          {statRows.map((row) => (
            <div key={row.id} className="contents">
              <dt className="text-content-secondary">{row.label}</dt>
              <dd
                data-testid={row.testId}
                className="m-0 flex min-w-0 items-center justify-end text-right text-foreground tabular-nums"
              >
                {row.value}
              </dd>
            </div>
          ))}
          {historyCount > 0 && (
            <div className="contents">
              <dt className="text-content-secondary">{t('之前还用过')}</dt>
              <dd className="m-0 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="usage-history-toggle"
                  aria-expanded={historyOpen}
                  onClick={() => setHistoryOpen((prev) => !prev)}
                  className="-mr-1.5 h-6 min-h-6 gap-1 px-1.5 text-caption font-medium text-content-secondary tabular-nums hover:text-foreground pointer-coarse:min-h-11"
                >
                  <span>{`+${historyCount}`}</span>
                  <ChevronRight
                    aria-hidden="true"
                    className={cn(
                      'size-4 transition-transform duration-(--dur-press) ease-(--ease-out-strong) motion-reduce:transition-none',
                      historyOpen && 'rotate-90',
                    )}
                  />
                </Button>
              </dd>
            </div>
          )}
        </dl>
      )}
      {historyCount > 0 && historyOpen && (
        <div
          data-testid="usage-history-list"
          className="flex min-w-0 flex-col gap-2 border-t border-border pt-2 text-meta"
        >
          {data.historyEngines.length > 0 && (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-caption text-content-tertiary">{t('引擎')}</span>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {data.historyEngines.map((engine) => (
                  <li
                    key={`${engine.runtime ?? ''}:${engine.label}`}
                    className="flex min-w-0 items-center justify-between gap-2 text-foreground"
                  >
                    <EngineLabel engine={engine.label} runtime={engine.runtime} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.historyModels.length > 0 && (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-caption text-content-tertiary">{t('模型列表')}</span>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {data.historyModels.map((model) => (
                  <li
                    key={`${model.provider ?? ''}:${model.modelId}:${model.raw}`}
                    className="flex min-w-0 items-center justify-between gap-2 text-foreground"
                  >
                    <ModelLabel
                      modelId={model.modelId}
                      modelName={model.modelName}
                      provider={model.provider}
                      runtime={model.runtime}
                    />
                    {model.providerLabel != null &&
                      model.providerLabel !== '' &&
                      !sameProviderSlug(model) && (
                        <span className="shrink-0 truncate text-caption text-content-tertiary">
                          {model.providerLabel}
                        </span>
                      )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.historyRunners.length > 0 && (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-caption text-content-tertiary">{t('执行机')}</span>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {data.historyRunners.map((runner) => (
                  <li
                    key={`${runner.id ?? ''}:${runner.name}`}
                    className="flex min-w-0 items-center justify-between gap-2 text-foreground"
                  >
                    <RunnerLabel machine={runner} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {footer}
    </Container>
  );
}
