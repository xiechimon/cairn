import {
  AGENT_PERMISSION_COPY,
  AGENT_TOOL_COPY,
  AGENT_TOOL_SWITCHES,
  type AgentMachineFitRow,
  type AgentRecord,
  MEMORY_QUOTA_PER_AGENT,
  MEMORY_UI_COPY,
  type PatchAgentBody,
  THINKING_LEVELS,
} from '@cairn/shared';
import { cn } from 'cn';
import { Brain, SearchX } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  useAgent,
  useAgentMachineFit,
  useAgentTasks,
  useApiMutations,
  useCapabilities,
  useMachines,
  useMcpServers,
  useMemories,
  useModelSources,
  useSecrets,
  useSkills,
} from '../api/hooks.js';
import { toModelOptions, toThinkingLevelDisplay } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import { ProfileHeader, useEditorFocus } from '../components/profile-card.js';
import { SegmentedTabs } from '../components/segmented.js';
import {
  SETTINGS_HINT_CLS,
  SETTINGS_ROW_CLS,
  SETTINGS_SELECT_TRIGGER_CLS,
  SETTINGS_VALUE_EDITOR_CLS,
  SettingsCard,
  SettingsRow,
  SettingsSelectTrigger,
} from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../components/ui/input-group.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { Select, SelectContent, SelectItem, SelectValue } from '../components/ui/select.js';
import { StatusChip } from '../components/ui/status-chip.js';
import { Switch } from '../components/ui/switch.js';
import { Textarea } from '../components/ui/textarea.js';
import { toastError } from '../components/ui/toaster.js';
import { isDeleted, markDeleted } from '../fixtures/deletions.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { ArrowUpDown, ChevronDown, ChevronRight, Search, SquarePen } from '../icons/index.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { PageShell } from '../pages/shell.js';
import { PHASE_UI } from '../phase.js';
import { SECRETS_HREF } from '../resources/secrets-page.js';
import { FallbackModelsSection } from './agent-fallback-models.js';
import { AgentModelSelect, AgentRuntimeSelect } from './agent-model-select.js';

export const AGENTS_HREF = '/app/resources/agents';

const AGENT_ICON_EDIT_CLS = 'text-muted-foreground';

const AGENT_TASK_ROW_CLS =
  'agent-task-row h-auto w-full justify-start gap-2 px-4 py-2.5 text-left font-normal';

function machineFitHint(m: AgentMachineFitRow, t: TFunc): string {
  if (!m.online) return t('离线');
  if (!m.runtimeOk) return t('未开启该 Agent 所需的 runtime');
  if (m.missing !== null && m.missing.length > 0) {
    return t('缺 {missing}（在该机装齐即解锁）', { missing: m.missing.join('、') });
  }
  if (m.missing === null) return t('能力快照未上报——按可跑放行');
  if (m.mcpGaps !== null && m.mcpGaps.length > 0) {
    return t('可跑；声明的 MCP 缺 {gaps}（执行时跳过）', { gaps: m.mcpGaps.join('、') });
  }
  return t('可跑');
}

type AgentTab = 'overview' | 'memory' | 'permissions';

const TAB_LABELS: { id: AgentTab; label: string }[] = [
  { id: 'overview', label: '概览' },
  { id: 'memory', label: '记忆' },
  { id: 'permissions', label: '权限' },
];

const MEMORY_SORT_OPTIONS = ['默认', '添加时间'] as const;
type MemorySort = (typeof MEMORY_SORT_OPTIONS)[number];

