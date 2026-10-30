# Claude Design sync notes

- Shape is `package` in synth-entry mode: `@cairn/web` is an app, not a published library, so there is no `dist/`. The converter synthesizes the entry from `src/components/**` (`srcDir`).
- The converter looks for the package under `node_modules/@cairn/web`. In this repo it does not exist; before building, run `ln -sfn ../.. node_modules/@cairn/web` from `apps/web` (gitignored, recreate per clone).
- Tailwind v4 is compiled by Vite, not by esbuild, so `cssEntry` points at a compiled copy in `.design-sync/.cache/app.css`. `buildCmd` produces it: a Vite build into `.design-sync-css/`, then a copy with `/fonts/` URLs rewritten to `../../public/fonts/`. Rerun `buildCmd` whenever components or styles change.
- Only utility classes the app already uses exist in the compiled CSS. Previews and designs should use component props and inline layout styles, not new Tailwind classes.
- `src/i18n/en.ts` pulls fixtures, which pull `@cairn/shared`'s barrel, which imports `node:crypto` (`otel.ts`). Vite drops it; esbuild cannot. `.design-sync/tsconfig.json` maps `node:crypto` to `.design-sync/shims/node-crypto.ts` (a throwing stub never reached by UI code).
- cairn's default theme is dark; the Paper light theme needs the `light` class. `.design-sync/paper-root.tsx` exports `PaperRoot`, bundled through `extraEntries` and used as `cfg.provider`. It also sets `light` on `<html>` so portaled overlays (dialogs, menus, popovers) render light.
- Overlay components need `cardMode: single` with a viewport so the open state renders inside the card.

## Re-sync risks

- `buildCmd` uses BSD `sed -i ''` (macOS). On Linux use `sed -i`.
- The compiled CSS is a snapshot of the app's used utilities; a component change that adds classes needs `buildCmd` rerun before the converter, or the new classes are missing.
- The `node:crypto` shim hides any future runtime use of `@cairn/shared` hashing in UI code; such a call would throw in previews.

## Preview techniques (first sync, folded from wave learnings)

- `PaperRoot` mounts `I18nProvider` (default locale `zh`): many components call `useI18n()` and render blank without it.
- `PaperRoot` adds `light` to `<html>` at module scope, before React renders: `Toaster` reads the root class in a `useState` initializer and otherwise picks the dark theme.
- Base UI Menu: `open` plus `modal={false}` on `DropdownMenu`, `open` on `DropdownMenuSub`.
- `IconTooltip` has no `open` prop: wrap in `TooltipProvider` (delay 0) and focus the trigger in an effect.
- `MessageScroller` needs `MessageScrollerProvider` with `defaultScrollPosition` and a fixed-height parent.
- Open Select previews pass `alignItemWithTrigger={false}`, except the scroll-arrow cards, which need item-aligned mode and a single-card viewport.
- `ModelPickList` focuses on mount; the preview blurs `document.activeElement` to avoid a focus outline in the capture.
- A preview file cannot declare a local component with the same name as an exported cell.
- Arbitrary Tailwind values work only if the app already uses them; check `.design-sync/.cache/app.css`.

## Source bugs found by the sync

- Separator and Tabs orientation variants never matched Base UI's `data-orientation`; fixed in #2218 by mapping `data-horizontal` / `data-vertical` in `app.css`. Tabs previews still carry `flexDirection: 'column'` as harmless glue.

## More preview techniques

- Sub-part previews reuse their parent's composition (every Card sub-part shows the same task card, every Panel sub-part the same machine panel).
- Icons in `src/icons` are not exported through the bundle; previews that need icons inline small SVGs.
- `AttachmentGroup` scrolls sideways; its preview wrapper is 720px wide so three items fit.

## Known render warns

- `ThinkingRow` text is faint by design (component styling), not a preview defect.
