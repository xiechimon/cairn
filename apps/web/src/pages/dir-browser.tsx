import { FS_LIST_MAX_ENTRIES } from '@cairn/shared';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useFsList, useProjects } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { PopoverContent } from '../components/ui/popover.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft, ChevronRight, Folder, GitCommit, Search } from '../icons/index.js';

const LAST_DIR_KEY = 'cairn.dirBrowser.lastDir';
const RECENT_KEY = 'cairn.dirBrowser.recent';
const RECENT_MAX = 6;

const LIST_ROW_CLS =
  'flex h-8 w-full cursor-pointer items-center justify-start gap-2.5 rounded-(--radius-menu-item) border-none bg-transparent px-2.5 text-left text-ui font-normal text-foreground hover:bg-(--menu-hover) hover:text-foreground data-selected:bg-(--menu-hover) dark:hover:bg-(--menu-hover) active:not-aria-[haspopup]:translate-y-0';

const LIST_GROUP_CLS = 'px-2.5 pt-2 pb-1 text-caption font-medium text-content-tertiary';

const CRUMB_CLS =
  'h-auto max-w-40 cursor-pointer truncate px-1 py-0.5 text-meta font-normal text-muted-foreground hover:text-foreground aria-[current=location]:font-medium aria-[current=location]:text-foreground';

