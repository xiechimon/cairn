import {
  type AskUserAnswer,
  CHIEF_INPUT_PLACEHOLDER,
  CHIEF_INPUT_PLACEHOLDER_STEERING,
} from '@cairn/shared';
import { CircleDashed, TriangleAlert } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useConnected } from '../api/connection-state.js';
import { useMachines, useMembers, useProjects, useSkills, useTodos } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { ProjectAvatar } from '../board/project-avatar.js';
import { useProjectMark } from '../board/project-mark.js';
import { FadeScrollerViewport } from '../components/chat/fade-scroller-viewport.js';
import { FOLLOW_THRESHOLD, JumpToLatestButton } from '../components/chat/jump-to-latest.js';
import { useLiveSeconds } from '../components/chat/live-row.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { machineSecondary } from '../components/machine-label.js';
import { QueuedCapsules } from '../components/queued-capsules.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  useMessageScroller,
  useMessageScrollerScrollable,
} from '../components/ui/message-scroller.js';
import { type TodoGlance, TodoGlanceContext } from '../detail/segments.js';
import type { ChiefContent, ChiefStreamItem, Phase } from '../fixtures/records.js';
import { useScrollFade } from '../hooks/use-scroll-fade.js';
import { useI18n } from '../i18n/provider.js';
import {
  ArrowDown,
  BarChart3,
  ChevronDown,
  ChiefFolder,
  ChiefGear,
  ChiefUserPlus,
  Grid2x2,
  Minus,
  RuntimeClaudeCode,
  RuntimePi,
} from '../icons/index.js';
import { uploadMessageAttachments } from '../overlay/attachment-paste.js';
import type { MentionGroups } from '../overlay/mention-token.js';
import { useServerDraft } from '../overlay/use-server-draft.js';
import { ChiefEarlierLoader } from './chief-earlier-loader.js';
import { ChiefStreamRow, chiefStreamRowKey, TurnElapsedContext } from './chief-message-rows.js';
import {
  ChiefConnectionBanner,
  ChiefFallbackBanner,
  ChiefOutageBanner,
} from './chief-outage-banner.js';
import { serverDraftBinding } from './composer-binding.js';
import {
  ComposerSurface,
  type ComposerSurfaceHandle,
  PROJECT_CHIP_CLS,
} from './composer-surface.js';
import { outstandingReportIds } from './outstanding-reports.js';
import { ProjectMenu } from './project-menu.js';
import type { ChiefEarlier } from './use-chief-surface.js';

const HEAD_ICON_BTN_CLS =
  "size-6 cursor-pointer justify-center rounded-none border-none bg-transparent p-0 text-(--text-tertiary) hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-(--text-tertiary) [&_svg:not([class*='size-'])]:size-auto";

const SCROLLER_ROOT_CLS = 'h-auto min-h-0 flex-1';
const SCROLLER_CONTENT_CLS = 'block gap-0 px-4 pt-3.5';
const SCROLLER_CONTENT_HOME_CLS = 'mx-auto block w-full max-w-190 gap-0 px-4 pt-3.5';

const EXAMPLE_ICONS = {
  'user-plus': ChiefUserPlus,
  folder: ChiefFolder,
  grid: Grid2x2,
  bars: BarChart3,
} as const;

export const CHIEF_DRAFT_STORAGE_KEY = 'cairn.chief-draft';
export const CHIEF_PROJECT_STORAGE_KEY = 'cairn.chief-project';

export function ChiefFollowArmed({ onAtBottom }: { onAtBottom: (atBottom: boolean) => void }) {
  const scrollable = useMessageScrollerScrollable();
  useEffect(() => {
    onAtBottom(!scrollable.end);
  }, [scrollable.end, onAtBottom]);
  return null;
}

export function ChiefScrollProvider({
  open = true,
  children,
}: {
  open?: boolean;
  children: React.ReactNode;
}) {
  const [atBottom, setAtBottom] = useState(true);
  return (
    <MessageScrollerProvider
      autoScroll={open && atBottom}
      scrollEdgeThreshold={FOLLOW_THRESHOLD}
      defaultScrollPosition="end"
    >
      <ChiefFollowArmed onAtBottom={setAtBottom} />
      {children}
    </MessageScrollerProvider>
  );
}

