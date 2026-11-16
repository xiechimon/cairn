import { POLICY_USES, type PolicyUse, type WorkPolicyRecord } from '@cairn/shared';
import { useEffect, useRef, useState } from 'react';
import { useRoutingSettings, useRoutingSettingsMutations } from '../api/routing-settings.js';
import { SETTINGS_HINT_CLS, SettingsCard, SettingsRow } from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { toastError } from '../components/ui/toaster.js';
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
  return t('任务和评审都不能用');
}

export function McpGrantSection({
  slug,
  name,
  grants,
  grantTasks = false,
}: {
  slug: string;
  name: string;
  grants: McpGrants;
  grantTasks?: boolean;
}) {
  const { t } = useI18n();
  const [shown, setShown] = useState<GrantDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const value = shown ?? grants.uses(slug);
  const change = (next: GrantDraft) => {
    setShown(next);
    setSaving(true);
    grants
      .save(slug, next)
      .catch((error: unknown) => {
        setShown(null);
        toastError(t('保存失败，请重试。'), error);
      })
      .finally(() => setSaving(false));
  };
  const granted = useRef(false);
  useEffect(() => {
    if (!grantTasks || granted.current || !grants.ready) return;
    granted.current = true;
    const current = grants.uses(slug);
    if (!current.session) change({ ...current, session: true });
  });
  const row = (use: PolicyUse, label: string, aria: string) => (
    <SettingsRow label={label}>
      <ToggleSwitch
        className="pointer-coarse:after:-inset-y-3"
        data-testid={`mcp-grant-${use}`}
        aria-label={aria}
        checked={value[use]}
        disabled={!grants.ready || saving}
        onCheckedChange={(checked) => change({ ...value, [use]: checked })}
      />
    </SettingsRow>
  );
  return (
    <div className="flex flex-col gap-2">
      <SettingsCard>
        {row('session', t('任务'), t('让任务用 {name}', { name }))}
        {row('review', t('评审'), t('让评审用 {name}', { name }))}
      </SettingsCard>
      <p className={SETTINGS_HINT_CLS}>{t('改动立即生效。Coordinator 用不了这里接入的服务器。')}</p>
    </div>
  );
}
