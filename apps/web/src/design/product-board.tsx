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
  'folder',
  'flask-conical',
  'rocket',
  'leaf',
  'database',
  'cloud',
  'heart',
  'server',
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
        note="ProjectAvatar: a neutral folder glyph, or the chosen icon; never a letter or a hue"
      >
        <Cell label="default">
          <ProjectAvatar />
          <span className="text-ui">cairn</span>
        </Cell>
        <Cell label="icon tiles">
          {AVATAR_ICONS.map((icon) => (
            <ProjectAvatar key={icon} icon={icon} />
          ))}
        </Cell>
        <Cell label="icon bare">
          {AVATAR_ICONS.map((icon) => (
            <ProjectAvatar key={icon} icon={icon} bare />
          ))}
        </Cell>
      </Specimen>
    </Section>
  );
}