export type ChiefConversationVariant = 'drawer' | 'global';

export interface ChiefConversationProps {
  variant: ChiefConversationVariant;
  open?: boolean;
  chief: ChiefContent;
  onSettings?: () => void;
  onClose?: () => void;
  onSend?: (text: string, projectId: string | null) => void | Promise<void>;
  onRewind?: (messageId: string) => void;
  onAnswerQuestion?: (input: { requestId: string; answers: AskUserAnswer[] }) => void;
  onCancelQuestion?: (requestId: string) => void;
  onWithdraw?: (messageId: string) => Promise<void>;
  onSteer?: (messageId: string) => void;
  onStop?: () => void;
  earlier?: ChiefEarlier;
  hero?: ReactNode;
  below?: ReactNode;
  heroCollapsed?: boolean;
  todoGlances?: ReadonlyMap<string, TodoGlance>;
  composerRef?: (node: HTMLTextAreaElement | null) => void;
  day?: { earlier: number; today: ReactNode };
  lead?: ReactNode;
  draftStorageKey?: string;
  initialDraft?: string;
  prefill?: { text: string; key: number } | null;
  placeholder?: string;
  composerError?: string | null;
  composerReplacement?: ReactNode;
  composerTools?: ReactNode;
  targetPlaceholder?: string | null;
  showBindGate?: boolean;
}

