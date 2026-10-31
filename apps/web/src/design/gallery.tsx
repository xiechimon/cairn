import { cn } from 'cn';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { SegmentedRadio } from '../components/segmented.js';
import {
  AvatarSection,
  ConversationSection,
  EmptySection,
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
import { IdentitySection, StreamSection, StructureSection } from './components-more.js';
import { DialogSection, MenuSection, ToastSection } from './components-overlays.js';
import {
  CoordinatorStreamSection,
  ProjectsSection,
  RoutingSection,
  SidebarSection,
} from './components-shell.js';
import { StoneSection, ThreadCardSection, ThreadRowSection } from './components-stone.js';
import {
  PermissionSection,
  PlanSection,
  PrBarSection,
  ScheduledSection,
} from './components-threads.js';
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
import { ProvidersPattern } from './patterns.js';
import { ProductBoardSection } from './product-board.js';
import { ProductChiefSection } from './product-chief.js';
import { ProductDetailSection } from './product-detail.js';
import { ProductOverlaysSection } from './product-overlays.js';
import { ProductPagesSection } from './product-pages.js';
import { ProductProviders } from './product-providers.js';
import { ScreensSection } from './screens.js';
import { GroupTitle } from './specimen.js';

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
      ['avatar', 'Avatar'],
      ['conversation', 'Conversation'],
      ['trace', 'Trace'],
      ['structure', 'Structure primitives'],
      ['identity', 'Agents and models'],
      ['stream', 'Live stream'],
    ],
  },
  {
    id: 'product',
    title: 'Product',
    items: [
      ['product-board', 'Filters and banners'],
      ['product-detail', 'Task detail'],
      ['product-chief', 'Coordinator'],
      ['product-overlays', 'Overlays and pickers'],
      ['product-pages', 'Page parts'],
    ],
  },
  {
    id: 'inbox-threads',
    title: 'Inbox and threads',
    items: [
      ['stone', 'Inbox groups'],
      ['thread-card', 'Thread card'],
      ['thread-row', 'Thread row and bulk bar'],
      ['permission', 'Permission and proposal'],
      ['plan', 'Plan approval, usage'],
      ['pr-bar', 'Pull request bar'],
      ['scheduled', 'Scheduled task row'],
      ['sidebar', 'Sidebar parts'],
      ['projects-lists', 'Projects, lists, phone'],
      ['coordinator', 'Coordinator stream'],
      ['routing', 'Model routing'],
    ],
  },
  {
    id: 'patterns',
    title: 'Patterns',
    items: [
      ['providers', 'Empty to filled'],
      ['screens', 'Screens'],
    ],
  },
] as const;

function useActiveSection(scroller: RefObject<HTMLElement | null>): string {
  const [active, setActive] = useState('color');
  useEffect(() => {
    const el = scroller.current;
    if (el == null) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const sections = [...el.querySelectorAll<HTMLElement>('[data-gallery-section]')];
      const line = el.getBoundingClientRect().top + el.clientHeight * 0.25;
      const current = sections.filter((s) => s.getBoundingClientRect().top <= line).at(-1);
      setActive(current?.id ?? sections[0]?.id ?? '');
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [scroller]);
  return active;
}

export function Gallery() {
  const [theme, setTheme] = useState<GalleryTheme>(() =>
    document.documentElement.classList.contains('light') ? 'light' : 'dark',
  );
  const scroller = useRef<HTMLElement>(null);
  const active = useActiveSection(scroller);

  const changeTheme = (next: GalleryTheme) => {
    document.documentElement.classList.toggle('light', next === 'light');
    document.documentElement.dataset.theme = next;
    setTheme(next);
  };
  const controls = (
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
  );

  return (
    <div className="flex h-full bg-canvas text-foreground">
      <aside className="hidden h-full w-62 flex-none flex-col overflow-y-auto px-3 py-5 md:flex">
        <a href="#top" className="flex items-center gap-2 px-2.5 pb-1 text-foreground no-underline">
          <span
            aria-hidden
            className="size-4 bg-foreground"
            style={{ mask: 'url(/logo-mark.svg) center / contain no-repeat' }}
          />
          <span
            className="text-heading font-semibold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
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
        <div className="mt-auto flex flex-col gap-3 px-1 pt-6">{controls}</div>
      </aside>
      <main
        id="top"
        ref={scroller}
        className="h-full min-w-0 flex-auto overflow-y-auto scroll-smooth bg-background motion-reduce:scroll-auto md:border-l md:border-border"
      >
        <div className="sticky top-0 z-(--z-docked) flex flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2.5 md:hidden">
          {controls}
        </div>
        <div className="mx-auto max-w-250 px-6 pb-40 md:px-12">
          <div key={theme}>
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
          <AvatarSection />
          <ConversationSection />
          <TraceSection />
          <StructureSection />
          <IdentitySection />
          <StreamSection />
          <GroupTitle
            id="product"
            title="Product"
            lede="The app's own components from board, detail, chief, overlay and pages, rendered with sample data in every state they ship."
          />
          <ProductProviders>
            <ProductBoardSection />
            <ProductDetailSection />
            <ProductChiefSection />
            <ProductOverlaysSection />
            <ProductPagesSection theme={theme} />
          </ProductProviders>
          <GroupTitle
            id="inbox-threads"
            title="Inbox and threads"
            lede="The inbox groups, thread cards and rows, and the bars prototype A is built from, as reusable components in src/components. Pages compose only these."
          />
          <StoneSection />
          <ThreadCardSection />
          <ThreadRowSection />
          <PermissionSection />
          <PlanSection />
          <PrBarSection />
          <ScheduledSection />
          <SidebarSection />
          <ProjectsSection />
          <CoordinatorStreamSection />
          <RoutingSection />
          <GroupTitle
            id="patterns"
            title="Patterns"
            lede="Page prototypes composed from the components above, with working interactions."
          />
          <ProvidersPattern />
          <ScreensSection theme={theme} />
        </div>
      </main>
    </div>
  );
}
