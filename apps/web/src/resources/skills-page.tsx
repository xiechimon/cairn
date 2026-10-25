import { SKILL_PAGE_COPY, SKILLS_DIR_DEFAULT } from '@cairn/shared';
import { Puzzle } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useSkills } from '../api/hooks.js';
import { mapSkills } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { TOPBAR_TEXT_BUTTON } from '../board/filter-panel.js';
import { EmptyState } from '../components/empty-state.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../components/ui/input-group.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { ArrowUpDown, ChevronDown, Download, Search } from '../icons/index.js';
import { PageShell } from '../pages/shell.js';
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
import { SkillDialog, type SkillEditTarget } from './skill-dialog.js';
import { SkillImportDialog } from './skill-import-dialog.js';

export const SKILLS_HREF = '/app/resources/skills';

const SORT_OPTIONS = ['默认', '名称'] as const;
type SortKind = (typeof SORT_OPTIONS)[number];

export function SkillsPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const skillsQ = useSkills(teamId, live);
  const rows = live ? mapSkills(skillsQ.data ?? []) : (fixture.resources?.skills ?? []);
  const [sort, setSort] = useState<SortKind>('默认');
  const skills = sort === '名称' ? [...rows].sort((a, b) => a.name.localeCompare(b.name)) : rows;
  const [dialog, setDialog] = useState<{ skill?: SkillEditTarget } | null>(null);
  const openCreate = () => setDialog({});
  const [importOpen, setImportOpen] = useState(false);

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
            <Download aria-hidden className="size-3.5 text-content-tertiary" />
            {t('导入')}
          </Button>
          <ResourceNewButton onClick={openCreate} />
        </>
      }
      fixture={fixture}
    >
      {skills.length === 0 ? (
        <EmptyState
          testId="resource-empty"
          className="mt-6"
          icon={Puzzle}
          title={t(SKILL_PAGE_COPY.empty)}
          description={t(SKILL_PAGE_COPY.directoryHint, { dir: SKILLS_DIR_DEFAULT })}
          action={{ label: t('新建技能'), onClick: openCreate }}
        />
      ) : (
        <>
          <div className={RES_SEARCH_ROW_CLS}>
            <InputGroup className="flex-1">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                type="text"
                placeholder={t('搜索技能...')}
                aria-label={t('搜索技能...')}
              />
            </InputGroup>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>
                <ArrowUpDown />
                <span>{t('排序')}</span>
                <ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom" sideOffset={8} aria-label={t('排序')}>
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={(next) => setSort(next as SortKind)}
                >
                  {SORT_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                      <span>{t(option)}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <ResourceList>
            {skills.map((skill) => (
              <ResourceRow
                key={skill.name}
                onOpen={() =>
                  setDialog({
                    skill: { id: skill.name, name: skill.name, description: skill.description },
                  })
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
        </>
      )}
      <SkillDialog open={dialog !== null} onClose={() => setDialog(null)} skill={dialog?.skill} />
      <SkillImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </PageShell>
  );
}
