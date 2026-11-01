import type { DiffFileContent } from '@cairn/shared';
import { cn } from 'cn';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useBuildChangeFile } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { relativeTime } from '../board/rel-time.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { Button } from '../components/ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import type {
  ChangesContent,
  DiffFile,
  DocBlock,
  PlanDiffContent,
  PlanVersion,
} from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown, ChevronRight, Restore, UnfoldVertical } from '../icons/index.js';
import {
  type DocTypeLabel,
  type DocView,
  PaneTitle,
  PaneViewButtons,
} from '../overlay/plan-dropdown.js';
import { Segments } from './segments.js';
import { computeHunkWordDiff } from './word-diff.js';

interface DocPaneProps {
  mode: 'plan' | 'changes' | 'diff';
  doc: DocBlock[] | undefined;
  changes: ChangesContent | undefined;
  now: number;
  onDocView: (view: DocView) => void;
  sections?: ReactNode;
  planVersions?: PlanVersion[];
  versionMenu?: 'versions' | 'compare';
  onVersionMenu?: (menu: 'versions' | 'compare' | undefined) => void;
  onCompare?: () => void;
  onBase?: () => void;
  planDiff?: PlanDiffContent;
  onToggleExpand?: () => void;
  buildId?: string | null;
  emptyMeta?: ReactNode;
}

const HUNK_RANGE = /^@@ -(\d+)(?:,(\d+))? /;

function oldRange(header: string): { start: number; length: number } | null {
  const match = HUNK_RANGE.exec(header);
  if (match == null) return null;
  return { start: Number(match[1]), length: match[2] === undefined ? 1 : Number(match[2]) };
}

