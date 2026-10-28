---
Category: New merge-gate API route and product tests missed wire allowlist, roster model ids, and autonomous mergePolicy seed
Source: #1794 (2026-10-28)
Level: 2
Safeguard: wire.test.ts INFERRED_ROUTES entry for GET /api/builds/{id}/gate; merge-gate-product.test.ts uses roster vendor-independent model ids and seeds mergePolicy autonomous
Intercepts: 0
Recurrences: 0
Notes: Negative controls: route missing from INFERRED_ROUTES fails invented-route assertion; non-roster author/reviewer ids leave independent-review-missing; default human policy blocks on policy-human before scenario asserts
---
