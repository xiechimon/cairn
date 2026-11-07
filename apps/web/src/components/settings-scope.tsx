import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { MachineName, machineLabel } from './machine-label.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.js';

export const TEAM_SCOPE = 'team';

export function useSettingsScope(machines: readonly MachineRow[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const scopeParam = searchParams.get('scope');
  const machine = machines.find((m) => m.id !== undefined && m.id === scopeParam);
  const setScope = (next: string, extra: Record<string, string | null> = {}) => {
    const params = new URLSearchParams(searchParams);
    if (next === TEAM_SCOPE) params.delete('scope');
    else params.set('scope', next);
    for (const [key, value] of Object.entries(extra)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    setSearchParams(params);
  };
  return { scope: machine?.id ?? TEAM_SCOPE, machine, setScope };
}

export function SettingsScopeSentence({
  machines,
  scope,
  onChange,
  trailing,
}: {
  machines: readonly MachineRow[];
  scope: string;
  onChange: (next: string) => void;
  trailing?: ReactNode;
}) {
  const { t } = useI18n();
  const current = machines.find((m) => m.id !== undefined && m.id === scope);
  return (
    <div
      data-testid="settings-scope"
      className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-meta text-content-tertiary"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span id="settings-scope-label">{t('设置作用于')}</span>
        <Select value={scope} onValueChange={(next) => onChange(next as string)}>
          <SelectTrigger
            aria-labelledby="settings-scope-label"
            size="sm"
            className="min-w-0 text-ui text-foreground"
          >
            <SelectValue>
              {current === undefined ? t('团队') : machineLabel(current, machines)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent aria-label={t('设置作用于')}>
            <SelectItem value={TEAM_SCOPE}>{t('团队')}</SelectItem>
            {machines.map((m) =>
              m.id === undefined ? null : (
                <SelectItem key={m.id} value={m.id}>
                  <MachineName machine={m} all={machines} />
                  {m.online === false && (
                    <span className="text-content-tertiary">{` · ${t('离线')}`}</span>
                  )}
                  {m.capabilities?.executor === 'orb' && (
                    <span className="text-content-tertiary">{' · Orb'}</span>
                  )}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>
      {trailing}
    </div>
  );
}
