import { SettingsCard, SettingsRow, Switch } from '@cairn/web';

export const Rows = () => (
  <div style={{ width: 520 }}>
    <SettingsCard>
      <SettingsRow label="Project name">cairn</SettingsRow>
      <SettingsRow label="Default agent">Implementer</SettingsRow>
      <SettingsRow label="Auto-merge" hint="Merge PRs once review passes and CI is green.">
        <Switch defaultChecked />
      </SettingsRow>
    </SettingsCard>
  </div>
);
