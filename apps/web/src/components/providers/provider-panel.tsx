import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  type Modifier,
  MouseSensor,
  TouchSensor,
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
import {
  CircleCheck,
  CircleHelp,
  CircleMinus,
  CircleX,
  Clock3,
  GripVertical,
  OctagonX,
  Pencil,
  TriangleAlert,
} from 'lucide-react';
import type { ComponentType, CSSProperties, DOMAttributes, ReactNode, Ref, SVGProps } from 'react';
import { useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { SettingsPanel } from '../settings-list.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { RingSpinner } from '../ui/ring-spinner.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';

export type ProviderMark = ComponentType<SVGProps<SVGSVGElement>>;

export type ProviderTone = 'ok' | 'warn' | 'fail' | 'off';
export type ProviderStatus = keyof typeof PROVIDER_STATUS;

export const PROVIDER_STATUS = {
  ok: { Icon: CircleCheck, tone: 'ok', label: '可用' },
  warn: { Icon: TriangleAlert, tone: 'warn', label: '需要处理' },
  fail: { Icon: OctagonX, tone: 'fail', label: '测试未通过' },
  off: { Icon: CircleHelp, tone: 'off', label: '未检查' },
  cooling: { Icon: Clock3, tone: 'off', label: '冷却中' },
  exhausted: { Icon: CircleMinus, tone: 'off', label: '额度用尽' },
  expired: { Icon: CircleX, tone: 'warn', label: '已过期' },
} as const;

export interface ProviderItem {
  id: string;
  name: string;
  Mark: ProviderMark;
  version?: string | null;
  status: string;
  statusLabel: string;
  statusGlyph: ProviderStatus;
  tone: ProviderTone;
  aside?: ReactNode;
}

const MONO_MARK_CLS = '[&_path]:fill-current';

const TONE_INK: Record<ProviderTone, string> = {
  ok: 'text-running-text',
  warn: 'text-tint-wait-ink',
  fail: 'text-tint-fail-ink',
  off: 'text-content-secondary',
};

export const TONE_DOT: Record<ProviderTone, string> = {
  ok: 'bg-running',
  warn: 'bg-(--waiting-ink)',
  fail: 'bg-destructive',
  off: 'bg-content-dim',
};

export function ProviderMarkTile({ Mark }: { Mark: ProviderMark }) {
  return (
    <span className="flex size-8 flex-none items-center justify-center rounded-(--radius-control) bg-background text-content-secondary ring-1 ring-border">
      <Mark aria-hidden className={cn('size-4', MONO_MARK_CLS)} />
    </span>
  );
}

export function ProviderInstanceRow({
  item,
  selected,
  onSelect,
  rowRef,
  rowListeners,
  selectRef,
  selectProps,
  style,
  dragging = false,
  grip,
}: {
  item: ProviderItem;
  selected: boolean;
  onSelect: () => void;
  grip?: ReactNode;
  rowRef?: (node: HTMLElement | null) => void;
  rowListeners?: DOMAttributes<HTMLDivElement>;
  selectRef?: Ref<HTMLButtonElement>;
  selectProps?: Record<string, unknown>;
  style?: CSSProperties;
  dragging?: boolean;
}) {
  const { t } = useI18n();
  const { Icon: StatusIcon, tone, label } = PROVIDER_STATUS[item.statusGlyph];
  const statusLabel = item.statusLabel || t(label);
  return (
    <div
      ref={rowRef}
      style={style}
      {...rowListeners}
      data-testid="provider-instance"
      data-instance-id={item.id}
      data-tone={tone}
      data-dragging={dragging ? 'true' : undefined}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'group/row relative flex items-start gap-3 px-3.5 py-3',
        grip !== undefined && 'pl-1.5',
        dragging
          ? 'z-10 cursor-grabbing bg-popover shadow-(--e2)'
          : selected
            ? 'bg-(--sidebar-active)'
            : 'bg-card hover:bg-menu-hover',
      )}
    >
      {grip}
      <Button
        ref={selectRef}
        variant="ghost"
        {...selectProps}
        aria-label={[
          item.name,
          item.version == null ? null : `v${item.version}`,
          item.status,
          statusLabel,
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={onSelect}
        className="h-auto min-w-0 flex-1 items-start justify-start gap-3 border-0 p-0 text-left font-normal whitespace-normal pointer-coarse:min-h-11 hover:bg-transparent dark:hover:bg-transparent"
      >
        <span className="flex min-w-0 flex-1 items-start gap-2.5 p-px">
          <item.Mark
            aria-hidden
            className={cn('mt-0.5 size-4 flex-none text-content-secondary', MONO_MARK_CLS)}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span title={item.name} className="truncate text-ui font-medium text-foreground">
                {item.name}
              </span>
              {item.version != null && (
                <code className="flex-none text-meta text-content-secondary">v{item.version}</code>
              )}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-meta tabular-nums">
              <span
                data-testid="provider-subtitle"
                title={item.status}
                className="truncate text-content-secondary"
              >
                {item.status}
              </span>
            </span>
          </span>
        </span>
        <span className="flex flex-none flex-col items-end justify-center gap-1 self-stretch">
          {item.aside}
          <span
            data-testid="provider-status-mark"
            data-status={item.statusGlyph}
            role="img"
            aria-label={statusLabel}
            title={statusLabel}
            className={cn('flex size-4 items-center justify-center', TONE_INK[tone])}
          >
            <StatusIcon aria-hidden className="size-4" />
          </span>
        </span>
      </Button>
    </div>
  );
}

const keepInList: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => {
  if (draggingNodeRect === null || containerNodeRect === null) return { ...transform, x: 0 };
  const top = containerNodeRect.top - draggingNodeRect.top;
  const bottom = containerNodeRect.bottom - draggingNodeRect.bottom;
  return { ...transform, x: 0, y: Math.min(Math.max(transform.y, top), bottom) };
};

const KEYBOARD_CODES = {
  start: ['Space'],
  cancel: ['Escape'],
  end: ['Space', 'Enter'],
};

export interface SortableItemBind {
  rowRef: (node: HTMLElement | null) => void;
  rowListeners: DOMAttributes<HTMLDivElement> | undefined;
  activatorRef: (node: HTMLElement | null) => void;
  activatorProps: Record<string, unknown>;
  dragging: boolean;
  style: CSSProperties;
}

export function SortableGrip({ dragging, testId }: { dragging: boolean; testId: string }) {
  const { t } = useI18n();
  return (
    <Tooltip open={dragging ? false : undefined}>
      <TooltipTrigger
        render={
          <span
            aria-hidden
            data-testid={testId}
            className={cn(
              '-mr-2 flex h-5 w-4 flex-none items-center justify-center rounded-(--cds-radius-xs) text-content-dim group-hover/row:text-content-secondary',
              dragging ? 'cursor-grabbing text-content-secondary' : 'cursor-grab',
            )}
          />
        }
      >
        <GripVertical className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={6}>
        {t('拖动调整优先级')}
      </TooltipContent>
    </Tooltip>
  );
}

export function SortableGripButton({
  label,
  testId,
  dragging,
  buttonRef,
  activatorProps,
}: {
  label: string;
  testId: string;
  dragging: boolean;
  buttonRef: Ref<HTMLButtonElement>;
  activatorProps: Record<string, unknown>;
}) {
  const { t } = useI18n();
  return (
    <Tooltip open={dragging ? false : undefined}>
      <TooltipTrigger
        render={
          <Button
            ref={buttonRef}
            variant="ghost"
            size="icon-xs"
            data-testid={testId}
            aria-label={label}
            {...activatorProps}
            className={cn(
              '-ml-1 flex-none text-content-dim group-hover/row:text-content-secondary hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-transparent pointer-coarse:size-11',
              dragging ? 'cursor-grabbing text-content-secondary' : 'cursor-grab',
            )}
          />
        }
      >
        <GripVertical aria-hidden className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={6}>
        {t('拖动调整优先级')}
      </TooltipContent>
    </Tooltip>
  );
}

function SortableEntry<T>({
  id,
  item,
  renderItem,
}: {
  id: string;
  item: T;
  renderItem: (item: T, bind: SortableItemBind) => ReactNode;
}) {
  const { t } = useI18n();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return renderItem(item, {
    rowRef: setNodeRef,
    rowListeners: listeners as DOMAttributes<HTMLDivElement> | undefined,
    activatorRef: setActivatorNodeRef,
    activatorProps: {
      ...attributes,
      role: undefined,
      tabIndex: undefined,
      'aria-pressed': undefined,
      'aria-roledescription': t('可拖动排序'),
    },
    dragging: isDragging,
    style: {
      transform: transform === null ? undefined : `translate3d(0, ${Math.round(transform.y)}px, 0)`,
      transition,
    },
  });
}

export function SortableList<T>({
  items,
  getId,
  getName,
  onReorder,
  onDragStartId,
  className,
  renderItem,
}: {
  items: readonly T[];
  getId: (item: T) => string;
  getName: (item: T) => string;
  onReorder: (ids: string[]) => void;
  onDragStartId?: (id: string) => void;
  className?: string;
  renderItem: (item: T, bind: SortableItemBind) => ReactNode;
}) {
  const { t } = useI18n();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: KEYBOARD_CODES,
    }),
  );
  const ids = items.map(getId);
  const nameOf = (id: string | number) => {
    const match = items.find((item) => getId(item) === id);
    return match === undefined ? String(id) : getName(match);
  };
  const positionOf = (id: string | number) => ids.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t('已拿起 {name}，在第 {n} 位', { name: nameOf(active.id), n: positionOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over === null
        ? undefined
        : t('{name} 移到第 {n} 位', { name: nameOf(active.id), n: positionOf(over.id) }),
    onDragEnd: ({ active, over }) =>
      over === null
        ? t('{name} 放回原位', { name: nameOf(active.id) })
        : t('{name} 放在第 {n} 位', { name: nameOf(active.id), n: positionOf(over.id) }),
    onDragCancel: ({ active }) => t('{name} 放回原位', { name: nameOf(active.id) }),
  };
  const onDragStart = ({ active }: DragStartEvent) => onDragStartId?.(String(active.id));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over === null || active.id === over.id) return;
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };
  return (
    <div className="min-w-0">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[keepInList]}
        autoScroll={false}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: t('按空格键拿起，用上下方向键移动，再按空格键放下，按 Esc 取消。'),
          },
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className={className}>
            {items.map((item) => {
              const id = getId(item);
              return <SortableEntry key={id} id={id} item={item} renderItem={renderItem} />;
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableRows({
  items,
  selectedId,
  onSelect,
  onReorder,
}: {
  items: ProviderItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (ids: string[]) => void;
}) {
  return (
    <SortableList
      items={items}
      getId={(item) => item.id}
      getName={(item) => item.name}
      onReorder={onReorder}
      onDragStartId={onSelect}
      className="flex flex-col divide-y divide-border"
      renderItem={(item, bind) => (
        <ProviderInstanceRow
          item={item}
          selected={item.id === selectedId}
          onSelect={() => onSelect(item.id)}
          grip={<SortableGrip dragging={bind.dragging} testId="provider-drag-grip" />}
          rowRef={bind.rowRef}
          rowListeners={bind.rowListeners}
          selectRef={bind.activatorRef}
          selectProps={bind.activatorProps}
          dragging={bind.dragging}
          style={bind.style}
        />
      )}
    />
  );
}

export function ProviderPanel({
  items,
  selectedId,
  onSelect,
  onReorder,
  header,
  empty,
  children,
}: {
  items: ProviderItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder?: (ids: string[]) => void;
  header?: ReactNode;
  empty?: ReactNode;
  children: ReactNode;
}) {
  if (items.length === 0)
    return (
      <div data-testid="provider-editor" className="flex min-w-0 flex-col py-8">
        {empty}
      </div>
    );
  return (
    <SettingsPanel header={header}>
      <div className="flex min-w-0 flex-col @3xl:grid @3xl:grid-cols-[17rem_minmax(0,1fr)]">
        <div
          data-testid="provider-list"
          className="flex flex-col divide-y divide-border border-b border-border @3xl:border-r @3xl:border-b-0"
        >
          {onReorder === undefined ? (
            items.map((item) => (
              <ProviderInstanceRow
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onSelect={() => onSelect(item.id)}
              />
            ))
          ) : (
            <SortableRows
              items={items}
              selectedId={selectedId}
              onSelect={onSelect}
              onReorder={onReorder}
            />
          )}
        </div>
        <div
          data-testid="provider-editor"
          className="flex min-w-0 flex-col gap-6 p-4 [&_.text-content-tertiary]:text-content-secondary [&_[data-variant=destructive]]:text-foreground"
        >
          {children}
        </div>
      </div>
    </SettingsPanel>
  );
}

function RenameTitle({ name, onRename }: { name: string; onRename: (next: string) => unknown }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null) {
    const commit = () => {
      const next = draft.trim();
      if (next === '' || next === name) {
        setDraft(null);
        return;
      }
      Promise.resolve(onRename(next)).then(
        () => setDraft(null),
        () => {},
      );
    };
    return (
      <Input
        autoFocus
        aria-label={t('名称')}
        data-testid="provider-rename-input"
        value={draft}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            event.stopPropagation();
            setDraft(null);
          }
        }}
        className="-ml-1.5 h-7 rounded-(--radius-control) px-1.5 text-card-title font-medium md:text-card-title"
      />
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            data-testid="provider-rename"
            onClick={() => setDraft(name)}
            className="group/rename -ml-1.5 h-7 max-w-full justify-start gap-1 px-1.5 text-card-title font-medium text-foreground"
          />
        }
      >
        <span className="truncate">{name}</span>
        <Pencil
          aria-hidden
          className="hidden size-4 flex-none text-content-tertiary group-hover/rename:block group-focus-visible/rename:block"
        />
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{t('点击改名')}</TooltipContent>
    </Tooltip>
  );
}

