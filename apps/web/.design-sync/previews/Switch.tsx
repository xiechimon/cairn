import { Label, Switch } from '@cairn/web';

const col = { display: 'flex', flexDirection: 'column', gap: 12 } as const;

export const States = () => (
  <div style={col}>
    <Label><Switch defaultChecked /> Auto-merge when checks pass</Label>
    <Label><Switch /> Notify on every build step</Label>
    <Label><Switch disabled defaultChecked /> Require human review (locked by policy)</Label>
  </div>
);

export const Sizes = () => (
  <div style={col}>
    <Label><Switch size="sm" defaultChecked /> Compact: show queued tasks</Label>
    <Label><Switch size="sm" /> Compact: show archived projects</Label>
  </div>
);
