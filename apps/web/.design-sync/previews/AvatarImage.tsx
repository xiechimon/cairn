import { Avatar, AvatarFallback, AvatarImage } from '@cairn/web';

const PHOTO = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="%23c9a27e"/><circle cx="20" cy="16" r="7" fill="%23f4e6d4"/><rect x="9" y="26" width="22" height="14" rx="7" fill="%23f4e6d4"/></svg>';

export const Image = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Avatar size="sm"><AvatarImage src={PHOTO} alt="ian" /><AvatarFallback>IA</AvatarFallback></Avatar>
    <Avatar><AvatarImage src={PHOTO} alt="ian" /><AvatarFallback>IA</AvatarFallback></Avatar>
    <Avatar size="lg"><AvatarImage src={PHOTO} alt="ian" /><AvatarFallback>IA</AvatarFallback></Avatar>
  </div>
);
