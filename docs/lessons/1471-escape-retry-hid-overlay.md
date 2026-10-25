---
Category: After deleting the e2e key-retry loop, one hotkeys case pressed Escape once and only closed the hover tooltip layer while the dialog stayed open; the retry used to mask this layering issue
Source: #1471 (2026-10-24)
Level: 2
Safeguard: `pressAndExpect` presses once and asserts the target, so the layering issue goes red on the spot; the case now presses Escape once to close the tooltip layer and again to close the dialog; `apps/web/e2e/hotkeys-ready.spec.ts` pins that keys work from the load event
Intercepts: 1
Recurrences: 0
Notes: negative control: reverting the fix made the case fail 5 out of 5 runs, with the fix 10 out of 10 green; the composer-inline-mention data-fresh case flakes red under the same load without source changes, unrelated to this ticket
---
