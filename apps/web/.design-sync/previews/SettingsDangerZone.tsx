import { SettingsDangerZone } from '@cairn/web';

export const DeleteProject = () => (
  <div style={{ width: 520 }}>
    <SettingsDangerZone
      label="Delete project"
      description="Removes cairn, its tasks, schedules and build history. This cannot be undone."
      actionLabel="Delete project"
    />
  </div>
);

export const Disabled = () => (
  <div style={{ width: 520 }}>
    <SettingsDangerZone
      label="Remove machine"
      description="omarchy still has 2 running builds. Evacuate it first."
      actionLabel="Remove machine"
      disabled
    />
  </div>
);
