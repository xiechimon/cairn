// New-project route (issue #71, r2 07): centered 768 column — avatar
// placeholder tile + caption, 项目名称 input, 仓库 selector row, full-width
// 创建项目 primary (disabled until the form is filled, r2 07 muted indigo).
// #83 (M5) live：名称受控 + 创建 = POST /api/projects → 跳项目页。
// #360 (spec 12 G2-T3)：仓库 selector 两行——「GitHub 仓库」（认证门控
// picker 面见下方 #361 段）与「本地文件夹」（触发行换绝对路径输入，server
// validateLocalRepoPath 三态校验，400 reason code 分类落红色错误行）。hosted 行
// 创建入口移除：未动表单提交 = 无 repo 普通项目（kind 缺省，server REST /
// MCP 仍接受 hosted，存量项目不动）。名称回填：local = basename(localPath)，
// github = repo 段；仅当名称为空或仍等于上次回填值时覆盖（用户手改过则
// 不动）。repo 种类菜单走 components/ui/dropdown-menu（t-0070，Base UI
// Menu RadioGroup）；picker 弹层走 registry Popover（#983 floating-shell 族拆
// 判决，Esc/外点/焦点归还归 Base UI 原语）。提交 body 单源 = shared
// createProjectBodySchema（kind 契约名；github 提交闸与 server 400 门同吃
// isGithubRepoRef）。
// #361 (spec 12 G2-T4)：GitHub 仓库 选态成为认证门控的 picker 面，三面：
// - 未认证 = 「认证 GitHub」钮（live = POST github/oauth/authorize → 同页签
//   跳走，#231 同律；fixture = accept 律本地翻转）+「手动输入 owner/repo」
//   兜底链接（公开仓免认证 / OAuth 未配置两降级入口）；
// - 已认证 = picker 触发钮（选中 full_name 回填走 trigger-label 律）+ 锚定
//   picker 弹层（搜索 / 仓库行 / 断开钮 / 手动兜底 = 组织仓不在列表降级
//   入口，#67/#127 家族律）；live 首取在途 = 禁用占位触发行（不闪认证钮
//   误导致点击）；
// - 手动兜底 = owner/repo input（isGithubRepoRef 提交闸 + repo 段名称回填
//   律不动）。
// 着陆参 ?oauth=connected|error&reason=…&github=connection（callback 302
// 回本页，server 按 state kind 分支落点）：connected → 复位 github 选态 +
// picker 自动开（同页签跳走期间表单态已丢，选态从着陆参重建）；error →
// reason 三译（#243 词汇不变）落内联错误行。读后清参，刷新不重放。

import {
  type CreateProjectBody,
  FS_PICK_ERROR_COPY,
  type FsPickErrorReason,
  type GithubRepoSummary,
  isGithubRepoRef,
  LOCAL_ERROR_REASON_COPY,
  type LocalErrorReason,
} from '@pacman/shared';
import { type KeyboardEvent, type Ref, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ApiError } from '../api/client.js';
import { useApiMutations, useGithubConnection, useGithubRepos } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { Input } from '../components/ui/input.js';
import { Label } from '../components/ui/label.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { toastError } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { oauthReasonCopy } from '../i18n/oauth-reason.js';
import { useI18n } from '../i18n/provider.js';
import { Check, ChevronRight, ImageFrame } from '../icons/index.js';
import { DirBrowser } from './dir-browser.js';
import { PAGE_COL_CLS } from './parts.js';
import { PageShell } from './shell.js';

/* #980 registry 对齐：手写配方（40 高带框族 / V2 弹层板 / 七通道中和）退役，
   件默认形态赢——Input/outline 钮/PopoverContent/DropdownMenuContent 的皮肤
   几何全归件；消费点只留布局位（flex-1/ml-2/w-auto min-w 等）。id 载体
   （#prj-new-name / #prj-new-repo）与 label 配对是语义资产，原样保留。 */

/** 仓库触发行：outline 件默认 + 两端对齐布局位（flex-1 占满 field 行）。 */
const REPO_TRIGGER_CLS = 'flex-1 justify-between font-normal';

/** picker 弹层板（#983 floating-shell 族拆判决：锚定 absolute 族 →
 *  registry Popover）：皮肤/动效/z 全归 PopoverContent 件默认，描边 Arrow
 *  三角随手写壳退役；消费点只留布局位——宽随锚（--anchor-width，
 *  Positioner 自定义属性）+ 原面最小宽 220。data-testid = 面板焦点判定
 *  与 e2e 的二级载体（面板语义由内层 role=listbox 承载）。 */
