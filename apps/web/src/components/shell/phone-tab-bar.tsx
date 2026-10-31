import { cn } from 'cn';
import type { ReactNode } from 'react';
import { Button } from '../ui/button.js';

export interface PhoneTab {
  id: string;
  label: string;
  icon: ReactNode;
  badge?: number;
}

export interface PhoneTabBarProps {
  tabs: readonly PhoneTab[];
  active: string;
  onChange?: (id: string) => void;
}

export function PhoneTabBar({ tabs, active, onChange }: PhoneTabBarProps) {
  return (
    <nav
      aria-label="Primary"
      data-slot="phone-tab-bar"
      className="flex h-15.5 flex-none border-t border-border bg-background px-2 pb-1.5"
    >
      {tabs.map((tab) => (
        <Button
          key={tab.id}
          variant="ghost"
          aria-current={tab.id === active ? 'page' : undefined}
          onClick={() => onChange?.(tab.id)}
          className={cn(
            'relative h-full flex-1 flex-col gap-0.75 text-caption font-normal hover:bg-transparent dark:hover:bg-transparent',
            tab.id === active ? 'font-semibold text-foreground' : 'text-content-tertiary',
          )}
        >
          {tab.icon}
          {tab.label}
          {tab.badge != null && tab.badge > 0 && (
            <span className="absolute top-1.5 left-[calc(50%+6px)] grid h-4 min-w-4 place-items-center rounded-full bg-pebble-waiting px-1 text-caption leading-none font-semibold text-(--text-on-accent)">
              {tab.badge}
            </span>
          )}
        </Button>
      ))}
    </nav>
  );
}