export function unmodifiedBefore(hunks: readonly { header: string }[], index: number): number {
  const current = oldRange(hunks[index]?.header ?? '');
  if (current == null) return 0;
  if (index === 0) return Math.max(current.start - 1, 0);
  const previous = oldRange(hunks[index - 1]?.header ?? '');
  if (previous == null) return 0;
  return Math.max(current.start - (previous.start + previous.length), 0);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function dirName(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

const PANE_HEAD = 'flex h-10 flex-none items-center gap-1 px-2.5 text-meta text-(--text-secondary)';
const PANE_SELECT = 'doc-pane-select ml-0 font-normal text-(--text-tertiary)';
const DIFF_LINE =
  'flex items-center font-mono text-code leading-5 text-(--foreground) [font-variant-ligatures:none]';
const DIFF_NO = 'w-8 flex-none pr-2 text-right text-(--text-tertiary) select-none';
const DIFF_KIND_SKIN: Record<string, string> = {
  add: 'bg-(--diff-add-bg) shadow-[inset_2px_0_0_var(--diff-add-fg)]',
  del: 'bg-(--diff-del-bg) shadow-[inset_2px_0_0_var(--destructive)]',
  marker: 'bg-transparent text-(--text-tertiary)',
  context: '',
};
const WORD_SKIN: Record<string, string> = {
  add: 'bg-(--diff-add-word-bg)',
  del: 'bg-(--diff-del-word-bg)',
};

type FullFileView =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'binary' }
  | { kind: 'text'; content: string };

function deriveFullFileView(
  fetchLive: boolean,
  showFull: boolean,
  fixtureContent: string | null,
  file: { isError: boolean; data: DiffFileContent | undefined },
): FullFileView {
  if (!showFull) return { kind: 'hidden' };
  if (!fetchLive) {
    return fixtureContent !== null ? { kind: 'text', content: fixtureContent } : { kind: 'binary' };
  }
  if (file.isError) return { kind: 'error' };
  if (file.data === undefined) return { kind: 'loading' };
  return file.data.encoding === 'base64'
    ? { kind: 'binary' }
    : { kind: 'text', content: file.data.content };
}

export function DiffFileBlock({
  file,
  expanded,
  buildId,
  allowFullFile = true,
}: {
  file: DiffFile;
  expanded: boolean;
  buildId: string | null;
  allowFullFile?: boolean;
}) {
  const { t } = useI18n();
  const { live } = useLiveData();
  const [showFull, setShowFull] = useState(false);
  const fetchLive = live && buildId != null;
  const fullQ = useBuildChangeFile(buildId, showFull ? file.path : null, fetchLive);
  const full = deriveFullFileView(fetchLive, showFull, file.fullContent ?? null, fullQ);
  const wordDiffs = useMemo(
    () => file.hunks.map((hunk) => computeHunkWordDiff(hunk.lines)),
    [file.hunks],
  );
  return (
    <div>
      <div className="doc-file-row flex h-8.5 flex-none items-center gap-1.5 border-b border-(--border) pl-3 text-ui text-(--text-tertiary) [&_svg]:text-(--text-tertiary)">
        {expanded ? (
          <ChevronDown width={10} height={10} />
        ) : (
          <ChevronRight width={10} height={10} />
        )}
        <span className="min-w-0 truncate">
          <span className="font-medium text-(--foreground)">{baseName(file.path)}</span>
          {dirName(file.path) !== '' && <span className="ml-1.5">{dirName(file.path)}</span>}
        </span>
        <span className="ml-auto pr-4 font-mono text-meta text-(--diff-add-fg)">
          +{file.added}
          {file.removed != null && file.removed > 0 && (
            <span className="text-(--destructive)"> −{file.removed}</span>
          )}
        </span>
      </div>
      {expanded && (
        <div>
          {full.kind === 'hidden' &&
            file.hunks.map((hunk, hi) => {
              const wordDiff = wordDiffs[hi];
              return (
                <div key={hunk.header}>
                  {unmodifiedBefore(file.hunks, hi) > 0 && (
                    <div
                      className="flex h-7 items-center pl-3 text-meta text-(--text-tertiary)"
                      data-testid="diff-fold"
                    >
                      {t('{n} 行未改动', { n: unmodifiedBefore(file.hunks, hi) })}
                    </div>
                  )}
                  <div className="diff-hunk-head bg-(--secondary) pl-18 font-mono text-code leading-6 text-(--text-tertiary) [font-variant-ligatures:none]">
                    {hunk.header}
                  </div>
                  {hunk.lines.map((line, i) => {
                    const segs = wordDiff?.segments.get(i);
                    const isCapped = wordDiff?.capped.has(i) === true;
                    return (
                      <div
                        key={i}
                        className={`diff-line--${line.kind} ${DIFF_LINE} ${
                          DIFF_KIND_SKIN[line.kind] ?? ''
                        }`}
                        data-kind={line.kind}
                        data-word={isCapped ? 'capped' : undefined}
                        title={isCapped ? t('行过长，已退回整行高亮') : undefined}
                      >
                        <span data-no="old" className={`${DIFF_NO} w-5`}>
                          {line.oldNo ?? ''}
                        </span>
                        <span data-no="new" className={`${DIFF_NO} w-5`}>
                          {line.newNo ?? ''}
                        </span>
                        <span className="sr-only">
                          {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ''}
                        </span>
                        <span className="pl-2 whitespace-pre">
                          {segs == null
                            ? line.text
                            : segs.map((seg, si) =>
                                seg.changed ? (
                                  <span
                                    key={si}
                                    data-word={line.kind}
                                    className={WORD_SKIN[line.kind]}
                                  >
                                    {seg.text}
                                  </span>
                                ) : (
                                  seg.text
                                ),
                              )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          {full.kind === 'text' && (
            <div data-testid="diff-full">
              {full.content
                .replace(/\n$/, '')
                .split('\n')
                .map((text, i) => (
                  <div key={i} className={`${DIFF_LINE}`} data-kind="context">
                    <span data-no="old" className={`${DIFF_NO} w-5`} />
                    <span data-no="new" className={`${DIFF_NO} w-5`}>
                      {i + 1}
                    </span>
                    <span className="pl-2 whitespace-pre">{text}</span>
                  </div>
                ))}
            </div>
          )}
          {(full.kind === 'loading' || full.kind === 'error' || full.kind === 'binary') && (
            <div className="py-2 pr-3 pl-18 font-mono text-code leading-4 text-(--text-tertiary)">
              {full.kind === 'loading'
                ? t('加载中…')
                : full.kind === 'error'
                  ? t('文件加载失败')
                  : t('二进制文件暂不支持预览')}
            </div>
          )}
          {allowFullFile && (
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => setShowFull((v) => !v)}
            >
              <UnfoldVertical width={12} height={12} />
              {showFull ? t('显示差异') : t('显示完整文件')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function VersionMenu({
  versions,
  menu,
  now,
  diffOpen,
  diffFrom,
  onMenu,
  onCompare,
  onBase,
}: {
  versions: PlanVersion[];
  menu: 'versions' | 'compare';
  now: number;
  diffOpen: boolean;
  diffFrom?: string;
  onMenu: (menu: 'versions' | 'compare' | undefined) => void;
  onCompare: () => void;
  onBase: () => void;
}) {
  const { t } = useI18n();
  if (menu === 'compare') {
    return (
      <KeyedMenuContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="version-menu--sub w-auto min-w-17"
      >
        <KeyedMenuItem className="version-menu-row" shortcut="P" onClick={onCompare}>
          {t('上一版本')}
        </KeyedMenuItem>
      </KeyedMenuContent>
    );
  }
  return (
    <KeyedMenuContent align="end" side="bottom" sideOffset={8} className="w-53">
      {versions.map((row, i) => (
        <KeyedMenuItem
          key={row.v}
          shortcut={i < 9 ? String(i + 1) : undefined}
          className={`version-menu-row${i === 0 ? ' font-semibold' : ''}`}
          onClick={() => onMenu(undefined)}
        >
          <span className="flex-1">
            {row.v} · {relativeTime(row.at, now, t)}
          </span>
          <Restore width={13} height={13} className="text-(--text-tertiary)" />
        </KeyedMenuItem>
      ))}
      <KeyedMenuItem
        className="version-menu-row"
        shortcut="C"
        closeOnClick={false}
        onClick={() => onMenu('compare')}
      >
        <span className="flex-1">{t('与其他版本对比…')}</span>
        {diffOpen && diffFrom != null && <span className="text-(--text-tertiary)">{diffFrom}</span>}
      </KeyedMenuItem>
      {diffOpen && (
        <KeyedMenuItem className="version-menu-row" shortcut="B" onClick={onBase}>
          <span>{t('回到与 base 对比')}</span>
        </KeyedMenuItem>
      )}
    </KeyedMenuContent>
  );
}

function VersionControl({
  range,
  label,
  planVersions,
  versionMenu,
  now,
  onVersionMenu,
  onCompare,
  onBase,
}: {
  range?: { from: string; to: string };
  label?: string;
  planVersions?: PlanVersion[];
  versionMenu?: 'versions' | 'compare';
  now: number;
  onVersionMenu?: (menu: 'versions' | 'compare' | undefined) => void;
  onCompare?: () => void;
  onBase?: () => void;
}) {
  return (
    <span className="doc-range-wrap relative inline-flex">
      <DropdownMenu
        open={versionMenu != null}
        onOpenChange={(next: boolean) => onVersionMenu?.(next ? 'versions' : undefined)}
      >
        {range != null ? (
          <DropdownMenuTrigger
            render={<Button variant="outline" size="xs" className="doc-range-chip" />}
          >
            {range.from} → {range.to}
            <ChevronDown width={12} height={12} />
          </DropdownMenuTrigger>
        ) : (
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="xs" className={PANE_SELECT} />}
          >
            {label}
            <ChevronDown width={12} height={12} />
          </DropdownMenuTrigger>
        )}
        {onVersionMenu != null && planVersions != null && (
          <VersionMenu
            versions={planVersions}
            menu={versionMenu ?? 'versions'}
            now={now}
            diffOpen={range != null}
            diffFrom={range?.from}
            onMenu={onVersionMenu}
            onCompare={() => onCompare?.()}
            onBase={() => onBase?.()}
          />
        )}
      </DropdownMenu>
    </span>
  );
}

function docBlockClass(kind: string, first: boolean): string {
  const base = 'text-card-title break-words text-(--foreground)';
  if (kind === 'para') return `${base}${first ? '' : ' mt-2'}`;
  if (kind === 'bullet') return `${base} relative mt-1 pl-4`;
  return `${base} ${first ? 'mt-0' : 'mt-6'} mb-1.5 text-meta font-medium tracking-[0.02em] text-(--text-tertiary)`;
}

export function DocPane({
  mode,
  doc,
  changes,
  now,
  onDocView,
  sections,
  planVersions,
  versionMenu,
  onVersionMenu,
  onCompare,
  onBase,
  planDiff,
  onToggleExpand,
  buildId,
  emptyMeta,
}: DocPaneProps) {
  const { t } = useI18n();
  const versionLabel = (): string => {
    const latest = planVersions?.[0];
    return latest == null ? 'v1' : `${latest.v} · ${relativeTime(latest.at, now, t)}`;
  };
  const headStart = (docLabel: DocTypeLabel) => (
    <PaneTitle docLabel={docLabel} onDocView={onDocView} />
  );
  const headEnd = (docLabel: DocTypeLabel) => (
    <div className="ml-auto">
      <PaneViewButtons docLabel={docLabel} onDocView={onDocView} />
    </div>
  );
  if (mode === 'changes' || mode === 'diff') {
    const hasData = mode === 'diff' ? planDiff != null : changes != null;
    const files = mode === 'diff' ? (planDiff?.files ?? []) : (changes?.files ?? []);
    const expanded = mode === 'diff' ? (planDiff?.expanded ?? false) : (changes?.expanded ?? false);
    const fileCount = files.length;
    const added = files.reduce((sum, f) => sum + f.added, 0);
    const removed = files.reduce((sum, f) => sum + (f.removed ?? 0), 0);
    return (
      <section className="doc-pane flex min-h-0 flex-1 flex-col" data-testid="doc-pane">
        <header className={PANE_HEAD}>
          {headStart(mode === 'diff' ? '方案' : '变更')}
          {hasData &&
            (mode === 'diff' && planDiff != null ? (
              <VersionControl
                range={{ from: planDiff.from, to: planDiff.to }}
                planVersions={planVersions}
                versionMenu={versionMenu}
                now={now}
                onVersionMenu={onVersionMenu}
                onCompare={onCompare}
                onBase={onBase}
              />
            ) : (
              <VersionControl
                label={versionLabel()}
                planVersions={planVersions}
                versionMenu={versionMenu}
                now={now}
                onVersionMenu={onVersionMenu}
                onCompare={onCompare}
                onBase={onBase}
              />
            ))}
          {headEnd(mode === 'diff' ? '方案' : '变更')}
        </header>
        {hasData && (
          <div className="flex h-8 flex-none items-center border-b border-(--border) pr-2 pl-4 text-meta text-(--text-tertiary)">
            <span>
              {t('{n} 个文件改动', { n: fileCount })}{' '}
              <span className="text-(--diff-add-fg)">+{added}</span>
              {removed > 0 && <span className="text-(--destructive)"> −{removed}</span>}
            </span>
            <Button
              variant="ghost"
              size="xs"
              className="ml-auto text-(--text-tertiary)"
              onClick={onToggleExpand}
            >
              {expanded ? t('全部收起') : t('全部展开')}
            </Button>
          </div>
        )}
        {hasData ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="w-max min-w-full">
              {files.map((file) => (
                <DiffFileBlock
                  key={file.path}
                  file={file}
                  expanded={expanded}
                  buildId={mode === 'changes' ? (buildId ?? null) : null}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="doc-empty static flex flex-1 items-center justify-center text-meta text-(--text-tertiary)">
            {t('暂无可显示的变更')}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="doc-pane flex min-h-0 flex-1 flex-col" data-testid="doc-pane">
      <header className={PANE_HEAD}>
        {headStart('方案')}
        {doc != null && (
          <VersionControl
            label={versionLabel()}
            planVersions={planVersions}
            versionMenu={versionMenu}
            now={now}
            onVersionMenu={onVersionMenu}
            onCompare={onCompare}
            onBase={onBase}
          />
        )}
        {headEnd('方案')}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-3.5 pt-2 pb-4" data-testid="doc-body">
          {doc == null
            ? (emptyMeta ?? (
                <div className="doc-empty flex h-24 items-center justify-center text-meta text-(--text-tertiary)">
                  {t('暂无方案')}
                </div>
              ))
            : doc.map((block, i) => (
                <p
                  key={i}
                  className={cn(`doc-block--${block.kind}`, docBlockClass(block.kind, i === 0))}
                >
                  {block.kind === 'bullet' && (
                    <span
                      aria-hidden="true"
                      className="absolute top-2.5 left-1 size-1 rounded-full bg-(--text-tertiary)"
                    />
                  )}
                  <Segments segments={block.segments} codeClassName="doc-code" />
                </p>
              ))}
        </div>
        {sections}
      </div>
    </section>
  );
}
