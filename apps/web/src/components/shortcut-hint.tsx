import { cn } from 'cn';
import { ArrowDown, ArrowUp, CornerDownLeft, Delete } from 'lucide-react';
import { Kbd, KbdGroup } from './ui/kbd.js';

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

export { ShortcutHint };
