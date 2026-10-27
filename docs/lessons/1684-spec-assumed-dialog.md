---
Category: The new spec assumed the header action in the fixture confirm phase would open a dialog; the fixture branch is actually inert (only live sends the confirmation), so the first run was red
Source: #1684 (2026-10-25)
Level: 2
Safeguard: Read the handler source before writing interaction assumptions (the fixture branch of `handlePrimaryAction`); test-first exposes the mistake before the implementation
Intercepts: 0
Recurrences: 0
Notes: The test itself is the gate; fixture-side behavior diverging from live is normal in this repo — check the branch before assuming
---

