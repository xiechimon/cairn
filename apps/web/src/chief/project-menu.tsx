import { CircleDashed } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { ProjectAvatar } from '../board/project-avatar.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { useI18n } from '../i18n/provider.js';

export interface ProjectOption {
  id: string;
  name: string;
  description?: string | undefined;
}

const AUTO_VALUE = '';

const ITEM_CLS = 'h-auto min-h-8 items-start py-1.5';

function OptionText({ title, hint }: { title: string; hint?: string | undefined }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-medium text-foreground">{title}</span>
      {hint != null && hint !== '' && (
        <span className="truncate text-caption text-content-tertiary">{hint}</span>
      )}
    </span>
  );
}

export function ProjectMenu({
  title,
  projects,
  value,
  withAuto,
  trigger,
  children,
  side = 'bottom',
  onPick,
}: {
  title: string;
  projects: readonly ProjectOption[];
  value: string | null;
  withAuto: boolean;
  trigger: ReactElement;
  children: ReactNode;
  side?: 'top' | 'bottom';
  onPick: (projectId: string | null) => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger}>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        side={side}
        sideOffset={6}
        aria-label={t(title)}
        className="w-auto max-w-80 min-w-60"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t(title)}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value ?? AUTO_VALUE}
            onValueChange={(next) => onPick(next === AUTO_VALUE ? null : String(next))}
          >
            {withAuto && (
              <DropdownMenuRadioItem value={AUTO_VALUE} closeOnClick className={ITEM_CLS}>
                <CircleDashed className="mt-0.5 size-4.5 flex-none text-content-tertiary" />
                <OptionText title={t('自动')} hint={t('总管判断，拿不准会问你')} />
              </DropdownMenuRadioItem>
            )}
            {projects.map((p, i) => (
              <DropdownMenuRadioItem key={p.id} value={p.id} closeOnClick className={ITEM_CLS}>
                <ProjectAvatar name={p.name} tone={i} className="mt-0.5" />
                <OptionText title={p.name} hint={p.description} />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
