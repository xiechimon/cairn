import { Avatar, AvatarBadge, AvatarFallback } from '@cairn/web';

export const Online = () => (
  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
    <Avatar size="sm"><AvatarFallback>IM</AvatarFallback><AvatarBadge /></Avatar>
    <Avatar><AvatarFallback>IM</AvatarFallback><AvatarBadge /></Avatar>
    <Avatar size="lg"><AvatarFallback>IM</AvatarFallback><AvatarBadge /></Avatar>
  </div>
);
