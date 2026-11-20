// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 apps/web/src/runtime/exports.ts
export const DESIGN_HANDOFF_FILENAME = 'DESIGN-HANDOFF.md';
export const DESIGN_MANIFEST_FILENAME = 'DESIGN-MANIFEST.json';

export function safeFilename(name: string, fallback: string): string {
  const slug = (name || fallback)
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

const FRAME_WRAPPER_FILE_RE =
  /(^|\/)(frames?\/|device-frames?\/)|(^|\/)(browser-chrome|device-frame)\.html?$/i;

function isFrameWrapperHtmlFile(file: string): boolean {
  return FRAME_WRAPPER_FILE_RE.test(file);
}

type DesignFileMap = {
  files: string[];
  htmlFiles: string[];
  screenHtmlFiles: string[];
  cssFiles: string[];
  jsFiles: string[];
  assetFiles: string[];
  entryFile: string;
};

function designFileMap(entryFile: string, files?: string[]): DesignFileMap {
  const all = Array.from(new Set([entryFile, ...(files ?? [])])).sort((a, b) => a.localeCompare(b));
  const htmlFiles = all.filter((name) => /\.html?$/i.test(name));
  const screenHtmlFiles = htmlFiles.filter((name) => !isFrameWrapperHtmlFile(name));
  const cssFiles = all.filter((name) => /\.css$/i.test(name));
  const jsFiles = all.filter((name) => /\.[cm]?[jt]sx?$/i.test(name));
  const assetFiles = all.filter(
    (name) => !htmlFiles.includes(name) && !cssFiles.includes(name) && !jsFiles.includes(name),
  );
  const preferredEntryFile = !isFrameWrapperHtmlFile(entryFile)
    ? entryFile
    : screenHtmlFiles.find((name) => /(^|\/)index\.html$/i.test(name)) ||
      screenHtmlFiles[0] ||
      entryFile;
  return {
    files: all,
    htmlFiles,
    screenHtmlFiles,
    cssFiles,
    jsFiles,
    assetFiles,
    entryFile: preferredEntryFile,
  };
}

export function buildDesignManifestContent(opts: {
  title: string;
  entryFile: string;
  files?: string[];
  kind?: 'html' | 'react';
}): string {
  const title = opts.title || 'Cairn page';
  const requestedEntryFile = opts.entryFile || 'index.html';
  const { files, htmlFiles, screenHtmlFiles, cssFiles, jsFiles, assetFiles, entryFile } =
    designFileMap(requestedEntryFile, opts.files);
  const screenFiles = screenHtmlFiles.length > 0 ? screenHtmlFiles : [entryFile];
  return JSON.stringify(
    {
      schema: 'open-design.design-manifest.v1',
      title,
      kind: opts.kind ?? 'html',
      entryFile,
      sourceFiles: {
        all: files,
        html: htmlFiles,
        css: cssFiles,
        scriptsAndComponents: jsFiles,
        assets: assetFiles,
      },
      screens: screenFiles.map((file) => {
        const isIndex = /(^|\/)index\.html?$/i.test(file);
        const isLanding =
          /(^|\/)(landing|marketing)\.html?$/i.test(file) || /landing|marketing/i.test(file);
        const isOsWidget = /widget|live-activity|lock-screen|home-screen/i.test(file);
        const isApp = /app|dashboard|workspace|generator|translator|editor|screen/i.test(file);
        return {
          file,
          role:
            isIndex && screenFiles.length > 1
              ? 'launcher-overview'
              : isLanding
                ? 'landing-page'
                : isOsWidget
                  ? 'os-widget-surface'
                  : isApp
                    ? 'product-screen'
                    : 'screen',
          implementationNote:
            isIndex && screenFiles.length > 1
              ? 'Use this as the navigation/overview entry only; implement each linked screen file as its own route/surface.'
              : 'Preserve visual hierarchy, responsive behavior, and interactive states from this screen.',
        };
      }),
      screenFilePolicy: {
        mode: 'screen-file-first',
        entryFileRole:
          screenFiles.length > 1 && /(^|\/)index\.html?$/i.test(entryFile)
            ? 'launcher-overview'
            : 'primary-screen',
        rules: [
          'Each distinct user-facing screen or surface must be delivered and implemented as its own file/route.',
          'If a landing page is present or requested, keep it in landing.html and do not merge it into the product app screen.',
          'When multiple HTML screens exist, index.html is a launcher/overview only; it must not be treated as the combined final UI.',
          'Keep product app screens, landing pages, platform screens, and OS widget surfaces separate in production code.',
        ],
      },
      appModules: [
        'Identify domain-specific in-app modules from the exported UI; do not reduce them to generic cards.',
        'For each major module, implement purpose, default/loading/empty/error/success states, and responsive behavior.',
        'Keep app modules separate from OS home-screen widgets in the production component model.',
      ],
      osWidgets: [
        'If the export includes home-screen, lock-screen, Live Activity, tablet glance, or Android widget surfaces, implement them as platform quick-access surfaces outside the app UI.',
        'If none are present, do not invent OS widgets unless the product requirements request them.',
      ],
      landingPage: {
        detection:
          'Inspect files and screen names for a marketing/landing page surface. If present, keep it separate from product app screens.',
        requiredSections: [
          'hero',
          'value props',
          'product proof/screenshots',
          'feature proof',
          'CTA',
        ],
      },
      tokens: {
        source: cssFiles.length > 0 ? cssFiles : [entryFile],
        required: [
          'background',
          'surface',
          'foreground',
          'muted text',
          'border',
          'accent',
          'radius',
          'shadow',
          'spacing',
          'type scale',
          'motion',
        ],
        note: 'Extract/freeze tokens before framework implementation so coding tools do not substitute default theme colors or typography.',
      },
      interactions: {
        source: jsFiles.length > 0 ? jsFiles : [entryFile],
        requiredStates: [
          'default',
          'hover',
          'focus',
          'active',
          'disabled',
          'loading',
          'empty',
          'error',
          'success',
        ],
        requiredBehaviors: [
          'forms/validation where present',
          'tabs/filters where present',
          'dialogs/sheets/drawers where present',
          'copy/generate/share actions where present',
          'player or quick controls where present',
        ],
        note: 'If the prototype is static, derive missing behavior from visible controls and document it before coding.',
      },
      responsiveViewports: [
        {
          name: 'mobile-compact',
          width: 360,
          height: 800,
          category: 'mobile',
          mustAvoidHorizontalScroll: true,
        },
        {
          name: 'mobile-standard',
          width: 390,
          height: 844,
          category: 'mobile',
          mustAvoidHorizontalScroll: true,
        },
        {
          name: 'mobile-large',
          width: 430,
          height: 932,
          category: 'mobile',
          mustAvoidHorizontalScroll: true,
        },
        {
          name: 'foldable-small-tablet',
          width: 600,
          height: 960,
          category: 'foldable-tablet',
          mustAvoidHorizontalScroll: true,
        },
        {
          name: 'tablet-portrait',
          width: 820,
          height: 1180,
          category: 'tablet',
          mustAvoidHorizontalScroll: true,
        },
        {
          name: 'tablet-landscape',
          width: 1024,
          height: 768,
          category: 'tablet',
          mustAvoidHorizontalScroll: true,
        },
        {
          name: 'laptop',
          width: 1366,
          height: 768,
          category: 'desktop',
          mustAvoidHorizontalScroll: true,
        },
        {
          name: 'desktop',
          width: 1440,
          height: 900,
          category: 'desktop',
          mustAvoidHorizontalScroll: true,
        },
        {
          name: 'wide',
          width: 1920,
          height: 1080,
          category: 'wide',
          mustAvoidHorizontalScroll: true,
        },
      ],
      implementationChecklist: [
        'Open entryFile first and map screens, modules, tokens, and interactions.',
        'Extract tokens before writing framework components.',
        'Implement app-specific modules with real states instead of generic card grids.',
        'Preserve or rebuild JS interactions for meaningful UX actions.',
        'Validate screenshots at desktop/tablet/mobile viewports with no horizontal overflow.',
        'Keep landing pages, in-app modules, and OS widgets as separate implementation surfaces.',
      ],
    },
    null,
    2,
  );
}

export function buildDesignHandoffContent(opts: {
  title: string;
  entryFile: string;
  files?: string[];
  kind?: 'html' | 'react';
}): string {
  const title = opts.title || 'Cairn page';
  const requestedEntryFile = opts.entryFile || 'index.html';
  const { files, htmlFiles, cssFiles, jsFiles, assetFiles, entryFile } = designFileMap(
    requestedEntryFile,
    opts.files,
  );
  const accentLikelyBrandLed =
    files.some((name) =>
      /(design|brand|tokens?|theme|style|tailwind|variables)\.(css|scss|sass|less|json|ts|tsx|js|jsx|md)$/i.test(
        name,
      ),
    ) || cssFiles.length > 0;
  const hasResponsiveClues =
    htmlFiles.length > 0 ||
    cssFiles.length > 0 ||
    files.some((name) => /(screens?|pages?|components?|app|src)\//i.test(name));
  const list = (items: string[]) =>
    items.length > 0 ? items.map((name) => `- \`${name}\``).join('\n') : '- None detected';
  const sourceNote =
    opts.kind === 'react'
      ? 'Use the exported React source as the component contract, then preserve the rendered visual behavior in the target app.'
      : `Start from \`${entryFile}\`, then preserve the visual system, responsive behavior, and interactions found in the exported files.`;

  return `# ${title} implementation handoff

This archive is the source of truth for turning the design into production code. ${sourceNote}

## Implementation target
- Build production UI from the exported design, not a loose reinterpretation.
- Preserve typography scale, spacing rhythm, color tokens, border radii, shadows, motion timing, and component states.
- Replace static placeholders only when the target app has real data or functional equivalents.
- Keep generated product UI free of Cairn preview chrome, preview labels, or design-process annotations.
- Treat this handoff as a visual contract: if implementation choices conflict, match the exported pixels and behavior first, then refactor internals.

## Source map
- Primary entry: \`${entryFile}\`
- HTML screens detected: ${htmlFiles.length}
- Stylesheets detected: ${cssFiles.length}
- Script/component files detected: ${jsFiles.length}
- Supporting assets detected: ${assetFiles.length}

## Responsive contract
Validate the implementation across this 2025–2026 viewport matrix:
- Mobile compact: 360×800
- Mobile standard: 390×844
- Mobile large: 430×932
- Foldable / small tablet: 600×960
- Tablet portrait: 820×1180
- Tablet landscape: 1024×768
- Laptop: 1366×768
- Desktop: 1440×900
- Wide desktop: 1920×1080

For responsive web exports, treat these as a modern breakpoint system for one adaptive web experience, not three fixed screenshots. Do not split responsive web into unrelated native app screens unless the project explicitly includes native targets. Use semantic layout thresholds, fluid \`clamp()\` type/spacing, and container queries where component width matters more than viewport width. ${hasResponsiveClues ? 'Preserve any CSS media queries, container queries, fluid `clamp()` scales, and layout changes already present in the exported files.' : 'If responsive rules are not present in the export, add them in the target implementation before shipping.'}

## Design fidelity contract
- Extract reusable tokens before writing components: background, surface, foreground, muted text, border, accent, radius, shadow, spacing, type scale, and motion duration/easing.
- Map product screens, in-app modules/components, optional landing page, and optional OS widget surfaces before coding. Keep these surfaces separate in the target architecture.
- Match layout geometry: max-widths, gutters, grid columns, card proportions, sticky/fixed elements, and viewport-specific navigation.
- Preserve real copy, labels, and data shown in the export. Do not replace specific text with generic marketing filler.
- Preserve interactive affordances: hover, focus, pressed, disabled, loading, validation, copy/share, tab/accordion, modal/sheet, and keyboard states where present.
- Preserve accessibility semantics when converting: headings stay hierarchical, controls remain buttons/links/inputs, focus states stay visible.
- Do not keep prototype-only annotations, frame labels, or Cairn preview chrome in the production UI.

## CJX-ready UX contract
- Use \`${DESIGN_MANIFEST_FILENAME}\` as the machine-readable map for screens, app modules, OS widgets, landing pages, tokens, interactions, and viewport checks.
- Screen-file-first: when multiple user-facing surfaces exist, implement each HTML screen as its own route/file. Treat \`index.html\` as a launcher/overview when the manifest marks it that way, not as a combined final UI.
- If \`landing.html\`, app screens, platform screens, or OS widget files exist, preserve those boundaries in the target app instead of merging them into one page.
- A single self-contained \`${entryFile}\` is acceptable only when the export truly contains one user-facing screen and its CSS/JS are structured enough to extract tokens, components, states, and behavior.
- If separate \`css/\` or \`js/\` files exist, treat them as source of truth for token/component/interactions before porting to React, Vue, SwiftUI, Compose, or another target stack.
- In-app modules/components are product UI blocks inside the app. OS widgets are home-screen/lock-screen/quick-access surfaces outside the app. Do not merge those concepts.

## Color and brand contract
- Use the exported design tokens and product/domain context as the color source of truth.
- Do not introduce warm beige / cream / peach / pink / orange-brown background washes unless they are already explicit brand/reference colors in the export.
- ${accentLikelyBrandLed ? 'A stylesheet or design/token file was detected; inspect it for canonical color variables before choosing framework theme tokens.' : 'No obvious token stylesheet was detected; sample colors from the entry file and convert them into named tokens before coding.'}

## Implementation sequence for AI coding tools
1. Open \`${entryFile}\` and \`${DESIGN_MANIFEST_FILENAME}\`; identify every screen file, launcher/overview file, app module, and interaction before coding.
2. If multiple HTML screens exist, map them to separate routes/surfaces first; do not merge \`landing.html\`, product app screens, platform screens, or OS widgets into one route.
3. Extract a token table from CSS/root styles and inline styles before building framework components.
4. Build product screens and domain-specific in-app modules from largest layout regions down to controls; avoid starting with isolated atoms that lose spatial intent.
5. Port responsive behavior across the modern viewport matrix and test each semantic breakpoint before cleanup.
6. Port interactions and states, then replace static placeholders only with real app data or functional equivalents.
7. Keep optional landing page and OS widget surfaces as separate surfaces if present.
8. Compare final screenshots against the export at 360×800, 390×844, 430×932, 820×1180, 1024×768, 1366×768, 1440×900, and 1920×1080 before declaring done.

## Entry points
${list(htmlFiles.length > 0 ? htmlFiles : [entryFile])}

## Styles
${list(cssFiles)}

## Scripts/components
${list(jsFiles)}

## Assets and supporting files
${list(assetFiles)}

## Coding checklist for AI tools
1. Inspect \`${entryFile}\` and \`${DESIGN_MANIFEST_FILENAME}\` first and identify reusable components before coding.
2. Implement each user-facing screen file as its own route/surface; keep launcher, landing, app, platform, and OS widget files separate.
3. Extract design tokens into the target stack: colors, type scale, spacing, radius, shadows, and motion.
4. Implement layout with real 2025–2026 responsive breakpoints, fluid type/spacing, and container-query-aware component behavior; test with no horizontal overflow.
5. Preserve interactive controls, hover/focus/pressed states, form behavior, validation, and copy actions where present.
6. Implement domain-specific in-app modules with real states; do not flatten them into generic cards.
7. Keep landing page, product screens, and OS widget/quick-access surfaces separate when present.
8. Confirm the production result visually matches the exported design before refactoring internals.
9. Reject implementation shortcuts that flatten the design into generic cards, generic gradients, placeholder stats, or framework-default typography.
10. If a detail is ambiguous, keep the exported HTML/CSS/JS behavior rather than inventing a new pattern.
`;
}
