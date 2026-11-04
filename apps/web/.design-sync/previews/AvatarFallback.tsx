import { Avatar, AvatarFallback } from '@cairn/web';

export const Initials = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Avatar size="sm"><AvatarFallback>IM</AvatarFallback></Avatar>
    <Avatar><AvatarFallback>RV</AvatarFallback></Avatar>
    <Avatar size="lg"><AvatarFallback>PL</AvatarFallback></Avatar>
  </div>
);
