---
Category: After removing the e2e key-retry loop, one hotkeys case pressed Escape once and only closed the hover tooltip layer while the dialog stayed open; the retry had masked this stacking issue
Source: #1471 (2026-10-24)
Level: 2
Safeguard: `pressAndExpect` presses once and asserts the target, so stacking issues go red on the spot; the case now presses Escape to close the tooltip and Escape again to close the dialog; `apps/web/e2e/hotkeys-ready.spec.ts` pins keys working at the load event
Intercepts: 1
Recurrences: 0
Notes: Negative control: with the fix reverted the case is red 5 of 5 runs, with it green 10 of 10; the composer-inline-mention data-fresh case goes intermittently red under the same load without source changes and is unrelated to this ticket
---
