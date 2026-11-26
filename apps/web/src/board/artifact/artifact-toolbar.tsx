import { attachmentExtOf, type DesignVersionRecord } from '@cairn/shared';
import { cn } from 'cn';
import { ChevronDown, History, MessageSquare, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconTooltip } from '../../components/icon-tooltip.js';
import { KeyedMenuContent } from '../../components/menu-keys.js';
import { Button } from '../../components/ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../../components/ui/dropdown-menu.js';
import { useI18n } from '../../i18n/provider.js';
import type { TFunc } from '../../i18n/translate.js';
import { relativeTime } from '../rel-time.js';

export const TOOL_BUTTON =
  'h-7 gap-1.5 px-2 text-content-secondary hover:text-foreground aria-pressed:bg-(--hover-1) aria-pressed:text-foreground aria-expanded:bg-(--hover-1) aria-expanded:text-foreground';

export function ToolbarRule() {
  return <span aria-hidden className="mx-0.5 h-4 w-px flex-none bg-border" />;
}

function baseName(name: string): string {
  const ext = attachmentExtOf(name);
  return ext === '' ? name : name.slice(0, -(ext.length + 1));
}

export interface CommentToggle {
  count: number;
  on: boolean;
  disabled: boolean;
  toggle: () => void;
}

export function ArtifactToolbar({
  name,
  menu,
  controls,
  comments,
  history,
  exportMenu,
}: {
  name: string;
  menu: ReactNode;
  controls?: ReactNode;
  comments: CommentToggle | null;
  history: { open: boolean; toggle: () => void } | null;
  exportMenu?: ReactNode;
}) {
  const { t } = useI18n();
  const ext = attachmentExtOf(name).toUpperCase();
  return (
    <div
      data-testid="artifact-toolbar"
      className="flex h-11 min-w-0 flex-none items-center gap-1 border-b border-border pr-3 pl-4"
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              data-testid="artifact-name"
              className="-ml-1.5 h-7 min-w-0 gap-1 px-1.5 font-medium text-foreground aria-expanded:bg-(--hover-1)"
            />
          }
        >
          <span className="truncate">{baseName(name)}</span>
          {ext !== '' && (
            <span className="flex-none font-normal text-content-tertiary">{`· ${ext}`}</span>
          )}
          <ChevronDown aria-hidden className="size-4 flex-none text-content-tertiary" />
        </DropdownMenuTrigger>
        <KeyedMenuContent align="start" className="w-52">
          {menu}
        </KeyedMenuContent>
      </DropdownMenu>
      <span className="min-w-0 flex-1" />
      {controls}
      {comments !== null && (
        <Button
          variant="ghost"
          size="sm"
          data-testid="artifact-comment-toggle"
          aria-pressed={comments.on}
          disabled={comments.disabled}
          onClick={comments.toggle}
          className={TOOL_BUTTON}
        >
          <MessageSquare aria-hidden className="size-4" />
          <span className="max-[640px]:sr-only">{t('评论')}</span>
          {comments.count > 0 && (
            <span data-testid="artifact-comment-count" className="tabular-nums">
              {comments.count}
            </span>
          )}
        </Button>
      )}
      {history !== null && (
        <IconTooltip
          label={t('版本历史')}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="artifact-history-toggle"
              aria-pressed={history.open}
              onClick={history.toggle}
              className={cn(TOOL_BUTTON, 'w-7 px-0')}
            />
          }
        >
          <History aria-hidden className="size-4" />
        </IconTooltip>
      )}
      {exportMenu !== undefined && (
        <>
          <ToolbarRule />
          {exportMenu}
        </>
      )}
    </div>
  );
}

export function versionLabel(version: DesignVersionRecord, t: TFunc): string {
  return version.source === 'restore' && version.restoredFromSeq !== null
    ? t('从第 {n} 版恢复', { n: version.restoredFromSeq })
    : t('第 {n} 版', { n: version.seq });
}

function versionAuthor(version: DesignVersionRecord, t: TFunc): string {
  return version.source === 'user' ? t('你') : t('Coordinator');
}

export function VersionHistory({
  versions,
  currentId,
  shownId,
  onPick,
  onClose,
}: {
  versions: readonly DesignVersionRecord[];
  currentId: string;
  shownId: string;
  onPick: (version: DesignVersionRecord) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const now = Date.now();
  const ordered = [...versions].sort((a, b) => b.seq - a.seq);
  return (
    <section
      data-testid="artifact-history"
      aria-label={t('版本历史')}
      className="flex w-60 flex-none flex-col border-l border-border bg-background max-[760px]:absolute max-[760px]:inset-y-0 max-[760px]:right-0 max-[760px]:z-20 max-[760px]:shadow-(--e2)"
    >
      <div className="flex h-11 flex-none items-center pr-2 pl-3.5">
        <h3 className="m-0 flex-1 text-ui font-medium text-foreground">{t('版本历史')}</h3>
        <IconTooltip
          label={t('关闭版本历史')}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="artifact-history-close"
              onClick={onClose}
              className="text-content-secondary hover:text-foreground"
            />
          }
        >
          <X aria-hidden className="size-4" />
        </IconTooltip>
      </div>
      <ol className="m-0 flex min-h-0 flex-1 list-none flex-col gap-0.5 overflow-y-auto px-1.5 pb-3">
        {ordered.map((version) => (
          <li key={version.id}>
            <Button
              variant="ghost"
              data-testid="artifact-version"
              data-seq={version.seq}
              aria-current={version.id === shownId ? 'true' : undefined}
              onClick={() => onPick(version)}
              className="h-auto w-full flex-col items-start gap-0.5 rounded-(--radius-menu-item) px-2 py-2 text-left font-normal whitespace-normal hover:bg-(--hover-1) aria-current:bg-(--hover-1) dark:hover:bg-(--hover-1)"
            >
              <span className="text-ui text-foreground tabular-nums">
                {relativeTime(version.createdAt, now, t)}
                {version.id === currentId && (
                  <span className="ml-1.5 text-meta text-content-tertiary">{t('当前')}</span>
                )}
              </span>
              <span className="truncate text-meta text-content-tertiary tabular-nums">
                {`${versionAuthor(version, t)} · ${versionLabel(version, t)}`}
              </span>
            </Button>
          </li>
        ))}
        <li className="px-2 pt-3 text-meta text-content-tertiary">
          {t('每次改动都会存一版，旧版不会被覆盖。')}
        </li>
      </ol>
    </section>
  );
}

export function OldVersionBar({
  shown,
  current,
  readOnly,
  restoring,
  onRestore,
  onCurrent,
}: {
  shown: DesignVersionRecord;
  current: DesignVersionRecord;
  readOnly: boolean;
  restoring: boolean;
  onRestore: () => void;
  onCurrent: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-testid="artifact-version-banner"
      className="flex flex-none flex-wrap items-center gap-2 border-b border-border bg-(--surface-1) px-4 py-1.5 text-ui text-foreground"
    >
      <span className="min-w-0 flex-1 truncate">
        {t('正在看第 {n} 版，当前是第 {m} 版', { n: shown.seq, m: current.seq })}
      </span>
      {!readOnly && (
        <Button
          variant="outline"
          size="sm"
          data-testid="artifact-version-restore"
          disabled={restoring}
          onClick={onRestore}
        >
          {t('切回这个版本')}
        </Button>
      )}
      <Button variant="ghost" size="sm" data-testid="artifact-version-current" onClick={onCurrent}>
        {t('回到当前')}
      </Button>
    </div>
  );
}
