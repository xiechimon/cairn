// New-task creation surface (issue #389): the C hotkey and the sidebar
// 新任务 row open the same NewTaskDialog on every route. Extracted from
// board-page's wiring (#66 create / #176 project select / #310 spec+attachments
// / #311 mentions) so two faces share one save path: the board keeps its
// dialog (fixture saves land a local card via onFixtureSave), and AppSidebar's
// global dialog serves every route that has no dialog of its own (the
// searchPanel/#129 override precedent).
// #394 (spec 15) 重塑：提交 = 正文单字段 + 项目 id（无标题/标签——标题
// server 派生占位、agent 回填；标签固定词表），本 hook 同形。
// #404：project 页同吃本面——差异显式参数化：anchorProjectId = 路由项目
// 锚（选择器行置首 + 保存缺省解析），mentions 闸 = 提及数据面有无
// （project 页无此面；machines/skills 查询随闸）。
// XMON-93：本 hook 只许住 NewTaskSurfaceRoot 隔离叶子——open/liveSpec 态
// 每次开合与输入都重渲染宿主组件，住页面里 = 整板同步重渲染（ESC 退出
// 卡顿根因）。页面消费 openDialog 走叶子的 apiRef。
// Query discipline: todos/projects were already eager on every shell
// (deduped TQ keys — zero new traffic); members/skills/machines stay eager
// only for the board and gate on the dialog's open state everywhere else
// （#640 前 board eager 位吃 firstAgentId 的卡片级开始已改直发编排回合，
// eager 语义保持原状不动查询面）。

