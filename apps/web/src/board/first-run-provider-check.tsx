import type { ProviderFailure, ProviderRecord } from '@cairn/shared';
import { Check } from 'lucide-react';
import { Button } from '../components/ui/button.js';
import { RingSpinner } from '../components/ui/ring-spinner.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { checkKey, type ModelCheck, type ModelChecks, providerWide } from './model-checks.js';

export function failureCopy(failure: ProviderFailure, t: TFunc): string {
  return failure === 'auth'
    ? t('密钥被拒绝，检查密钥后重新添加')
    : failure === 'network'
      ? t('无法连接这个服务商，请检查地址和网络')
      : failure === 'not-found' || failure === 'no-model'
        ? t('服务商没有这个模型，或不支持它')
        : failure === 'rate-limit' || failure === 'timeout' || failure === 'upstream'
          ? t('服务商暂时未响应或额度已用完，请稍后重试')
          : t('服务商的回复无效，请检查连接设置');
}

type Verdict =
  | { kind: 'checking' }
  | { kind: 'ok'; tried: number }
  | { kind: 'broken'; check: Extract<ModelCheck, { state: 'failed' }> }
  | { kind: 'partial'; failed: { id: string; check: Extract<ModelCheck, { state: 'failed' }> }[] };

function verdictOf(record: ProviderRecord, checks: ModelChecks['checks']): Verdict {
  const results = record.models.map((model) => ({
    id: model.id,
    check: checks.get(checkKey(record.providerId, model.id)),
  }));
  const first = results[0]?.check;
  if (first?.state === 'failed' && providerWide(first)) return { kind: 'broken', check: first };
  const settled = results.filter(
    (row): row is { id: string; check: Exclude<ModelCheck, { state: 'checking' }> } =>
      row.check !== undefined && row.check.state !== 'checking',
  );
  const failed = settled.flatMap((row) =>
    row.check.state === 'failed' ? [{ id: row.id, check: row.check }] : [],
  );
  if (settled.length === 0) return { kind: 'checking' };
  if (failed.length === 0) return { kind: 'ok', tried: settled.length };
  if (settled.length === results.length && failed.length === results.length) {
    const reason = failed[0];
    if (reason !== undefined) return { kind: 'broken', check: reason.check };
  }
  return { kind: 'partial', failed };
}

function ProviderRow({
  record,
  checks,
  onRemove,
  removing,
}: {
  record: ProviderRecord;
  checks: ModelChecks;
  onRemove: () => void;
  removing: boolean;
}) {
  const { t } = useI18n();
  const verdict = verdictOf(record, checks.checks);
  const total = record.models.length;
  return (
    <li
      data-testid={`provider-check-${record.providerId}`}
      className="flex flex-col gap-1 border-b border-border py-3"
    >
      <div className="flex min-h-6 items-center gap-2">
        <span className="font-title text-foreground">{record.label}</span>
        <span className="text-meta text-content-tertiary">{t('{n} 个模型', { n: total })}</span>
        {verdict.kind === 'broken' && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto px-3"
            disabled={removing}
            onClick={onRemove}
          >
            {t('移除')}
          </Button>
        )}
      </div>
      <div className="text-pretty break-keep text-meta text-content-secondary">
        {verdict.kind === 'checking' ? (
          <span className="inline-flex items-center gap-1.5">
            <RingSpinner className="size-4" />
            {t('正在发一句试试…')}
          </span>
        ) : verdict.kind === 'ok' ? (
          <span className="inline-flex items-center gap-1 text-foreground">
            <Check aria-hidden className="size-4" />
            {verdict.tried < total
              ? t('能用 · 已试 {n}/{total}', { n: verdict.tried, total })
              : t('能用')}
          </span>
        ) : verdict.kind === 'broken' ? (
          <span title={verdict.check.reason ?? undefined}>
            <span className="text-foreground">{t('不能用')}</span>
            {' · '}
            {failureCopy(verdict.check.failure, t)}
          </span>
        ) : (
          <>
            <span>
              <span className="text-foreground">{t('部分能用')}</span>
              {' · '}
              {t('{total} 个模型里 {n} 个不能用', { total, n: verdict.failed.length })}
            </span>
            <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
              {verdict.failed.map(({ id, check }) => (
                <li key={id} className="flex flex-wrap gap-x-3" title={check.reason ?? undefined}>
                  <span className="font-mono text-content-tertiary">{id}</span>
                  <span>
                    {failureCopy(check.failure, t)}
                    {check.failure === 'rate-limit' ||
                    check.failure === 'timeout' ||
                    check.failure === 'upstream'
                      ? ''
                      : t('，下一步不会列出')}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </li>
  );
}

export function ProviderCheckList({
  records,
  checks,
  removing,
  onRemove,
  onUndo,
  onNext,
}: {
  records: readonly ProviderRecord[];
  checks: ModelChecks;
  removing: boolean;
  onRemove: (record: ProviderRecord) => void;
  onUndo: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n();
  const verdicts = records.map((record) => verdictOf(record, checks.checks));
  const pending = verdicts.some((verdict) => verdict.kind === 'checking');
  const usable = verdicts.some((verdict) => verdict.kind === 'ok' || verdict.kind === 'partial');
  const anyBroken = verdicts.some(
    (verdict) => verdict.kind !== 'ok' && verdict.kind !== 'checking',
  );
  return (
    <div data-testid="first-run-provider-check">
      <h3 className="m-0 font-title text-card-title text-foreground">
        {t('导入了 {n} 个服务商', { n: records.length })}
      </h3>
      <ul className="m-0 mt-3 list-none border-t border-border p-0">
        {records.map((record) => (
          <ProviderRow
            key={record.id}
            record={record}
            checks={checks}
            removing={removing}
            onRemove={() => onRemove(record)}
          />
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          size="lg"
          className="px-4 pointer-coarse:h-11 max-lg:h-11"
          disabled={pending || !usable}
          onClick={onNext}
        >
          {t('下一步：确认模型')}
        </Button>
        {anyBroken && !pending && (
          <span className="text-meta text-content-secondary">
            {t('不能用的模型不会出现在下一步')}
          </span>
        )}
        <Button
          variant="link"
          className="ml-auto h-auto min-h-6 p-0 text-meta font-normal text-content-secondary underline decoration-content-tertiary underline-offset-4 hover:text-foreground"
          disabled={removing}
          onClick={onUndo}
        >
          {t('撤销这次导入')}
        </Button>
      </div>
    </div>
  );
}