const CLAUDE_CODE_THINKING_LEVELS: readonly string[] = [
  'off',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

function thinkingLevelsForProvider(
  provider: string | null,
  catalog: readonly string[],
): readonly string[] {
  if (provider !== 'claude-code') return catalog;
  return catalog.filter((level) => CLAUDE_CODE_THINKING_LEVELS.includes(level));
}

export function AgentDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const agentId = params.id;
  const { search } = useLocation();
  const navigate = useNavigate();
  const fixture = resolveScenario(new URLSearchParams(search));
  const { live, teamId } = useLiveData();

  const agentQ = useAgent(teamId, agentId, live);
  const agentTasksQ = useAgentTasks(teamId, agentId, live);
  const machineFitQ = useAgentMachineFit(teamId, agentId, live);
  const memoriesQ = useMemories(teamId, agentId, live);
  const modelSourcesQ = useModelSources(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const capabilitiesQ = useCapabilities(live);
  const skillsQ = useSkills(teamId, live);
  const secretsQ = useSecrets(teamId, live);
  const mcpQ = useMcpServers(teamId, live);
  const mutations = useApiMutations(teamId);

  const [tab, setTab] = useState<AgentTab>('overview');
  const [localPatch, setLocalPatch] = useState<Partial<AgentRecord>>({});
  const [removedMemories, setRemovedMemories] = useState<string[]>([]);
  const [memoryQuery, setMemoryQuery] = useState('');
  const [memorySort, setMemorySort] = useState<MemorySort>('默认');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const fixtureAgent = fixture.agents?.find((row) => row.id === agentId);
  const source = live ? agentQ.data : fixtureAgent;
  const agent: AgentRecord | undefined =
    source === undefined || (agentId !== undefined && isDeleted(agentId))
      ? undefined
      : { ...source, ...localPatch };

  const patch = useCallback(
    (body: PatchAgentBody) => {
      if (agentId === undefined) return;
      if (live) {
        mutations.patchAgent.mutate(
          { id: agentId, body },
          {
            onError: (error) => {
              if (
                'tools' in body ||
                'secrets' in body ||
                'skillsAllowlist' in body ||
                'mcpServers' in body
              )
                return;
              toastError(t('保存失败，请重试。'), error);
            },
          },
        );
      } else {
        setLocalPatch((prev) => ({ ...prev, ...body }));
      }
    },
    [agentId, live, mutations.patchAgent, t],
  );

  const modelOptions = live
    ? toModelOptions(modelSourcesQ.data?.sources ?? [])
    : toModelOptions(fixture.resources?.providerSources ?? []);

  const skillOptions = live
    ? (skillsQ.data ?? []).map((row) => ({ id: row.id, name: row.name }))
    : (fixture.resources?.skills ?? []).map((row) => ({ id: row.name, name: row.name }));

  const memories = (live ? (memoriesQ.data ?? []) : (fixture.resources?.memories ?? [])).filter(
    (row) => row.agentId === agentId && !removedMemories.includes(row.id),
  );

  const agentTasks = live ? (agentTasksQ.data ?? []) : (fixture.agentTasks ?? []);
  const agentTasksPending = live && agentTasksQ.isPending;

  const memoryNeedle = memoryQuery.trim().toLowerCase();
  const matchedMemories =
    memoryNeedle === ''
      ? memories
      : memories.filter((row) =>
          `${row.title}\n${row.content}`.toLowerCase().includes(memoryNeedle),
        );
  const visibleMemories =
    memorySort === '添加时间'
      ? [...matchedMemories].sort((a, b) => b.createdAt - a.createdAt)
      : matchedMemories;
  const secretIds = live
    ? (secretsQ.data ?? []).map((row) => row.id)
    : (fixture.resources?.secrets ?? []).map((row) => row.id);
  const mcpOptions = live
    ? (mcpQ.data ?? []).map((row) => ({ id: row.id, name: row.label }))
    : (fixture.resources?.mcpServers ?? []).map((row) => ({ id: row.name, name: row.name }));

  const failedPatchBody = mutations.patchAgent.variables?.body;
  const permSaveFailed =
    mutations.patchAgent.isError &&
    failedPatchBody !== undefined &&
    ('tools' in failedPatchBody ||
      'secrets' in failedPatchBody ||
      'skillsAllowlist' in failedPatchBody ||
      'mcpServers' in failedPatchBody);

  if (agent === undefined) {
    return (
      <PageShell route={AGENTS_HREF} title={t('Agent')} back="/app/team" fixture={fixture}>
        <div className="agent-detail flex flex-col gap-4">
          <p className="agent-missing text-sm text-muted-foreground">
            {t('找不到该 Agent。它可能已被删除。')}
          </p>
        </div>
      </PageShell>
    );
  }

  const toggleTool = (label: string, on: boolean) => {
    const next = on
      ? [...agent.tools, label].filter((v, i, all) => all.indexOf(v) === i)
      : agent.tools.filter((v) => v !== label);
    patch({ tools: next });
  };
  const toggleMcp = (id: string, on: boolean) => {
    const next = on ? [...agent.mcpServers, id] : agent.mcpServers.filter((v) => v !== id);
    patch({ mcpServers: next });
  };
  const toggleRequiredMcp = (id: string, on: boolean) => {
    const current = agent.requiredCapabilities ?? {};
    const nextMcp = on
      ? [...(current.mcpServers ?? []), id]
      : (current.mcpServers ?? []).filter((v) => v !== id);
    const hasModels = (current.models ?? []).length > 0;
    patch({
      requiredCapabilities:
        nextMcp.length === 0 && !hasModels ? null : { ...current, mcpServers: nextMcp },
    });
  };
  const toggleAllowlistSkill = (id: string, on: boolean) => {
    if (agent.skillsAllowlist === null) return;
    const next = on
      ? [...new Set([...agent.skillsAllowlist, id])]
      : agent.skillsAllowlist.filter((v) => v !== id);
    patch({ skillsAllowlist: next });
  };

  const defaultSkill = agent.defaultSkill;
  const runtimeValue = agent.provider === 'pi' ? null : agent.provider;
  const thinkingCatalog = capabilitiesQ.data?.thinkingLevels ?? THINKING_LEVELS;
  const thinkingOptions = thinkingLevelsForProvider(runtimeValue, thinkingCatalog);
  const thinkingLevel = toThinkingLevelDisplay(agent.thinkingLevel, thinkingOptions);

  return (
    <PageShell route={AGENTS_HREF} title={agent.displayName} back="/app/team" fixture={fixture}>
      <div className="agent-detail flex flex-col gap-4">
        <SegmentedTabs
          className="agent-tabs"
          optionHandle="agent-tab"
          label={t('Agent')}
          value={tab}
          onChange={setTab}
          options={TAB_LABELS.map((item) => ({ value: item.id, label: t(item.label) }))}
        />

        {tab === 'overview' && (
          <div className="agent-overview flex flex-col gap-3.5">
            <div className="flex flex-col gap-6">
              <ProfileHeader
                avatar={
                  <SeededAvatar
                    className="size-14"
                    name={agent.displayName}
                    src={agent.avatarUrl}
                    fallback="/avatar-robot-1.svg"
                  />
                }
                name={agent.displayName}
                sub={t('头像与名称')}
                onRename={(displayName) => patch({ displayName })}
                nameClassName="agent-name"
                editClassName="agent-name-edit"
                inputId="agent-name-input"
              />
              <SettingsCard>
                <RoleRow
                  value={agent.description}
                  onCommit={(description) => patch({ description })}
                />
                <SettingsRow
                  label={t('默认 skill')}
                  hint={t(AGENT_PERMISSION_COPY.defaultSkill)}
                  labelClassName="agent-field-label"
                >
                  <Select
                    value={defaultSkill}
                    onValueChange={(next) => patch({ defaultSkill: next })}
                  >
                    <SettingsSelectTrigger
                      className={cn('agent-skill-select', SETTINGS_SELECT_TRIGGER_CLS)}
                    >
                      <SelectValue>
                        {defaultSkill === null
                          ? t('未设置')
                          : (skillOptions.find((skill) => skill.id === defaultSkill)?.name ??
                            defaultSkill)}
                      </SelectValue>
                    </SettingsSelectTrigger>
                    <SelectContent aria-label={t('默认 skill')}>
                      <SelectItem value={null}>{t('未设置')}</SelectItem>
                      {skillOptions.map((skill) => (
                        <SelectItem key={skill.id} value={skill.id}>
                          {skill.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingsRow>
                <SettingsRow label={t('运行时')} labelClassName="agent-field-label">
                  <AgentRuntimeSelect
                    value={runtimeValue}
                    options={modelOptions}
                    onPick={(next) => {
                      if (next === runtimeValue) return;
                      const nextLevels = thinkingLevelsForProvider(next, thinkingCatalog);
                      const illegal =
                        agent.thinkingLevel !== null && !nextLevels.includes(agent.thinkingLevel);
                      patch({
                        provider: next,
                        modelId: null,
                        ...(illegal ? { thinkingLevel: null } : {}),
                      });
                    }}
                    prefix="agent-runtime"
                    triggerClassName={SETTINGS_SELECT_TRIGGER_CLS}
                  />
                </SettingsRow>
                <SettingsRow label={t('模型')} labelClassName="agent-field-label">
                  <AgentModelSelect
                    provider={runtimeValue}
                    modelId={agent.modelId}
                    options={modelOptions}
                    onPick={(next) => patch({ modelId: next })}
                    prefix="agent-model"
                    triggerClassName={SETTINGS_SELECT_TRIGGER_CLS}
                  />
                </SettingsRow>
                <SettingsRow label={t('思考强度')} labelClassName="agent-field-label">
                  <Select
                    value={thinkingLevel}
                    onValueChange={(next) => patch({ thinkingLevel: next })}
                  >
                    <SettingsSelectTrigger
                      className={cn('agent-thinking-select', SETTINGS_SELECT_TRIGGER_CLS)}
                    >
                      <SelectValue>
                        {thinkingLevel === null ? t('未设置') : thinkingLevel}
                      </SelectValue>
                    </SettingsSelectTrigger>
                    <SelectContent aria-label={t('思考强度')}>
                      <SelectItem value={null}>{t('未设置')}</SelectItem>
                      {thinkingOptions.map((level) => (
                        <SelectItem key={level} value={level}>
                          {level}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingsRow>
              </SettingsCard>
              <FallbackModelsSection
                serverChain={agent.fallbackModels ?? []}
                saveFailed={
                  mutations.patchAgent.isError &&
                  mutations.patchAgent.variables?.body.fallbackModels !== undefined
                }
                options={modelOptions}
                optionsReady={!live || modelSourcesQ.isSuccess}
                homeMachine={machinesQ.data?.find((row) => row.id === agent.machineId) ?? null}
                onChange={(fallbackModels) => patch({ fallbackModels })}
              />
            </div>
            <Card size="sm" className="agent-tasks gap-0 py-1.5">
              <p className="agent-tasks-head m-0 px-4 pb-0.5 pt-1 text-xs font-medium leading-4 text-muted-foreground">
                {t('进行中')}
                {agentTasks.length > 0 ? ` · ${agentTasks.length}` : ''}
              </p>
              {agentTasksPending ? null : agentTasks.length === 0 ? (
                <p className="agent-tasks-empty m-0 px-4 py-1.5 text-xs leading-4 text-muted-foreground">
                  {t('暂无进行中的任务')}
                </p>
              ) : (
                agentTasks.map((row) => {
                  const ui = PHASE_UI[row.state === 'waiting' ? 'queued' : row.todo.phase];
                  return (
                    <Button
                      key={row.buildId}
                      variant="ghost"
                      className={AGENT_TASK_ROW_CLS}
                      onClick={() => navigate(`/app/todo/${row.todo.id}`)}
                    >
                      <span className="agent-task-seq flex-none text-xs text-muted-foreground">
                        #{row.todo.seqNum}
                      </span>
                      <span className="agent-task-title min-w-0 flex-[1_1_auto] truncate text-sm text-foreground">
                        {row.todo.title}
                      </span>
                      <StatusChip tone={ui.tone}>{t(ui.chip)}</StatusChip>
                      <span
                        className="agent-task-go inline-flex flex-none text-muted-foreground"
                        aria-hidden="true"
                      >
                        <ChevronRight width={12} height={12} />
                      </span>
                    </Button>
                  );
                })
              )}
            </Card>
            <div className="agent-danger mt-1.5 flex">
              <Button
                variant="destructive"
                size="sm"
                className="agent-delete"
                onClick={() => setDeleteOpen(true)}
              >
                {t('删除 Agent')}
              </Button>
            </div>
          </div>
        )}

        {tab === 'memory' && (
          <div className="agent-memories flex flex-col gap-2">
            <p className="agent-memory-head m-0 text-meta text-content-tertiary">
              {t('记忆 · {n} / {max}', {
                n: memories.length,
                max: MEMORY_QUOTA_PER_AGENT,
              })}
            </p>
            {memories.length === 0 ? (
              <EmptyState
                icon={Brain}
                title={t('尚无记忆')}
                description={t('Agent 会在工作中将值得沉淀的经验存入此处。')}
                className="agent-memory-empty"
              />
            ) : (
              <>
                <div className="agent-memory-search flex flex-none items-center justify-between gap-2">
                  <InputGroup className="flex-1">
                    <InputGroupAddon>
                      <Search />
                    </InputGroupAddon>
                    <InputGroupInput
                      type="text"
                      placeholder={t(MEMORY_UI_COPY.searchPlaceholder)}
                      aria-label={t(MEMORY_UI_COPY.searchPlaceholder)}
                      value={memoryQuery}
                      onChange={(event) => setMemoryQuery(event.target.value)}
                    />
                  </InputGroup>
                  <span className="relative flex">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="outline" className="agent-memory-sort" />}
                      >
                        <ArrowUpDown data-icon="inline-start" />
                        <span>{t(MEMORY_UI_COPY.sort)}</span>
                        <ChevronDown width={12} height={12} className="size-3" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        side="bottom"
                        sideOffset={8}
                        aria-label={t(MEMORY_UI_COPY.sort)}
                        className="agent-memory-sort-menu w-auto min-w-37"
                      >
                        <DropdownMenuRadioGroup
                          value={memorySort}
                          onValueChange={(next) => setMemorySort(next as MemorySort)}
                        >
                          {MEMORY_SORT_OPTIONS.map((option) => (
                            <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                              <span>{t(option)}</span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </div>
                {visibleMemories.length === 0 ? (
                  <EmptyState
                    icon={SearchX}
                    title={t('没有匹配的记忆')}
                    description={t('换个关键词再试。')}
                    className="agent-memory-no-match"
                  />
                ) : (
                  <SettingsCard>
                    {visibleMemories.map((memory) => (
                      <div
                        key={memory.id}
                        className={cn(SETTINGS_ROW_CLS, 'agent-memory-row items-start gap-3')}
                      >
                        <span className="flex flex-1 flex-col">
                          <span className="agent-memory-title text-ui text-foreground">
                            {memory.title}
                          </span>
                          <span className="text-meta text-content-tertiary">{memory.content}</span>
                        </span>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => {
                            if (agentId === undefined) return;
                            if (live)
                              mutations.deleteMemory.mutate(
                                { agentId, memoryId: memory.id },
                                {
                                  onError: (error) =>
                                    toastError(t('删除记忆失败，请重试。'), error),
                                },
                              );
                            else setRemovedMemories((prev) => [...prev, memory.id]);
                          }}
                        >
                          {t('删除')}
                        </Button>
                      </div>
                    ))}
                  </SettingsCard>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'permissions' && (
          <div className="agent-perms flex flex-col gap-6">
            {permSaveFailed && (
              <p className="agent-perm-error m-0 text-meta text-destructive" role="alert">
                {t('保存失败，请重试。')}
              </p>
            )}
            <section className="agent-perm-group flex flex-col gap-2">
              <h3 className="m-0 text-card-title font-medium text-foreground">{t('工具')}</h3>
              <SettingsCard>
                {AGENT_TOOL_SWITCHES.map((label) => (
                  <SettingsRow
                    key={label}
                    label={t(label)}
                    hint={t(AGENT_TOOL_COPY[label])}
                    hintClassName="agent-perm-hint"
                  >
                    <Switch
                      className="agent-tool-switch"
                      aria-label={t(label)}
                      checked={agent.tools.includes(label)}
                      onCheckedChange={(checked) => toggleTool(label, checked)}
                    />
                  </SettingsRow>
                ))}
              </SettingsCard>
            </section>

            <section className="agent-perm-group flex flex-col gap-2">
              <h3 className="m-0 text-card-title font-medium text-foreground">{t('授权技能')}</h3>
              <p className={SETTINGS_HINT_CLS}>{t(AGENT_PERMISSION_COPY.skillsAllowlist)}</p>
              <SettingsCard>
                <SettingsRow label={t('不限制')}>
                  <Switch
                    className="agent-allowlist-switch"
                    aria-label={t('不限制')}
                    checked={agent.skillsAllowlist === null}
                    onCheckedChange={(on) => patch({ skillsAllowlist: on ? null : [] })}
                  />
                </SettingsRow>
                {(() => {
                  const allowlist = agent.skillsAllowlist;
                  if (allowlist === null) return null;
                  return skillOptions.map((skill) => (
                    <SettingsRow key={skill.id} className="agent-allowlist-row" label={skill.name}>
                      <Switch
                        className="agent-allowlist-skill-switch"
                        aria-label={skill.name}
                        checked={allowlist.includes(skill.id)}
                        onCheckedChange={(checked) => toggleAllowlistSkill(skill.id, checked)}
                      />
                    </SettingsRow>
                  ));
                })()}
              </SettingsCard>
            </section>

            <section className="agent-perm-group flex flex-col gap-2">
              <h3 className="m-0 text-card-title font-medium text-foreground">{t('密钥')}</h3>
              {secretIds.length === 0 ? (
                <SettingsCard>
                  <div className={cn(SETTINGS_ROW_CLS, 'gap-2')}>
                    <p className="agent-perm-empty m-0 text-ui text-content-secondary">
                      {t('暂无团队密钥。')}
                    </p>
                    <Link
                      className="agent-secret-add text-meta text-primary no-underline hover:underline"
                      to={{ pathname: SECRETS_HREF, search }}
                    >
                      {t('去添加密钥')}
                    </Link>
                  </div>
                </SettingsCard>
              ) : (
                <SettingsCard>
                  <SettingsRow
                    className="agent-secret-row"
                    label={t('团队密钥')}
                    hint={t(AGENT_PERMISSION_COPY.secrets)}
                    labelClassName="agent-secret-name"
                    hintClassName="agent-perm-hint agent-secret-hint"
                  >
                    <Switch
                      className="agent-secret-switch"
                      aria-label={t('团队密钥')}
                      checked={agent.secrets.length > 0}
                      onCheckedChange={(checked) => patch({ secrets: checked ? secretIds : [] })}
                    />
                  </SettingsRow>
                </SettingsCard>
              )}
            </section>

            <section className="agent-perm-group flex flex-col gap-2">
              <h3 className="m-0 text-card-title font-medium text-foreground">{t('MCP 服务器')}</h3>
              <p className={SETTINGS_HINT_CLS}>{t(AGENT_PERMISSION_COPY.mcpServers)}</p>
              {mcpOptions.length === 0 ? (
                <SettingsCard>
                  <div className={cn(SETTINGS_ROW_CLS, 'gap-2')}>
                    <p className="agent-perm-empty m-0 text-ui text-content-secondary">
                      {t('暂无 MCP 服务器。')}
                    </p>
                  </div>
                </SettingsCard>
              ) : (
                <SettingsCard>
                  {mcpOptions.map((server) => (
                    <SettingsRow key={server.id} className="agent-mcp-row" label={server.name}>
                      <Switch
                        aria-label={server.name}
                        checked={agent.mcpServers.includes(server.id)}
                        onCheckedChange={(checked) => toggleMcp(server.id, checked)}
                      />
                    </SettingsRow>
                  ))}
                </SettingsCard>
              )}
            </section>

            <section className="agent-perm-group flex flex-col gap-2">
              <h3 className="m-0 text-card-title font-medium text-foreground">{t('机器匹配')}</h3>
              <p className={SETTINGS_HINT_CLS}>
                {t(
                  '执行要求 = 派发硬闸：能力快照不满足的机器不领该 Agent 的步（排队面会给可见成因）；从未上报快照的机器按可跑放行。',
                )}
              </p>
              {mcpOptions.length === 0 ? (
                <SettingsCard>
                  <div className={cn(SETTINGS_ROW_CLS, 'gap-2')}>
                    <p className="agent-perm-empty m-0 text-ui text-content-secondary">
                      {t('暂无 MCP 服务器。')}
                    </p>
                  </div>
                </SettingsCard>
              ) : (
                <SettingsCard>
                  {mcpOptions.map((server) => (
                    <SettingsRow
                      key={server.id}
                      label={server.name}
                      hint={t('要求执行机已安装该 MCP 服务器')}
                      hintClassName="agent-perm-hint"
                    >
                      <Switch
                        aria-label={t('要求安装 {name}', { name: server.name })}
                        checked={(agent.requiredCapabilities?.mcpServers ?? []).includes(server.id)}
                        onCheckedChange={(checked) => toggleRequiredMcp(server.id, checked)}
                      />
                    </SettingsRow>
                  ))}
                </SettingsCard>
              )}
              {live && machineFitQ.data !== undefined && (
                <SettingsCard>
                  {machineFitQ.data.machines.length === 0 ? (
                    <div className={cn(SETTINGS_ROW_CLS, 'gap-2')}>
                      <p className="m-0 text-ui text-content-secondary">{t('暂无机器。')}</p>
                    </div>
                  ) : (
                    machineFitQ.data.machines.map((m) => (
                      <SettingsRow
                        key={m.machineId}
                        label={m.name}
                        hint={machineFitHint(m, t)}
                        hintClassName="agent-perm-hint"
                      >
                        <span
                          className={cn(
                            'text-meta',
                            m.canRun ? 'text-content-secondary' : 'text-destructive',
                          )}
                        >
                          {m.canRun ? t('可跑') : t('不可跑')}
                        </span>
                      </SettingsRow>
                    ))
                  )}
                </SettingsCard>
              )}
            </section>
          </div>
        )}
      </div>
      <DeleteConfirm
        open={deleteOpen}
        title={t('删除 Agent？')}
        summary={t('将「{name}」移出团队？该 Agent 进行中的任务将被停止。', {
          name: agent.displayName,
        })}
        ariaLabel={t('删除 Agent')}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false);
          if (agentId === undefined) return;
          if (live) {
            mutations.deleteAgent.mutate(agentId, {
              onSuccess: () => navigate({ pathname: '/app/team', search }),
              onError: (error) => toastError(t('删除 Agent 失败，请重试。'), error),
            });
            return;
          }
          markDeleted(agentId);
          navigate({ pathname: '/app/team', search });
        }}
      />
    </PageShell>
  );
}

function RoleRow({
  value,
  onCommit,
}: {
  value: string | null;
  onCommit: (next: string | null) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useEditorFocus<HTMLTextAreaElement>(draft !== null);
  const display = value == null ? null : value.trim().replace(/\n{3,}/g, '\n\n');
  return (
    <SettingsRow
      label={t('职责')}
      hint={t(AGENT_PERMISSION_COPY.responsibility)}
      labelClassName="agent-field-label"
      valueClassName={draft === null ? 'items-start' : SETTINGS_VALUE_EDITOR_CLS}
    >
      {draft === null ? (
        <>
          <span className="agent-role-text min-w-0 flex-auto text-ui whitespace-pre-line break-words text-foreground">
            {display ?? t('未设置职责')}
          </span>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              className={`agent-role-edit ${AGENT_ICON_EDIT_CLS}`}
              aria-label={t('编辑')}
              onClick={() => setDraft(value ?? '')}
            >
              <SquarePen width={14} height={14} />
            </Button>
          </div>
        </>
      ) : (
        <>
          <Textarea
            id="agent-role-input"
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              className="agent-role-save"
              onClick={() => {
                const next = draft.trim();
                onCommit(next === '' ? null : next);
                setDraft(null);
              }}
            >
              {t('保存')}
            </Button>
          </div>
        </>
      )}
    </SettingsRow>
  );
}
