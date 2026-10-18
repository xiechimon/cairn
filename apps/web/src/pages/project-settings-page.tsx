// Project settings route (issue #71, r2 24c): 基本信息|仓库|标签 tab group
// and one card — avatar circle + 更换 link, then 名称/仓库/目标分支/描述 rows.
// #1242 身份可变面：名称/描述行接 PATCH（live 输入 + 保存钮，失败 toast
// 可见）；local 项目新增「转换为 GitHub 形态」卡（repoKind/githubRepo/
// localPath 三键 PATCH）。fixture 面保静态捕获形状（SquarePen 占位）。
// #177 (local-first 裁决, endpoint 实测): no project mutation endpoint exists
// anywhere in the stack — no PATCH, no DELETE /api/projects/:id, and the
// schema has no defaultBranch column — so the route's three dead buttons
// resolve wontfix: 更换 removed outright (#307, spec 08 档 4 — the avatar
// is the static PROJECT_INITIAL asset, no upload face; this item's
// #148/#177 capture-verbatim-chrome verdict re-adjudicated 移除, the
// account-swap twin stays with 档 3), 目标分支
// becomes a static chip (#149 branch-chip precedent),
// and the danger card is removed outright (#148 退出登录 box / #149 导出
// precedent; the ticket premise that DELETE exists did not survive a grep).
// #207 复活危险区: #189 DELETE /api/projects/:id 落地(级联单源 server
// services/projects.ts),删除卡归位 + DeleteConfirm 家族确认弹层(r2 24d,
// 键入项目名闸门) + deleteProject mutation(invalidateAll 正典);确认后跳
// /app(fixture 走 #66 deletions 覆面,侧栏项目行随行隐去)。
import { isGithubRepoRef } from '@pacman/shared';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useApiMutations, useProjects } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardHeader } from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';
import { toastError } from '../components/ui/toaster.js';
import { markDeleted } from '../fixtures/deletions.js';
import { PROJECT_INITIAL } from '../fixtures/fixtures.js';
import type { ProjectContent } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown, SquarePen } from '../icons/index.js';
import { DeleteProjectConfirm } from '../overlay/delete-project-confirm.js';
import { PageShell, TabGroup } from './shell.js';

const TABS = [
  { id: 'basic', label: '基本信息' },
  { id: 'repo', label: '仓库' },
  { id: 'tags', label: '标签' },
];

/** 行布局（#983 panel→Card 判决的消费点位）：两端对齐 + 顶部分隔线 +
 *  行内几何；皮肤全归 Card registry 默认（bg-card + ring + rounded-xl）。 */
const ROW_CLS = 'flex min-h-12 items-center justify-between border-t border-border px-4 py-1.5';

/** 行右值槽（原 .prj-set-value 的布局位）：8px 间距；行内 svg（编辑
 *  铅笔/chevron）muted 墨 + pointer（#177 静态化后仅光标语义）。字号随
 *  Card 根的 text-sm（registry 几何赢，13px 手写档退役）。 */
const VALUE_CLS =
  'flex items-center gap-2 text-foreground [&_svg]:cursor-pointer [&_svg]:text-muted-foreground';

/** 行左 label（原 PanelLabel 的消费点位）：registry 词汇 muted-foreground，
 *  字号随 Card 根 text-sm。 */
const LABEL_CLS = 'text-muted-foreground';

