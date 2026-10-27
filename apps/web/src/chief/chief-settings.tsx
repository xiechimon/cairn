import { MEMORY_EMPTY_COPY, MEMORY_QUOTA_PER_AGENT } from '@cairn/shared';
import { cn } from 'cn';
import { useState } from 'react';
import { useApiMutations, useChief, useMachines, useMembers, useMemories } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { SegmentedTabs } from '../components/segmented.js';
import { SETTINGS_HINT_CLS, SETTINGS_ROW_CLS, SettingsCard } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import type { ChiefContent, ChiefSettingsTab, MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft, ChevronRight } from '../icons/index.js';
import { ChiefAgentDialog, type ChiefAgentOption } from './chief-agent-dialog.js';
import { ChiefSpiralFace } from './chief-spiral-face.js';
import { EditCharterDialog } from './edit-charter-dialog.js';

const TABS: { id: ChiefSettingsTab; label: string }[] = [
  { id: 'agent', label: 'Agent' },
  { id: 'charter', label: '章程' },
  { id: 'memory', label: '记忆' },
  { id: 'watches', label: '关注与提醒' },
];

const EMPTY_ROW_CLS = cn(
  SETTINGS_ROW_CLS,
  'justify-center text-center text-meta text-content-tertiary',
);

const ENTRY_ROW_CLS = cn(SETTINGS_ROW_CLS, 'flex-col items-start justify-center gap-0.5 py-2');

const ROW_AVATAR_CLS =
  'grid size-6 flex-none place-items-center rounded-full border border-(--border) bg-(--card) text-meta text-(--foreground)';
const ROW_AVATAR_IMG_CLS =
  'grid size-6 flex-none place-items-center rounded-full border-none bg-none [&_img]:block [&_img]:size-6 [&_img]:rounded-full';

