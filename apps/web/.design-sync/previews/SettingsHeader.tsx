import { Button, SeededAvatar, SettingsHeader } from '@cairn/web';

export const WithAvatar = () => (
  <div style={{ width: 520 }}>
    <SettingsHeader
      avatar={<SeededAvatar className="size-14" name="Implementer" fallback="I" />}
      title="Implementer"
      sub="claude-code · omarchy · 3 tasks running"
      action={<Button variant="outline">Edit</Button>}
    />
  </div>
);

export const TitleOnly = () => (
  <div style={{ width: 520 }}>
    <SettingsHeader title="cairn" sub="xiechimon/cairn · 12 open tasks" />
  </div>
);
