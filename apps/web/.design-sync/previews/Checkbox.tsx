import { Checkbox } from '@cairn/web';

const row = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } as const;

export const States = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <label style={row}>
      <Checkbox defaultChecked />
      Run web e2e before opening the PR
    </label>
    <label style={row}>
      <Checkbox />
      Auto-merge when CI is green
    </label>
    <label style={row}>
      <Checkbox indeterminate />
      Select all tasks in cairn
    </label>
  </div>
);

export const Disabled = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <label style={row}>
      <Checkbox disabled defaultChecked />
      Require independent review (enforced by project)
    </label>
    <label style={row}>
      <Checkbox disabled />
      Allow force push
    </label>
  </div>
);
