# ui-cds-settings (PR-8)

Claude Desktop redesign PR-8: settings / resources reading column.

## Changes
- Reading column stays `w-192` (768px) within the 672–768 band
- Settings / resource cards: `--cds-radius-2xl` **16px**, `shadow-none` (tier-2 plate; ring hairline from Card)
- Group rows: `--row-h` **40px** (divided rows compensate 1px hairline)
- Profile card / head corners follow 16px; account rows already ~40px
- Inputs: `--cds-radius-lg` **8px** via app.css (height already 32px / `h-8`); input.tsx stays pristine (S5)
- Empty titles: **15px semibold** + `text-balance`
- Colors frozen

## Evidence
- `before/` / `after/` screenshots
- `after/metrics-after.json`
- e2e: `cds-settings.spec.ts`
