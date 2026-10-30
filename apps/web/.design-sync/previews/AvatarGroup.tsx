import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from '@cairn/web';

const PHOTOS = [
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="%23c9a27e"/><circle cx="20" cy="16" r="7" fill="%23f4e6d4"/><rect x="9" y="26" width="22" height="14" rx="7" fill="%23f4e6d4"/></svg>',
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="%237f9a86"/><circle cx="20" cy="16" r="7" fill="%23f4e6d4"/><rect x="9" y="26" width="22" height="14" rx="7" fill="%23f4e6d4"/></svg>',
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="%238a8fb0"/><circle cx="20" cy="16" r="7" fill="%23f4e6d4"/><rect x="9" y="26" width="22" height="14" rx="7" fill="%23f4e6d4"/></svg>',
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="%23b07f7f"/><circle cx="20" cy="16" r="7" fill="%23f4e6d4"/><rect x="9" y="26" width="22" height="14" rx="7" fill="%23f4e6d4"/></svg>',
];

export const Agents = () => (
  <AvatarGroup>
    <Avatar><AvatarImage src={PHOTOS[0]} alt="Implementer" /><AvatarFallback>IM</AvatarFallback></Avatar>
    <Avatar><AvatarImage src={PHOTOS[1]} alt="Reviewer" /><AvatarFallback>RV</AvatarFallback></Avatar>
    <Avatar><AvatarImage src={PHOTOS[2]} alt="Planner" /><AvatarFallback>PL</AvatarFallback></Avatar>
    <Avatar><AvatarImage src={PHOTOS[3]} alt="Chief" /><AvatarFallback>CH</AvatarFallback></Avatar>
  </AvatarGroup>
);

export const Large = () => (
  <AvatarGroup>
    <Avatar size="lg"><AvatarImage src={PHOTOS[0]} alt="Implementer" /><AvatarFallback>IM</AvatarFallback></Avatar>
    <Avatar size="lg"><AvatarImage src={PHOTOS[1]} alt="Reviewer" /><AvatarFallback>RV</AvatarFallback></Avatar>
    <AvatarGroupCount>+5</AvatarGroupCount>
  </AvatarGroup>
);
