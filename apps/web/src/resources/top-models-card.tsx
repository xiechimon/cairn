import {
  MODEL_SOURCE_RUNTIME_LABELS,
  type ModelSourceRuntime,
  THINKING_LEVELS,
  type ThinkingLevel,
  TOP_MODELS_MAX,
  type TopModel,
} from '@cairn/shared';
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { cn } from 'cn';
import { Box, GripVertical, Plus, Server, X } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { ClaudeMark, GeminiMark, GrokMark, OpenAIMark } from '../components/brand-marks.js';
import { KeyedMenuContent } from '../components/menu-keys.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import type { ModelOption } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

type Mark = ComponentType<SVGProps<SVGSVGElement>>;

const SUGGESTED: readonly { modelId: string; thinkingLevel: ThinkingLevel }[] = [
  { modelId: 'claude-opus-5-5', thinkingLevel: 'high' },
  { modelId: 'gpt-6.1-sol', thinkingLevel: 'medium' },
  { modelId: 'claude-sonnet-5-5', thinkingLevel: 'high' },
  { modelId: 'glm-5.3', thinkingLevel: 'max' },
];

const PICKED = 'claude-opus-5-5';

const BLURBS: readonly [RegExp, string][] = [
  [/^claude-opus/, '最强，适合复杂任务'],
  [/^claude-sonnet/, '快，能力强'],
  [/^claude-haiku/, '最快，适合机械活'],
  [/^gpt-.*-sol$/, '均衡'],
  [/^glm-/, '开源权重'],
  [/^gemini/, '长上下文'],
];

export const topModelKey = (model: Pick<TopModel, 'provider' | 'modelId'>) =>
  JSON.stringify([model.provider, model.modelId]);

const levelLabel = (level: string) => level.charAt(0).toUpperCase() + level.slice(1);

function vendorMark(modelId: string): Mark {
  if (modelId.startsWith('claude')) return ClaudeMark;
  if (/^(gpt|o\d|codex)/.test(modelId)) return OpenAIMark;
  if (modelId.startsWith('gemini')) return GeminiMark;
  if (modelId.startsWith('grok')) return GrokMark;
  return Box;
}

function providerChipMark(provider: string): Mark {
  if (provider === 'claude-code' || provider === 'anthropic') return ClaudeMark;
  if (provider.startsWith('openai') || provider === 'codex') return OpenAIMark;
  return Server;
}

export function suggestedTopModels(options: readonly ModelOption[]): TopModel[] {
  return SUGGESTED.flatMap(({ modelId, thinkingLevel }) => {
    const option = options.find((o) => o.modelId === modelId && o.liveness !== 'dead');
    return option === undefined ? [] : [{ provider: option.provider, modelId, thinkingLevel }];
  });
}

