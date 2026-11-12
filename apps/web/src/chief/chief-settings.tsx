import { cn } from 'cn';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApiMutations, useChief } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { SegmentedTabs } from '../components/segmented.js';
import { SETTINGS_HINT_CLS, SETTINGS_ROW_CLS, SettingsCard } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import type { ChiefContent, ChiefSettingsTab } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft, ChevronRight } from '../icons/index.js';
import { COORDINATOR_ROUTING_HREF } from '../resources/routing-settings-page.js';
import { EditCharterDialog } from './edit-charter-dialog.js';
import { MemoryPanel } from './memory-panel.js';

const TABS: { id: ChiefSettingsTab; label: string }[] = [
  { id: 'routing', label: '模型与机器' },
  { id: 'charter', label: '章程' },
  { id: 'memory', label: '记忆' },
  { id: 'watches', label: '关注与提醒' },
];

const EMPTY_ROW_CLS = cn(
  SETTINGS_ROW_CLS,
  'justify-center text-center text-meta text-content-tertiary',
);

const ENTRY_ROW_CLS = cn(SETTINGS_ROW_CLS, 'flex-col items-start justify-center gap-0.5 py-2');

export function ChiefSettings({ chief, onBack }: { chief: ChiefContent; onBack: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<ChiefSettingsTab>(chief.tab ?? 'routing');
  const { live, teamId } = useLiveData();
  const chiefQ = useChief(teamId, live);
  const mutations = useApiMutations(teamId);
  const charter = live ? (chiefQ.data?.chief.charter ?? '') : '';
  const [charterOpen, setCharterOpen] = useState(false);
  const navigate = useNavigate();
  const watches = live ? (chiefQ.data?.watches ?? []) : [];
  const wakes = live ? (chiefQ.data?.wakes ?? []) : [];
  const saveCharter = live
    ? (value: string) =>
        mutations.patchChief.mutate({ charter: value }, { onSuccess: () => setCharterOpen(false) })
    : undefined;
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header
        data-testid="chief-settings-topbar"
        className="flex h-14 flex-none items-center gap-3 border-b border-border px-6 whitespace-nowrap"
      >
        <IconTooltip
          label={t('返回')}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="-mr-1 -ml-2 size-7 flex-none cursor-pointer text-content-tertiary"
              onClick={onBack}
            />
          }
        >
          <ChevronLeft width={20} height={20} />
        </IconTooltip>
        <h1 className="min-w-0 truncate voice-title text-page text-foreground">
          {t('Coordinator 设置')}
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

          {tab === 'routing' && (
            <SettingsCard className="mt-4">
              <Button
                variant="ghost"
                data-testid="chief-routing-row"
                className={cn(
                  SETTINGS_ROW_CLS,
                  "h-auto w-full cursor-pointer justify-start gap-3 rounded-none border-0 text-left text-ui font-normal text-foreground hover:bg-transparent dark:hover:bg-transparent [&_svg:not([class*='size-'])]:size-auto",
                )}
                onClick={() => navigate(COORDINATOR_ROUTING_HREF)}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-ui text-foreground">{t('模型与机器')}</span>
                  <span className={SETTINGS_HINT_CLS}>
                    {t('跟随 coordinator 路由规则，在路由设置里调整。')}
                  </span>
                </span>
                <ChevronRight width={16} height={16} className="ml-auto text-content-tertiary" />
              </Button>
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
                    {t('尚无章程。点击编辑，为 Coordinator 添加常设指示。')}
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

          {tab === 'memory' && <MemoryPanel live={live} teamId={teamId} project={null} />}

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
                  {t(
                    '暂无跟进事项。Coordinator 关注某个任务，或约定到点回头核实时，会按主题列在这里。',
                  )}
                </div>
              )}
            </SettingsCard>
          )}
        </div>
      </div>
      <EditCharterDialog
        open={charterOpen}
        onClose={() => setCharterOpen(false)}
        charter={charter}
        onSave={saveCharter}
      />
    </div>
  );
}
