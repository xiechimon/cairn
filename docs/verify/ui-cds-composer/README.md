# ui-cds-composer (PR-7)

Claude Desktop redesign PR-7: composer card shell.

## Changes
- Composer card: `--radius-composer` **20px**, `--shadow-composer` ladder (ring + soft lift), `border-0` (1px hairline retired)
- Grow cap: `--composer-max-h` **384px** (`growCap` wiring)
- Textarea leading: `leading-5`
- Chief drawer inherits the same shadow ladder where it shared the card chrome
- Colors frozen
- detail-3pane e2e border assert updated to `0px` (shadow ring replaces hairline)

## Evidence
- `before/` / `after/` screenshots + card crop
- `after/metrics-after.json`
- e2e: `cds-composer.spec.ts` + detail-3pane composer pins
