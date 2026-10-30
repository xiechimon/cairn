import { Button } from '@cairn/web';

export const Variants = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <Button>New task</Button>
    <Button variant="outline">Filter</Button>
    <Button variant="secondary">Schedules</Button>
    <Button variant="ghost">Cancel</Button>
    <Button variant="destructive">Delete project</Button>
    <Button variant="link">View details</Button>
  </div>
);

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <Button size="xs">Retry</Button>
    <Button size="sm">Retry</Button>
    <Button>Retry</Button>
    <Button size="lg">Retry</Button>
  </div>
);

export const Disabled = () => (
  <div style={{ display: 'flex', gap: 8 }}>
    <Button disabled>Merging…</Button>
    <Button variant="outline" disabled>Filter</Button>
  </div>
);
