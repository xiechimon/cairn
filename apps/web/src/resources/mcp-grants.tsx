import { POLICY_USES, type PolicyUse, type WorkPolicyRecord } from '@cairn/shared';
import { useState } from 'react';
import { useRoutingSettings, useRoutingSettingsMutations } from '../api/routing-settings.js';
import { SETTINGS_HINT_CLS, SettingsCard, SettingsRow } from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { useI18n } from '../i18n/provider.js';

export type GrantDraft = Record<PolicyUse, boolean>;

export interface McpGrants {
  ready: boolean;
  uses: (slug: string) => GrantDraft;
  save: (slug: string, next: GrantDraft) => Promise<void>;
}

export function useMcpGrants(
  teamId: string | undefined,
  live: boolean,
  fixturePolicies: readonly WorkPolicyRecord[] | undefined,
): McpGrants {
  const settingsQ = useRoutingSettings(teamId, live);
  const { patchPolicy } = useRoutingSettingsMutations(teamId);
  const [local, setLocal] = useState<readonly WorkPolicyRecord[]>(fixturePolicies ?? []);
  const policies = live ? (settingsQ.data?.policies ?? []) : local;
  const granted = (slug: string, use: PolicyUse) =>
    policies.find((p) => p.use === use)?.mcpServers.includes(slug) === true;
  const uses = (slug: string) =>
    Object.fromEntries(POLICY_USES.map((use) => [use, granted(slug, use)])) as GrantDraft;
  const save = async (slug: string, next: GrantDraft) => {
    const changes = POLICY_USES.filter((use) => granted(slug, use) !== next[use]).map((use) => {
      const current = policies.find((p) => p.use === use)?.mcpServers ?? [];
      const mcpServers = next[use] ? [...current, slug] : current.filter((s) => s !== slug);
      return { use, mcpServers };
    });
    if (!live) {
      setLocal((rows) =>
        rows.map((p) => {
          const change = changes.find((c) => c.use === p.use);
          return change === undefined ? p : { ...p, mcpServers: change.mcpServers };
        }),
      );
      return;
    }
    await Promise.all(
      changes.map(({ use, mcpServers }) => patchPolicy.mutateAsync({ use, body: { mcpServers } })),
    );
  };
  return { ready: !live || settingsQ.data !== undefined, uses, save };
}

export function grantSummary(t: (text: string) => string, uses: GrantDraft): string {
  if (uses.session && uses.review) return t('任务和评审可用');
  if (uses.session) return t('任务可用');
  if (uses.review) return t('评审可用');
  return t('任务和评审都还不能用');
}

export function McpGrantRows({
  name,
  value,
  disabled,
  onChange,
}: {
  name: string;
  value: GrantDraft;
  disabled: boolean;
  onChange: (next: GrantDraft) => void;
}) {
  const { t } = useI18n();
  const row = (use: PolicyUse, label: string, hint: string, aria: string) => (
    <SettingsRow label={label} hint={hint}>
      <ToggleSwitch
        className="pointer-coarse:after:-inset-y-3"
        data-testid={`mcp-grant-${use}`}
        aria-label={aria}
        checked={value[use]}
        disabled={disabled}
        onCheckedChange={(checked) => onChange({ ...value, [use]: checked })}
      />
    </SettingsRow>
  );
  return (
    <div className="flex flex-col gap-2">
      <SettingsCard>
        {row('session', t('任务'), t('做任务时能调用它的工具'), t('让任务用 {name}', { name }))}
        {row('review', t('评审'), t('评审改动时能调用它的工具'), t('让评审用 {name}', { name }))}
      </SettingsCard>
      <p className={SETTINGS_HINT_CLS}>{t('Coordinator 还不能用连接器，只有任务和评审能用。')}</p>
    </div>
  );
}
