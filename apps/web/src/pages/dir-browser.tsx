import { FS_LIST_MAX_ENTRIES } from '@cairn/shared';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useFsList } from '../api/hooks.js';
import { Button } from '../components/ui/button.js';
import { PopoverContent } from '../components/ui/popover.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronRight, GitCommit } from '../icons/index.js';

const LAST_DIR_KEY = 'cairn.dirBrowser.lastDir';

const CRUMB_CLS =
  'h-auto max-w-40 shrink cursor-pointer truncate p-1 font-normal text-muted-foreground hover:text-foreground aria-[current=location]:font-medium aria-[current=location]:text-foreground';

const ROW_NAME_CLS =
  'h-auto min-w-0 flex-1 cursor-pointer justify-start truncate px-1.5 py-1 font-normal hover:bg-transparent dark:hover:bg-transparent';

const PICK_CLS =
  'flex-none cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100';

function readLastDir(): string | null {
  try {
    return window.localStorage.getItem(LAST_DIR_KEY);
  } catch {
    return null;
  }
}

function writeLastDir(path: string): void {
  try {
    window.localStorage.setItem(LAST_DIR_KEY, path);
  } catch {}
}

function breadcrumb(path: string): { label: string; path: string }[] {
  const segs = [{ label: '/', path: '/' }];
  let acc = '';
  for (const part of path.split('/')) {
    if (part === '') continue;
    acc += `/${part}`;
    segs.push({ label: part, path: acc });
  }
  return segs;
}

export function DirBrowser({ onPick }: { onPick: (path: string) => void }) {
  const { t } = useI18n();
  const [dir, setDir] = useState<string | null>(() => readLastDir());
  const [showDotfiles, setShowDotfiles] = useState(false);

  const listQ = useFsList(dir, true);

  const lastGoodPath = useRef<string | null>(null);
  const dataPath = listQ.data && !listQ.isPlaceholderData ? listQ.data.path : null;
  useEffect(() => {
    if (dataPath !== null) {
      lastGoodPath.current = dataPath;
      writeLastDir(dataPath);
    }
  }, [dataPath]);
  const currentPath = dataPath ?? lastGoodPath.current;

  const reason = listQ.error instanceof ApiError ? listQ.error.reason : undefined;
  useEffect(() => {
    if (
      dir !== null &&
      (reason === 'not_found' || reason === 'not_dir' || reason === 'not_readable')
    ) {
      setDir(null);
    }
  }, [dir, reason]);

  const entries = listQ.data?.entries ?? [];
  const visible = showDotfiles ? entries : entries.filter((e) => !e.name.startsWith('.'));
  const crumbs = currentPath !== null ? breadcrumb(currentPath) : [];

  return (
    <PopoverContent side="bottom" align="end" sideOffset={8} aria-label={t('浏览本地文件夹')}>
      <div className="flex items-center gap-2 px-1">
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
          {crumbs.map((seg, i) => (
            <span key={seg.path} className="inline-flex min-w-0 items-center gap-0.5">
              {i > 0 && (
                <span className="inline-flex text-muted-foreground" aria-hidden="true">
                  <ChevronRight width={12} height={12} />
                </span>
              )}
              <Button
                variant="ghost"
                className={CRUMB_CLS}
                aria-current={i === crumbs.length - 1 ? 'location' : undefined}
                onClick={() => setDir(seg.path)}
              >
                {seg.label}
              </Button>
            </span>
          ))}
        </nav>
        <Button
          variant={showDotfiles ? 'secondary' : 'outline'}
          size="xs"
          className="flex-none whitespace-nowrap"
          aria-pressed={showDotfiles}
          onClick={() => setShowDotfiles((v) => !v)}
        >
          {t('显示隐藏文件')}
        </Button>
      </div>
      <ul className="flex max-h-72 flex-col overflow-y-auto">
        {listQ.isError ? (
          <div className="px-3 py-2 text-xs leading-4 text-destructive" role="alert">
            {(listQ.error as Error).message}
          </div>
        ) : (
          visible.map((entry) => {
            const base = currentPath ?? '/';
            const child = base === '/' ? `/${entry.name}` : `${base}/${entry.name}`;
            return (
              <li
                className="group flex h-8 items-center gap-1.5 rounded-md px-1 hover:bg-accent"
                key={entry.name}
              >
                <Button variant="ghost" className={ROW_NAME_CLS} onClick={() => setDir(child)}>
                  {entry.name}
                </Button>
                {entry.git && (
                  <span
                    className="inline-flex flex-none text-primary"
                    role="img"
                    aria-label={t('git 仓库')}
                  >
                    <GitCommit width={13} height={13} />
                  </span>
                )}
                <Button
                  variant="outline"
                  size="xs"
                  className={PICK_CLS}
                  onClick={() => onPick(child)}
                >
                  {t('选择')}
                </Button>
              </li>
            );
          })
        )}
        {!listQ.isError &&
          !listQ.isPlaceholderData &&
          listQ.data !== undefined &&
          visible.length === 0 && (
            <li className="px-3 py-2 text-xs leading-4 text-muted-foreground">
              {entries.length === 0 ? t('没有子目录') : t('子目录均已隐藏')}
            </li>
          )}
      </ul>
      {listQ.data?.truncated === true && (
        <div className="border-t border-border p-1 text-xs leading-4 text-muted-foreground">
          {t('目录条目过多，只列出前 {n} 条', { n: FS_LIST_MAX_ENTRIES })}
        </div>
      )}
    </PopoverContent>
  );
}
