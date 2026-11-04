# Theme (appearance)

Users switch light/dark: the root element re-skins instantly (`html.light` + `data-theme`), the choice persists in the `cairn-theme` localStorage key and survives reload; with no stored value it follows the system color (the e2e colorScheme dark is exactly this default).

## Sub-features

- `theme-apply` switching repaints instantly: root `.light` class + `dataset.theme`.
- `theme-persist` the `cairn-theme` key lands in localStorage and still applies after reload (apps/web/src/theme.ts `THEME_STORAGE_KEY`).
- `theme-segments` the user-menu popover `外观` segmented row (light/dark, `data-active` follows) — **the live surface currently has no popover trigger** (see Gotchas).

## How to get to it (user POV)

- The user-menu popover `外观` row (light/dark segments).
- Editing the `cairn-theme` storage directly (developer path; currently the only drivable path on the live surface).
- Driving (`vp.mjs list theme` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive theme persist`: light / dark written into `cairn-theme`, survives reload.
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive theme sealed-tokens-audit`: retired rules absent under both themes, selected-row color and token contrast.

## Driving it with verify-cairn

Preconditions:

- `launch.mjs` stack up + `doctor.mjs` fully PASS.

- **Two-way persistence.** Run `node <skill>/scripts/drive.mjs theme`. Chain: default dark screenshot -> `localStorage.setItem('cairn-theme','light')` + reload -> `dataset.theme='light'` and the root has `.light` -> screenshot; then set 'dark' + reload -> back to dark. Evidence `01-theme-default-dark.png` / `02-theme-light.png` / `03-theme-dark.png` + `result.json`.
- **Injection as initial value.** The storage-injection path uses the same key: inject light before reload and the first frame is light (the fixture e2e theme-toggle.spec.ts test 3 already pins it; the live re-check via the same probe is covered — the probe's write is the same injection path).

## Gotchas

- **The popover trigger is fixture-only**: `UserMenu` mounts only when `!live && detail.userMenuOpen` (todo-detail-page.tsx); the live UI has no button to open the user menu (the trigger belongs to a later ticket). Do not look for `.user-menu-seg` in a live drive — not finding it is not a bug.
- The theme key is `cairn-theme` (**hyphen**); only the i18n locale key is `cairn.locale` (**dot**), do not mix them up.
- The assertion trio: `dataset.theme` + root `.light` class + localStorage value; looking only at the background color gets fooled by screenshot compression.
- The probe drives via reload and does not touch the system colorScheme; the e2e follow-system assertion (`emulateMedia`) belongs to the fixture surface and is not repeated here.
