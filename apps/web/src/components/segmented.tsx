import { cn } from 'cn';
import { type KeyboardEvent, type ReactNode, useRef } from 'react';
import { IconTooltip } from './icon-tooltip.js';
import { Button } from './ui/button.js';
import { Tabs, TabsIndicator, TabsList, TabsTrigger } from './ui/tabs.js';

interface SegmentedOptionBase<T extends string> {
  value: T;
  disabled?: boolean;
  testId?: string;
  data?: Record<`data-${string}`, string>;
}

export type SegmentedOption<T extends string> = SegmentedOptionBase<T> &
  (
    | { label: string; icon?: ReactNode; ariaLabel?: undefined }
    | { label?: undefined; icon: ReactNode; ariaLabel: string }
  );

interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (next: T) => void;
  className?: string;
  optionHandle?: string;
}

const TRACK_CLS =
  'inline-flex h-8 w-fit items-center justify-center gap-0.5 rounded-md bg-secondary p-0.5 text-foreground group-data-horizontal/tabs:h-8';

const OPTION_CLS =
  "relative inline-flex h-7 flex-none items-center justify-center gap-1.5 rounded-(--cds-radius-sm) border-0 px-3 py-0 text-ui font-normal whitespace-nowrap text-foreground transition-[color,background-color] duration-(--dur-fast) ease-out dark:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const QUIET_TRACK_CLS =
  'inline-flex h-7 w-fit items-center gap-1 bg-transparent p-0 text-foreground group-data-horizontal/tabs:h-7';

const QUIET_OPTION_CLS =
  'rounded-(--cds-radius-md) px-2.5 text-meta data-active:bg-(--sidebar-active) dark:data-active:bg-(--sidebar-active) hover:bg-(--hover-1)';

const OPTION_ICON_CLS = 'w-7 px-0';

const RADIO_BUTTON_NEUTRAL_CLS = 'hover:bg-transparent dark:hover:bg-transparent';

const OPTION_SELECTED_CLS = 'data-active:font-medium';

const OPTION_SELECTED_FACE_CLS =
  'data-active:bg-(--seg-active) data-active:shadow-xs data-active:ring-1 data-active:ring-border dark:data-active:bg-(--seg-active) group-data-[variant=default]/tabs-list:data-active:shadow-xs';

const OPTION_UNDER_PILL_CLS =
  'z-[1] data-active:bg-transparent data-active:shadow-none dark:data-active:bg-transparent group-data-[variant=default]/tabs-list:data-active:shadow-none';

const PILL_CLS =
  'pointer-events-none absolute top-(--active-tab-top) left-(--active-tab-left) z-0 h-(--active-tab-height) w-(--active-tab-width) rounded-(--cds-radius-sm) bg-(--seg-active) shadow-xs ring-1 ring-border [transition:left_var(--dur-fast)_ease,top_var(--dur-fast)_ease,width_var(--dur-fast)_ease,height_var(--dur-fast)_ease] motion-reduce:[transition:none]';

function optionClass(option: SegmentedOption<string>) {
  return cn(OPTION_CLS, option.label === undefined && OPTION_ICON_CLS, OPTION_SELECTED_CLS);
}

function OptionContent({ option }: { option: SegmentedOption<string> }) {
  return (
    <>
      {option.icon}
      {option.label}
    </>
  );
}

export function SegmentedTabs<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  optionHandle,
  slide = false,
  quiet = false,
}: SegmentedProps<T> & {
  label?: string;
  slide?: boolean;
  quiet?: boolean;
}) {
  return (
    <Tabs className="contents" value={value} onValueChange={(next: unknown) => onChange(next as T)}>
      <TabsList
        aria-label={label}
        data-segmented="track"
        className={cn(quiet ? QUIET_TRACK_CLS : TRACK_CLS, slide && 'relative', className)}
      >
        {slide && <TabsIndicator data-segmented="indicator" className={PILL_CLS} />}
        {options.map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            disabled={option.disabled === true}
            aria-label={option.ariaLabel}
            data-testid={option.testId}
            data-segmented="option"
            {...option.data}
            className={cn(
              optionClass(option),
              quiet ? QUIET_OPTION_CLS : slide ? OPTION_UNDER_PILL_CLS : OPTION_SELECTED_FACE_CLS,
              optionHandle,
            )}
          >
            <OptionContent option={option} />
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export function SegmentedRadio<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  optionHandle,
}: SegmentedProps<T> & {
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.flatMap((option, index) => (option.disabled === true ? [] : [index]));
  const checkedIndex = options.findIndex((option) => option.value === value);
  const tabStop = checkedIndex >= 0 ? checkedIndex : (enabled[0] ?? -1);
  const move = (event: KeyboardEvent, index: number) => {
    const last = enabled.length - 1;
    const at = enabled.indexOf(index);
    const target =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? enabled[(at + 1) % enabled.length]
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? enabled[(at - 1 + enabled.length) % enabled.length]
          : event.key === 'Home'
            ? enabled[0]
            : event.key === 'End'
              ? enabled[last]
              : undefined;
    if (target === undefined) return;
    event.preventDefault();
    const option = options[target];
    if (option === undefined) return;
    onChange(option.value);
    refs.current[target]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-segmented="track"
      className={cn(TRACK_CLS, className)}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        const button = (
          <Button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            variant="ghost"
            role="radio"
            aria-checked={checked}
            aria-label={option.ariaLabel}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={option.disabled === true}
            data-active={checked ? '' : undefined}
            data-testid={option.testId}
            data-segmented="option"
            {...option.data}
            className={cn(
              optionClass(option),
              RADIO_BUTTON_NEUTRAL_CLS,
              OPTION_SELECTED_FACE_CLS,
              optionHandle,
            )}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
          >
            <OptionContent option={option} />
          </Button>
        );
        return option.ariaLabel === undefined ? (
          button
        ) : (
          <IconTooltip key={option.value} label={option.ariaLabel} trigger={button}>
            <OptionContent option={option} />
          </IconTooltip>
        );
      })}
    </div>
  );
}
