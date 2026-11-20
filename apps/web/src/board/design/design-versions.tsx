import type { DesignVersionRecord } from '@cairn/shared';
import { Button } from '../../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';
import { useI18n } from '../../i18n/provider.js';
import type { TFunc } from '../../i18n/translate.js';
import { relativeTime } from '../rel-time.js';

export function versionLabel(version: DesignVersionRecord, t: TFunc): string {
  return version.source === 'restore' && version.restoredFromSeq !== null
    ? t('从 v{n} 恢复', { n: version.restoredFromSeq })
    : t('第 {n} 版', { n: version.seq });
}

export function VersionsMenu({
  fileName,
  versions,
  currentId,
  shownId,
  onPick,
}: {
  fileName: string;
  versions: readonly DesignVersionRecord[];
  currentId: string;
  shownId: string;
  onPick: (version: DesignVersionRecord) => void;
}) {
  const { t } = useI18n();
  const now = Date.now();
  const ordered = [...versions].sort((a, b) => b.seq - a.seq);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            data-testid="design-versions"
            className="text-content-secondary hover:text-foreground"
          />
        }
      >
        {t('版本')}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('{name} · 版本', { name: fileName })}</DropdownMenuLabel>
          {ordered.map((version) => (
            <DropdownMenuItem
              key={version.id}
              data-testid="design-version-item"
              data-seq={version.seq}
              data-shown={version.id === shownId || undefined}
              onClick={() => onPick(version)}
              className="h-auto gap-3 py-2 pointer-coarse:h-auto data-shown:bg-(--hover-1)"
            >
              <span className="flex size-7 flex-none items-center justify-center rounded-full border border-border text-meta tabular-nums text-content-secondary">
                v{version.seq}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-ui text-foreground">
                  {versionLabel(version, t)}
                  {version.id === currentId && ` · ${t('当前')}`}
                </span>
                <span className="truncate text-meta tabular-nums text-content-tertiary">
                  {relativeTime(version.createdAt, now, t)}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
