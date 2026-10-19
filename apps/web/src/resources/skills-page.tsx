// 技能 route (issue #69): search input + 排序 button row, then one card of
// skill rows (name + description, row chevron).
// #306 接真：排序钮开单选 listbox（默认/名称，当前项 ✓，行点击 = 选中即关
// — lang-dropdown 家族律）。原站排序下拉内容未观测，选项集 [设计]：SkillRow
// 数据面只有 name/description（无时间戳），可诚实承载的排序键 = 名称。
// spec 13（#367）只读面 → XMON-114（S3，spec 13 回摆）写面：技能 = server
// 本地目录现扫投影不变，但页面恢复新建/编辑——topbar「+ 新建」与空态主钮
// 开 SkillDialog（frontmatter 表单化），行点击开编辑。空态文案指路目录 +
// 界面新建双入口（canon = shared SKILL_PAGE_COPY 单源消费，{dir} =
// SKILLS_DIR_DEFAULT；env 覆写在 server 侧，i18n 键经 COMPUTED_KEYS 登记）。
import { SKILL_PAGE_COPY, SKILLS_DIR_DEFAULT } from '@pacman/shared';
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

/** #306 [设计]: the two honest sorts — server (arrival) order and name. */
const SORT_OPTIONS = ['默认', '名称'] as const;
type SortKind = (typeof SORT_OPTIONS)[number];

export function SkillsPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  // M5 live：GET /api/skills?teamId=（02 §6.1 词表；spec 13 起 server 现扫
  // 本地目录，wire 形状不变）。
  const { live, teamId } = useLiveData();
  const skillsQ = useSkills(teamId, live);
  const rows = live ? mapSkills(skillsQ.data ?? []) : (fixture.resources?.skills ?? []);
  const [sort, setSort] = useState<SortKind>('默认');
  const skills = sort === '名称' ? [...rows].sort((a, b) => a.name.localeCompare(b.name)) : rows;
  // 弹窗态：null = 关；{skill?} 无 skill = 新建，有 = 编辑（XMON-114）。
  const [dialog, setDialog] = useState<{ skill?: SkillEditTarget } | null>(null);
  const openCreate = () => setDialog({});
  // 导入弹窗（#1170）：localPath / GitHub URL 二选一 → POST skills/import。
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
