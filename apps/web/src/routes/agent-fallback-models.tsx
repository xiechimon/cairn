import { FALLBACK_MODELS_MAX, isBackendRuntimeId, type ModelRef } from '@cairn/shared';
import { cn } from 'cn';
import { useState } from 'react';
import { findModelOption, providerEchoLabel } from '../components/model-select-core.js';
import {
  SETTINGS_HINT_CLS,
  SETTINGS_SELECT_TRIGGER_CLS,
  SettingsCard,
  SettingsRow,
} from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import type { ModelOption } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ArrowDown, ArrowUp, Plus, Trash2 } from '../icons/index.js';
import { AgentModelSelect, AgentRuntimeSelect, providerGroups } from './agent-model-select.js';

interface HomeMachine {
  name: string;
  enabledRuntimes: readonly string[];
}

interface DraftRow {
  provider: string | null;
  modelId: string | null;
}

interface PendingChain {
  base: string;
  next: ModelRef[];
}

interface FallbackModelsSectionProps {
  serverChain: ModelRef[];
  saveFailed: boolean;
  options: ModelOption[];
  optionsReady: boolean;
  homeMachine: HomeMachine | null;
  onChange: (next: ModelRef[] | null) => void;
}

export function FallbackModelsSection({
  serverChain,
  saveFailed,
  options,
  optionsReady,
  homeMachine,
  onChange,
}: FallbackModelsSectionProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [pending, setPending] = useState<PendingChain | null>(null);
  const serverKey = JSON.stringify(serverChain);
  const chain =
    pending !== null && pending.base === serverKey && !saveFailed ? pending.next : serverChain;
  const groups = providerGroups(options);
  const rows: DraftRow[] = draft === null ? chain : [...chain, draft];
  const full = rows.length >= FALLBACK_MODELS_MAX;
  const commit = (next: ModelRef[]) => {
    setPending({ base: serverKey, next });
    onChange(next.length === 0 ? null : next);
  };
  const move = (from: number, to: number) => {
    const next = chain.slice();
    const moved = next.splice(from, 1);
    next.splice(to, 0, ...moved);
    commit(next);
  };

  return (
    <section className="agent-fallback flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-card-title font-medium text-foreground">{t('备用模型')}</h3>
        <span className={SETTINGS_HINT_CLS}>{`${rows.length} / ${FALLBACK_MODELS_MAX}`}</span>
      </div>
      <p className={SETTINGS_HINT_CLS}>
        {t(
          '主模型额度用完、服务 5xx、账号耗尽、限流、模型 404 或认证失败时，按顺序换到下一个可用备选。只有规划和执行步会换；审核、验证、合并、总管不换。备选用尽后，限流和额度继续等待，其他服务故障则该步失败。',
        )}
      </p>
      {rows.length > 0 && (
        <SettingsCard>
          {rows.map((row, index) => {
            const slot = index + 1;
            const isDraft = index >= chain.length;
            const option = findModelOption(options, row);
            const warnings: string[] = [];
            if (isDraft) warnings.push(t('选完模型后才会保存'));
            else {
              if (option === null && optionsReady) warnings.push(t('当前可选列表里没有该模型'));
              if (option?.liveness === 'dead') warnings.push(t('已下架，运行时会跳过该备选'));
              const runtime = isBackendRuntimeId(row.provider) ? 'claude-code' : 'pi';
              if (homeMachine !== null && !homeMachine.enabledRuntimes.includes(runtime)) {
                warnings.push(
                  t('归属机 {machine} 未开启 {runtime} runtime，运行时会跳过该备选', {
                    machine: homeMachine.name,
                    runtime,
                  }),
                );
              }
            }
            const dimmed =
              !isDraft && (option === null ? optionsReady : option.liveness === 'dead');
            return (
              <SettingsRow
                key={slot}
                className="agent-fallback-row"
                label={t('备用 {n}', { n: slot })}
                hint={warnings.length > 0 ? warnings.join('；') : undefined}
                labelClassName="agent-field-label"
                valueClassName={cn('agent-fallback-pickers flex-none', dimmed && 'opacity-60')}
              >
                {isDraft ? (
                  <AgentRuntimeSelect
                    ariaLabel={t('备用 {n} 运行时', { n: slot })}
                    value={row.provider}
                    options={options}
                    unsetLabel={t('选择运行时')}
                    onPick={(provider) => setDraft({ provider, modelId: null })}
                    prefix="agent-fallback-runtime"
                    triggerClassName={SETTINGS_SELECT_TRIGGER_CLS}
                  />
                ) : (
                  <span className="whitespace-nowrap text-meta text-content-tertiary">
                    {providerEchoLabel(row.provider, groups, '')}
                  </span>
                )}
                <AgentModelSelect
                  ariaLabel={t('备用 {n} 模型', { n: slot })}
                  provider={row.provider}
                  modelId={row.modelId}
                  options={options}
                  onPick={(modelId) => {
                    if (modelId === null || row.provider === null) return;
                    const picked = { provider: row.provider, modelId };
                    if (isDraft) {
                      setDraft(null);
                      commit([...chain, picked]);
                    } else commit(chain.map((ref, i) => (i === index ? picked : ref)));
                  }}
                  prefix="agent-fallback-model"
                  triggerClassName={SETTINGS_SELECT_TRIGGER_CLS}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('上移备用 {n}', { n: slot })}
                  disabled={isDraft || index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUp width={14} height={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('下移备用 {n}', { n: slot })}
                  disabled={isDraft || index === chain.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDown width={14} height={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('删除备用 {n}', { n: slot })}
                  onClick={() => {
                    if (isDraft) setDraft(null);
                    else commit(chain.filter((_, i) => i !== index));
                  }}
                >
                  <Trash2 width={14} height={14} />
                </Button>
              </SettingsRow>
            );
          })}
        </SettingsCard>
      )}
      <div className="flex">
        <Button
          variant="outline"
          size="sm"
          disabled={full || draft !== null}
          onClick={() => setDraft({ provider: null, modelId: null })}
        >
          <Plus data-icon="inline-start" width={14} height={14} />
          {t('添加备用模型')}
        </Button>
      </div>
    </section>
  );
}
