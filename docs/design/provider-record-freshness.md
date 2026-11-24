# Provider record freshness

A defect fix for out-of-order provider responses. The existing response field `updatedAt` becomes the per-record logical version; no database migration or new client mode is needed.

## States and transitions

A stored provider starts at the creation timestamp. Every successful update atomically writes `max(current updatedAt + 1, wall clock)` in SQLite. This includes ordinary PATCH, model input discovery, Codex and xAI device reauthorization, and both token refresh paths. Equal timestamps and clock rollback cannot produce equal or older versions. Failed or superseded writes do not advance the version. GET and PATCH serialize the stored value unchanged.

The client keeps the newer record by `updatedAt`. An older version cannot replace an already known version. Equal versions describe the same stored state. List membership and envelope metadata still follow GET; version comparison applies to each returned record, not the order or capabilities. React Query structural sharing applies the same merge after a GET completes, including a GET already in flight when a PATCH finishes. PATCH merges its record before invalidation; errors leave the cache unchanged. Provider-order rollback restores only order, never old records.

The editor keeps the newest observed record in a ref. A model edit starts from that record, or a newer save in the active queue. Each PATCH completion reconciles its response with the newest observation. Queue state is released when pending work reaches zero. A failed edit rolls back to the newest known record and does not block subsequent edits. The queue does not provide cross-client compare-and-swap: another client's edit that has not reached this client remains outside this fix.

A fingerprint change invalidates completed checks for the old configuration, not running requests. Completed results are presented only when their returned fingerprint equals the current fingerprint. The result can arrive before or after the list learns the configuration; storage by fingerprint must not expose a result as belonging to another configuration. Subscription checks retain their separate reset boundary, because their API does not use provider configuration fingerprints. A failed request is not an authoritative configuration check.

## Verification paths

- `provider-configuration.test.ts`: same-millisecond PATCH, clock rollback, model discovery and both token refresh writers advance versions.
- `provider-save-cache.test.ts`: late model PATCH and stale GET cannot restore Available; failed writes retain the cache and list metadata survives reconciliation.
- `provider-check-state.test.ts`: drained and active queues preserve an externally added model; in-flight checks use returned fingerprints rather than their start configuration.
- `dark-text-tertiary-contrast.test.ts`: the actual Available glyph token reaches 3:1 on normal, hover, selected and dragging backgrounds in both themes.

Tests and live screenshots are separate evidence. Machine restrictions in the round-20 brief prevent local Playwright and live-stack validation; no live verification is claimed by this document.
