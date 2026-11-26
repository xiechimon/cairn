import { cn } from 'cn';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n/provider.js';
import { EngineLabel, ModelLabel, RunnerLabel } from './model-identity.js';

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
  historyEngines?: UsageEngineItem[];
  latestModel: UsageModelItem | null;
  historyModels?: UsageModelItem[];
  latestRunner: UsageRunnerItem | null;
  historyRunners?: UsageRunnerItem[];
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

  if (statRows.length === 0 && footer === undefined) return null;

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
        </dl>
      )}
      {footer}
    </Container>
  );
}