import type { TodoRecord as WireTodo } from '@pacman/shared';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { attachFile } from '../api/attachments.js';
import {
  useApiMutations,
  useMachines,
  useMembers,
  useProjects,
  useSkills,
  useTodos,
} from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useOrchestrateStart } from '../chief/use-orchestrate-start.js';
import { toastError } from '../components/ui/toaster.js';
import type { FixtureSet, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { attachmentFailureTitle } from './attachment-paste.js';
import type { MentionGroups } from './mention-picker.js';
import type { NewTaskDialogProps } from './new-task-dialog.js';

export interface NewTaskSurfaceOpts {
  /** fixture 面 mention 数据源：board 传合并集（fixture.todos + 本地新建卡）；
   *  缺省 = fixture.todos。 */
  fixtureTodos?: TodoRecord[];
  /** true = members/skills/machines 保持 eager（board 现状位，查询面语义
   *  不动）；缺省 = 随 open 态 gated，不开不发。 */
  eager?: boolean;
  /** fixture 面保存落点（board = 本地卡 append，#66 律；参数 = 正文，标题
   *  由 localTodo 按 shared 规则派生——#394 同律）。缺省 = 仅关 dialog。 */
  onFixtureSave?: (spec: string) => void;
  /** 页面锚定项目（#404 project 页 = 路由项目 id，#305 律）：dialog 项目
   *  选择器行把它置首（未动选择的默认行 = rows[0]，提交锚定本页项目而非
   *  首项目）；live 保存缺省解析 = 选中 ?? 锚 ?? 首项目——锚恒在位时下方
   *  「无项目建默认项目」分支不可达。缺省 = board/全局面语义（首项目，
   *  空集建默认项目，#176/#83 律）。 */
  anchorProjectId?: string;
  /** 提及 picker 数据面（#311）：缺省 true = live hooks / fixture 派生
   *  全集；false = 不传 mentionGroups（picker 空集）且 machines/skills
   *  查询随闸（project 页面）。 */
  mentions?: boolean;
}

export interface NewTaskSurface {
  /** 打开 dialog（C 热键 / 侧栏行 / 页面按钮共用的唯一 opener，幂等）。 */
  openDialog: () => void;
  /** 直接摊给 <NewTaskDialog>。 */
  dialogProps: NewTaskDialogProps;
}

export function useNewTaskSurface(fixture: FixtureSet, opts: NewTaskSurfaceOpts = {}) {
  const {
    fixtureTodos: fixtureTodosOpt,
    eager = false,
    onFixtureSave,
    anchorProjectId,
    mentions = true,
  } = opts;
  const { live, teamId } = useLiveData();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const openDialog = useCallback(() => setOpen(true), []);
  const closeDialog = useCallback(() => setOpen(false), []);
  const todosQ = useTodos(teamId, live);
  const projectsQ = useProjects(teamId, live);
  // #389 gated 面：非 board 路由（AppSidebar 全局 dialog）不开窗不发请求；
  // board 传 eager 保持原 eager 行为字节不变。
  const dataOn = live && (eager || open);
  const membersQ = useMembers(teamId, dataOn);
  // machines 双消费（#311 提及面 + #682 机器 chip）——mentions=false 的面
  // （project 页）chip 也要数据，故只随 open 门控；skills 仍仅提及面。
  const machinesQ = useMachines(teamId, dataOn);
  const skillsQ = useSkills(teamId, dataOn && mentions);
  const mutations = useApiMutations(teamId);

  // M7 #310 附件：live 创建面把 spec 提到此处,附件 token 才能注入。
  // 新建对话框关闭 = 直接清空（持久化场景下再次打开应从空开始）。
  const [liveSpec, setLiveSpec] = useState('');

  // #640：保存并开始的第二跳 = 直发总管编排回合（指派由总管按职责文本
  // 裁定，入口不再吃 firstAgentId）。
  const { orchestrate } = useOrchestrateStart();

  // spec 15 #394：提交 = 正文单字段。标题不再采集——live 面 wire 上 title
  // 恒空串由 server 派生占位（首行截断），agent 接单后回填；fixture 面 =
  // onFixtureSave → localTodo 内同一 shared 规则派生。
  // 保存缺省解析（#176 + #404 参数位）：dialog 选中项目优先；未选（空集/
  // 查询未决）退锚定页路由项目（project），再退首行真值。锚恒在位 ⇒ 两
  // 保存路径的「无项目建默认项目」分支不可达（board/全局面无锚，原样可达）。
  const resolveProjectId = useCallback(
    (selectedProjectId?: string) => selectedProjectId ?? anchorProjectId ?? projectsQ.data?.[0]?.id,
    [anchorProjectId, projectsQ.data],
  );
  const createTodo = useCallback(
    (spec: string, selectedProjectId?: string) => {
      setOpen(false);
      // 提交后清空 spec,下次打开新建对话框从空开始
      setLiveSpec('');
      if (live) {
        const projectId = resolveProjectId(selectedProjectId);
        if (projectId) {
          // #638：dialog 提交即关（上方 setOpen），失败不能再静默——toast。
          mutations.createTodo.mutate(
            { projectId, spec },
            { onError: (error) => toastError(t('新建任务失败，请重试。'), error) },
          );
          return;
        }
        // 无项目：先建默认托管项目再落任务（self-host 单用户语义 [设计]，
        // 02 §3 项目创建流两分支的 hosted 侧）。
        mutations.createProject.mutate(
          { name: t('默认项目'), repoKind: 'hosted' },
          {
            onSuccess: (p) =>
              mutations.createTodo.mutate(
                { projectId: p.id, spec },
                { onError: (error) => toastError(t('新建任务失败，请重试。'), error) },
              ),
            onError: (error) => toastError(t('创建项目失败，请重试。'), error),
          },
        );
        return;
      }
      onFixtureSave?.(spec);
    },
    [live, resolveProjectId, mutations.createTodo, mutations.createProject, onFixtureSave, t],
  );

  // 保存并开始（r2 §4.2 双钮语义；#640 / r14 §5.7 前置裁决落地）：创建 →
  // 直发总管编排回合（POST /todos/:id/orchestrate，替换原写死 withPlan:true
  // 的 plan 步）——总管直接规划、按活的类型派发，入口不给选择。T0 反馈 =
  // toast + 查看会话深链（use-orchestrate-start.ts）。fixture 面 = 同 保存。
  const createAndStart = useCallback(
    (spec: string, selectedProjectId?: string) => {
      setOpen(false);
      setLiveSpec('');
      if (!live) {
        createTodo(spec, selectedProjectId);
        return;
      }
      const start = (projectId: string) =>
        mutations.createTodo.mutate(
          { projectId, spec },
          {
            onSuccess: (created) =>
              orchestrate(
                { id: created.id, seqNum: created.seqNum },
                { savedTitle: t('已保存，交给总管编排') },
              ),
            // #638：编排腿自带失败 toast（use-orchestrate-start），创建腿此前
            // 静默——「保存并开始」点了没反应即此面。
            onError: (error) => toastError(t('新建任务失败，请重试。'), error),
          },
        );
      const projectId = resolveProjectId(selectedProjectId);
      if (projectId) start(projectId);
      else
        mutations.createProject.mutate(
          { name: t('默认项目'), repoKind: 'hosted' },
          {
            onSuccess: (p) => start(p.id),
            onError: (error) => toastError(t('创建项目失败，请重试。'), error),
          },
        );
    },
    [
      live,
      createTodo,
      mutations.createTodo,
      mutations.createProject,
      resolveProjectId,
      orchestrate,
      t,
    ],
  );

  // M7 #310 附件 wire：live 创建面 spec 由本 hook 持 state,token 才能注入。
  // fixture 面不传 → dialog 内部 useState fallback,行为字节不变。
  // #729 契约收窄：本面只管 grant+upload 与失败 toast，返回成功文件的
  // token；注入 spec（行原子、粘贴落 caret 位）由 dialog 的 runAttachment
  // 统一做——与 detail composer 共享同一插入函数，两面不漂移（失败方式 9）。
  const onAttachment = useCallback(
    async (files: File[]) => {
      const tokens: string[] = [];
      for (const file of files) {
        try {
          const r = await attachFile({ file, scope: 'spec' });
          tokens.push(r.token);
        } catch (err) {
          console.error('attachment failed', file.name, err);
          toast.error(t(attachmentFailureTitle(err)), { description: file.name });
        }
      }
      return tokens;
    },
    [t],
  );

  // #176 新建任务 dialog 项目选择器数据位:live = projectsQ 真值投影
  // (undefined = 查询未决);fixture = scenario projectNames(缺省 =
  // undefined → dialog 退 canon 单默认项目)。选择是纯表单 state。
  // #404 锚定页（project）：live 未决退空集（不退 canon 幻影行），锚行
  // 置首——dialog 未动选择的默认行 = rows[0] = 本页路由项目（#305 律，
  // fixture 面同律）。
  const projectRows = useMemo(() => {
    let rows: { id: string; name: string }[] | undefined;
    if (live) {
      rows =
        anchorProjectId === undefined
          ? projectsQ.data?.map((p) => ({ id: p.id, name: p.name }))
          : (projectsQ.data ?? []).map((p) => ({ id: p.id, name: p.name }));
    } else if (fixture.projectNames != null) {
      rows = Object.entries(fixture.projectNames).map(([id, name]) => ({ id, name }));
    }
    if (rows !== undefined && anchorProjectId !== undefined) {
      rows = [
        ...rows.filter((row) => row.id === anchorProjectId),
        ...rows.filter((row) => row.id !== anchorProjectId),
      ];
    }
    return rows;
  }, [live, projectsQ.data, fixture.projectNames, anchorProjectId]);

  // #311 mention picker groups: the new-task dialog needs the same entity
  // set the composer surfaces. Live pulls the canonical REST hooks; fixture
  // derives from the local scenario (resources carries skills + machines;
  // team roster carries agents; projectNames drives projects). When the
  // live hooks are still loading, fall back to the empty rows so the picker
  // still opens with a 0 count.
  const liveTodoSet: WireTodo[] = todosQ.data ?? [];
  const fixtureTodos = fixtureTodosOpt ?? fixture.todos;
  const mentionGroups: MentionGroups = live
    ? {
        todo: liveTodoSet.map((t) => ({
          id: t.id,
          label: `#${t.seqNum} ${t.title}`,
          seq: t.seqNum,
          subtitle: t.phase,
        })),
        agent: (membersQ.data ?? [])
          .filter((m) => m.memberType === 'agent')
          .map((m) => ({
            id: m.actorId,
            label: (m.actor as { displayName?: string } | undefined)?.displayName ?? m.actorId,
            subtitle:
              (m.actor as { description?: string | null } | undefined)?.description ?? undefined,
          })),
        project: (projectsQ.data ?? []).map((p) => ({ id: p.id, label: p.name })),
        skill: (skillsQ.data ?? []).map((s) => ({
          id: s.id,
          label: s.name,
          subtitle: s.description ?? undefined,
        })),
        machine: (machinesQ.data ?? []).map((m) => ({ id: m.id, label: m.name })),
      }
    : {
        todo: fixtureTodos.map((t) => ({
          id: t.id,
          label: `#${t.seqNum} ${t.title}`,
          seq: t.seqNum,
          subtitle: t.phase,
        })),
        agent: (fixture.team?.agents ?? []).map((a) => ({
          id: a.id,
          label: a.displayName,
          subtitle: a.role ?? a.model,
        })),
        project: Object.entries(fixture.projectNames ?? {}).map(([id, name]) => ({
          id,
          label: name,
        })),
        skill: (fixture.resources?.skills ?? []).map((s) => ({
          id: s.name,
          label: s.name,
          subtitle: s.description,
        })),
        machine: (fixture.resources?.machines ?? []).map((m) => ({
          id: m.name,
          label: m.name,
        })),
      };

  const dialogProps: NewTaskDialogProps = {
    open,
    onClose: closeDialog,
    onSave: createTodo,
    onSaveAndStart: live ? createAndStart : undefined,
    projects: projectRows,
    // XMON-87 选择记忆:全局面(board / 侧栏)记住上次选的项目;锚定面
    // (#404 project 页)不记忆——那面的未动选择按 #305 律恒等于本页路由
    // 项目(锚行置首),全局记忆会把页面语义顶掉。
    ...(anchorProjectId === undefined ? { rememberProject: true } : {}),
    ...(live ? { spec: liveSpec, onSpecChange: setLiveSpec, onAttachment } : {}),
    ...(mentions ? { mentionGroups } : {}),
  };
  return { openDialog, dialogProps };
}
