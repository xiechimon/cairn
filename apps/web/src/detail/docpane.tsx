import type { DiffFileContent } from '@cairn/shared';
import { cn } from 'cn';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useBuildChangeFile } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { relativeTime } from '../board/rel-time.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import type {
  ChangesContent,
  DiffFile,
  DocBlock,
  PaneView,
  PlanDiffContent,
  PlanVersion,
} from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  FileTab,
  FileText,
  Restore,
  UnfoldVertical,
} from '../icons/index.js';
import { type DocTypeLabel, PaneTypeSelect } from '../overlay/plan-dropdown.js';
import { Segments } from './segments.js';
import { computeHunkWordDiff } from './word-diff.js';

interface DocPaneProps {
  mode: 'plan' | 'changes' | 'diff';
  doc: DocBlock[] | undefined;
  changes: ChangesContent | undefined;
  now: number;
  planDropdownOpen?: boolean;
  onPaneView: (view: PaneView) => void;
  hasSections?: boolean;
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

export const PANE_HEAD =
  'flex h-9 flex-none items-center border-b border-(--border) pl-4 text-meta text-(--text-secondary) [&>svg]:text-(--text-tertiary)';
const PANE_SELECT = 'doc-pane-select ml-0';
const DIFF_LINE = 'flex items-center font-mono text-caption leading-4 text-(--text-secondary)';
const DIFF_NO = 'flex-none pr-1 text-right text-(--text-tertiary)';
const DIFF_KIND_SKIN: Record<string, string> = {
  add: 'bg-(--diff-add-bg)',
  del: 'bg-(--diff-del-bg)',
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
      <div className="doc-file-row flex h-8 flex-none items-center gap-1.5 bg-(--secondary) pl-3 text-ui text-(--text-secondary) [&_svg]:text-(--text-tertiary)">
        {expanded ? (
          <ChevronDown width={10} height={10} />
        ) : (
          <ChevronRight width={10} height={10} />
        )}
        <FileText width={14} height={14} />
        {file.path}
        <span className="flex text-(--text-tertiary)">
          <Eye width={14} height={14} />
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
                  <div className="diff-hunk-head border-y border-(--border) bg-(--secondary) pl-14 font-mono text-caption leading-5 text-(--text-secondary)">
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
                        <span className="w-3 flex-none text-center text-(--diff-add-fg)">
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
                    <span className="w-3 flex-none text-center text-(--diff-add-fg)" />
                    <span className="pl-2 whitespace-pre">{text}</span>
                  </div>
                ))}
            </div>
          )}
          {(full.kind === 'loading' || full.kind === 'error' || full.kind === 'binary') && (
            <div className="py-2 pr-3 pl-14 font-mono text-caption leading-4 text-(--text-tertiary)">
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
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="version-menu--sub w-auto min-w-17"
      >
        <DropdownMenuItem className="version-menu-row" onClick={onCompare}>
          {t('上一版本')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    );
  }
  return (
    <DropdownMenuContent align="end" side="bottom" sideOffset={8} className="w-53">
      {versions.map((row, i) => (
        <DropdownMenuItem
          key={row.v}
          className={`version-menu-row justify-between${i === 0 ? ' font-semibold' : ''}`}
          onClick={() => onMenu(undefined)}
        >
          <span>
            {row.v} · {relativeTime(row.at, now, t)}
          </span>
          <Restore width={13} height={13} className="text-(--text-tertiary)" />
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem
        className="version-menu-row justify-between"
        closeOnClick={false}
        onClick={() => onMenu('compare')}
      >
        <span>{t('与其他版本对比…')}</span>
        {diffOpen && diffFrom != null && <span className="text-(--text-tertiary)">{diffFrom}</span>}
      </DropdownMenuItem>
      {diffOpen && (
        <DropdownMenuItem className="version-menu-row" onClick={onBase}>
          <span>{t('回到与 base 对比')}</span>
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
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
    <span className="doc-range-wrap relative ml-4 inline-flex">
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
  const base = 'text-card-title leading-6 break-words text-(--foreground)';
  if (kind === 'para') return `${base}${first ? '' : ' mt-2'}`;
  if (kind === 'bullet') return `${base} pl-4 [text-indent:-12px]`;
  return `${base} ${first ? 'mt-0' : 'mt-6'} mb-1.5 text-meta font-medium tracking-[0.02em] text-(--text-tertiary)`;
}

export function DocPane({
  mode,
  doc,
  changes,
  now,
  planDropdownOpen,
  onPaneView,
  hasSections,
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
  const typeSelect = (docLabel: DocTypeLabel) => (
    <PaneTypeSelect
      view="doc"
      docLabel={docLabel}
      sections={hasSections}
      onView={onPaneView}
      initiallyOpen={planDropdownOpen}
    />
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
          <FileTab width={14} height={14} />
          {typeSelect(mode === 'diff' ? '方案' : '变更')}
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
                label={planVersions?.[0]?.v ?? 'v1'}
                planVersions={planVersions}
                versionMenu={versionMenu}
                now={now}
                onVersionMenu={onVersionMenu}
                onCompare={onCompare}
                onBase={onBase}
              />
            ))}
          {hasData && (
            <>
              <span className="ml-4 text-(--text-tertiary)">
                {t('· {n} 个文件改动', { n: fileCount })}{' '}
                <span className="text-(--diff-add-fg)">+{added}</span>
                {removed > 0 && <span className="text-(--destructive)"> −{removed}</span>}
              </span>
              <Button
                variant="ghost"
                size="xs"
                className="ml-auto mr-4 text-(--text-tertiary)"
                onClick={onToggleExpand}
              >
                {expanded ? t('全部收起') : t('全部展开')}
              </Button>
            </>
          )}
        </header>
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
        <FileTab width={14} height={14} />
        {typeSelect('方案')}
        {doc != null && (
          <VersionControl
            label={planVersions?.[0]?.v ?? 'v1'}
            planVersions={planVersions}
            versionMenu={versionMenu}
            now={now}
            onVersionMenu={onVersionMenu}
            onCompare={onCompare}
            onBase={onBase}
          />
        )}
      </header>
      <div
        className="relative min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-6"
        data-testid="doc-body"
      >
        {doc == null
          ? (emptyMeta ?? (
              <div className="doc-empty absolute inset-0 flex items-center justify-center text-meta text-(--text-tertiary)">
                {t('暂无方案')}
              </div>
            ))
          : doc.map((block, i) => (
              <p
                key={i}
                className={cn(`doc-block--${block.kind}`, docBlockClass(block.kind, i === 0))}
              >
                {block.kind === 'bullet' ? '• ' : ''}
                <Segments segments={block.segments} codeClassName="doc-code" />
              </p>
            ))}
      </div>
    </section>
  );
}
