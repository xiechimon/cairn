import type { ActionTier, AutonomyRecord, PatchAutonomyBody } from '@cairn/shared';
import { cn } from 'cn';
import { useApiMutations, useProjectAutonomy, useTeamAutonomy } from '../api/hooks.js';
import {
  SETTINGS_SELECT_TRIGGER_CLS,
  SettingsCard,
  SettingsRow,
} from '../components/settings-list.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';

export const TIER_LABELS: Record<ActionTier, string> = {
  guarded: '先问我',
  full: '完全放手',
};

export function ProjectAutonomyCard({ projectId, teamId }: { projectId: string; teamId: string }) {
  const { t } = useI18n();
  const q = useProjectAutonomy(projectId, true);
  const teamQ = useTeamAutonomy(teamId, true);
  const mutations = useApiMutations(teamId);
  const data: AutonomyRecord | undefined = q.data;
  if (data === undefined) return null;
  const teamTier = teamQ.data?.actionTier;
  const followLabel =
    teamTier === undefined
      ? t('跟随全局')
      : t('跟随全局（{tier}）', { tier: t(TIER_LABELS[teamTier]) });
  const save = (body: PatchAutonomyBody) =>
    mutations.patchAutonomy.mutate(
      { id: projectId, body },
      { onError: (error) => toastError(t('保存失败，请重试。'), error) },
    );
  return (
    <section aria-label={t('对外动作')}>
      <SettingsCard>
        <SettingsRow
          label={t('对外动作')}
          hint={t('比如发送、发布')}
          info={t('发送、发布等对外动作，会先问过再跑，或完全交给它。')}
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
      </SettingsCard>
    </section>
  );
}
