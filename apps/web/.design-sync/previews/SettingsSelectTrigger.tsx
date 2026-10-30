import { Select, SelectContent, SelectItem, SelectValue, SettingsCard, SettingsRow, SettingsSelectTrigger } from '@cairn/web';

const machines = [
  { value: 'omarchy', label: 'omarchy' },
  { value: 'xmonsMac', label: 'xmonsMac' },
];

export const Closed = () => (
  <div style={{ width: 520 }}>
    <SettingsCard>
      <SettingsRow label="Move agents to" hint="Agents on this machine migrate to the target.">
        <Select defaultValue="omarchy" items={machines}>
          <SettingsSelectTrigger>
            <SelectValue />
          </SettingsSelectTrigger>
          <SelectContent>
            {machines.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
    </SettingsCard>
  </div>
);
