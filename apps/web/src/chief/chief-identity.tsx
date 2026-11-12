import { Link, useLocation } from 'react-router';

import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import type { ChiefContent } from '../fixtures/records.js';
import { ROUTING_SETTINGS_HREF } from '../resources/routing-settings-page.js';
import { AVATAR_IMG_CLS } from './recipes.js';

const IDENTITY_CLS = 'inline-flex items-center gap-1.5 self-start text-inherit no-underline';

interface ChiefIdentityProps {
  agent: NonNullable<ChiefContent['agent']>;
}

export function ChiefIdentity({ agent }: ChiefIdentityProps) {
  const { search } = useLocation();
  const face = (
    <>
      <span className={AVATAR_IMG_CLS}>
        <SeededAvatar
          className="size-6"
          name={agent.displayName}
          src={agent.avatarUrl}
          fallback="/avatar-robot-1.svg"
        />
      </span>
      <span className="text-meta leading-4 font-normal text-(--text-secondary)">
        {agent.displayName}
      </span>
    </>
  );
  if (agent.id == null) return <span className={IDENTITY_CLS}>{face}</span>;
  return (
    <Link
      className={`${IDENTITY_CLS} cursor-pointer`}
      to={{ pathname: ROUTING_SETTINGS_HREF, search }}
    >
      {face}
    </Link>
  );
}
