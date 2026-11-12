import { cn } from 'cn';
import { type CSSProperties, useState } from 'react';
import { avatarInitial, avatarTint } from '../../lib/avatar-tint.js';
import { Avatar, AvatarImage } from './avatar.js';

export interface SeededAvatarProps {
  name?: string | null;
  src?: string | null;
  fallback: string;
  className?: string;
}

export function SeededAvatar({ name, src, fallback, className }: SeededAvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const picture = src && src !== failedSrc ? src : null;
  const initial = name ? avatarInitial(name) : '';
  if (picture === null && name && initial !== '')
    return (
      <Avatar className={cn('@container', className)}>
        <span
          data-slot="avatar-initial"
          aria-hidden="true"
          className="avatar-initial flex size-full items-center justify-center rounded-full leading-none font-semibold"
          style={{ '--avatar-color': avatarTint(name) } as CSSProperties}
        >
          {initial}
        </span>
      </Avatar>
    );
  return (
    <Avatar className={className}>
      <AvatarImage
        keepMounted
        src={picture ?? fallback}
        alt=""
        onLoadingStatusChange={(status) => {
          if (status === 'error' && picture !== null) setFailedSrc(picture);
        }}
      />
    </Avatar>
  );
}
