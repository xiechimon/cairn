// 技能 route (issue #69, r7 08): search input + 排序 button row, then one
// card row per skill (20px orange puzzle tile, name + description, row
// chevron). Row content comes from the scenario fixture.
// #306 接真：排序钮开单选 listbox（默认/名称，当前项 ✓，行点击 = 选中即关
// — lang-dropdown 家族律）。原站排序下拉内容未观测，选项集 [设计]：SkillRow
// 数据面只有 name/description（无时间戳），可诚实承载的排序键 = 名称。
// spec 13（#367）只读面 → XMON-114（S3，spec 13 回摆）写面：技能 = server
// 本地目录现扫投影不变，但页面恢复新建/编辑——topbar「+ 新建」与空态主钮
// 开 SkillDialog（frontmatter 表单化），行点击开编辑。空态文案指路目录 +
// 界面新建双入口（canon = shared SKILL_PAGE_COPY 单源消费，{dir} =
// SKILLS_DIR_DEFAULT；env 覆写在 server 侧，i18n 键经 COMPUTED_KEYS 登记）。
import { SKILL_PAGE_COPY, SKILLS_DIR_DEFAULT } from '@pacman/shared';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useSkills } from '../api/hooks.js';
import { mapSkills } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { TOPBAR_TEXT_BUTTON } from '../board/filter-panel.js';
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
import { ArrowUpDown, ChevronDown, Download, Puzzle, Search } from '../icons/index.js';
import { PageShell } from '../pages/shell.js';
import {
  EmptyState,
  RES_SEARCH_ROW_CLS,
  ResourceNewButton,
  RowCard,
  RowChevron,
  RowDesc,
  RowText,
  RowTitle,
  Tile,
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
        // r2 08: the empty state replaces the search row entirely；spec 13
        // 回摆（XMON-114）：双入口口径——主钮开新建弹窗，文案指路目录 +
        // 界面新建（canon = SKILL_PAGE_COPY，{dir} 插值；en 翻译键 = 同串，
        // i18n-coverage COMPUTED_KEYS 登记）。
        <EmptyState
          Icon={Puzzle}
          title={SKILL_PAGE_COPY.empty}
          description={SKILL_PAGE_COPY.directoryHint}
          descriptionVars={{ dir: SKILLS_DIR_DEFAULT }}
          actionLabel="新建技能"
          onAction={openCreate}
        />
      ) : (
        <>
          <div className={RES_SEARCH_ROW_CLS}>
            {/* #1005 registry 对齐：搜索盒走 InputGroup 官方组合（前置图标
                addon + 零装饰 input，件自带 focus 环与 rounded-lg 盒形）——
                手搓盒形配方（RES_SEARCH_BOX/INPUT_CLS）在本面退役。过滤行为
                无行为票，本面 = 真输入框，占位文案同键单源。 */}
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
            {/* #854 收编 dropdown-menu（Base UI Menu RadioGroup，#714
                playbook）：单选即关走显式 closeOnClick；勾形改由
                RadioItemIndicator 原生槽承载；定位正本迁 Positioner 参数
                （side=bottom align=end sideOffset=8）。#1005 registry 对齐：
                触发钮 = Button outline 默认档，盘/行皮肤走件默认（V2 弹层壳
                配方在本面退役；盘宽随锚 = 件默认 w-(--anchor-width)）。 */}
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
          {skills.map((skill) => (
            <RowCard
              key={skill.name}
              onOpen={() =>
                setDialog({
                  skill: { id: skill.name, name: skill.name, description: skill.description },
                })
              }
            >
              <Tile Icon={Puzzle} size="sm" tone="orange" />
              <RowText>
                <RowTitle>{skill.name}</RowTitle>
                <RowDesc strong>{skill.description}</RowDesc>
              </RowText>
              <RowChevron />
            </RowCard>
          ))}
        </>
      )}
      <SkillDialog open={dialog !== null} onClose={() => setDialog(null)} skill={dialog?.skill} />
      <SkillImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </PageShell>
  );
}