// 板宽 = 锚（触发钮）宽 + swap 钮位（32+8）= 旧 inset-x-0 的 field wrap 全跨：
// 窄于 wrap 时 wrap 同行的提交钮会从板右缘露出深色残块（#1061 实审截图点名）。
const PICKER_PLATE_CLS = 'w-[calc(var(--anchor-width)+40px)] min-w-[220px]';

/** picker 仓库行：ghost 件默认形态（hover 涂底 = registry 可供性），只留
 *  布局位；whitespace-normal 复原长 owner/repo 的换行面（base nowrap 会
 *  禁掉）。键盘契约（roving/typeahead/Enter 即选即关）在下方手搓面不变。 */
// 焦点/选中指示走 registry 菜单行词汇（focus:bg-accent + outline-hidden，
// dropdown-menu item 同形）——Button 基类的 border-ring + ring-3 在板内行上
// 过重（#1061 实审点名「描边+阴影偏重」）。
const GH_ROW_CLS =
  'h-auto w-full cursor-pointer justify-start px-2 py-1.5 text-left font-normal whitespace-normal outline-hidden focus:bg-accent focus:text-accent-foreground focus-visible:border-transparent focus-visible:ring-0';

/** 兜底链接钮：registry link 变体（手写 tertiary 下划线配方退役）；
 *  体级 mt-2 / picker 内 mt-0+px-1 的位差由消费点补。 */
const GH_LINK_CLS = 'h-auto self-start p-0 text-xs';

/** repo 选择态：none = 未动（触发行持「选择仓库」占位；提交实效 = 无 repo
 *  普通项目，spec 12）；github / local = 用户已选的形态。 */
type RepoSel = 'none' | 'github' | 'local';

/** 本地路径末段（名称回填源）：容忍尾部斜杠；根路径与 `.`/`..` 无段可回
 *  = 返回空串跳过回填。`~` 前缀原样参与取段（server 侧展开，两侧同值）。 */
function pathBasename(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  const segment = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return segment === '.' || segment === '..' ? '' : segment;
}

/** 重开仓库种类菜单的 swap 钮（github 三面 + local 面共用，#305 原形；
 *  t-0070 收编成 Menu Trigger——toggle 开合/aria-haspopup/aria-expanded
 *  归原语，onClick 直通形态退役。#305 的 local 面内联副本随之并入本件）。
 *  registry 形态：outline 件 icon 档（手写 40×40 带框配方退役）。 */
function RepoSwapButton({
  label,
  buttonRef,
}: {
  label: string;
  /** t-0070：键盘激活后的焦点接续位（选中即分支切换、原 trigger 卸载，
   *  焦点交回常驻的 swap 钮而不是掉 body）。 */
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <DropdownMenuTrigger
      render={
        <Button
          ref={buttonRef}
          variant="outline"
          size="icon"
          className="ml-2 shrink-0 text-muted-foreground"
          aria-label={label}
        />
      }
    >
      <ChevronRight width={14} height={14} />
    </DropdownMenuTrigger>
  );
}

