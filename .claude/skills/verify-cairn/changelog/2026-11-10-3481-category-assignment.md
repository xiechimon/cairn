# #3481 · Category assignment retirement

REST/Coordinator/MCP and canonical task services now reject retired `tagIds` before writes. Published create/update inputs, normative specs, feature-map states and the verification recipe move with the removal. Legacy read/storage and lifecycle cleanup remain until the approved final snapshot/drop; GitHub labels and Git release tags remain independent.

The input-stripping bug class appeared at both MCP face registration and the Claude SDK Coordinator host bridge: removing a shape property let the SDK silently turn a stale assignment into a create/title write. Actual SDK negative controls failed for both tools at both sites. Existing SDK object registration with passthrough now carries the key to canonical Zod rejection. No replacement SDK, custom protocol parser or dependency was added. The server Pi validator and ACP HTTP bridge are covered as unchanged forwarding paths.

Historical membership fixtures replace retired API setup. Existing guards intercepted SDK type-inference mistakes before commit; the bridge now uses the classic Zod shape its builder actually produces. Public API evidence and full production-entry observations are under `docs/verify/3481/`.