export function ChiefConversation({
  variant,
  chief,
  open = true,
  onSettings,
  onClose,
  onSend,
  onRewind,
  onAnswerQuestion,
  onCancelQuestion,
  onWithdraw,
  onSteer,
  onStop,
  earlier,
  hero,
  below,
  heroCollapsed = false,
  todoGlances,
  composerRef,
  day,
  lead,
  draftStorageKey = CHIEF_DRAFT_STORAGE_KEY,
  initialDraft = '',
  prefill = null,
  placeholder,
  composerError = null,
  composerReplacement,
  composerTools,
  targetPlaceholder = null,
  showBindGate = true,
}: ChiefConversationProps) {
  const projectMark = useProjectMark();
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const todosQ = useTodos(teamId, live);
  const membersQ = useMembers(teamId, live);
  const projectsQ = useProjects(teamId, live);
  const skillsQ = useSkills(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const mentionGroups: MentionGroups = {
    todo: (todosQ.data ?? []).map((td) => ({
      id: td.id,
      label: `#${td.seqNum} ${td.title}`,
      seq: td.seqNum,
      subtitle: td.phase,
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
    machine: (machinesQ.data ?? []).map((m) => ({
      id: m.id,
      label: m.name,
      subtitle: machineSecondary(m, machinesQ.data ?? []) ?? undefined,
    })),
  };
  const projectOptions = useMemo(
    () =>
      (projectsQ.data ?? []).map((p) => ({ id: p.id, name: p.name, description: p.description })),
    [projectsQ.data],
  );
  const [storedProjectId, setStoredProjectId] = useState(() => {
    if (!live) return null;
    try {
      return localStorage.getItem(CHIEF_PROJECT_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const pickedProject = projectOptions.find((p) => p.id === storedProjectId) ?? null;
  const chipVisible = variant !== 'global' && onSend != null && projectOptions.length > 1;
  const pickProject = useCallback((projectId: string | null) => {
    setStoredProjectId(projectId);
    try {
      if (projectId === null) localStorage.removeItem(CHIEF_PROJECT_STORAGE_KEY);
      else localStorage.setItem(CHIEF_PROJECT_STORAGE_KEY, projectId);
    } catch {}
  }, []);
  const chipProjectId = chipVisible ? (pickedProject?.id ?? null) : null;
  const onAttachment =
    onSend != null ? (files: File[]) => uploadMessageAttachments(files, t) : undefined;
  const { scrollToEnd } = useMessageScroller();
  const followSentRef = useRef(false);
  const latestUserKeyRef = useRef<string | number | null>(null);
  const userKeyAtSendRef = useRef<string | number | null>(null);
  const prevThreadRef = useRef(chief.threadTitle);
  useEffect(() => {
    if (prevThreadRef.current === chief.threadTitle) return;
    prevThreadRef.current = chief.threadTitle;
    if (open) scrollToEnd();
  }, [chief.threadTitle, open, scrollToEnd]);
  const [rewindConfirm, setRewindConfirm] = useState<{ index: number; id: string | null } | null>(
    null,
  );
  const [toolsOpen, setToolsOpen] = useState<Set<number>>(() => new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyText = useCallback((key: string, text: string) => {
    const clip = navigator.clipboard;
    if (!clip) return;
    void clip.writeText(text).then(
      () => {
        setCopiedKey(key);
        window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);
      },
      () => {},
    );
  }, []);
  const toggleTools = useCallback(
    (i: number) =>
      setToolsOpen((cur) => {
        const next = new Set(cur);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        return next;
      }),
    [],
  );
  const requestRewind = useCallback(
    (index: number, id: string | null) => setRewindConfirm({ index, id }),
    [],
  );
  const [liveDraft, setLiveDraft] = useServerDraft({
    teamId,
    scope: 'chief',
    localKey: draftStorageKey,
    enabled: live,
    initial: initialDraft,
  });
  const stopTurnRef = useRef<(() => void) | undefined>(undefined);
  const surfaceRef = useRef<ComposerSurfaceHandle | null>(null);
  const composerBinding = serverDraftBinding(
    onSend != null ? liveDraft : (chief.draft ?? ''),
    onSend != null ? setLiveDraft : undefined,
  );
  const sendFromComposer =
    onSend == null
      ? undefined
      : (text: string) => {
          followSentRef.current = true;
          userKeyAtSendRef.current = latestUserKeyRef.current;
          const sent = onSend(text, chipProjectId);
          Promise.resolve(sent).catch(() => {
            followSentRef.current = false;
          });
          return sent;
        };
  useEffect(() => {
    if (open) return;
    setRewindConfirm(null);
  }, [open]);
  const prefillKey = prefill?.key;
  const prefillText = prefill?.text;
  useEffect(() => {
    if (prefillKey == null || prefillText == null) return;
    setLiveDraft(prefillText);
    surfaceRef.current?.focus({ preventScroll: true });
  }, [prefillKey, prefillText]);
  const home = variant !== 'drawer';
  const ownHeader = variant !== 'global';
  const glances = useMemo(
    () =>
      todoGlances ??
      new Map(
        (todosQ.data ?? []).map((td) => [
          td.id,
          { phase: td.phase as Phase, seq: td.seqNum, title: td.title },
        ]),
      ),
    [todoGlances, todosQ.data],
  );
  const empty = (chief.stream?.length ?? 0) === 0;
  const heroLayout = home && empty && !heroCollapsed;
  const heroScrollRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  useScrollFade(heroScrollRef, { enabled: heroLayout });
  const canStop = targetPlaceholder === null && chief.running === true && onStop != null;
  const liveTurn =
    chief.running === true
      ? chief.stream?.findLast((item) => item.kind === 'streaming')
      : undefined;
  const connected = useConnected();
  const turnTick = useLiveSeconds(liveTurn?.kind === 'streaming' ? liveTurn.startedAt : null);
  const turnElapsed =
    turnTick ?? (liveTurn?.kind === 'streaming' ? liveTurn.seconds : undefined) ?? null;
  const withdraw =
    onWithdraw == null
      ? undefined
      : (messageId: string, text: string) => {
          onWithdraw(messageId).then(
            () => {
              followSentRef.current = false;
              setLiveDraft((cur) => (cur === '' ? text : `${cur}\n${text}`));
              surfaceRef.current?.focus({ preventScroll: true });
            },
            () => {},
          );
        };
  const waitingTurn = chief.waitingTurn;
  const stopTurn =
    waitingTurn !== undefined && withdraw !== undefined
      ? () => withdraw(waitingTurn.messageId, waitingTurn.text)
      : onStop;
  stopTurnRef.current = stopTurn;
  const allRows = (chief.stream ?? []).map((item, i) => ({ item, i }));
  const rows = allRows.filter(({ item }) => item.kind !== 'user' || item.pending == null);
  const latestMessage = rows.findLast(
    ({ item }) => item.kind === 'user' || (item.kind === 'robot' && item.typing !== true),
  );
  const latestUser = rows.findLast(({ item }) => item.kind === 'user');
  const latestUserKey =
    latestUser == null ? null : chiefStreamRowKey(latestUser.item, latestUser.i);
  latestUserKeyRef.current = latestUserKey;
  const keyAtSend = userKeyAtSendRef.current;
  const sentRowPosition =
    keyAtSend == null
      ? -1
      : rows.findIndex(({ item, i }) => chiefStreamRowKey(item, i) === keyAtSend);
  const latestUserPosition = latestUser == null ? -1 : rows.indexOf(latestUser);
  useLayoutEffect(() => {
    if (!followSentRef.current || latestUserPosition < 0) return;
    if (keyAtSend != null && sentRowPosition < 0) {
      followSentRef.current = false;
      return;
    }
    if (latestUserPosition <= sentRowPosition) return;
    followSentRef.current = false;
    scrollToEnd();
  }, [latestUserKey, keyAtSend, sentRowPosition, latestUserPosition, scrollToEnd]);
  const queuedCapsules = allRows.flatMap(({ item }) =>
    item.kind === 'user' && item.pending != null && item.id != null
      ? [
          {
            id: item.id,
            content: item.text,
            ...(item.pending === 'held' ? { note: t('已存下，Coordinator 恢复后会处理') } : {}),
            held: item.pending === 'held',
          },
        ]
      : [],
  );
  const outstandingReports = outstandingReportIds(chief.stream ?? []);
  const streamRow = ({ item, i }: { item: ChiefStreamItem; i: number }) => (
    <ChiefStreamRow
      key={chiefStreamRowKey(item, i)}
      item={item}
      index={i}
      latest={i === latestMessage?.i}
      replyable={item.kind === 'thread-report' && outstandingReports.has(item.id)}
      bound={chief.bound}
      agent={chief.agent}
      runningTool={chief.runningTool}
      copiedKey={copiedKey}
      onCopy={copyText}
      toolsOpen={toolsOpen}
      onToggleTools={toggleTools}
      onRewindRequest={requestRewind}
      onAnswerQuestion={onAnswerQuestion}
      onCancelQuestion={onCancelQuestion}
    />
  );
  const renderRows = (list: { item: ChiefStreamItem; i: number }[]) => list.map(streamRow);
  const intro = (
    <>
      {!chief.bound && showBindGate && (
        <div
          data-testid="chief-gate"
          className={`${home ? 'mx-auto mt-4 w-[calc(100%-2rem)] max-w-182' : 'mx-4'} flex h-14 flex-none items-center gap-3 rounded-(--radius-card) bg-(--card) pr-3 pl-4 text-ui text-(--text-secondary) ring-1 ring-(--border)`}
        >
          <span>{t('请先为 Coordinator 选择一个 Agent。')}</span>
          <Button
            className={`ml-auto cursor-pointer ${DIALOG_PRIMARY_BUTTON}`}
            onClick={onSettings}
          >
            {t('设置')}
          </Button>
        </div>
      )}
      {chief.examples && (
        <div className="flex-none">
          <h2
            className={`text-center font-heading text-heading font-title text-(--foreground) ${
              chief.bound ? 'mt-14' : 'mt-16'
            }`}
          >
            {t('选择一个主题开始')}
          </h2>
          <div
            className={`${home ? 'mx-auto w-[calc(100%-2rem)] max-w-182 grid-cols-1 sm:grid-cols-2' : 'mx-8 grid-cols-2'} mt-3 mb-4 grid gap-2.5`}
            data-testid="chief-examples"
          >
            {chief.examples.map((ex) => {
              const Icon = EXAMPLE_ICONS[ex.icon];
              return (
                <Button
                  variant="ghost"
                  className="h-auto min-h-16 w-full cursor-pointer justify-start gap-3 rounded-(--radius-card) border-none bg-(--card) px-3 py-3 text-left whitespace-normal font-normal ring-1 ring-(--border) hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover) aria-expanded:bg-transparent [&_svg:not([class*='size-'])]:size-auto"
                  key={ex.text}
                  onClick={onSend != null ? () => void onSend(ex.text, chipProjectId) : undefined}
                >
                  <span className="flex size-6 flex-none items-center justify-center text-(--text-secondary)">
                    <Icon width={18} height={18} />
                  </span>
                  <span className="text-ui leading-5 text-(--foreground)">{t(ex.text)}</span>
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
  return (
    <>
      {ownHeader && (
        <header
          className={
            home
              ? 'relative mx-auto w-full max-w-190 flex-none px-4 pt-3 pb-2'
              : 'relative px-4 pt-1 pb-3'
          }
        >
          <div className="flex items-center">
            <h2 className="m-0 min-w-0 truncate font-heading text-heading font-title text-(--foreground)">
              {t('Coordinator')}
            </h2>
            <div className="ml-auto flex items-center gap-2.5">
              {onSettings != null && (
                <IconTooltip
                  label={t('Coordinator 设置')}
                  side="bottom"
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      className={HEAD_ICON_BTN_CLS}
                      onClick={onSettings}
                    />
                  }
                >
                  <ChiefGear />
                </IconTooltip>
              )}
              {onClose != null && (
                <IconTooltip
                  label={t('最小化')}
                  side="bottom"
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      className={HEAD_ICON_BTN_CLS}
                      onClick={onClose}
                    />
                  }
                >
                  <Minus width={16} height={16} />
                </IconTooltip>
              )}
            </div>
          </div>
          {chief.bound && (
            <div
              className="mt-1 flex items-center gap-1 text-meta text-(--text-tertiary)"
              data-testid="chief-model-row"
            >
              <span className="flex min-w-0 items-center gap-1 px-1">
                <span className="inline-flex flex-none items-center">
                  {(chief.modelProvider ?? 'pi') === 'claude-code' ? (
                    <RuntimeClaudeCode width={12} height={12} />
                  ) : (
                    <RuntimePi width={12} height={12} />
                  )}
                </span>
                {chief.fallbackModel != null ? (
                  <>
                    <span className="min-w-0 truncate">
                      {t('备用模型 {model}', { model: chief.fallbackModel })}
                    </span>
                    <span
                      aria-hidden="true"
                      data-testid="chief-fallback-dot"
                      className="ml-0.5 size-1.5 flex-none rounded-full bg-(--badge-attention)"
                    />
                    <span className="sr-only">{t('，主模型暂时用不了')}</span>
                  </>
                ) : (
                  <span className="min-w-0 truncate">{chief.modelSlot}</span>
                )}
              </span>
            </div>
          )}
        </header>
      )}

      {heroLayout ? (
        <div
          ref={heroScrollRef}
          data-testid="chief-home-scroll"
          className="scroll-fade min-h-0 flex-1 overflow-y-auto pb-6"
        >
          {hero}
          {intro}
          {below}
        </div>
      ) : (
        <>
          {intro}
          <MessageScroller className={SCROLLER_ROOT_CLS}>
            <FadeScrollerViewport reserveEnd ref={viewportRef} data-testid="chief-body">
              <MessageScrollerContent
                className={home ? SCROLLER_CONTENT_HOME_CLS : SCROLLER_CONTENT_CLS}
                data-testid="chief-stream"
              >
                <TurnElapsedContext.Provider value={variant !== 'global'}>
                  <TodoGlanceContext.Provider value={glances}>
                    {lead}
                    {day == null ? (
                      renderRows(rows)
                    ) : (
                      <>
                        <div data-testid="chief-earlier" className="opacity-60">
                          {renderRows(rows.slice(0, day.earlier))}
                        </div>
                        {day.today}
                        {renderRows(rows.slice(day.earlier))}
                      </>
                    )}
                  </TodoGlanceContext.Provider>
                </TurnElapsedContext.Provider>
              </MessageScrollerContent>
            </FadeScrollerViewport>
            <JumpToLatestButton>
              <ArrowDown width={16} height={16} />
              <span className="sr-only">{t('滚动到最新')}</span>
            </JumpToLatestButton>
            {earlier != null && (
              <ChiefEarlierLoader
                earlier={earlier}
                hasEarlier={chief.hasEarlier === true}
                rowCount={rows.length}
                viewportRef={viewportRef}
              />
            )}
          </MessageScroller>
        </>
      )}

      {!connected ? (
        <ChiefConnectionBanner />
      ) : chief.outage != null ? (
        <ChiefOutageBanner outage={chief.outage} onSettings={onSettings} />
      ) : (
        chief.fallbackModel != null && (
          <ChiefFallbackBanner model={chief.fallbackModel} onSettings={onSettings} />
        )
      )}
      {composerReplacement ?? (
        <>
          {composerError != null && (
            <p
              role="alert"
              data-testid="chief-composer-error"
              className={`${home ? 'mx-auto w-[calc(100%-2rem)] max-w-182' : 'mx-4'} mt-2 mb-0 flex items-center gap-1.5 text-meta text-destructive`}
            >
              <TriangleAlert aria-hidden="true" className="size-3.5 flex-none" />
              {composerError}
            </p>
          )}
          <ComposerSurface
            handleRef={surfaceRef}
            binding={composerBinding}
            editable={onSend != null}
            onSend={sendFromComposer}
            onAttachment={onAttachment}
            mentionGroups={mentionGroups}
            onPickProject={chipVisible ? (p) => pickProject(p.id) : undefined}
            slash={{
              reviewAvailable: false,
              stopAvailable: targetPlaceholder === null && chief.running === true && onStop != null,
              onStop: () => stopTurnRef.current?.(),
            }}
            placeholder={
              targetPlaceholder ??
              (chief.outage != null
                ? t('可以继续说，Coordinator 恢复后会按顺序处理…')
                : chief.running === true
                  ? t(CHIEF_INPUT_PLACEHOLDER_STEERING)
                  : (placeholder ?? t(CHIEF_INPUT_PLACEHOLDER)))
            }
            invalid={composerError != null}
            home={home}
            open={open}
            composerRef={composerRef}
            above={
              <QueuedCapsules
                messages={queuedCapsules}
                onSendNow={onSteer ? (id) => onSteer(id) : undefined}
                onRemove={withdraw}
                removeLabel={t('撤回')}
              />
            }
            tools={
              <>
                {composerTools}
                {chipVisible && (
                  <ProjectMenu
                    title="发给哪个项目"
                    projects={projectOptions}
                    value={pickedProject?.id ?? null}
                    withAuto
                    side="top"
                    onPick={pickProject}
                    trigger={
                      <Button
                        variant="ghost"
                        data-testid="chief-project-chip"
                        data-set={pickedProject != null ? '' : undefined}
                        aria-label={t('发给哪个项目：{name}', {
                          name: pickedProject?.name ?? t('自动，由 Coordinator 判断'),
                        })}
                        className={PROJECT_CHIP_CLS}
                      />
                    }
                  >
                    {pickedProject != null ? (
                      <ProjectAvatar
                        name={pickedProject.name}
                        tone={projectOptions.indexOf(pickedProject)}
                        icon={projectMark(pickedProject.id).icon}
                        color={projectMark(pickedProject.id).color}
                        bare
                      />
                    ) : (
                      <CircleDashed className="size-4 flex-none" />
                    )}
                    <span className="truncate">{pickedProject?.name ?? t('自动')}</span>
                    <ChevronDown width={12} height={12} />
                  </ProjectMenu>
                )}
              </>
            }
            canStop={canStop}
            onStop={stopTurn}
            running={chief.running === true}
            turnElapsed={turnElapsed}
          />
        </>
      )}
      <DialogShell
        title={t('恢复到此处')}
        open={rewindConfirm !== null}
        onClose={() => setRewindConfirm(null)}
        size="s"
        footer={
          <>
            <Button
              variant="ghost"
              className={DIALOG_TEXT_BUTTON}
              onClick={() => setRewindConfirm(null)}
            >
              {t('取消')}
            </Button>
            <Button
              className={DIALOG_PRIMARY_BUTTON}
              onClick={() => {
                const anchor = rewindConfirm;
                setRewindConfirm(null);
                if (anchor?.id != null) onRewind?.(anchor.id);
              }}
            >
              {t('恢复到此处')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="m-0 text-ui text-foreground">
            {t('恢复到此处？该条之后的 {n} 条消息会移除，Coordinator 从这条重发开新回合。', {
              n: Math.max(0, (chief.stream?.length ?? 0) - (rewindConfirm?.index ?? 0) - 1),
            })}
          </p>
        </div>
      </DialogShell>
    </>
  );
}