const ROW_NAME_CLS =
  'h-auto min-w-0 flex-1 cursor-pointer justify-start gap-0 px-0 py-1 text-ui font-normal hover:bg-transparent dark:hover:bg-transparent';

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

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list: unknown = raw == null ? [] : JSON.parse(raw);
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function rememberPick(path: string): void {
  try {
    const next = [path, ...readRecent().filter((p) => p !== path)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

function baseName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`;
}

interface KnownFolder {
  path: string;
  git: boolean;
}

function FolderList({
  onPick,
  onBrowse,
}: {
  onPick: (path: string) => void;
  onBrowse: () => void;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const projectsQ = useProjects(teamId, live);
  const listQ = useFsList(readLastDir(), true);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const projectPaths = new Set(
    (projectsQ.data ?? []).flatMap((project) =>
      project.localPath != null && project.localPath !== '' ? [project.localPath] : [],
    ),
  );
  const recent: KnownFolder[] = [...new Set([...readRecent(), ...projectPaths])].map((path) => ({
    path,
    git: projectPaths.has(path),
  }));
  const listedDir = listQ.data && !listQ.isPlaceholderData ? listQ.data.path : null;
  const nearby: KnownFolder[] =
    listedDir === null
      ? []
      : (listQ.data?.entries ?? [])
          .filter((entry) => entry.git && !entry.name.startsWith('.'))
          .map((entry) => ({ path: joinPath(listedDir, entry.name), git: true }))
          .filter((folder) => !recent.some((r) => r.path === folder.path));

  const q = query.trim();
  const match = (folder: KnownFolder) =>
    q === '' || folder.path.toLowerCase().includes(q.toLowerCase());
  const typedPath = q.startsWith('/') ? q : null;
  const groups: { label: string; folders: KnownFolder[] }[] = [
    { label: t('最近'), folders: recent.filter(match) },
    {
      label: listedDir === null ? '' : t('{dir} 里的仓库', { dir: listedDir }),
      folders: nearby.filter(match),
    },
  ].filter((group) => group.folders.length > 0);
  const actions: Array<() => void> = [
    ...(typedPath === null ? [] : [() => onPick(typedPath)]),
    ...groups.flatMap((group) => group.folders.map((folder) => () => onPick(folder.path))),
    onBrowse,
  ];
  const at = Math.min(cursor, actions.length - 1);
  let index = typedPath === null ? 0 : 1;

  return (
    <>
      <div className="-mx-2.5 -mt-2.5 mb-1 flex h-10 items-center gap-2 border-b border-border px-3 text-content-tertiary">
        <Search width={15} height={15} />
        <Input
          autoFocus
          aria-label={t('查找文件夹或粘贴路径')}
          placeholder={t('查找文件夹或粘贴路径…')}
          className="h-auto flex-1 rounded-none border-none bg-transparent p-0 text-ui text-foreground shadow-none ring-0 placeholder:text-content-tertiary focus-visible:border-transparent focus-visible:ring-0! focus-visible:outline-none md:text-ui dark:bg-transparent"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setCursor((at + step + actions.length) % actions.length);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              actions[at]?.();
            }
          }}
        />
      </div>
      <div className="flex max-h-80 flex-col overflow-y-auto" data-testid="dir-folder-list">
        {typedPath !== null && (
          <Button
            variant="ghost"
            className={LIST_ROW_CLS}
            data-selected={at === 0 ? '' : undefined}
            onClick={() => onPick(typedPath)}
          >
            <Folder aria-hidden="true" className="size-4 flex-none text-icon" />
            <span className="truncate">{t('使用 {path}', { path: typedPath })}</span>
          </Button>
        )}
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col">
            <div className={LIST_GROUP_CLS}>{group.label}</div>
            {group.folders.map((folder) => {
              const rowIndex = index++;
              return (
                <Button
                  key={folder.path}
                  variant="ghost"
                  className={LIST_ROW_CLS}
                  data-selected={at === rowIndex ? '' : undefined}
                  title={folder.path}
                  onClick={() => onPick(folder.path)}
                >
                  <Folder aria-hidden="true" className="size-4 flex-none text-icon" />
                  <span className="flex-none">{baseName(folder.path)}</span>
                  <span className="ml-auto min-w-0 truncate pl-3 text-meta text-content-tertiary">
                    {folder.path}
                  </span>
                  {folder.git && (
                    <span className="flex-none rounded-(--cds-radius-sm) bg-secondary px-1.5 text-caption text-content-secondary">
                      git
                    </span>
                  )}
                </Button>
              );
            })}
          </div>
        ))}
        {groups.length === 0 && typedPath === null && (
          <div className="px-2.5 py-2 text-meta text-content-tertiary">
            {q === '' ? t('还没有用过的文件夹') : t('没有匹配的文件夹')}
          </div>
        )}
      </div>
      <div className="-mx-2.5 mt-1 border-t border-border px-1 pt-1">
        <Button
          variant="ghost"
          className={LIST_ROW_CLS}
          data-selected={at === actions.length - 1 ? '' : undefined}
          onClick={onBrowse}
        >
          <ChevronRight aria-hidden="true" className="size-4 flex-none text-icon" />
          {t('浏览文件夹…')}
        </Button>
      </div>
    </>
  );
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
  const [browsing, setBrowsing] = useState(false);
  const pick = (path: string) => {
    rememberPick(path);
    onPick(path);
  };
  return (
    <PopoverContent
      side="bottom"
      align="start"
      sideOffset={8}
      className="w-115"
      aria-label={t('浏览本地文件夹')}
    >
      {browsing ? (
        <FolderTree onPick={pick} onBack={() => setBrowsing(false)} />
      ) : (
        <FolderList onPick={pick} onBrowse={() => setBrowsing(true)} />
      )}
    </PopoverContent>
  );
}

function FolderTree({ onPick, onBack }: { onPick: (path: string) => void; onBack: () => void }) {
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
    <>
      <div className="flex items-center gap-1 px-1">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('返回列表')}
          className="flex-none self-start text-content-tertiary"
          onClick={onBack}
        >
          <ChevronLeft width={14} height={14} />
        </Button>
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 border-b border-border pb-1.5">
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
                className="group flex h-8 items-center gap-2 rounded-(--radius-menu-item) px-1.5 hover:bg-(--menu-hover)"
                key={entry.name}
              >
                <Folder aria-hidden="true" className="size-4 flex-none text-icon" />
                <Button
                  variant="ghost"
                  aria-label={entry.name}
                  className={ROW_NAME_CLS}
                  onClick={() => setDir(child)}
                >
                  <span className="truncate">{entry.name}</span>
                  {entry.git && (
                    <span
                      className="ml-1 inline-flex flex-none items-center gap-1 text-caption text-content-tertiary"
                      role="img"
                      aria-label={t('git 仓库')}
                    >
                      <GitCommit width={12} height={12} />
                      git
                    </span>
                  )}
                </Button>
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
      <div className="border-t border-border pt-1">
        <Button
          variant="ghost"
          size="xs"
          className="h-7 justify-start px-1.5 text-meta font-normal text-content-tertiary aria-pressed:text-foreground"
          aria-pressed={showDotfiles}
          onClick={() => setShowDotfiles((v) => !v)}
        >
          {t('显示隐藏文件')}
        </Button>
      </div>
    </>
  );
}
