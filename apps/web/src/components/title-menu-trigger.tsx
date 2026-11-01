import { cn } from 'cn';
import type { ReactNode } from 'react';
import { ChevronDown } from '../icons/index.js';
import { DropdownMenuTrigger } from './ui/dropdown-menu.js';

const SIZE_CLS = {
  page: '-ml-1.5 h-8 gap-2 rounded-md px-1.5 font-serif text-page tracking-[-0.01em]',
  pane: 'h-7 gap-1 rounded-lg px-2 text-ui',
} as const;

const CHEVRON_PX = { page: 14, pane: 12 } as const;

export function TitleMenuTrigger({
  size = 'page',
  media,
  testId,
  children,
}: {
  size?: keyof typeof SIZE_CLS;
  media?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenuTrigger
      data-testid={testId}
      className={cn(
        'inline-flex min-w-0 items-center font-semibold text-(--foreground) outline-none hover:bg-(--menu-hover) focus-visible:ring-2 focus-visible:ring-(--ring) aria-expanded:bg-(--menu-hover)',
        SIZE_CLS[size],
      )}
    >
      {media}
      <span className="min-w-0 truncate">{children}</span>
      <ChevronDown
        aria-hidden
        width={CHEVRON_PX[size]}
        height={CHEVRON_PX[size]}
        className="flex-none text-(--text-tertiary)"
      />
    </DropdownMenuTrigger>
  );
}