export function ProjectNewPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const navigate = useNavigate();
  const mutations = useApiMutations(teamId);
  const [name, setName] = useState('');
  const [repoSel, setRepoSel] = useState<RepoSel>('none');
  const [githubRepo, setGithubRepo] = useState('');
  const [localPath, setLocalPath] = useState('');
  // #440：浏览钮在飞位（disabled + server 单飞双保险）与降级提示行文案
  // （ADR 0003 D4——能力边界说明，非错误级；null = 无提示）。
  const [pickBusy, setPickBusy] = useState(false);
  const [pickHint, setPickHint] = useState<string | null>(null);
  // #441：native 对话框不可用（422 unavailable，remote/headless 形态）时自动
  // 打开应用内目录浏览器兜底（ADR 0003 D6）；其余错误只落提示行不开 overlay。
  const [browseOpen, setBrowseOpen] = useState(false);
  const [repoOpen, setRepoOpen] = useState(false);
  // #361 github 面状态位：manualRepo = 手动兜底 input 面；pickerOpen =
  // picker 弹层；oauthError = 着陆 reason 三译 / authorize 失败原文（内联行）。
  const [manualRepo, setManualRepo] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [repoQuery, setRepoQuery] = useState('');
  // fixture accept 律本地覆盖（null = 无覆盖，跟 scenario fixture；live 面
  // 不用——连接态 = status 读面真值）。
  const [fixtureAuth, setFixtureAuth] = useState<boolean | null>(null);
  // 上次自动回填值——名称覆盖判定「为空或仍等于上次回填值」的后半（spec
  // 12）；用户手改（≠ 上次回填且非空）后路径/repo 变化不再覆盖。ref 即可：
  // 只参与事件时判定，不进渲染面。
  const autoName = useRef('');
  // t-0070：repo 种类菜单的定位锚 = 整个 field wrap（多触发面——none 态主钮
  // 与各选态 swap 钮开的是同一张 plate，plate 恒贴 wrap 左缘，不跟触发钮走）。
  // gh picker 的 Popover 同锚（Positioner 锚定取代旧 Portal-container 几何）。
  const repoFieldRef = useRef<HTMLDivElement>(null);
  // t-0070：菜单激活 = 分支切换 = 原 trigger 卸载，Base UI 的焦点归还失去
  // 落点（掉 body）——选中时立旗，落定后把焦点交给常驻的 swap 钮（鼠标路径
  // 无感：程序焦点跟随鼠标交互不触发 :focus-visible，无环）。
  const swapBtnRef = useRef<HTMLButtonElement>(null);
  const pendingSwapFocus = useRef(false);
  useEffect(() => {
    if (!pendingSwapFocus.current) return;
    pendingSwapFocus.current = false;
    const raf = requestAnimationFrame(() => swapBtnRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [repoSel]);

  // OAuth callback 着陆参（?oauth=…&github=connection——connection 族专属
  // 旗标，provider 族着陆不带、providers-page 消费面互不串）。只删
  // oauth/reason/github 三键——scenario 等其余参保留（providers-page 同律）。
  useEffect(() => {
    const oauth = searchParams.get('oauth');
    if (oauth === null || searchParams.get('github') !== 'connection') return;
    setRepoSel('github');
    setManualRepo(false);
    if (oauth === 'connected') {
      setOauthError(null);
      setPickerOpen(true);
    } else {
      // #243 reason 三路分译单源 = i18n/oauth-reason.ts（providers-page 共用）。
      setOauthError(oauthReasonCopy(searchParams.get('reason'), t));
    }
    const next = new URLSearchParams(searchParams);
    next.delete('oauth');
    next.delete('reason');
    next.delete('github');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, t]);

  const githubSelected = repoSel === 'github';
  // 连接态：live = GET connection 封套（github 选态才拉，页面挂载不空转）；
  // fixture = scenario 数据 + accept 律本地覆盖。live 首取在途 = 未决态
  // （禁用占位触发行，不闪认证钮误导点击；refetch 期 data 在场不回落）。
  const connectionQ = useGithubConnection(teamId, live && githubSelected);
  const connectionPending = live && githubSelected && connectionQ.isPending;
  const connected = live
    ? (connectionQ.data?.connected ?? false)
    : (fixtureAuth ?? fixture.github?.connected === true);
  const login = live ? connectionQ.data?.login : fixture.github?.login;
  // picker 仓库行：live 于已认证 picker 面在途才拉；搜索过滤本地做
  // （单页 100 条一次取回，server q 为同值兜底；>100 仓的列表外命中走
  // 手动兜底——分页归后续需要时再开，T1 代理面同律）。
  const reposQ = useGithubRepos(live && githubSelected && connected && !manualRepo);
  const repos = live ? (reposQ.data?.repos ?? []) : (fixture.github?.repos ?? []);
  const query = repoQuery.trim().toLowerCase();
  const hits =
    query === '' ? repos : repos.filter((r) => r.full_name.toLowerCase().includes(query));

  // 上次自动回填值——名称覆盖判定「为空或仍等于上次回填值时覆盖」的后半
  // （spec 12）；用户手改（≠ 上次回填且非空）后路径/repo 变化不再覆盖。
  const backfillName = (next: string) => {
    if (next === '') return;
    if (name !== '' && name !== autoName.current) return;
    setName(next);
    autoName.current = next;
  };
  const onGithubRepoChange = (value: string) => {
    setGithubRepo(value);
    const ref = value.trim();
    // 有效 owner/repo 才回填 repo 段；半截输入（无斜杠/非法字符）不动名称。
    if (isGithubRepoRef(ref)) backfillName(ref.slice(ref.indexOf('/') + 1));
  };
  const onLocalPathChange = (value: string) => {
    setLocalPath(value);
    // 编辑即撤提示（陈旧提示不残留，localErrorText 同律）。
    setPickHint(null);
    backfillName(pathBasename(value));
  };

  // #440 浏览钮（ADR 0003 D1/D4）：server 代弹 macOS 原生选文件夹对话框。
  // 取消 = 静默 no-op（{path:null} 是正常结局）；能力缺失/单飞 = reason 分译
  // 落中性提示行；未分类失败原文直透（LOCAL_ERROR_REASON_COPY 降级同律）。
  // 结果直接覆盖 localPath（S11 最后动作赢，#440 失败方式清单）并走既有
  // basename 回填律。
  const browseFolder = () => {
    if (pickBusy) return;
    setPickBusy(true);
    setPickHint(null);
    mutations.pickLocalFolder.mutate(undefined, {
      onSuccess: (data) => {
        if (data.path !== null) onLocalPathChange(data.path);
      },
      onError: (err) => {
        const reason = err instanceof ApiError ? err.reason : undefined;
        setPickHint(
          reason !== undefined && reason in FS_PICK_ERROR_COPY
            ? t(FS_PICK_ERROR_COPY[reason as FsPickErrorReason])
            : err instanceof ApiError
              ? err.message
              : t('无法打开系统文件夹对话框'),
        );
        // #441 兜底：unavailable = remote/headless 形态（无 GUI 会话），自动开
        // 应用内目录浏览器（ADR 0003 D6）；busy（409）与未分类错只落提示行。
        if (reason === 'unavailable') setBrowseOpen(true);
      },
      onSettled: () => setPickBusy(false),
    });
  };

  // picker 单选：回填 owner/repo（trigger 面显示）+ 项目名（回填律）+ 收面板。
  const pickRepo = (repo: GithubRepoSummary) => {
    setGithubRepo(repo.full_name);
    backfillName(repo.name);
    setPickerOpen(false);
    setOauthError(null);
  };

  const startAuth = () => {
    setOauthError(null);
    if (live) {
      mutations.startGithubOAuth.mutate(undefined, {
        // 成功 = 同页签跳授权页；页面随整页导航退场（startProviderOAuth 同律）。
        onSuccess: (data) => window.location.assign(data.authorizationUrl),
        onError: (err) => setOauthError(err.message),
      });
    } else {
      setFixtureAuth(true); // fixture accept 律：点认证 = 认证通过
    }
  };

  const disconnect = () => {
    setPickerOpen(false);
    if (live) {
      // invalidate → status 读面收敛回未认证面；#638 失败 = 连接还挂着却零解释。
      mutations.disconnectGithub.mutate(undefined, {
        onError: (error) => toastError(t('断开连接失败，请重试。'), error),
      });
    } else {
      setFixtureAuth(false);
    }
  };

  // 提交闸：github = owner/repo 过 server 同源校验（isGithubRepoRef，shared
  // 单源——picker 选中回填的 full_name 天然过闸，#361 不动此律）；local =
  // 路径非空（三态真伪只有 server fs 能判，400 走错误行）；none = 无 repo
  // 项目仅需名称。无效值不发请求，server 400 兜底不变。
  const formOk =
    repoSel === 'github'
      ? isGithubRepoRef(githubRepo.trim())
      : repoSel === 'local'
        ? localPath.trim() !== ''
        : true;
  const showGithubField = githubSelected && !manualRepo;

  // t-0070（裁决③：维持手搓 + 键盘契约与 dropdown-menu 收编面同等）：
  // picker 行表的 roving tabindex / typeahead / 开面焦点进列表 / 关面焦点
  // 归还触发钮。Menu 原语承载不了「搜索 input + 行表」混合板，Command/
  // Combobox 无 drop-in（coverage map §3.9 对 mention-picker 内容层的同形
  // 裁决先例），故契约语义手搓、皮肤与 DOM 形态零变化。
  const pickerVisible = showGithubField && connected && pickerOpen;
  const ghListRef = useRef<HTMLDivElement>(null);
  const ghFocusDelivered = useRef(false);
  const ghTypeBuf = useRef({ text: '', ts: 0 });
  const [ghActive, setGhActive] = useState(0);
  // 开面（含着陆参自动开）与行表异步到位后把焦点送进列表：选中行优先，
  // 否则首行；面板已持焦（用户点了搜索框）不抢。delivered 旗标按开合周期
  // 复位。有界 rAF 重试：open 帧弹层子树刚随 Portal 挂载（#656 壳），
  // live 面行表还要等 reposQ——单次 rAF 会在列表就位前放弃，重试到
  // delivered 或 30 帧预算耗尽（空面 = 无行可聚焦，焦点留在触发钮）。
  useEffect(() => {
    if (!pickerVisible) {
      ghFocusDelivered.current = false;
      return;
    }
    let raf = 0;
    let tries = 0;
    const step = () => {
      tries += 1;
      const list = ghListRef.current;
      if (list !== null) {
        const plate = list.closest('[data-testid="github-picker"]');
        const active = document.activeElement;
        if (plate?.contains(active)) {
          ghFocusDelivered.current = true;
          return;
        }
        if (ghFocusDelivered.current && active !== document.body) return;
        const rows = [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')];
        if (rows.length > 0) {
          const idx = Math.max(
            0,
            hits.findIndex((repo) => repo.full_name === githubRepo),
          );
          setGhActive(idx);
          rows[idx]?.focus();
          ghFocusDelivered.current = true;
          return;
        }
      }
      if (tries < 30) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [pickerVisible, hits, githubRepo]);
  // 关面焦点归还：交回 #prj-new-repo（该时点的续作控件：picker 触发钮 /
  // 手动兜底 input / 认证钮，menu 原语的焦点归还同律）。壳退场保活期
  // （visibility 桥 150ms，EXIT_BRIDGE_CLS）里不立刻掉焦——焦点滞留在
  // 关面中的行上，故按「active 在 picker 面板子树内（含保活期）或已掉
  // body」判定有界重试（30 帧 > 保活窗，也覆盖分支切换时续作控件晚一帧就位）；
  // 焦点在面板外稳位（触发钮 toggle 关面 / 用户已移焦）不抢。
  const pickerWasOpen = useRef(false);
  useEffect(() => {
    if (pickerVisible) {
      pickerWasOpen.current = true;
      return;
    }
    if (!pickerWasOpen.current) return;
    pickerWasOpen.current = false;
    let raf = 0;
    let tries = 0;
    const step = () => {
      tries += 1;
      const active = document.activeElement;
      const insidePicker = active?.closest('[data-testid="github-picker"]') != null;
      if (active !== document.body && !insidePicker) return; // 焦点已落面板外稳位，不抢
      const el = document.getElementById('prj-new-repo');
      if (el !== null) {
        el.focus();
        return;
      }
      if (tries < 30) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [pickerVisible]);
  // 列表键盘：Arrow/Home/End roving（回环 = loopFocus 律）+ typeahead
  // （500ms 缓冲，前缀命中优先、子串兜底；CJK 走输入法路径，与 Menu 原语
  // 同限）。Enter/Space = button 原生激活 → pickRepo 即选即关。
  const onGhListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = ghListRef.current;
    if (list === null) return;
    const rows = [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    if (rows.length === 0) return;
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') {
      next = current < 0 ? 0 : (current + 1) % rows.length;
    } else if (event.key === 'ArrowUp') {
      next = current < 0 ? rows.length - 1 : (current - 1 + rows.length) % rows.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = rows.length - 1;
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      const text =
        now - ghTypeBuf.current.ts < 500
          ? ghTypeBuf.current.text + event.key.toLowerCase()
          : event.key.toLowerCase();
      ghTypeBuf.current = { text, ts: now };
      const label = (el: HTMLElement) => (el.textContent ?? '').trim().toLowerCase();
      let idx = rows.findIndex((el) => label(el).startsWith(text));
      if (idx < 0) idx = rows.findIndex((el) => label(el).includes(text));
      if (idx >= 0) next = idx;
    }
    if (next === null) return;
    event.preventDefault();
    setGhActive(next);
    rows[next]?.focus();
  };

  // local 400 错误行：仅当「本次提交的路径仍是输入框现值」时呈现——编辑
  // 路径即撤（陈旧错误不残留）。reason 分类按 server 应答的结构化 code
  // （#386，词汇单源 = shared PROJECT_LOCAL_ERROR_REASONS），消息子串不再
  // 是契约；无 code 或未分类 reason = 原文直透。
  const [submittedPath, setSubmittedPath] = useState<string | null>(null);
  const createError = mutations.createProject.error;
  const localErrorCopy = (reason: string | undefined, message: string): string =>
    reason !== undefined && reason in LOCAL_ERROR_REASON_COPY
      ? t(LOCAL_ERROR_REASON_COPY[reason as LocalErrorReason])
      : message;
  const localErrorText =
    repoSel === 'local' &&
    submittedPath !== null &&
    submittedPath === localPath.trim() &&
    createError instanceof ApiError &&
    createError.status === 400
      ? localErrorCopy(createError.reason, createError.message)
      : null;

  const submit = () => {
    const body: CreateProjectBody =
      repoSel === 'github'
        ? { name: name.trim(), kind: 'github', githubRepo: githubRepo.trim() }
        : repoSel === 'local'
          ? { name: name.trim(), kind: 'local', localPath: localPath.trim() }
          : { name: name.trim() };
    if (repoSel === 'local') setSubmittedPath(localPath.trim());
    mutations.createProject.mutate(body, {
      onSuccess: (p) => navigate(`/app/project/${p.id}`),
      // #638：local-400 已有内联错误行（localErrorText，编辑即撤）——不双报。
      // 其余失败（github ref 校验 400 / 5xx / 网络）此前无任何反馈位，toast
      // 点名；判据与 localErrorText 的呈现闸同源（本次提交形态 + status）。
      onError: (error) => {
        const inlineHandled =
          repoSel === 'local' && error instanceof ApiError && error.status === 400;
        if (!inlineHandled) toastError(t('创建项目失败，请重试。'), error);
      },
    });
  };

  return (
    <PageShell fixture={fixture} selected="none" title="新建项目">
      <div className={`${PAGE_COL_CLS} flex flex-col pt-4`}>
        <div className="mx-auto flex size-[72px] items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <ImageFrame />
        </div>
        <div className="mt-3 text-center text-xs leading-4 text-muted-foreground">
          {t('可选。未设置时以首字母代替。')}
        </div>
        {/* CJK 标签行高修正（leading-none → 1.25，墨盒不贴行底被邻位
            focus 环压住）：就地 className，件保持 pristine（#980 S5）。 */}
        <Label className="mt-6 mb-2 leading-tight" htmlFor="prj-new-name">
          {t('项目名称')}
        </Label>
        {/* Input 件默认形态（h-8 rounded-lg）。#1244：focus 环是全局
            2px --focus-ring outline。 */}
        <Input
          id="prj-new-name"
          type="text"
          placeholder="My App"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Label className="mt-6 mb-2 leading-tight" htmlFor="prj-new-repo">
          {t('仓库')}
        </Label>
        {/* t-0070 收编：repo 种类菜单 → components/ui/dropdown-menu（Base UI
            Menu RadioGroup）。开合受控（repoOpen 与 picker 互斥位联动：开菜单
            即收 picker）；Esc / 外点关 / roving focus / typeahead / 焦点归还
            全归原语。皮肤 = 件默认（#980 裁决④），定位走 Positioner 参数
            （side=bottom align=start sideOffset=6），anchor 显式钉 field wrap
            （多触发面共锚）。gh picker = registry Popover（#983 floating-shell
            族拆判决），同一 wrap 作 Positioner 锚。 */}
        <DropdownMenu
          open={repoOpen}
          onOpenChange={(next) => {
            setRepoOpen(next);
            if (next) setPickerOpen(false);
          }}
        >
          <Popover
            open={pickerVisible}
            onOpenChange={(next: boolean) => {
              if (next) {
                setRepoOpen(false);
                setPickerOpen(true);
              } else {
                setPickerOpen(false);
              }
            }}
          >
            <div className="relative flex" ref={repoFieldRef}>
              {repoSel === 'github' ? (
                manualRepo ? (
                  <>
                    <Input
                      id="prj-new-repo"
                      className="flex-1"
                      type="text"
                      placeholder="owner/repo"
                      aria-label={t('GitHub 仓库')}
                      value={githubRepo}
                      onChange={(e) => onGithubRepoChange(e.target.value)}
                    />
                    <RepoSwapButton label={t('选择仓库')} buttonRef={swapBtnRef} />
                  </>
                ) : connectionPending ? (
                  <>
                    {/* live 首取在途：禁用占位（连接态未决，不闪认证钮）。
                    禁用降档 = 件默认（opacity-50 + pointer-events-none）。 */}
                    <Button
                      variant="outline"
                      id="prj-new-repo"
                      className={REPO_TRIGGER_CLS}
                      disabled
                    >
                      <span className="text-sm text-muted-foreground">{t('选择仓库')}</span>
                    </Button>
                    <RepoSwapButton label={t('选择仓库')} buttonRef={swapBtnRef} />
                  </>
                ) : connected ? (
                  <>
                    {/* picker 触发 = PopoverTrigger（Base UI 原生 toggle：
                    aria-haspopup/aria-expanded 归原语，#666 的双写竞态面
                    随受控 onClick 直通形态退役）。 */}
                    <PopoverTrigger
                      render={
                        <Button variant="outline" id="prj-new-repo" className={REPO_TRIGGER_CLS} />
                      }
                    >
                      {githubRepo === '' ? (
                        <span className="text-muted-foreground">{t('选择 GitHub 仓库')}</span>
                      ) : (
                        <span>{githubRepo}</span>
                      )}
                      <ChevronRight width={14} height={14} />
                    </PopoverTrigger>
                    <RepoSwapButton label={t('选择仓库')} buttonRef={swapBtnRef} />
                  </>
                ) : (
                  <>
                    <Button id="prj-new-repo" className="flex-1" onClick={startAuth}>
                      {t('认证 GitHub')}
                    </Button>
                    <RepoSwapButton label={t('选择仓库')} buttonRef={swapBtnRef} />
                  </>
                )
              ) : repoSel === 'local' ? (
                <>
                  <Input
                    id="prj-new-repo"
                    className="flex-1"
                    type="text"
                    placeholder="/path/to/repo"
                    aria-label={t('本地文件夹')}
                    value={localPath}
                    onChange={(e) => onLocalPathChange(e.target.value)}
                  />
                  {/* 浏览钮 = DirBrowser Popover 的 Trigger（#441 兜底面）：
                    trigger 按压不直开面板——onOpenChange 截获开面请求改走
                    browseFolder（server 代弹原生对话框），仅 422 unavailable
                    程序开面（ADR 0003 D6）；面板开着时再按 = 原生 toggle
                    关面（旧 ClickCatcher「外点只关」同语义）。 */}
                  <Popover
                    open={browseOpen}
                    onOpenChange={(next: boolean) => {
                      if (next) browseFolder();
                      else setBrowseOpen(false);
                    }}
                  >
                    <PopoverTrigger
                      render={
                        <Button
                          variant="outline"
                          className="ml-2 shrink-0"
                          aria-label={t('浏览')}
                          disabled={pickBusy}
                        />
                      }
                    >
                      {t('浏览')}
                    </PopoverTrigger>
                    <DirBrowser
                      onPick={(path) => {
                        setBrowseOpen(false);
                        onLocalPathChange(path);
                      }}
                    />
                  </Popover>
                  {/* local 面的种类 swap（#305 内联副本，t-0070 并入 RepoSwapButton
                  ——Trigger 化后两形完全同件）。 */}
                  <RepoSwapButton label={t('选择仓库')} buttonRef={swapBtnRef} />
                </>
              ) : (
                // t-0070 收编成 Menu Trigger（aria-haspopup/expanded/toggle 归
                // 原语）；outline 件默认形态（同已连接 picker 触发面口径）。
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline" id="prj-new-repo" className={REPO_TRIGGER_CLS} />
                  }
                >
                  <span className="text-muted-foreground">{t('选择仓库')}</span>
                  <ChevronRight width={14} height={14} />
                </DropdownMenuTrigger>
              )}
              {/* 行选中态镜像用户动作（aria-checked ≡ indicator 勾渲染，原
                aria-selected ≡ check 律的 RadioItem 原生等价）：未动 =
                RadioGroup value null = 无行选中（触发行仍持占位文案；「未动表
                提交 = 无 repo 项目」是 body 层行为，不进选择面状态）。
                单选即关走显式 closeOnClick——RadioItem 缺省 false（原生菜单
                radio 保开语义），本面家族律是 select-and-close（#306/#360）。 */}
              <DropdownMenuContent
                anchor={repoFieldRef}
                sideOffset={6}
                aria-label={t('仓库')}
                className="w-auto min-w-[200px]"
              >
                <DropdownMenuRadioGroup
                  value={repoSel === 'none' ? null : repoSel}
                  onValueChange={(next) => {
                    const sel = next as 'github' | 'local';
                    pendingSwapFocus.current = true;
                    setRepoSel(sel);
                    if (sel === 'github') setPickerOpen(false);
                  }}
                >
                  <DropdownMenuRadioItem value="github" closeOnClick>
                    {t('GitHub 仓库')}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="local" closeOnClick>
                    {t('本地文件夹')}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
              {/* picker 弹层（#361）：已认证面专属——头部（已连接 login + 断开钮）/
                搜索 / 仓库行（单选即回填收面板，aria-selected ≡ check 律）/
                手动兜底链接。壳 = registry Popover（#983 floating-shell 族拆
                判决：锚定 absolute 族 → Popover，Positioner 锚定 field wrap）：
                Esc / 外点关 / 焦点归还 / 进出场动效全归 Base UI 原语——外点
                语义随 ClickCatcher 退役换原生 outside-press（#425 遗留待定项，
                #991 归原型实审裁决）；#666 toggle 双写竞态由 PopoverTrigger
                原生开合消除。行表键盘契约手搓面不变（t-0070 裁决③：混合板
                无 drop-in）：开面焦点进列表（initialFocus=false + 下方
                ghFocusDelivered 一族送达）、Arrow/Home/End roving、typeahead、
                Enter 即选即关。 */}
              <PopoverContent
                side="bottom"
                align="start"
                sideOffset={8}
                initialFocus={false}
                className={PICKER_PLATE_CLS}
                data-testid="github-picker"
              >
                <div className="flex items-center justify-between px-1 text-xs leading-4 text-muted-foreground">
                  <span>
                    {login === undefined || login === ''
                      ? t('已连接')
                      : `${t('已连接')} · ${login}`}
                  </span>
                  <Button variant="link" className="h-auto p-0 text-xs" onClick={disconnect}>
                    {t('断开连接')}
                  </Button>
                </div>
                <Input
                  type="text"
                  placeholder={t('搜索仓库')}
                  aria-label={t('搜索仓库')}
                  value={repoQuery}
                  onChange={(e) => setRepoQuery(e.target.value)}
                />
                {hits.length === 0 ? (
                  // live 取回在途不闪空面文案（pending ≠ 无命中）。
                  live && reposQ.isPending ? null : (
                    <div className="px-3 py-2 text-xs leading-4 text-muted-foreground">
                      {t('没有匹配的仓库')}
                    </div>
                  )
                ) : (
                  <div
                    className="flex max-h-56 flex-col overflow-y-auto"
                    role="listbox"
                    aria-label={t('GitHub 仓库')}
                    ref={ghListRef}
                    onKeyDown={onGhListKeyDown}
                  >
                    {hits.map((repo, index) => (
                      // 行钮 = ghost 件默认形态；role=option / aria-selected /
                      // roving tabIndex 键盘契约原样（t-0070 裁决③手搓面）。
                      <Button
                        key={repo.id}
                        variant="ghost"
                        className={GH_ROW_CLS}
                        role="option"
                        aria-selected={githubRepo === repo.full_name}
                        tabIndex={index === ghActive ? 0 : -1}
                        onClick={() => pickRepo(repo)}
                      >
                        {repo.full_name}
                        {githubRepo === repo.full_name && (
                          <span className="ml-auto flex text-primary">
                            <Check width={14} height={14} />
                          </span>
                        )}
                      </Button>
                    ))}
                  </div>
                )}
                {live && reposQ.isError ? (
                  <div className="px-1 text-xs leading-4 text-destructive" role="alert">
                    {(reposQ.error as Error).message}
                  </div>
                ) : null}
                {/* picker 内的兜底行与 repo 行同族（ghost 行钮几何/字重，
                2026-10-08 复核：link 件 text-xs+font-medium 在行表里读作
                异族）；语义仍是切手动面的动作，故留在 listbox 外。 */}
                <Button
                  variant="ghost"
                  className={GH_ROW_CLS}
                  onClick={() => {
                    setPickerOpen(false);
                    setManualRepo(true);
                  }}
                >
                  {t('手动输入 owner/repo')}
                </Button>
              </PopoverContent>
            </div>
          </Popover>
        </DropdownMenu>
        {/* github 非手动面的内联错误行（着陆 reason 三译 / authorize 400
            原文）与未认证面手动兜底链接（连接态未决时不出，随占位面收敛）。 */}
        {showGithubField && oauthError !== null && (
          <div className="mt-2 text-xs leading-4 text-destructive" role="alert">
            {oauthError}
          </div>
        )}
        {showGithubField && !connected && !connectionPending && (
          <Button
            variant="link"
            className={`${GH_LINK_CLS} mt-2`}
            onClick={() => setManualRepo(true)}
          >
            {t('手动输入 owner/repo')}
          </Button>
        )}
        {localErrorText !== null && (
          <div className="mt-2 text-xs leading-4 text-destructive" role="alert">
            {localErrorText}
          </div>
        )}
        {/* #440 降级提示行（ADR 0003 D4）：能力边界说明非错误级——中性色、
            载体 role=status（#910 裁定 3 aria 载体）；仅 local 选态呈现，
            编辑路径即撤。 */}
        {repoSel === 'local' && pickHint !== null && (
          <div className="mt-2 text-xs leading-4 text-muted-foreground" role="status">
            {pickHint}
          </div>
        )}
        {/* #1152（ADR 0016）localPath 单机器形态常驻标注：仓真值在这台机器的
            文件系统上，机器损坏进度随机器走——选中 local 即呈现，不随编辑撤。
            无 role=status：那是给动态升降提示的活区域（pickHint 占用且 e2e 钉
            了它唯一），常驻静态描述不应进活区域。 */}
        {repoSel === 'local' && (
          <div className="mt-2 text-xs leading-4 text-muted-foreground">
            {t('单机器形态：这台机器损坏时进度随机器走。需要在任意机器上续跑，请用 GitHub 接入。')}
          </div>
        )}
        {/* 提交钮：default 件默认形态（40 高手写几何与 .55 禁用淡化退役，
            禁用降档 = 件默认 opacity-50）。 */}
        <Button
          className="mt-5"
          disabled={live ? name.trim() === '' || !formOk : true}
          onClick={live ? submit : undefined}
        >
          {t('创建项目')}
        </Button>
      </div>
    </PageShell>
  );
}
