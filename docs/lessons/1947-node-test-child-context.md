---
Category: A nested Node test subprocess inherited the parent runner context and hid its expected output
Source: Issue #1947 (2026-10-27)
Level: 2
Safeguard: The subprocess contract test removes NODE_TEST_CONTEXT and explicitly selects the TAP reporter
Intercepts: 1
Recurrences: 0
Notes: The original subprocess contract failed while parsing its missing allocation record; the isolated subprocess passes and verifies the same record
---
