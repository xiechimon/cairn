import { cn } from 'cn';
import { type KeyboardEvent, type ReactNode, useRef } from 'react';
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
  'inline-flex h-8 w-fit items-center justify-center gap-0.5 rounded-md bg-canvas p-0.5 text-content-secondary group-data-[orientation=horizontal]/tabs:h-8';

const OPTION_CLS =
  "relative inline-flex h-7 flex-none items-center justify-center gap-1.5 rounded-(--cds-radius-md) border-0 px-3 py-0 text-ui font-normal whitespace-nowrap text-content-secondary transition-[color,background-color,box-shadow] duration-(--dur-fast) ease-out hover:text-foreground dark:text-content-secondary dark:hover:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5";

const OPTION_ICON_CLS = 'w-7 px-0';

const RADIO_BUTTON_NEUTRAL_CLS =
  'hover:bg-transparent dark:hover:bg-transparent active:not-aria-[haspopup]:translate-y-0';

const OPTION_SELECTED_CLS =
  'data-active:font-medium data-active:text-foreground dark:data-active:text-foreground';

const OPTION_SELECTED_FACE_CLS =
  'data-active:bg-card data-active:shadow-xs data-active:ring-1 data-active:ring-border dark:data-active:bg-card group-data-[variant=default]/tabs-list:data-active:shadow-xs';

const OPTION_UNDER_PILL_CLS =
  'z-[1] data-active:bg-transparent data-active:shadow-none dark:data-active:bg-transparent group-data-[variant=default]/tabs-list:data-active:shadow-none';

const PILL_CLS =
  'pointer-events-none absolute top-(--active-tab-top) left-(--active-tab-left) z-0 h-(--active-tab-height) w-(--active-tab-width) rounded-(--cds-radius-md) bg-card shadow-xs ring-1 ring-border [transition:left_var(--dur-fast)_ease,top_var(--dur-fast)_ease,width_var(--dur-fast)_ease,height_var(--dur-fast)_ease] motion-reduce:[transition:none]';

function optionClass(option: SegmentedOption<string>, handle?: string) {
  return cn(OPTION_CLS, option.label === undefined && OPTION_ICON_CLS, OPTION_SELECTED_CLS, handle);
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
}: SegmentedProps<T> & {
  label?: string;
  slide?: boolean;
}) {
  return (
    <Tabs className="contents" value={value} onValueChange={(next: unknown) => onChange(next as T)}>
      <TabsList
        aria-label={label}
        data-segmented="track"
        className={cn(TRACK_CLS, slide && 'relative', className)}
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
              optionClass(option, optionHandle),
              slide ? OPTION_UNDER_PILL_CLS : OPTION_SELECTED_FACE_CLS,
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
        return (
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
              optionClass(option, optionHandle),
              RADIO_BUTTON_NEUTRAL_CLS,
              OPTION_SELECTED_FACE_CLS,
            )}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
          >
            <OptionContent option={option} />
          </Button>
        );
      })}
    </div>
  );
}
