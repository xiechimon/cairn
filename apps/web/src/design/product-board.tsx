import { useState } from 'react';
import { BackupBanner } from '../board/backup-banner.js';
import type { BoardFilters } from '../board/board.js';
import {
  type FilterChip,
  FilterChips,
  type FilterDimension,
  FilterPanel,
} from '../board/filter-panel.js';
import { FirstPrCard } from '../board/first-pr-card.js';
import { NotificationBanner } from '../board/notify-banner.js';
import { ProjectAvatar } from '../board/project-avatar.js';
import { QuotaBanner, quotaBannerInfo } from '../board/quota-banner.js';
import type { TodoRecord } from '../fixtures/records.js';
import { BOARD_FIXTURE, NOW, TAGS, tagOf, todo } from './product-fixtures.js';
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

function useTagFilters(todos: readonly TodoRecord[]): BoardFilters {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (value: string) =>
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  const dimension: FilterDimension = {
    key: 'tag',
    name: 'Tag',
    choices: TAGS.map((tag) => ({
      value: tag.id,
      label: tag.name,
      color: tag.color,
      count: todos.filter((t) => t.tagIds.includes(tag.id)).length,
    })),
    selected,
    onToggle: toggle,
    onSelectAll: () => setSelected(TAGS.map((tag) => tag.id)),
    onInvert: () => setSelected(TAGS.map((tag) => tag.id).filter((id) => !selected.includes(id))),
    onClear: () => setSelected([]),
    onOnly: (value) => setSelected([value]),
  };
  const chips: FilterChip[] = selected.map((id) => ({
    key: `tag:${id}`,
    label: tagOf(id)?.name ?? id,
    onClear: () => toggle(id),
  }));
  return {
    dimensions: [dimension],
    chips,
    totalSelected: selected.length,
    active: selected.length > 0,
    matches: (todo) => todo.tagIds.some((id) => selected.includes(id)),
    onClear: () => setSelected([]),
    summary: chips.map((chip) => chip.label).join(', '),
  };
}

function FilterSpecimen() {
  const filters = useTagFilters(BOARD_FIXTURE.todos);
  return (
    <Specimen
      title="Filter panel and chips"
      note="Open the panel and pick tags; chips appear beside it"
      stage="canvas"
    >
      <div className="flex min-w-0 items-center gap-3">
        <FilterPanel
          dimensions={filters.dimensions}
          totalSelected={filters.totalSelected}
          onClearAll={filters.onClear}
        />
        <FilterChips chips={filters.chips} onClearAll={filters.onClear} />
      </div>
    </Specimen>
  );
}

export function ProductBoardSection() {
  const [_lastAction, setLastAction] = useState<string | null>(null);
  const [firstPrShown, setFirstPrShown] = useState(true);
  return (
    <Section
      id="product-board"
      title="Filters and banners"
      lede="Filters, the banners shown above a list, and the project avatar. The board and its task cards are retired with prototype A."
    >
      <FilterSpecimen />
      <Specimen title="Banners" note="Shown above the columns" stage="canvas" className="flex-col">
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
      <Specimen title="Project avatar" note="ProjectAvatar, six tones cycling by index">
        {['cairn', 'docs-site', 'mobile', 'infra', 'billing', 'search', 'api'].map((name, i) => (
          <Cell key={name} label={`tone ${i}`}>
            <ProjectAvatar name={name} tone={i} />
            <ProjectAvatar name={name} tone={i} className="size-7 text-ui" />
            <span className="text-ui">{name}</span>
          </Cell>
        ))}
      </Specimen>
    </Section>
  );
}
