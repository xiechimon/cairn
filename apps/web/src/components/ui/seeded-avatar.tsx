import { useState } from 'react';
import { spiralAvatarUrl } from '../../lib/spiral-avatar.js';
import { Avatar, AvatarImage } from './avatar.js';

export interface SeededAvatarProps {
  name?: string | null;
  src?: string | null;
  fallback: string;
  className?: string;
  busy?: boolean;
}

export function SeededAvatar({ name, src, fallback, className, busy = false }: SeededAvatarProps) {
  const generated = name ? spiralAvatarUrl(name, busy) : fallback;
  const resolved = src || generated;
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const failed = failedFor === resolved;
  return (
    <Avatar className={className}>
      <AvatarImage
        keepMounted
        src={failed ? fallback : resolved}
        alt=""
        onLoadingStatusChange={(status) => {
          if (status === 'error' && !failed) setFailedFor(resolved);
        }}
      />
    </Avatar>
  );
}