function TopModelRow({
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: topModelKey(model),
  });
  const name = option?.modelName ?? model.modelId;
  const Vendor = vendorMark(model.modelId);
  const Chip = providerChipMark(model.provider);
  const blurb = BLURBS.find(([pattern]) => pattern.test(model.modelId))?.[1];
  const level = model.thinkingLevel ?? 'off';
  return (
    <li
      ref={setNodeRef}
      data-testid="top-model-row"
      data-top-model={model.modelId}
      data-unavailable={option === undefined ? '' : undefined}
      style={{
        transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
        transition,
      }}
      className={cn(
        'relative flex min-h-12 items-center gap-x-3 border-t border-border bg-card px-4 py-1.5 max-sm:flex-wrap max-sm:gap-x-2.5 max-sm:gap-y-0.5 max-sm:px-3 max-sm:py-1.5',
        isDragging && 'z-10 shadow-(--e2)',
      )}
    >
      <span className="flex min-w-0 flex-auto items-center gap-3 max-sm:basis-full">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('拖动排序 {model}', { model: name })}
          className="top-model-grip -mx-1 cursor-grab touch-none text-content-tertiary active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden className="size-4" />
        </Button>
        <Vendor aria-hidden className="size-5 flex-none text-foreground max-sm:size-4" />
        <span className="flex min-w-0 flex-auto items-center gap-2">
          <span
            className={cn(
              'truncate text-ui font-medium max-sm:text-meta',
              option === undefined ? 'text-content-tertiary' : 'text-foreground',
            )}
          >
            {name}
          </span>
          {model.modelId === PICKED && (
            <span className="flex-none rounded-sm bg-secondary px-1.5 text-caption text-content-secondary max-sm:hidden">
              {t('推荐')}
            </span>
          )}
          {blurb !== undefined && (
            <span className="truncate text-meta text-content-tertiary max-sm:hidden">
              {t(blurb)}
            </span>
          )}
        </span>
      </span>
      <span className="flex flex-none items-center gap-1 max-sm:basis-full max-sm:pl-6">
        <span
          data-testid="top-model-provider"
          className="inline-flex h-6 max-sm:h-5 max-w-36 flex-none items-center gap-1 rounded-full bg-secondary px-2 text-caption text-content-secondary max-sm:mr-auto max-sm:max-w-40"
        >
          {option === undefined ? (
            t('不可用')
          ) : (
            <>
              <Chip aria-hidden className="size-4 flex-none" />
              <span className="truncate">{option.providerLabel}</span>
            </>
          )}
        </span>
        <Select
          value={level}
          onValueChange={(next) => {
            if (next !== null) onLevel(next === 'off' ? null : (next as ThinkingLevel));
          }}
        >
          <SelectTrigger
            aria-label={t('{model} 的思考强度', { model: name })}
            className="top-model-level ml-2 w-28 flex-none max-sm:ml-1 max-sm:h-7 max-sm:w-24 max-sm:text-meta border-transparent bg-transparent shadow-none hover:bg-muted"
          >
            <SelectValue>{levelLabel(level)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {THINKING_LEVELS.map((value) => (
              <SelectItem key={value} value={value}>
                {levelLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('删除 {model}', { model: name })}
          className="top-model-remove flex-none text-content-tertiary"
          onClick={onRemove}
        >
          <X aria-hidden />
        </Button>
      </span>
    </li>
  );
}

export function TopModelsCard({
  models,
  options,
  onChange,
  onReset,
}: {
  models: TopModel[];
  options: ModelOption[];
  onChange: (next: TopModel[]) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const optionOf = (model: TopModel) =>
    options.find((o) => o.provider === model.provider && o.modelId === model.modelId);
  const listed = new Set(models.map(topModelKey));
  const addable = options.filter((o) => o.liveness !== 'dead' && !listed.has(topModelKey(o)));
  const unique = [...new Map(addable.map((o) => [topModelKey(o), o])).values()];
  const runtimes = [...new Set(unique.map((o) => o.runtime))];
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over === null || active.id === over.id) return;
    const keys = models.map(topModelKey);
    onChange(arrayMove(models, keys.indexOf(String(active.id)), keys.indexOf(String(over.id))));
  };
  return (
    <section
      data-testid="top-models"
      className="overflow-hidden rounded-(--radius-card) bg-card shadow-(--e1)"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 max-sm:px-3 max-sm:py-2.5">
        <div className="flex min-w-0 flex-col">
          <h2 className="m-0 truncate text-card-title font-semibold text-foreground max-sm:text-ui">
            {t('常用模型')}
          </h2>
          <p className="m-0 text-meta text-content-tertiary">
            {t('你常用的模型，最多 {max} 个。', { max: TOP_MODELS_MAX })}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={models.length >= TOP_MODELS_MAX || unique.length === 0}
            render={<Button variant="outline" size="sm" data-testid="top-models-add" />}
          >
            <Plus aria-hidden />
            {t('添加模型')}
          </DropdownMenuTrigger>
          <KeyedMenuContent
            align="end"
            side="bottom"
            sideOffset={6}
            aria-label={t('添加模型')}
            className="top-models-add-menu max-h-80 w-max max-w-(--available-width)"
          >
            {runtimes.map((runtime) => (
              <DropdownMenuGroup key={runtime}>
                <DropdownMenuLabel>
                  {MODEL_SOURCE_RUNTIME_LABELS[runtime as ModelSourceRuntime] ?? runtime}
                </DropdownMenuLabel>
                {unique
                  .filter((o) => o.runtime === runtime)
                  .map((o) => (
                    <DropdownMenuItem
                      key={topModelKey(o)}
                      className="top-models-add-row"
                      onClick={() =>
                        onChange([
                          ...models,
                          { provider: o.provider, modelId: o.modelId, thinkingLevel: null },
                        ])
                      }
                    >
                      {o.modelName}
                      {o.provider !== o.runtime && (
                        <span className="text-meta text-content-tertiary">{o.providerLabel}</span>
                      )}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuGroup>
            ))}
          </KeyedMenuContent>
        </DropdownMenu>
      </div>
      {models.length === 0 ? (
        <p
          data-testid="top-models-empty"
          className="m-0 border-t border-border px-4 py-3 text-meta text-content-tertiary"
        >
          {t('还没有常用模型。点「添加模型」从已连接的服务商里挑。')}
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={models.map(topModelKey)} strategy={verticalListSortingStrategy}>
            <ul className="m-0 list-none p-0">
              {models.map((model, index) => (
                <TopModelRow
                  key={topModelKey(model)}
                  model={model}
                  option={optionOf(model)}
                  onLevel={(thinkingLevel) =>
                    onChange(models.map((m, i) => (i === index ? { ...m, thinkingLevel } : m)))
                  }
                  onRemove={() => onChange(models.filter((_, i) => i !== index))}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 max-sm:px-3 max-sm:py-2.5">
        <span className="text-meta text-content-tertiary">{t('恢复成推荐的模型和顺序。')}</span>
        <Button variant="outline" size="sm" data-testid="top-models-reset" onClick={onReset}>
          {t('恢复推荐')}
        </Button>
      </div>
    </section>
  );
}
