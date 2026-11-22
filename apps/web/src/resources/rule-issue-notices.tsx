import {
  MODEL_SOURCE_RUNTIME_LABELS,
  ROUTE_USES,
  type RouteUse,
  type RuleFix,
  type RuleIssue,
} from '@cairn/shared';
import { TriangleAlert } from 'lucide-react';
import { ROUTE_USE_LABELS } from '../api/model-routing.js';
import { SettingsCard, SettingsSection } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import type { ModelOption } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

const RESET_LABELS = {
  machineId: '首选执行机',
  requiredCapabilities: '执行机要求',
  fallbackModels: '备用模型',
  thinkingLevel: '思考强度',
} as const satisfies Partial<Record<keyof RuleFix, string>>;

function optionFor(options: readonly ModelOption[], provider: string, modelId: string) {
  if (provider === 'pi') return options.find((o) => o.runtime === 'pi' && o.modelId === modelId);
  return options.find((o) => o.provider === provider && o.modelId === modelId);
}

export function RuleIssueNotices({
  issues,
  options,
  machineName,
  editableUses,
  pendingUse,
  onFix,
}: {
  issues: readonly RuleIssue[];
  options: readonly ModelOption[];
  machineName: (id: string) => string;
  editableUses: ReadonlySet<RouteUse>;
  pendingUse: RouteUse | null;
  onFix: (use: RouteUse, fix: RuleFix) => void;
}) {
  const { t } = useI18n();
  if (issues.length === 0) return null;
  const providerLabel = (provider: string) =>
    options.find((o) => o.provider === provider)?.providerLabel ?? provider;
  const problem = (issue: RuleIssue) => {
    switch (issue.reason) {
      case 'runtime-disabled':
        return t('没有执行机启用 {runtime}', {
          runtime: issue.runtime === undefined ? '' : MODEL_SOURCE_RUNTIME_LABELS[issue.runtime],
        });
      case 'machine-unusable':
        return issue.machineId === undefined
          ? t('没有执行机满足它的要求')
          : t('固定的执行机 {machine} 不可用', { machine: machineName(issue.machineId) });
      case 'provider-missing':
        return t('服务商 {provider} 已不存在', { provider: providerLabel(issue.provider ?? '') });
      case 'provider-no-key':
        return t('服务商 {provider} 没有 API key', {
          provider: providerLabel(issue.provider ?? ''),
        });
    }
  };
  const remedy = (issue: RuleIssue) => {
    const fix = issue.suggested;
    if (fix === null) {
      return editableUses.has(issue.use)
        ? t('没有能自动换上的模型，在下面给它选一个能用的。')
        : t('这个用途没有能自动换上的模型。');
    }
    const option = optionFor(options, fix.provider, fix.modelId);
    const target = `${option?.modelName ?? fix.modelId} · ${option?.providerLabel ?? providerLabel(fix.provider)}`;
    const resets = (Object.keys(RESET_LABELS) as (keyof typeof RESET_LABELS)[])
      .filter((key) => key in fix)
      .map((key) => t(RESET_LABELS[key]));
    return resets.length === 0
      ? t('修复后改用 {target}。', { target })
      : t('修复后改用 {target}，并清空{resets}。', { target, resets: resets.join(t('、')) });
  };
  const ordered = [...issues].sort((a, b) => ROUTE_USES.indexOf(a.use) - ROUTE_USES.indexOf(b.use));
  return (
    <SettingsSection testId="routing-rule-issues" title={t('需要处理的规则')}>
      <SettingsCard>
        {ordered.map((issue) => {
          const fix = issue.suggested;
          const use = t(ROUTE_USE_LABELS[issue.use]);
          return (
            <div
              key={issue.use}
              data-testid={`routing-rule-issue-${issue.use}`}
              data-reason={issue.reason}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 px-4 py-3 max-sm:grid-cols-[auto_1fr]"
            >
              <TriangleAlert
                aria-hidden
                className="size-5 flex-none self-start text-(--waiting-ink) max-sm:size-4 max-sm:mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="text-ui font-medium text-pretty break-keep text-foreground max-sm:text-meta">
                  {t('{use}：{problem}', { use, problem: problem(issue) })}
                </div>
                <div className="mt-0.5 text-meta text-pretty break-keep text-content-secondary">
                  {remedy(issue)}
                </div>
              </div>
              {fix !== null && (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid={`routing-rule-fix-${issue.use}`}
                  aria-label={t('修复 {use}', { use })}
                  disabled={pendingUse !== null}
                  className="relative pointer-coarse:after:absolute pointer-coarse:after:-inset-2 max-sm:col-start-2 max-sm:mt-2 max-sm:justify-self-start"
                  onClick={() => onFix(issue.use, fix)}
                >
                  {t('修复')}
                </Button>
              )}
            </div>
          );
        })}
      </SettingsCard>
    </SettingsSection>
  );
}
