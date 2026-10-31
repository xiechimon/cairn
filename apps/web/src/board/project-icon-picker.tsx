import {
  type PatchProjectBody,
  PROJECT_COLORS,
  PROJECT_ICONS,
  type ProjectColor,
  type ProjectIcon,
} from '@cairn/shared';
import { cn } from 'cn';
import { Ban, Search } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { useI18n } from '../i18n/provider.js';
import { PROJECT_COLOR_SWATCH } from './project-avatar.js';
import { PROJECT_ICON_COMPONENTS } from './project-icon-map.js';

const COLOR_LABEL: Record<ProjectColor, string> = {
  moss: '苔绿',
  amber: '琥珀',
  slate: '石板',
  plum: '梅紫',
  teal: '青碧',
  rose: '玫红',
  gray: '灰色',
};

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring';

export interface ProjectIconPickerProps {
  icon: ProjectIcon | null | undefined;
  color: ProjectColor | null | undefined;
  onChange: (patch: Pick<PatchProjectBody, 'icon' | 'color'>) => void;
  trigger: ReactNode;
  triggerClassName?: string;
  disabled?: boolean;
}

export function ProjectIconPicker({
  icon,
  color,
  onChange,
  trigger,
  triggerClassName,
  disabled = false,
}: ProjectIconPickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase().replaceAll(' ', '-');
  const shown = PROJECT_ICONS.filter((name) => name.includes(needle));
  return (
    <Popover onOpenChange={() => setQuery('')}>
      <PopoverTrigger
        disabled={disabled}
        aria-label={t('更换项目图标')}
        data-testid="project-icon-trigger"
        className={cn('block size-full cursor-pointer', FOCUS, triggerClassName)}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        data-testid="project-icon-picker"
        className="w-69 gap-0 rounded-xl p-1"
      >
        <div className="relative px-1.5 pt-1.5 pb-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-content-tertiary"
          />
          <Input
            aria-label={t('搜索图标')}
            placeholder={t('搜索图标')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 pl-8"
          />
        </div>
        <fieldset className="m-0 grid min-h-34 min-w-0 grid-cols-8 content-start gap-0 border-0 px-1.5 py-1">
          <legend className="sr-only">{t('图标')}</legend>
          {shown.map((name) => {
            const Icon = PROJECT_ICON_COMPONENTS[name];
            const selected = icon === name;
            return (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-pressed={selected}
                data-icon={name}
                onClick={() => onChange({ icon: name })}
                className={cn(
                  'grid size-8 cursor-pointer place-items-center rounded-(--radius-menu-item) text-content-secondary hover:bg-(--menu-hover) hover:text-foreground',
                  selected && 'bg-(--menu-hover) text-foreground',
                  FOCUS,
                )}
              >
                <Icon className="size-4" strokeWidth={1.75} />
              </button>
            );
          })}
          {shown.length === 0 && (
            <p className="col-span-8 m-0 px-1 py-2 text-ui text-content-tertiary">
              {t('没有匹配的图标')}
            </p>
          )}
        </fieldset>
        <fieldset className="m-0 flex min-w-0 items-center justify-between border-0 border-t border-border px-2.5 py-2.5">
          <legend className="sr-only">{t('颜色')}</legend>
          <button
            type="button"
            aria-label={t('无颜色')}
            aria-pressed={color == null}
            data-color="none"
            onClick={() => onChange({ color: null })}
            className={cn(
              'grid size-5 cursor-pointer place-items-center rounded-full text-content-tertiary ring-1 ring-border ring-inset',
              color == null && 'ring-2 ring-offset-2 ring-offset-popover ring-foreground',
              FOCUS,
            )}
          >
            <Ban className="size-3" strokeWidth={1.75} />
          </button>
          {PROJECT_COLORS.map((name) => (
            <button
              key={name}
              type="button"
              aria-label={t(COLOR_LABEL[name])}
              aria-pressed={color === name}
              data-color={name}
              onClick={() => onChange({ color: name })}
              className={cn(
                'size-5 cursor-pointer rounded-full',
                PROJECT_COLOR_SWATCH[name],
                color === name && 'ring-2 ring-offset-2 ring-offset-popover ring-foreground',
                FOCUS,
              )}
            />
          ))}
        </fieldset>
        <div className="border-t border-border p-0.5">
          <Button
            variant="ghost"
            disabled={icon == null && color == null}
            onClick={() => onChange({ icon: null, color: null })}
            className="h-8 w-full justify-start px-2.5 text-ui font-normal text-content-secondary hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)"
          >
            {t('重置图标和颜色')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