export function ProjectSettingsPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const [tab, setTab] = useState('basic');
  const [deleteOpen, setDeleteOpen] = useState(false);
  // #1213/ADR 0017：github 形态 localPath 加速位草稿态——null = 未编辑，
  // 显示值回落 server 真值；保存成功后清草稿（invalidate 重取收敛）。
  const [accelDraft, setAccelDraft] = useState<string | null>(null);
  // #1242 身份面草稿态（accelDraft 同律）：null = 未编辑回落真值。
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState<string | null>(null);
  // #1242 转换面草稿：githubRepo 手输串 + localPath（null = 未编辑回落
  // 现值——local 绑定路径预填为加速位候选）。
  const [convRepo, setConvRepo] = useState('');
  const [convPathDraft, setConvPathDraft] = useState<string | null>(null);
  const [convError, setConvError] = useState<string | null>(null);
  // M5 live：设置行 = GET /api/projects 检索真值（名称/仓库/托管 chip）。
  const { live, teamId } = useLiveData();
  const projectsQ = useProjects(teamId, live);
  const mutations = useApiMutations(teamId);
  const wireProject = live ? (projectsQ.data ?? []).find((p) => p.id === id) : undefined;
  const project: ProjectContent | undefined = live
    ? wireProject
      ? {
          name: wireProject.name,
          branch: 'main',
          files: [],
          repoName: wireProject.repoName ?? wireProject.githubRepo ?? '',
          hosted: wireProject.repoKind === 'hosted',
          defaultBranch: 'main',
          description: wireProject.description ?? null,
        }
      : undefined
    : fixture.project;
  return (
    <PageShell
      route="project-settings"
      fixture={fixture}
      selected="none"
      title={t('设置')}
      back={{ pathname: `/app/project/${id ?? ''}`, search: searchParams.toString() }}
    >
      <div className="pt-1">
        {/* r2 24c: the tab group sits in the content column, not the topbar */}
        <div className="flex">
          <TabGroup tabs={TABS} tab={tab} onTab={setTab} />
        </div>
        {/* #983 判决执行：Panel quiet 档退役 → registry Card 默认皮肤
            （bg-card + ring + rounded-xl；色差由 #988 色板重选在 token 层
            吸收），消费点只留布局位（gap-0/py-0 中和 Card 的内距节奏，行
            几何自持）。.prj-set-avatar/.prj-set-branch 别名留存（dead-buttons
            跨域句柄，#411 别名优先）。 */}
        <Card className="mt-4 gap-0 py-0">
          <CardHeader className="justify-items-center py-4">
            <span className="prj-set-avatar flex size-16 items-center justify-center rounded-full bg-muted text-xl text-muted-foreground">
              {PROJECT_INITIAL}
            </span>
            {/* 「更换」钮全除（#307 wontfix）：头像是静态 PROJECT_INITIAL 资产,
                栈内无上传面——档 4 二分律下本项 #177 占位 chrome 裁决改判
                移除（account-swap 同款归档 3，本票不动）。 */}
          </CardHeader>
          <CardContent className={ROW_CLS}>
            <span className={LABEL_CLS}>{t('名称')}</span>
            <span className={VALUE_CLS}>
              {/* #1242 身份面：改名接 PATCH（失败可见）；fixture 面保静态
                  捕获形状（SquarePen 占位）。 */}
              {live && wireProject !== undefined ? (
                <>
                  <Input
                    aria-label={t('名称')}
                    className="h-8 w-72"
                    value={nameDraft ?? wireProject.name}
                    onChange={(event) => setNameDraft(event.target.value)}
                  />
                  <Button
                    size="sm"
                    aria-label={t('保存名称')}
                    disabled={
                      mutations.patchProject.isPending ||
                      (nameDraft ?? '').trim() === wireProject.name ||
                      (nameDraft ?? '').trim() === ''
                    }
                    onClick={() => {
                      if (id === undefined) return;
                      mutations.patchProject.mutate(
                        { id, body: { name: (nameDraft ?? '').trim() } },
                        {
                          onSuccess: () => setNameDraft(null),
                          // 失败可见（#638 同律）：toast 报错，草稿保留重试。
                          onError: (error) => toastError(t('保存失败，请重试。'), error),
                        },
                      );
                    }}
                  >
                    {t('保存')}
                  </Button>
                </>
              ) : (
                <>
                  {project?.name ?? ''}
                  <SquarePen width={14} height={14} />
                </>
              )}
            </span>
          </CardContent>
          <CardContent className={ROW_CLS}>
            <span className={LABEL_CLS}>{t('仓库')}</span>
            <span className={VALUE_CLS}>
              {project?.repoName ?? ''}
              {project?.hosted === true && <Badge variant="secondary">{t('Pacman 托管')}</Badge>}
            </span>
          </CardContent>
          <CardContent className={ROW_CLS}>
            <span className={LABEL_CLS}>{t('目标分支')}</span>
            <span className={VALUE_CLS}>
              {/* 分支 chip = 静态展示(#177 裁决,#149 分支 chip 同律): schema
                  无 defaultBranch 列、无 PATCH 端点,读面固定 main;chevron 保
                  r2 24c 捕获形状。非交互元素——不再是死钮。registry 词汇：
                  Badge outline + font-mono（手写 28 高方角盒退役）。 */}
              <Badge
                variant="outline"
                className="prj-set-branch gap-1.5 font-mono [&_svg]:text-muted-foreground"
              >
                {project?.defaultBranch ?? 'main'}
                <ChevronDown width={12} height={12} />
              </Badge>
            </span>
          </CardContent>
          {/* #1213/ADR 0017 双执行源：github 形态显示「本机加速路径」——
              githubRepo 恒为真值源，localPath 只是同机执行加速位（daemon 侧
              双条件判定，失格静默回落 GitHub clone）。清空保存 = 显式 null
              （wire 契约，不是不带键）。其余形态不显示（local 形态的
              localPath 是创建闸绑定，不在本面改写）。 */}
          {live && wireProject?.repoKind === 'github' && (
            <CardContent className={ROW_CLS}>
              <span className={LABEL_CLS}>{t('本机加速路径')}</span>
              <span className={VALUE_CLS}>
                <Input
                  aria-label={t('本机加速路径')}
                  className="h-8 w-72 font-mono"
                  placeholder={t('绝对路径，留空即清除')}
                  value={accelDraft ?? wireProject.localPath ?? ''}
                  onChange={(event) => setAccelDraft(event.target.value)}
                />
                <Button
                  size="sm"
                  disabled={
                    mutations.patchProject.isPending ||
                    (accelDraft ?? wireProject.localPath ?? '') === (wireProject.localPath ?? '')
                  }
                  onClick={() => {
                    if (id === undefined) return;
                    const next = (accelDraft ?? '').trim();
                    mutations.patchProject.mutate(
                      // 空串归一 null（空 ≡ 未设，与 server 侧同口径）。
                      { id, body: { localPath: next === '' ? null : next } },
                      {
                        onSuccess: () => setAccelDraft(null),
                        onError: (error) => toastError(t('保存失败，请重试。'), error),
                      },
                    );
                  }}
                >
                  {t('保存')}
                </Button>
              </span>
            </CardContent>
          )}
          <CardContent className={ROW_CLS}>
            <span className={LABEL_CLS}>{t('描述')}</span>
            <span className={`${VALUE_CLS} text-muted-foreground`}>
              {/* #1242 描述面：接 PATCH（null/空 = 清空——显式 null 上 wire，
                  #1169 序列化坑族）；fixture 面保静态捕获形状。 */}
              {live && wireProject !== undefined ? (
                <>
                  <Input
                    aria-label={t('描述')}
                    className="h-8 w-72"
                    placeholder={t('尚无描述')}
                    value={descDraft ?? wireProject.description ?? ''}
                    onChange={(event) => setDescDraft(event.target.value)}
                  />
                  <Button
                    size="sm"
                    aria-label={t('保存描述')}
                    disabled={
                      mutations.patchProject.isPending ||
                      (descDraft ?? wireProject.description ?? '') ===
                        (wireProject.description ?? '')
                    }
                    onClick={() => {
                      if (id === undefined) return;
                      const next = (descDraft ?? '').trim();
                      mutations.patchProject.mutate(
                        // 空串归一 null（空 ≡ 未设，server 侧同口径）。
                        { id, body: { description: next === '' ? null : next } },
                        {
                          onSuccess: () => setDescDraft(null),
                          onError: (error) => toastError(t('描述保存失败，请重试。'), error),
                        },
                      );
                    }}
                  >
                    {t('保存')}
                  </Button>
                </>
              ) : (
                <>
                  {project?.description ?? t('尚无描述')}
                  <SquarePen width={14} height={14} />
                </>
              )}
            </span>
          </CardContent>
        </Card>
        {/* #1242 local→github 转换卡（live local 项目专用）：用户 2026-10-11
            定案「原 pacman 项目转 github 形态 + localPath 加速位」的 UI 出口。
            提交闸：owner/repo 形状（isGithubRepoRef，与新建页同单源）——
            预检不过落中性提示行（inline，非 toast——输入未完成不是错误事件）；
            server 侧语义闸（可达性/在飞 build 409）失败走 toastError（失败
            可见）。localPath 预填现值（local 绑定路径就地转加速位），空串 =
            显式 null 清空。转换成功 → invalidate 重取 → repoKind 切面：本卡
            卸载、基本信息卡的加速位行上线。 */}
        {live && wireProject?.repoKind === 'local' && (
          <Card className="mt-4 gap-1.5 p-4">
            <div className="text-sm font-medium">{t('转换为 GitHub 形态')}</div>
            <div className="text-sm text-muted-foreground">
              {t('转换后以 GitHub 仓为唯一真值源，本机路径转为执行加速位；有在飞构建时不可转换。')}
            </div>
            <div className="mt-1.5 flex flex-col items-start gap-1.5">
              <Input
                aria-label={t('GitHub 仓库（owner/repo）')}
                className="h-8 w-72 font-mono"
                placeholder="owner/repo"
                value={convRepo}
                onChange={(event) => {
                  setConvRepo(event.target.value);
                  setConvError(null);
                }}
              />
              <Input
                aria-label={t('本机加速路径')}
                className="h-8 w-72 font-mono"
                placeholder={t('绝对路径，留空即清除')}
                value={convPathDraft ?? wireProject.localPath ?? ''}
                onChange={(event) => setConvPathDraft(event.target.value)}
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={mutations.patchProject.isPending || convRepo.trim() === ''}
                  onClick={() => {
                    if (id === undefined) return;
                    const repo = convRepo.trim();
                    if (!isGithubRepoRef(repo)) {
                      setConvError(t('GitHub 仓库格式应为 owner/repo。'));
                      return;
                    }
                    const nextPath = (convPathDraft ?? wireProject.localPath ?? '').trim();
                    mutations.patchProject.mutate(
                      // 空串归一 null（空 ≡ 未设，server 侧同口径）。
                      {
                        id,
                        body: {
                          repoKind: 'github',
                          githubRepo: repo,
                          localPath: nextPath === '' ? null : nextPath,
                        },
                      },
                      {
                        onSuccess: () => {
                          setConvRepo('');
                          setConvPathDraft(null);
                          setConvError(null);
                        },
                        onError: (error) => toastError(t('转换失败，请重试。'), error),
                      },
                    );
                  }}
                >
                  {t('转换')}
                </Button>
                {convError !== null && (
                  <span role="alert" className="text-xs text-destructive">
                    {convError}
                  </span>
                )}
              </div>
            </div>
          </Card>
        )}
        {/* 危险操作区(#207 复活): #189 DELETE /api/projects/:id 已落地,
            钮接真确认流。#983 判决执行：Panel quiet 退役 → registry Card；
            destructive 钮回件默认软底档（#946 实底皮肤配方退役——皮肤超出
            官网形态，registry 默认赢）。 */}
        <div className="mt-4 mb-2 text-xs leading-4 text-muted-foreground">{t('危险操作')}</div>
        <Card className="mt-4 gap-1.5 p-4">
          <div className="text-sm font-medium">{t('删除项目')}</div>
          <div className="text-sm text-muted-foreground">
            {/* #1174：确认文案写清级联带走什么（票面要求）。列举项 = server
                services/projects.ts 清图序的 truthful 投影（任务/构建历史/
                定时/标签/托管仓库磁盘面）；票面点名的「技能授权面」不在列
                ——技能不入库、无项目级授权（spec 13 #367），文案不撒谎。 */}
            {t(
              '删除项目将级联删除其下所有任务、构建历史、定时任务、标签与托管仓库文件，此操作不可恢复。',
            )}
          </div>
          <Button
            variant="destructive"
            className="mt-1.5 w-fit"
            onClick={() => setDeleteOpen(true)}
          >
            {t('删除')}
          </Button>
        </Card>
      </div>
      {/* 确认弹层(r2 24d, DeleteConfirm 家族): 键入项目名精确匹配才解禁;
          确认后跳项目列表面 —— live 走 DELETE + invalidateAll 重取,fixture
          走 #66 deletions 覆面(侧栏项目行随行隐去,reload 还原)。 */}
      <DeleteProjectConfirm
        projectName={project?.name ?? ''}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false);
          if (live) {
            if (id !== undefined) {
              mutations.deleteProject.mutate(id, {
                onSuccess: () => navigate('/app'),
                // #638：确认层已关，失败 = 项目还在却零解释。
                onError: (error) => toastError(t('删除项目失败，请重试。'), error),
              });
            }
            return;
          }
          if (id !== undefined) markDeleted(id);
          navigate('/app');
        }}
      />
    </PageShell>
  );
}
