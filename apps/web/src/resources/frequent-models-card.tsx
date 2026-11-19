import { THINKING_LEVELS, type ThinkingLevel, type TopModel } from '@cairn/shared';
import { cn } from 'cn';
import { Box, Plus, X } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import {
  AntigravityMark,
  ClaudeMark,
  DevinMark,
  GeminiMark,
  GrokMark,
  OpenAIMark,
} from '../components/brand-marks.js';
import { FilterPicker } from '../components/filter-picker.js';
import { modelGroupKey, modelGroupName } from '../components/model-select-core.js';
import { SETTINGS_ROW_CLS, SettingsCard, SettingsSection } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import type { ModelOption } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

export const levelLabel = (level: string) => level.charAt(0).toUpperCase() + level.slice(1);

export function vendorMark(modelId: string): ComponentType<SVGProps<SVGSVGElement>> {
  if (modelId.startsWith('claude')) return ClaudeMark;
  if (modelId.startsWith('devin')) return DevinMark;
  if (modelId.startsWith('antigravity')) return AntigravityMark;
  if (/^(gpt|o\d|codex)/.test(modelId)) return OpenAIMark;
  if (modelId.startsWith('gemini')) return GeminiMark;
  if (modelId.startsWith('grok')) return GrokMark;
  return Box;
}

const frequentKey = (model: Pick<TopModel, 'provider' | 'modelId'>) =>
  JSON.stringify([model.provider, model.modelId]);

function optionOf(model: TopModel, options: readonly ModelOption[]): ModelOption | undefined {
  return options.find(
    (o) =>
      o.liveness !== 'dead' &&
      (model.provider === 'pi'
        ? o.runtime === 'pi' && o.modelId === model.modelId
        : o.provider === model.provider && o.modelId === model.modelId),
  );
}

function FrequentModelRow({
  model,
  option,
  onLevel,
  onRemove,
}: {
  model: TopModel;
  option: ModelOption | undefined;
  onLevel: (level: ThinkingLevel | null) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const name = option?.modelName ?? model.modelId;
  const Vendor = vendorMark(model.modelId);
  const level = model.thinkingLevel ?? 'off';
  return (
    <div
      data-testid="frequent-model-row"
      data-unavailable={option === undefined ? '' : undefined}
      className={cn(SETTINGS_ROW_CLS, 'flex-wrap gap-y-1 py-2 max-sm:gap-x-2')}
    >
      <span className="flex min-w-0 flex-auto items-center gap-3">
        <Vendor aria-hidden className="size-4 flex-none text-foreground" />
        <span className="flex min-w-0 flex-col">
          <span
            className={cn(
              'truncate text-ui',
              option === undefined ? 'text-content-tertiary' : 'text-foreground',
            )}
          >
            {name}
          </span>
          <span className="truncate text-meta text-content-tertiary">
            {option === undefined ? t('不可用') : modelGroupName(option)}
          </span>
        </span>
      </span>
      <span className="flex flex-none items-center gap-1 max-sm:ml-auto">
        {option?.runtime !== 'devin' && (
          <Select
            value={level}
            onValueChange={(next) => {
              if (next !== null) onLevel(next === 'off' ? null : (next as ThinkingLevel));
            }}
          >
            <SelectTrigger
              aria-label={t('{model} 的思考强度', { model: name })}
              className="frequent-model-level w-auto flex-none border-transparent bg-transparent shadow-none hover:bg-muted dark:bg-transparent dark:hover:bg-muted max-sm:h-7 max-sm:text-meta"
            >
              <SelectValue>
                <span className="text-content-tertiary">{t('思考')}</span>
                {levelLabel(level)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {THINKING_LEVELS.map((value) => (
                <SelectItem key={value} value={value}>
                  {levelLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('删除 {model}', { model: name })}
          className="flex-none text-content-tertiary pointer-coarse:size-11"
          onClick={onRemove}
        >
          <X aria-hidden />
        </Button>
      </span>
    </div>
  );
}

export function FrequentModelsCard({
  models,
  options,
  onChange,
}: {
  models: TopModel[];
  options: ModelOption[];
  onChange: (next: TopModel[]) => void;
}) {
  const { t } = useI18n();
  const listed = new Set(models.map(frequentKey));
  const addable = [
    ...new Map(
      options
        .filter((o) => o.liveness !== 'dead' && !listed.has(frequentKey(o)))
        .map((o) => [frequentKey(o), o]),
    ).values(),
  ];
  return (
    <SettingsSection
      testId="frequent-models"
      title={t('常用模型')}
      description={t(
        '任务默认用 Coordinator 的模型。在这里加几个常用模型，Coordinator 派活时会按任务难度从中挑一个。',
      )}
      action={
        <FilterPicker
          options={addable.map((o) => ({
            value: frequentKey(o),
            label: o.modelName,
            detail: modelGroupName(o),
            group: modelGroupKey(o),
            groupLabel: modelGroupName(o),
            keywords: `${o.modelId} ${o.runtime}`,
          }))}
          value={null}
          onPick={(key) => {
            const o = addable.find((row) => frequentKey(row) === key);
            if (o !== undefined) {
              onChange([
                ...models,
                { provider: o.provider, modelId: o.modelId, thinkingLevel: null },
              ]);
            }
          }}
          disabled={addable.length === 0}
          label={t('添加模型')}
          placeholder={t('搜索模型或服务商')}
          noun={t('模型')}
          align="end"
          trigger={<Button variant="outline" size="sm" />}
          triggerTestId="frequent-models-add"
          triggerContent={
            <>
              <Plus aria-hidden />
              {t('添加模型')}
            </>
          }
          rowClassName="frequent-models-add-row"
        />
      }
    >
      <SettingsCard>
        {models.length === 0 ? (
          <p
            data-testid="frequent-models-empty"
            className={cn(SETTINGS_ROW_CLS, 'm-0 text-meta text-pretty text-content-tertiary')}
          >
            {addable.length === 0
              ? t('还没有常用模型。先接入服务商，再回来添加。')
              : t('还没有常用模型，所有任务都用 Coordinator 的模型。')}
          </p>
        ) : (
          models.map((model, index) => (
            <FrequentModelRow
              key={frequentKey(model)}
              model={model}
              option={optionOf(model, options)}
              onLevel={(thinkingLevel) =>
                onChange(models.map((m, i) => (i === index ? { ...m, thinkingLevel } : m)))
              }
              onRemove={() => onChange(models.filter((_, i) => i !== index))}
            />
          ))
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
