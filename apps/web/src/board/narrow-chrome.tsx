import { cn } from 'cn';
import { ListChecks, TextAlignStart } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { setDrawerOpen, useDrawerOpen } from './narrow-drawer.js';
import { NARROW_FLOAT_CLS, NARROW_ICON_CLS, NeedsYouCount } from './phone-tabs.js';

const KEYBOARD_MIN_PX = 150;

const FLOAT_BUTTON_CLS = `${NARROW_FLOAT_CLS} absolute top-3 size-11.5 rounded-full text-foreground hover:bg-popover dark:hover:bg-popover`;

function editableFocused(): boolean {
  const node = document.activeElement;
  if (!(node instanceof HTMLElement)) return false;
  return (
    node.isContentEditable ||
    node.matches('textarea, input:not([type=checkbox], [type=radio], [type=button], [type=submit])')
  );
}

export function useNarrowChrome(): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.narrowChrome = '';
    const viewport = window.visualViewport;
    const heightNow = () => viewport?.height ?? window.innerHeight;
    let tallest = { width: window.innerWidth, height: heightNow() };
    const update = () => {
      const height = heightNow();
      if (window.innerWidth !== tallest.width) tallest = { width: window.innerWidth, height };
      else if (height > tallest.height) tallest = { ...tallest, height };
      const open = editableFocused() && tallest.height - height > KEYBOARD_MIN_PX;
      const inset = Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0));
      root.style.setProperty('--keyboard-inset', `${open ? inset : 0}px`);
      if (open) root.dataset.keyboardOpen = '';
      else delete root.dataset.keyboardOpen;
      setKeyboardOpen(open);
    };
    viewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      delete root.dataset.narrowChrome;
      delete root.dataset.keyboardOpen;
      root.style.removeProperty('--keyboard-inset');
    };
  }, []);
  return keyboardOpen;
}

export function NarrowTopControls({
  mark,
  tasksOpen,
  badge,
  onTasks,
}: {
  mark: ReactNode;
  tasksOpen: boolean;
  badge: number;
  onTasks: () => void;
}) {
  const { t } = useI18n();
  const drawerOpen = useDrawerOpen();
  const tasksLabel = badge > 0 ? t('任务，{n} 件等你', { n: badge }) : t('任务');
  return (
    <div
      data-slot="narrow-top"
      className="pointer-events-none fixed inset-x-0 top-0 z-(--z-narrow-chrome) pt-[env(safe-area-inset-top)]"
    >
      <div className="relative h-18">
        <IconTooltip
          label={t('展开侧边栏')}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon"
              data-testid="narrow-menu"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className={cn(FLOAT_BUTTON_CLS, 'left-4')}
            />
          }
        >
          <TextAlignStart aria-hidden className={NARROW_ICON_CLS} strokeWidth={1.75} />
        </IconTooltip>
        <div className="absolute inset-x-0 top-1">{mark}</div>
        <IconTooltip
          label={tasksLabel}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon"
              data-testid="tasks-toggle"
              aria-pressed={tasksOpen}
              onClick={onTasks}
              className={cn(
                FLOAT_BUTTON_CLS,
                'right-4 aria-pressed:bg-(--card-button) aria-pressed:text-(--text-on-accent) dark:aria-pressed:bg-(--card-button)',
              )}
            />
          }
        >
          <ListChecks aria-hidden className={NARROW_ICON_CLS} strokeWidth={1.75} />
          {badge > 0 && <NeedsYouCount count={badge} className="-top-1 -right-1" />}
        </IconTooltip>
      </div>
    </div>
  );
}
