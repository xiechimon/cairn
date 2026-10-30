import { Avatar, AvatarFallback, AvatarImage } from '@cairn/web';

const PHOTO = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="%23c9a27e"/><circle cx="20" cy="16" r="7" fill="%23f4e6d4"/><rect x="9" y="26" width="22" height="14" rx="7" fill="%23f4e6d4"/></svg>';

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Avatar size="sm"><AvatarFallback>IM</AvatarFallback></Avatar>
    <Avatar><AvatarFallback>IM</AvatarFallback></Avatar>
    <Avatar size="lg"><AvatarFallback>IM</AvatarFallback></Avatar>
  </div>
);

export const ImageAndFallback = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Avatar size="lg"><AvatarImage src={PHOTO} alt="ian" /><AvatarFallback>IA</AvatarFallback></Avatar>
    <Avatar size="lg"><AvatarFallback>RV</AvatarFallback></Avatar>
  </div>
);