export function ChiefSettings({
  chief,
  onBack,
  machines,
}: {
  chief: ChiefContent;
  onBack: () => void;
  machines?: MachineRow[];
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<ChiefSettingsTab>(chief.tab ?? 'agent');
  const { live, teamId } = useLiveData();
  const chiefQ = useChief(teamId, live);
  const membersQ = useMembers(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const mutations = useApiMutations(teamId);
  const charter = live ? (chiefQ.data?.chief.charter ?? '') : '';
  const boundAgent =
    live && chiefQ.data?.agentActor != null
      ? {
          id: chiefQ.data.agentActor.id,
          name: chiefQ.data.agentActor.displayName,
          avatarUrl: chiefQ.data.agentActor.avatarUrl,
        }
      : null;
  const agentOptions: ChiefAgentOption[] | undefined = live
    ? (membersQ.data ?? [])
        .filter((m) => m.memberType === 'agent')
        .map((m) => {
          const actor = m.actor as { displayName?: string; avatarUrl?: string | null } | undefined;
          return {
            id: m.actorId,
            name: actor?.displayName ?? m.actorId,
            avatarUrl: actor?.avatarUrl ?? null,
          };
        })
    : undefined;
  const [agentOpen, setAgentOpen] = useState(false);
  const [charterOpen, setCharterOpen] = useState(false);
  const memoriesQ = useMemories(teamId, boundAgent?.id, live && boundAgent != null);
  const memories = memoriesQ.data ?? [];
  const watches = live ? (chiefQ.data?.watches ?? []) : [];
  const wakes = live ? (chiefQ.data?.wakes ?? []) : [];
  const bindAgent = live
    ? (agentId: string) =>
        mutations.patchChief.mutate(
          { agent: { agentId } },
          { onSuccess: () => setAgentOpen(false) },
        )
    : undefined;
  const saveCharter = live
    ? (value: string) =>
        mutations.patchChief.mutate({ charter: value }, { onSuccess: () => setCharterOpen(false) })
    : undefined;
  const boundMachineId = live ? (chiefQ.data?.agentActor?.machineId ?? null) : null;
  const boundModelId = live ? (chiefQ.data?.agentActor?.modelId ?? null) : null;
  const boundMachineName =
    boundMachineId !== null
      ? ((live ? (machinesQ.data ?? []) : (machines ?? [])).find((m) => m.id === boundMachineId)
          ?.name ?? null)
      : null;
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header
        data-testid="chief-settings-topbar"
        className="flex h-14 flex-none items-center gap-3 border-b border-border px-6 whitespace-nowrap"
      >
        <Button
          variant="ghost"
          size="icon"
          className="-mr-1 -ml-2 size-7 flex-none cursor-pointer text-content-tertiary"
          aria-label={t('返回')}
          onClick={onBack}
        >
          <ChevronLeft width={16} height={16} />
        </Button>
        <h1 className="min-w-0 truncate font-heading text-page font-medium text-foreground">
          {t('总管设置')}
        </h1>
      </header>
      <div className="flex-1 overflow-x-hidden overflow-y-auto px-4">
        <div data-testid="chief-settings-col" className="mx-auto w-192 max-w-full pt-4 pb-6">
          <SegmentedTabs
            slide
            value={tab}
            onChange={setTab}
            options={TABS.map((item) => ({ value: item.id, label: t(item.label) }))}
          />

          {tab === 'agent' && (
            <SettingsCard className="mt-4">
              <Button
                variant="ghost"
                className={cn(
                  SETTINGS_ROW_CLS,
                  "h-auto w-full cursor-pointer justify-start gap-3 rounded-none border-0 border-b border-border text-left text-ui font-normal text-foreground hover:bg-transparent active:not-aria-[haspopup]:translate-y-0 dark:hover:bg-transparent [&_svg:first-child]:text-content-tertiary [&_svg:not([class*='size-'])]:size-auto",
                )}
                onClick={() => setAgentOpen(true)}
              >
                {boundAgent != null ? (
                  boundAgent.avatarUrl != null ? (
                    <span className={ROW_AVATAR_IMG_CLS}>
                      <SeededAvatar
                        className="size-6"
                        name={boundAgent.name}
                        src={boundAgent.avatarUrl}
                        fallback="/avatar-robot-1.svg"
                      />
                    </span>
                  ) : (
                    <span className={ROW_AVATAR_CLS}>{boundAgent.name.charAt(0)}</span>
                  )
                ) : (
                  <ChiefSpiralFace size={24} />
                )}
                <span>{boundAgent != null ? boundAgent.name : t('未设置')}</span>
                <ChevronRight width={14} height={14} className="ml-auto text-content-tertiary" />
              </Button>
              <div className={SETTINGS_ROW_CLS} data-testid="chief-follows-agent">
                <span className="flex min-w-0 flex-col">
                  <span className="text-ui text-foreground">{t('模型与归属机')}</span>
                  <span className={SETTINGS_HINT_CLS}>
                    {boundAgent != null && boundModelId !== null
                      ? t('跟随绑定 Agent：模型 {model} · 归属机 {machine}', {
                          model: boundModelId,
                          machine: boundMachineName ?? t('未设归属机'),
                        })
                      : t('跟随绑定 Agent 的自身配置，在 Agent 的设置里调整。')}
                  </span>
                </span>
              </div>
            </SettingsCard>
          )}

          {tab === 'charter' && (
            <>
              <SettingsCard className="mt-4">
                {charter !== '' ? (
                  <div className="px-4 py-3 text-ui whitespace-pre-wrap text-foreground">
                    {charter}
                  </div>
                ) : (
                  <div className={EMPTY_ROW_CLS}>
                    {t('尚无章程。点击编辑，为总管添加常设指示。')}
                  </div>
                )}
              </SettingsCard>
              <div className="mt-4 flex justify-end">
                <Button className={DIALOG_PRIMARY_BUTTON} onClick={() => setCharterOpen(true)}>
                  {t('编辑')}
                </Button>
              </div>
            </>
          )}

          {tab === 'memory' &&
            (live && boundAgent != null ? (
              memoriesQ.data != null ? (
                <div>
                  <p className="mt-4 text-meta text-content-tertiary">
                    {t('记忆 · {n} / {max}', { n: memories.length, max: MEMORY_QUOTA_PER_AGENT })}
                  </p>
                  <SettingsCard className="mt-2">
                    {memories.length === 0 ? (
                      <p className={EMPTY_ROW_CLS}>{t(MEMORY_EMPTY_COPY)}</p>
                    ) : (
                      memories.map((memory) => (
                        <div key={memory.id} className={ENTRY_ROW_CLS}>
                          <span className="text-ui text-foreground">{memory.title}</span>
                          <span className="text-meta text-content-secondary">{memory.content}</span>
                        </div>
                      ))
                    )}
                  </SettingsCard>
                </div>
              ) : null
            ) : (
              <SettingsCard className="mt-4">
                <div className={EMPTY_ROW_CLS}>
                  {t('尚未选择 Agent。请先在「Agent」页选定 Agent，记忆将保存在该 Agent 上。')}
                </div>
              </SettingsCard>
            ))}

          {tab === 'watches' && (
            <SettingsCard className="mt-4">
              {live && (watches.length > 0 || wakes.length > 0) ? (
                <>
                  {watches.map((watch) => (
                    <div key={watch.threadId} className={ENTRY_ROW_CLS}>
                      <span className="text-ui text-foreground">{watch.title}</span>
                      <span className={SETTINGS_HINT_CLS}>{watch.threadTitle}</span>
                    </div>
                  ))}
                  {wakes.map((wake) => {
                    const note = typeof wake.note === 'string' ? wake.note : null;
                    const at = typeof wake.at === 'number' ? wake.at : null;
                    const id = typeof wake.id === 'string' ? wake.id : null;
                    return (
                      <div key={id ?? `${at}`} className={ENTRY_ROW_CLS}>
                        <span className="text-ui text-foreground">{note ?? t('到点提醒')}</span>
                        {at != null && (
                          <span className={SETTINGS_HINT_CLS}>{new Date(at).toLocaleString()}</span>
                        )}
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className={EMPTY_ROW_CLS}>
                  {t('暂无跟进事项。总管关注某个任务，或约定到点回头核实时，会按主题列在这里。')}
                </div>
              )}
            </SettingsCard>
          )}
        </div>
      </div>
      <ChiefAgentDialog
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        agents={agentOptions}
        boundAgentId={boundAgent?.id ?? null}
        onBind={bindAgent}
      />
      <EditCharterDialog
        open={charterOpen}
        onClose={() => setCharterOpen(false)}
        charter={charter}
        onSave={saveCharter}
      />
    </div>
  );
}
