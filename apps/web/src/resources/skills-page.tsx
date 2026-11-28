import { SKILL_PAGE_COPY } from '@cairn/shared';
import { ChevronDown, Download, Ellipsis, Puzzle, Search } from 'lucide-react';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError } from '../api/client.js';
import { useApiMutations, useSkills } from '../api/hooks.js';
import { mapSkills } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { TOPBAR_TEXT_BUTTON } from '../board/filter-panel.js';
import { EmptyState } from '../components/empty-state.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { KeyedMenuContent, KeyedMenuItem, KeyedMenuRadioItem } from '../components/menu-keys.js';
import { QueryBoundary } from '../components/query-state.js';
import { retryableLazy } from '../components/subtree-error-boundary.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../components/ui/input-group.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { PageShell } from '../pages/shell.js';
import { SKILLS_HREF } from './hrefs.js';
import {
  RES_SEARCH_ROW_CLS,
  ResourceList,
  ResourceNewButton,
  ResourceRow,
  RowChevron,
  RowDesc,
  RowText,
  RowTitle,
} from './parts.js';
import type { SkillEditTarget } from './skill-dialog.js';
import { SkillImportDialog } from './skill-import-dialog.js';

const SkillDialog = retryableLazy(() =>
  import('./skill-dialog.js').then((m) => ({ default: m.SkillDialog })),
);

const SORT_OPTIONS = ['默认', '名称'] as const;
const SORT_KEYS: Record<(typeof SORT_OPTIONS)[number], string> = { 默认: 'D', 名称: 'N' };
type SortKind = (typeof SORT_OPTIONS)[number];

export function SkillsPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const skillsQ = useSkills(teamId, live);
  const rows = live ? mapSkills(skillsQ.data ?? []) : (fixture.resources?.skills ?? []);
  const empty = (!live || skillsQ.isSuccess) && rows.length === 0;
  const [sort, setSort] = useState<SortKind>('默认');
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matched =
    needle === ''
      ? rows
      : rows.filter((row) => `${row.name} ${row.description}`.toLowerCase().includes(needle));
  const skills =
    sort === '名称' ? [...matched].sort((a, b) => a.name.localeCompare(b.name)) : matched;
  const [dialog, setDialog] = useState<{ skill?: SkillEditTarget } | null>(null);
  const openCreate = () => setDialog({});
  const [importOpen, setImportOpen] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  const remove = () => {
    if (deleting === null) return;
    const id = deleting.id;
    setDeleting(null);
    if (!live) return;
    mutations.deleteSkill.mutate(id, {
      onSuccess: (result) => {
        if (!result.systemTrash)
          toastSuccess(t('副本不在废纸篓，已移到 {path}', { path: result.trashedTo }));
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 404) return;
        toastError(t('删除技能失败，请重试。'), error);
      },
    });
  };

  return (
    <PageShell
      route={SKILLS_HREF}
      title={t('技能')}
      selected={SKILLS_HREF}
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            className={TOPBAR_TEXT_BUTTON}
            onClick={() => setImportOpen(true)}
            data-testid="resource-import"
          >
            <Download aria-hidden className="size-5 text-content-tertiary" />
            {t('导入')}
          </Button>
          {!empty && <ResourceNewButton onClick={openCreate} />}
        </>
      }
      fixture={fixture}
    >
      <QueryBoundary
        query={live ? skillsQ : undefined}
        isEmpty={rows.length === 0}
        loadingLabel={t('正在加载技能')}
        errorTitle={t('技能未能加载')}
        className="mt-6"
        empty={
          <EmptyState
            testId="resource-empty"
            className="mt-6"
            icon={Puzzle}
            title={t(SKILL_PAGE_COPY.empty)}
            action={{ label: t('新建技能'), onClick: openCreate }}
          />
        }
      >
        <div className={RES_SEARCH_ROW_CLS}>
          <InputGroup className="flex-1 pointer-coarse:h-11">
            <InputGroupAddon>
              <Search className="size-5" />
            </InputGroupAddon>
            <InputGroupInput
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('搜索技能')}
              aria-label={t('搜索技能')}
            />
          </InputGroup>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" className="pointer-coarse:h-11" />}
            >
              <span>{t('排序：{option}', { option: t(sort) })}</span>
              <ChevronDown className="size-5" />
            </DropdownMenuTrigger>
            <KeyedMenuContent align="end" side="bottom" sideOffset={8} aria-label={t('排序')}>
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(next) => setSort(next as SortKind)}
              >
                {SORT_OPTIONS.map((option) => (
                  <KeyedMenuRadioItem
                    key={option}
                    value={option}
                    shortcut={SORT_KEYS[option]}
                    closeOnClick
                  >
                    <span>{t(option)}</span>
                  </KeyedMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </KeyedMenuContent>
          </DropdownMenu>
        </div>
        {skills.length === 0 ? (
          <p data-testid="skill-search-empty" className="mt-4 text-meta text-content-tertiary">
            {t('没有匹配的技能。')}
          </p>
        ) : (
          <ResourceList>
            {skills.map((skill) => (
              <ResourceRow
                key={skill.name}
                onOpen={() =>
                  setDialog({
                    skill: { id: skill.name, name: skill.name, description: skill.description },
                  })
                }
                menu={
                  <DropdownMenu>
                    <IconTooltip
                      label={t('{name} 的菜单', { name: skill.name })}
                      trigger={
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              data-testid="skill-row-menu"
                              className="text-content-tertiary hover:bg-transparent hover:text-foreground aria-expanded:bg-menu-hover aria-expanded:text-foreground pointer-coarse:size-11 dark:hover:bg-transparent dark:aria-expanded:bg-menu-hover"
                            />
                          }
                        />
                      }
                    >
                      <Ellipsis aria-hidden strokeWidth={1.75} />
                    </IconTooltip>
                    <KeyedMenuContent
                      side="bottom"
                      align="end"
                      sideOffset={4}
                      className="w-auto min-w-40"
                    >
                      <KeyedMenuItem
                        shortcut="D"
                        confirms
                        variant="destructive"
                        data-testid="skill-row-menu-delete"
                        onClick={() => setDeleting({ id: skill.name, name: skill.name })}
                      >
                        {t('删除')}
                      </KeyedMenuItem>
                    </KeyedMenuContent>
                  </DropdownMenu>
                }
              >
                <RowText>
                  <RowTitle>{skill.name}</RowTitle>
                  <RowDesc>{skill.description}</RowDesc>
                </RowText>
                <RowChevron />
              </ResourceRow>
            ))}
          </ResourceList>
        )}
      </QueryBoundary>
      <Suspense fallback={null}>
        <SkillDialog open={dialog !== null} onClose={() => setDialog(null)} skill={dialog?.skill} />
      </Suspense>
      <SkillImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <DeleteConfirm
        open={deleting !== null}
        title={t('删除技能「{name}」？', { name: deleting?.name ?? '' })}
        summary={t('技能从 Cairn 移除，文件移到废纸篓；你自己的文件夹不动。')}
        ariaLabel={t('删除技能')}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
      />
    </PageShell>
  );
}
