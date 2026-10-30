import { ProfileHeader, SeededAvatar } from '@cairn/web';

const noop = () => {};

export const Agent = () => (
  <div style={{ width: 420 }}>
    <ProfileHeader
      avatar={<SeededAvatar className="size-14" name="Implementer" />}
      name="Implementer"
      sub="Avatar and name"
      onRename={noop}
    />
  </div>
);

export const Reviewer = () => (
  <div style={{ width: 420 }}>
    <ProfileHeader
      avatar={<SeededAvatar className="size-14" name="Reviewer" />}
      name="Reviewer"
      sub="Avatar and name"
      onRename={noop}
    />
  </div>
);