export function ProviderEditorHead({
  Mark,
  name,
  kind,
  version,
  aside,
  onRename,
}: {
  Mark: ProviderMark;
  name: string;
  kind: string;
  version?: string | null;
  aside?: ReactNode;
  onRename?: (next: string) => unknown;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ProviderMarkTile Mark={Mark} />
      <div className="flex min-w-0 flex-1 basis-0 flex-col items-start">
        {onRename === undefined ? (
          <h2 className="m-0 max-w-full truncate text-card-title font-medium text-foreground">
            {name}
          </h2>
        ) : (
          <h2 className="m-0 flex max-w-full min-w-0 self-stretch">
            <RenameTitle key={name} name={name} onRename={onRename} />
          </h2>
        )}
        <span className="max-w-full wrap-anywhere text-meta text-content-tertiary tabular-nums">
          {kind}
        </span>
      </div>
      {version != null && <code className="text-meta text-content-tertiary">v{version}</code>}
      {aside}
    </div>
  );
}

export function SignInAgainButton({
  onClick,
  pending = false,
  testId = 'subscription-sign-in-again',
}: {
  onClick: () => void;
  pending?: boolean;
  testId?: string;
}) {
  const { t } = useI18n();
  return (
    <Button variant="default" size="sm" data-testid={testId} disabled={pending} onClick={onClick}>
      {pending && <RingSpinner aria-hidden data-icon="inline-start" />}
      {t('重新登录')}
    </Button>
  );
}
