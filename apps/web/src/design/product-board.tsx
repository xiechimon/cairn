import { useState } from 'react';
import { BackupBanner } from '../board/backup-banner.js';
import { FirstPrCard } from '../board/first-pr-card.js';
import { NotificationBanner } from '../board/notify-banner.js';
import { ProjectAvatar } from '../board/project-avatar.js';
import { QuotaBanner, quotaBannerInfo } from '../board/quota-banner.js';
import { NOW, todo } from './product-fixtures.js';
import { Cell, Labeled, Section, Specimen } from './specimen.js';

const quotaTodo = (providerId: string, kind: 'quota' | 'capacity', minutes: number) =>
  todo({
    title: 'Waiting on quota',
    phase: 'building',
    quotaWait: {
      kind,
      providerId,
      label: providerId,
      retryAfterMs: null,
      probeAt: NOW + minutes * 60_000,
    },
  });

const QUOTA_ONE =
  quotaBannerInfo([quotaTodo('Claude', 'quota', 30), quotaTodo('Claude', 'quota', 45)]) ?? [];
const QUOTA_MANY =
  quotaBannerInfo([quotaTodo('Claude', 'quota', 30), quotaTodo('Codex', 'capacity', 10)]) ?? [];

const AVATAR_ICONS = [
  ['folder', undefined],
  ['flask-conical', 'plum'],
  ['rocket', 'amber'],
  ['leaf', 'moss'],
  ['database', 'slate'],
  ['cloud', 'teal'],
  ['heart', 'rose'],
  ['server', 'gray'],
] as const;

export function ProductBoardSection() {
  const [_lastAction, setLastAction] = useState<string | null>(null);
  const [firstPrShown, setFirstPrShown] = useState(true);
  return (
    <Section
      id="product-board"
      title="Banners"
      lede="The banners shown above the home conversation, and the project avatar."
    >
      <Specimen
        id="banners"
        title="Banners"
        note="Shown above the home conversation"
        stage="canvas"
        className="flex-col"
      >
        <Labeled label="NotificationBanner">
          <NotificationBanner onEnable={() => setLastAction('enable notifications')} />
        </Labeled>
        <Labeled label="QuotaBanner, one lane">
          <QuotaBanner infos={QUOTA_ONE} />
        </Labeled>
        <Labeled label="QuotaBanner, several lanes">
          <QuotaBanner infos={QUOTA_MANY} />
        </Labeled>
        <Labeled label="BackupBanner, stale">
          <BackupBanner notice={{ kind: 'stale', host: 'cairn-server', hours: 52 }} />
        </Labeled>
        <Labeled label="BackupBanner, failing">
          <BackupBanner
            notice={{ kind: 'failing', host: 'cairn-server', detail: 'failed exit 2', hours: 6 }}
          />
        </Labeled>
        <Labeled label="BackupBanner, unreadable">
          <BackupBanner notice={{ kind: 'unreadable' }} />
        </Labeled>
        <Labeled label="FirstPrCard">
          {firstPrShown ? (
            <FirstPrCard
              info={{ href: 'https://github.com', title: '', body: '', daysToFirstPr: 3 }}
              onDismiss={() => setFirstPrShown(false)}
            />
          ) : (
            <span className="text-meta text-content-tertiary">
              Dismissed. Reload to see it again.
            </span>
          )}
        </Labeled>
      </Specimen>
      <Specimen
        id="project-avatar"
        title="Project avatar"
        note="ProjectAvatar: letter tile by index tone, or a chosen icon and colour"
      >
        {['cairn', 'docs-site', 'mobile', 'infra', 'billing', 'search', 'api'].map((name, i) => (
          <Cell key={name} label={`tone ${i}`}>
            <ProjectAvatar name={name} tone={i} />
            <ProjectAvatar name={name} tone={i} className="size-7 text-ui" />
            <span className="text-ui">{name}</span>
          </Cell>
        ))}
        <Cell label="icon tiles">
          {AVATAR_ICONS.map(([icon, color]) => (
            <ProjectAvatar key={icon} name={icon} tone={0} icon={icon} color={color} />
          ))}
        </Cell>
        <Cell label="icon bare">
          {AVATAR_ICONS.map(([icon, color]) => (
            <ProjectAvatar key={icon} name={icon} tone={0} icon={icon} color={color} bare />
          ))}
        </Cell>
      </Specimen>
    </Section>
  );
}
