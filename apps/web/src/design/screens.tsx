import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from '../icons/index.js';
import type { GalleryTheme } from './design-doc.js';
import { Section, useOnlySpecimen } from './specimen.js';

const FRAME_W = 1200;
const FRAME_H = 760;

const SCREENS = [
  {
    title: 'Workbench',
    url: '/app?scenario=01',
    parts: 'Sidebar, Coordinator greeting, composer, needs-you inbox',
  },
  {
    title: 'Side chat: confirm the plan',
    url: '/app?scenario=17b&thread=7ve0iOkQ-JBpSL98zSiGc',
    parts: 'Coordinator home with the thread side chat, plan card, composer',
  },
  {
    title: 'Side chat: tool calls',
    url: '/app?scenario=28&thread=7ve0iOkQ-JBpSL98zSiGc',
    parts: 'Agent turns, tool activity rows, live row',
  },
  {
    title: 'Project tasks',
    url: '/app/project/ZAQczKCu0MOAzC1ZqcFlX/files?scenario=prj-tasks&tab=tasks',
    parts: 'Project header, segmented tabs, task list',
  },
  {
    title: 'Schedules',
    url: '/app/schedules?scenario=r3-93',
    parts: 'Schedule cards, frequency, next run',
  },
  {
    title: 'Work routing',
    url: '/app/settings/work-routing?scenario=routing-settings',
    parts: 'Settings list, runtime and model pickers',
  },
  {
    title: 'Machines',
    url: '/app/resources/machines?scenario=06',
    parts: 'Resource rows, online status',
  },
  {
    title: 'Providers',
    url: '/app/resources/providers?scenario=01',
    parts: 'Provider list, runtime tabs',
  },
  {
    title: 'Account',
    url: '/app/account?scenario=13',
    parts: 'Profile header, settings card',
  },
] as const;

export function applyFrameTheme(frame: HTMLIFrameElement | null, theme: GalleryTheme) {
  const root = frame?.contentDocument?.documentElement;
  if (root == null) return;
  root.classList.toggle('light', theme === 'light');
  root.dataset.theme = theme;
}

function Screen({
  title,
  url,
  parts,
  theme,
}: {
  title: string;
  url: string;
  parts: string;
  theme: GalleryTheme;
}) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const el = box.current;
    if (el == null) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / FRAME_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    applyFrameTheme(frame.current, theme);
  }, [theme]);

  return (
    <figure className="m-0 overflow-hidden rounded-(--radius-card) bg-card shadow-(--e1)">
      <figcaption className="flex items-center gap-3 border-b border-border px-5 py-3">
        <span className="text-ui font-medium text-foreground">{title}</span>
        <span className="min-w-0 flex-auto truncate text-meta text-content-tertiary">{parts}</span>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex flex-none items-center gap-1 text-meta text-content-secondary no-underline hover:text-foreground"
        >
          Open
          <ExternalLink width={12} height={12} />
        </a>
      </figcaption>
      <div
        ref={box}
        className="relative overflow-hidden bg-canvas"
        style={{ height: FRAME_H * scale }}
      >
        <iframe
          ref={frame}
          title={title}
          src={url}
          loading="lazy"
          tabIndex={-1}
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
          style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${scale})` }}
          onLoad={() => applyFrameTheme(frame.current, theme)}
        />
      </div>
    </figure>
  );
}

export function ScreensSection({ theme }: { theme: GalleryTheme }) {
  if (useOnlySpecimen() != null) return null;
  return (
    <Section
      id="screens"
      title="Screens"
      lede="The product itself, loaded from its sample-data scenarios. Every component on these screens is the shipped one, so this view never drifts from the app. The previews are view-only; Open shows the full page with sample data."
    >
      {SCREENS.map((s) => (
        <Screen key={s.url} title={s.title} url={s.url} parts={s.parts} theme={theme} />
      ))}
    </Section>
  );
}
