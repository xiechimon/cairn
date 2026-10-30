---
Category: A safe-path fixture inherited a symlinked macOS temporary root and failed ancestor validation before reaching its intended assertion
Source: Ticket 2189 (2026-10-30)
Level: 2
Safeguard: setup-runner-linux.test.mjs canonicalizes its scratch root and separately asserts deliberate database symlinks are rejected before account mutation
Intercepts: 0
Recurrences: 0
Notes: The intermediate fixture failed with Refusing symlink /var in review-fixture-red.log; the canonical fixture passes for both firewall backends. Biome also caught an unsorted import during this round, corrected with its existing organizer before the final lint run.
---
