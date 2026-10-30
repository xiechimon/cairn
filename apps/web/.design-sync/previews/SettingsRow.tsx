import { Button, SettingsCard, SettingsRow, Switch } from '@cairn/web';

export const PlainValue = () => (
  <div style={{ width: 520 }}>
    <SettingsCard>
      <SettingsRow label="Repository">xiechimon/cairn</SettingsRow>
    </SettingsCard>
  </div>
);

export const WithHint = () => (
  <div style={{ width: 520 }}>
    <SettingsCard>
      <SettingsRow label="Run e2e before PR" hint="The implementer runs the affected e2e set before opening a pull request.">
        <Switch defaultChecked />
      </SettingsRow>
    </SettingsCard>
  </div>
);

export const WithAction = () => (
  <div style={{ width: 520 }}>
    <SettingsCard>
      <SettingsRow label="GitHub App" hint="Installed on 4 repositories">
        <Button variant="outline">Reconnect</Button>
      </SettingsRow>
    </SettingsCard>
  </div>
);
