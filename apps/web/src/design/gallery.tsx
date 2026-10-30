import { cn } from 'cn';
import { useEffect, useState } from 'react';
import { SegmentedRadio } from '../components/segmented.js';
import {
  ConversationSection,
  EmptySection,
  PanelSection,
  SettingsSection,
  TraceSection,
} from './components-content.js';
import {
  BadgeSection,
  ButtonSection,
  ChoiceSection,
  InputSection,
  TooltipSection,
} from './components-controls.js';
import { DialogSection, MenuSection, ToastSection } from './components-overlays.js';
import type { GalleryTheme } from './design-doc.js';
import {
  ColorSection,
  DocCheckSection,
  ElevationSection,
  FoundationsHero,
  MotionSection,
  ShapeSection,
  TypeSection,
} from './foundations.js';
import { BoardPattern, ProvidersPattern } from './patterns.js';
import { GroupTitle } from './specimen.js';

type Density = 'comfortable' | 'compact';

const NAV = [
  {
    id: 'foundations',
    title: 'Foundations',
    items: [
      ['color', 'Color'],
      ['type', 'Type'],
      ['shape', 'Shape'],
      ['elevation', 'Elevation'],
      ['motion', 'Motion'],
      ['doc-check', 'Doc check'],
    ],
  },
  {
    id: 'components',
    title: 'Components',
    items: [
      ['button', 'Button'],
      ['badge', 'Badge and chips'],
      ['tooltip', 'Tooltip and key caps'],
      ['input', 'Inputs and forms'],
      ['choice', 'Selection'],
      ['menu', 'Menu'],
      ['dialog', 'Dialog'],
      ['toast', 'Toast'],
      ['empty', 'Empty and loading'],
      ['settings', 'Settings list'],
      ['panel', 'Panel and avatar'],
      ['conversation', 'Conversation'],
      ['trace', 'Trace'],
    ],
  },
  {
    id: 'patterns',
    title: 'Patterns',
    items: [
      ['board', 'Board'],
      ['providers', 'Empty to filled'],
    ],
  },
] as const;

function useActiveSection(): string {
  const [active, setActive] = useState('color');
  useEffect(() => {
    const sections = [...document.querySelectorAll<HTMLElement>('[data-gallery-section]')];
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.25;
      const current = sections.filter((s) => s.getBoundingClientRect().top <= line).at(-1);
      setActive(current?.id ?? sections[0]?.id ?? '');
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return active;
}

export function Gallery() {
  const [theme, setTheme] = useState<GalleryTheme>(() =>
    document.documentElement.classList.contains('light') ? 'light' : 'dark',
  );
  const [density, setDensity] = useState<Density>('comfortable');
  const active = useActiveSection();

  const changeTheme = (next: GalleryTheme) => {
    document.documentElement.classList.toggle('light', next === 'light');
    document.documentElement.dataset.theme = next;
    setTheme(next);
  };
  const changeDensity = (next: Density) => {
    if (next === 'compact') document.documentElement.dataset.density = 'compact';
    else delete document.documentElement.dataset.density;
    setDensity(next);
  };

  return (
    <div className="flex min-h-screen bg-canvas text-foreground">
      <aside className="sticky top-0 hidden h-screen w-62 flex-none flex-col overflow-y-auto px-3 py-5 md:flex">
        <a href="#top" className="flex items-center gap-2 px-2.5 pb-1 text-foreground no-underline">
          <span
            aria-hidden
            className="size-4 bg-foreground"
            style={{ mask: 'url(/logo-mark.svg) center / contain no-repeat' }}
          />
          <span className="text-heading font-semibold" style={{ fontFamily: 'var(--font-serif)' }}>
            Cairn
          </span>
        </a>
        <span className="px-2.5 pb-5 text-meta text-content-tertiary">Design system</span>
        <nav aria-label="Gallery" className="flex flex-col gap-5">
          {NAV.map((group) => (
            <div key={group.id} className="flex flex-col gap-px">
              <a
                href={`#${group.id}`}
                className="px-2.5 pb-1 text-caption font-medium text-content-tertiary no-underline hover:text-content-secondary"
              >
                {group.title}
              </a>
              {group.items.map(([id, label]) => (
                <a
                  key={id}
                  href={`#${id}`}
                  aria-current={active === id ? 'location' : undefined}
                  className={cn(
                    'flex h-8 items-center rounded-(--radius-control) px-2.5 text-ui no-underline transition-colors duration-(--dur-fast)',
                    active === id
                      ? 'bg-(--sidebar-active) font-medium text-foreground'
                      : 'text-content-secondary hover:bg-sidebar-hover hover:text-foreground',
                  )}
                >
                  {label}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3 px-1 pt-6">
          <SegmentedRadio
            label="Theme"
            value={theme}
            onChange={changeTheme}
            className="w-full"
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
          />
          <SegmentedRadio
            label="Density"
            value={density}
            onChange={changeDensity}
            className="w-full"
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
        </div>
      </aside>
      <main id="top" className="min-w-0 flex-auto bg-background md:border-l md:border-border">
        <div className="mx-auto max-w-250 px-6 pb-40 md:px-12">
          <div key={`${theme}-${density}`}>
            <GroupTitle
              id="foundations"
              title="Cairn"
              lede="The design system behind the workbench: tokens measured live from the app's CSS, the real components, and pages built from them."
            />
            <FoundationsHero theme={theme} />
            <ColorSection />
            <TypeSection />
            <ShapeSection />
            <ElevationSection />
            <MotionSection />
            <DocCheckSection theme={theme} />
          </div>
          <GroupTitle
            id="components"
            title="Components"
            lede="Every specimen below renders the component the app ships, from src/components. Click, type and use the keyboard; they all work."
          />
          <ButtonSection />
          <BadgeSection />
          <TooltipSection />
          <InputSection />
          <ChoiceSection />
          <MenuSection />
          <DialogSection />
          <ToastSection />
          <EmptySection />
          <SettingsSection />
          <PanelSection />
          <ConversationSection />
          <TraceSection />
          <GroupTitle
            id="patterns"
            title="Patterns"
            lede="Page prototypes composed from the components above, with working interactions."
          />
          <BoardPattern />
          <ProvidersPattern />
        </div>
      </main>
    </div>
  );
}
