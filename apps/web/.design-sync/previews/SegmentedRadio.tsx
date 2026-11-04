import { SegmentedRadio } from '@cairn/web';
import { useState } from 'react';

export const Theme = () => {
  const [value, setValue] = useState('light');
  return (
    <SegmentedRadio
      label="Theme"
      value={value}
      onChange={setValue}
      options={[
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
        { value: 'system', label: 'System' },
      ]}
    />
  );
};

export const WithDisabled = () => {
  const [value, setValue] = useState('auto');
  return (
    <SegmentedRadio
      label="Merge mode"
      value={value}
      onChange={setValue}
      options={[
        { value: 'auto', label: 'Auto-merge' },
        { value: 'review', label: 'Needs review' },
        { value: 'manual', label: 'Manual', disabled: true },
      ]}
    />
  );
};
