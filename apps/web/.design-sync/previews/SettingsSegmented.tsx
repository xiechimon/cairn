import { SettingsCard, SettingsRow, SettingsSegmented } from '@cairn/web';
import { useState } from 'react';

export const InRow = () => {
  const [value, setValue] = useState('zh');
  return (
    <div style={{ width: 520 }}>
      <SettingsCard>
        <SettingsRow label="Language">
          <SettingsSegmented
            label="Language"
            value={value}
            onChange={setValue}
            options={[
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'English' },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Density">
          <SettingsSegmented
            label="Density"
            value="compact"
            onChange={() => {}}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfortable', label: 'Comfortable' },
            ]}
          />
        </SettingsRow>
      </SettingsCard>
    </div>
  );
};
