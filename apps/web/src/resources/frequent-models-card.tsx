import type { ThinkingLevel, TopModel } from '@cairn/shared';
import { cn } from 'cn';
import { Plus, X } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { FilterPicker } from '../components/filter-picker.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { modelMarkFor } from '../components/model-identity.js';
import { modelGroupKey, modelGroupName } from '../components/model-select-core.js';
import {
  SortableGripButton,
  type SortableItemBind,
  SortableList,
} from '../components/providers/provider-panel.js';
import { SETTINGS_ROW_CLS, SettingsCard, SettingsSection } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import type { ModelOption } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ThinkingLevelSelect } from './thinking-level-select.js';

export function vendorMark({
  runtime,
  modelId,
  provider,
}: {
  runtime: string;
  modelId: string;
  provider?: string;
}): ComponentType<SVGProps<SVGSVGElement>> {
  return modelMarkFor({ runtime, modelId, provider });
}

const frequentKey = (model: Pick<TopModel, 'provider' | 'modelId'>) =>
  JSON.stringify([model.provider, model.modelId]);

function optionOf(model: TopModel, options: readonly ModelOption[]): ModelOption | undefined {
  return options.find(
    (o) =>
      o.liveness !== 'dead' &&
      o.updateRequired === undefined &&
      (model.provider === 'pi'
        ? o.runtime === 'pi' && o.modelId === model.modelId
        : o.provider === model.provider && o.modelId === model.modelId),
  );
}

function FrequentModelRow({
  model,
  option,
  bind,
  onLevel,
  onRemove,
}: {
  model: TopModel;
  option: ModelOption | undefined;
  bind?: SortableItemBind;
  onLevel: (level: ThinkingLevel | null) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const name = option?.modelName ?? model.modelId;
  const Vendor = vendorMark({ runtime: option?.runtime ?? model.provider, modelId: model.modelId });
  return (
    <div
      ref={bind?.rowRef}
      style={bind?.style}
      {...bind?.rowListeners}
      data-testid="frequent-model-row"
      data-model-key={`${model.provider}/${model.modelId}`}
      data-unavailable={option === undefined ? '' : undefined}
      data-dragging={bind?.dragging ? 'true' : undefined}
      className={cn(
        SETTINGS_ROW_CLS,
        'group/row relative flex-wrap gap-y-1 py-2 max-sm:gap-x-2',
        bind !== undefined && 'pl-2.5',
        bind?.dragging && 'z-10 cursor-grabbing bg-popover shadow-(--e2)',
      )}
    >
      <span className="flex min-w-0 flex-auto items-center gap-3">
        {bind !== undefined && (
          <SortableGripButton
            testId="frequent-model-drag-grip"
            label={t('拖动调整 {model} 优先级', { model: name })}
            dragging={bind.dragging}
            buttonRef={bind.activatorRef}
            activatorProps={bind.activatorProps}
          />
        )}
        <span data-testid="frequent-model-mark" className="flex flex-none items-center">
          <Vendor aria-hidden className="size-4 flex-none text-foreground" />
        </span>
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
        {option !== undefined && (
          <ThinkingLevelSelect
            levels={option.thinkingLevels}
            resolvesTo={option.thinkingDefault}
            value={model.thinkingLevel}
            onChange={onLevel}
            label={t('{model} 的思考强度', { model: name })}
            className="frequent-model-level"
          />
        )}
        <IconTooltip
          label={t('删除 {model}', { model: name })}
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              className="flex-none text-content-tertiary pointer-coarse:size-11"
              onClick={onRemove}
            />
          }
        >
          <X aria-hidden />
        </IconTooltip>
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
  onChange: (next: TopModel[], reason?: 'reorder') => void;
}) {
  const { t } = useI18n();
  const listed = new Set(models.map(frequentKey));
  const addable = [
    ...new Map(
      options
        .filter(
          (o) =>
            o.liveness !== 'dead' && o.updateRequired === undefined && !listed.has(frequentKey(o)),
        )
        .map((o) => [frequentKey(o), o]),
    ).values(),
  ];
  const byKey = new Map(models.map((m) => [frequentKey(m), m]));
  return (
    <SettingsSection
      testId="frequent-models"
      title={t('常用模型')}
      {...(models.length > 0
        ? {
            info: t('Coordinator 派活时按任务难度从这里挑一个。'),
          }
        : {})}
      action={
        <FilterPicker
          options={addable.map((o) => {
            const OptionVendor = vendorMark(o);
            return {
              value: frequentKey(o),
              label: o.modelName,
              icon: <OptionVendor aria-hidden="true" className="size-4" />,
              detail: modelGroupName(o),
              group: modelGroupKey(o),
              groupLabel: modelGroupName(o),
              keywords: `${o.modelId} ${o.runtime}`,
            };
          })}
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
              ? t('暂无常用模型。先接入服务商，再返回添加。')
              : t('暂无常用模型，所有任务都使用 Coordinator 的模型。')}
          </p>
        ) : models.length === 1 ? (
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
        ) : (
          <SortableList
            items={models}
            getId={frequentKey}
            getName={(model) => optionOf(model, options)?.modelName ?? model.modelId}
            onReorder={(keys) => {
              const reordered = keys.flatMap((key) => {
                const hit = byKey.get(key);
                return hit === undefined ? [] : [hit];
              });
              onChange(reordered, 'reorder');
            }}
            className="flex flex-col divide-y divide-border"
            renderItem={(model, bind) => (
              <FrequentModelRow
                model={model}
                option={optionOf(model, options)}
                bind={bind}
                onLevel={(thinkingLevel) =>
                  onChange(
                    models.map((m) =>
                      frequentKey(m) === frequentKey(model) ? { ...m, thinkingLevel } : m,
                    ),
                  )
                }
                onRemove={() =>
                  onChange(models.filter((m) => frequentKey(m) !== frequentKey(model)))
                }
              />
            )}
          />
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
