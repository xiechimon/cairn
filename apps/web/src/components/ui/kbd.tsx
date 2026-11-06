import { cn } from 'cn';
import { ArrowDown, ArrowUp, CornerDownLeft, Delete } from 'lucide-react';
import type * as React from 'react';

function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn('inline-flex items-center gap-1', className)}
      {...props}
    />
  );
}

const MOD_LABEL = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const SHORTCUT_ICONS = {
  enter: CornerDownLeft,
  up: ArrowUp,
  down: ArrowDown,
  backspace: Delete,
} as const;

type ShortcutIcon = keyof typeof SHORTCUT_ICONS;

function ShortcutHint({
  keys,
  chipClassName,
  className,
}: {
  keys: readonly (ShortcutIcon | 'mod' | (string & {}))[];
  chipClassName?: string;
  className?: string;
}) {
  return (
    <KbdGroup className={cn('gap-0.5', className)}>
      {keys.map((key) => {
        const Icon = key in SHORTCUT_ICONS ? SHORTCUT_ICONS[key as ShortcutIcon] : null;
        return (
          <Kbd
            key={key}
            className={cn(
              'h-4.5 min-w-4.5 rounded-(--cds-radius-sm) border border-current/22 bg-transparent px-[3px] text-current shadow-none!',
              Icon !== null && 'px-0',
              chipClassName,
            )}
          >
            {Icon !== null ? (
              <Icon aria-hidden strokeWidth={1.75} className="size-3" />
            ) : key === 'mod' ? (
              MOD_LABEL
            ) : (
              key
            )}
          </Kbd>
        );
      })}
    </KbdGroup>
  );
}

export { Kbd, KbdGroup, ShortcutHint };
