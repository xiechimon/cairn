import { Checkbox, Input, Label, Switch } from '@cairn/web';

export const WithInput = () => (
  <div style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 8 }}>
    <Label htmlFor="project-name">Project name</Label>
    <Input id="project-name" defaultValue="cairn" />
  </div>
);

export const WithControls = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <Label>
      <Checkbox defaultChecked />
      Run web e2e before opening the PR
    </Label>
    <Label>
      <Switch defaultChecked />
      Auto-merge when checks pass
    </Label>
  </div>
);
