import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
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
import { GripVertical, Pencil } from 'lucide-react';
import type { ComponentType, CSSProperties, DOMAttributes, ReactNode, Ref, SVGProps } from 'react';
import { useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { SettingsPanel, SettingsSection } from '../settings-list.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';

export type ProviderMark = ComponentType<SVGProps<SVGSVGElement>>;

export type ProviderTone = 'ok' | 'warn' | 'fail' | 'off';

export interface ProviderItem {
  id: string;
  name: string;
  Mark: ProviderMark;
  version?: string | null;
  status: string;
  tone: ProviderTone;
  aside?: ReactNode;
}

const MONO_MARK_CLS = '[&_path]:fill-current';

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
  return (
    <div
      ref={rowRef}
      style={style}
      {...rowListeners}
      data-testid="provider-instance"
      data-instance-id={item.id}
      data-tone={item.tone}
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
        onClick={onSelect}
        className={cn(
          'h-auto min-w-0 flex-auto items-start justify-start gap-2.5 p-0 text-left font-normal whitespace-normal hover:bg-transparent dark:hover:bg-transparent',
          item.tone === 'off' && !selected && 'opacity-60',
        )}
      >
        <item.Mark
          aria-hidden
          className={cn('mt-0.5 size-4 flex-none text-content-secondary', MONO_MARK_CLS)}
        />
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-ui font-medium text-foreground">{item.name}</span>
            {item.version != null && (
              <code className="flex-none text-meta text-content-tertiary">v{item.version}</code>
            )}
          </span>
          <span className="flex items-start gap-1.5 text-meta text-content-tertiary">
            <span
              aria-hidden
              className={cn('mt-1.5 size-1.5 flex-none rounded-full', TONE_DOT[item.tone])}
            />
            <span className="line-clamp-2">{item.status}</span>
          </span>
        </span>
      </Button>
      {item.aside}
    </div>
  );
}

function RowGrip({ dragging }: { dragging: boolean }) {
  const { t } = useI18n();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-hidden
            data-testid="provider-drag-grip"
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

function SortableRow({
  item,
  selected,
  onSelect,
}: {
  item: ProviderItem;
  selected: boolean;
  onSelect: () => void;
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
  } = useSortable({ id: item.id });
  return (
    <ProviderInstanceRow
      item={item}
      selected={selected}
      onSelect={onSelect}
      grip={<RowGrip dragging={isDragging} />}
      rowRef={setNodeRef}
      rowListeners={listeners}
      selectRef={setActivatorNodeRef}
      selectProps={{
        ...attributes,
        role: undefined,
        tabIndex: undefined,
        'aria-pressed': undefined,
        'aria-roledescription': t('可拖动排序'),
      }}
      dragging={isDragging}
      style={{
        transform:
          transform === null ? undefined : `translate3d(0, ${Math.round(transform.y)}px, 0)`,
        transition,
      }}
    />
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
  const { t } = useI18n();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: KEYBOARD_CODES,
    }),
  );
  const ids = items.map((item) => item.id);
  const nameOf = (id: string | number) => items.find((item) => item.id === id)?.name ?? String(id);
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
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over === null || active.id === over.id) return;
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[keepInList]}
      autoScroll={false}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: t('按空格键拿起，用上下方向键移动，再按空格键放下，按 Esc 取消。'),
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col divide-y divide-border">
          {items.map((item) => (
            <SortableRow
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              onSelect={() => onSelect(item.id)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
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
        <div data-testid="provider-editor" className="flex min-w-0 flex-col gap-6 p-4">
          {children}
        </div>
      </div>
    </SettingsPanel>
  );
}

function RenameTitle({ name, onRename }: { name: string; onRename: (next: string) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null) {
    const commit = () => {
      const next = draft.trim();
      if (next !== '' && next !== name) onRename(next);
      setDraft(null);
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
  onRename?: (next: string) => void;
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
        <span className="max-w-full truncate text-meta text-content-tertiary" title={kind}>
          {kind}
        </span>
      </div>
      {version != null && <code className="text-meta text-content-tertiary">v{version}</code>}
      {aside}
    </div>
  );
}

export function ProviderSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <SettingsSection title={title} description={hint}>
      {children}
    </SettingsSection>
  );
}
