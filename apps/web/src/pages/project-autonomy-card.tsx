import type {
  ActionTier,
  AutonomyGateReason,
  AutonomyKind,
  AutonomyRecord,
  AutonomySettings,
  PatchAutonomyBody,
} from '@cairn/shared';
import { cn } from 'cn';
import { useState } from 'react';
import { useApiMutations, useProjectAutonomy, useTeamAutonomy } from '../api/hooks.js';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import {
  SETTINGS_ROW_CLS,
  SETTINGS_SELECT_TRIGGER_CLS,
  SettingsCard,
  SettingsRow,
} from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { Spinner } from '../components/ui/spinner.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';

const NUMBER_INPUT_CLS = `${FORM_CONTROL_CLS} w-24`;

const KIND_LABELS: Record<AutonomyKind, string> = {
  'issue-intake': 'issue 进料',
  scheduling: '排期扫票',
};

const REASON_LABELS: Record<AutonomyGateReason, string> = {
  disabled: '未开启',
  dormant: '没有新提交，休眠中',
  'in-flight-cap': '在飞任务已满',
  'member-active': '有人正在用，让路',
  cooldown: '冷却中',
  budget: '今日预算已用完',
  'budget-unreadable': '花费读不到，先不跑',
};

export const TIER_LABELS: Record<ActionTier, string> = {
  guarded: '先问我',
  full: '完全放手',
};

type NumberKey = 'quietMinutes' | 'cooldownMinutes' | 'dailyBudgetUsd';

const NUMBER_FIELDS: Array<{ key: NumberKey; label: string; step: string }> = [
  { key: 'quietMinutes', label: '有人在用时让路（分钟）', step: '1' },
  { key: 'cooldownMinutes', label: '同类任务冷却（分钟）', step: '1' },
  { key: 'dailyBudgetUsd', label: '每日预算（USD）', step: '0.5' },
];

export function ProjectAutonomyCard({ projectId, teamId }: { projectId: string; teamId: string }) {
  const { t } = useI18n();
  const q = useProjectAutonomy(projectId, true);
  const teamQ = useTeamAutonomy(teamId, true);
  const mutations = useApiMutations(teamId);
  const [draft, setDraft] = useState<Partial<Record<NumberKey, string>>>({});
  const data: AutonomyRecord | undefined = q.data;
  if (data === undefined) return null;
  const settings = data.settings;
  const teamTier = teamQ.data?.actionTier;
  const followLabel =
    teamTier === undefined
      ? t('跟随全局')
      : t('跟随全局（{tier}）', { tier: t(TIER_LABELS[teamTier]) });
  const save = (body: PatchAutonomyBody, onSuccess?: () => void) =>
    mutations.patchAutonomy.mutate(
      { id: projectId, body },
      {
        onSuccess,
        onError: (error) => toastError(t('保存失败，请重试。'), error),
      },
    );
  const parsed: Partial<AutonomySettings> = {};
  let invalid = false;
  for (const { key } of NUMBER_FIELDS) {
    const raw = draft[key];
    if (raw === undefined) continue;
    const n = Number(raw);
    const ok =
      raw.trim() !== '' &&
      Number.isFinite(n) &&
      n >= 0 &&
      (key === 'dailyBudgetUsd' || Number.isInteger(n));
    if (!ok) invalid = true;
    else if (n !== settings[key]) parsed[key] = n;
  }
  const dirty = Object.keys(parsed).length > 0;
  return (
    <section aria-label={t('后台自动任务')}>
      <SettingsCard>
        <SettingsRow label={t('允许后台自动开跑')}>
          <ToggleSwitch
            aria-label={t('允许后台自动开跑')}
            checked={settings.enabled}
            disabled={mutations.patchAutonomy.isPending}
            onCheckedChange={(enabled) => save({ enabled })}
          />
        </SettingsRow>
        <SettingsRow
          label={t('对外动作')}
          hint={t('发送、发布等对外动作，先问过再跑或完全交给它。')}
        >
          <Select
            value={data.actionTierOverride ?? 'follow'}
            disabled={mutations.patchAutonomy.isPending}
            onValueChange={(tier) =>
              save({ actionTier: tier === 'follow' ? null : (tier as ActionTier) })
            }
          >
            <SelectTrigger
              aria-label={t('对外动作')}
              className={cn(SETTINGS_SELECT_TRIGGER_CLS, 'w-52')}
              data-testid="autonomy-tier"
            >
              <SelectValue>
                {data.actionTierOverride === null
                  ? followLabel
                  : t(TIER_LABELS[data.actionTierOverride])}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="follow">{followLabel}</SelectItem>
              <SelectItem value="guarded">{t('先问我')}</SelectItem>
              <SelectItem value="full">{t('完全放手')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        {NUMBER_FIELDS.map(({ key, label, step }) => (
          <SettingsRow key={key} label={t(label)}>
            <Input
              aria-label={t(label)}
              className={NUMBER_INPUT_CLS}
              type="number"
              min="0"
              step={step}
              value={draft[key] ?? String(settings[key])}
              onChange={(event) => setDraft((d) => ({ ...d, [key]: event.target.value }))}
            />
          </SettingsRow>
        ))}
        <div className={cn(SETTINGS_ROW_CLS, 'justify-end')}>
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            aria-label={t('保存后台自动任务设置')}
            disabled={mutations.patchAutonomy.isPending || invalid || !dirty}
            onClick={() => save(parsed, () => setDraft({}))}
          >
            {mutations.patchAutonomy.isPending && <Spinner data-icon="inline-start" />}
            {t('保存')}
          </Button>
        </div>
        <SettingsRow label={t('今日已花（UTC）')}>
          <span className="font-mono">
            {data.spentTodayUsd === null ? t('读不到') : `$${data.spentTodayUsd.toFixed(2)}`}
          </span>
        </SettingsRow>
        {data.kinds
          .filter((k) => k.kind === 'issue-intake' || k.lastEvaluatedAt !== null)
          .map((k) => (
            <SettingsRow key={k.kind} label={t(KIND_LABELS[k.kind])}>
              <span
                className={cn(
                  'text-meta',
                  k.lastEvaluatedAt === null
                    ? 'text-content-tertiary'
                    : k.lastBlockedReason === null
                      ? 'text-running-text'
                      : 'text-content-secondary',
                )}
                data-testid={`autonomy-state-${k.kind}`}
              >
                {k.lastEvaluatedAt === null
                  ? t('还没判过')
                  : k.lastBlockedReason === null
                    ? t('最近一次放行')
                    : `${t('最近一次被拦：')}${t(REASON_LABELS[k.lastBlockedReason])}`}
              </span>
            </SettingsRow>
          ))}
      </SettingsCard>
    </section>
  );
}
