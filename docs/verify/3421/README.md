# Private tailnet owner login verification

Requirement: [#3421](https://github.com/xiechimon/cairn/issues/3421), R1–R7 and A1–A9 in [the approved research](../../research/seamless-device-auth-2026-11-08.md). R8, daemon changes and live Serve deployment are excluded.

## Plan and decisions

| Decision | Choice and reason |
|---|---|
| Trust root | Only the accepting private Unix listener can supply ambient owner identity; no TCP-header trust. |
| Owner policy | Ready owner login wins; tagged or unknown owners use only the explicit socket allowlist. |
| Authentication order | Existing valid tokens retain their authority before considering ambient identity. Device tokens cannot become owners by carrying identity headers. |
| Enrollment | Route enrollment confirmation through the same token/ambient-CSRF middleware as pairing, rather than duplicating the security gate. |
| System tailscaled | `CAIRN_TSNET=socket` selects the required socket-only deployment, reusing the existing activation variable. No additional feature flags. LocalAPI status refreshes every 30 seconds. |
| Filesystem | Verify private parent, socket uid and exact 0600 mode. Refuse active sockets rather than unlinking another server's endpoint. |
| UI | One translated, wrapping secondary-text line; no new card, badge or gate logic. Single-setting draft exemption. |
| Deployment | Only document the command; the coordinator repoints Serve after merge. |

Implementation order: failing boundary tests, listener/auth changes, sidecar metadata and sharee tests, socket-only LocalAPI plumbing, signed-in line and browser proof, checks, one held PR. No primary session cookie or cloud account is introduced.

## Overlap

1. Existing issue #3421 is this request and is reused. #2530 concerns daemon enrollment; #2280 a service portal; other search hits concern notifications. No duplicate issue was created.
2. Matching open PRs: none at the initial and expanded checks.
3. Recent merged prerequisites: #3076 (sidecar), #3112 (off-by-default supervision), #3192 (QR pairing), #3040 (enrollment origin), #3073 (loopback token safety). Their guarantees are preserved; none is intentionally reverted.
4. Open PRs touching the original supplied planned files: none initially. Expanded paths found #3422 (`cairn/conv-01a1b976-1231-7d34-87a9-a37ba9c6ccc6`) and #3101 (`server/provider-test-connection`) sharing `apps/web/src/i18n/en.ts`; the final check also found #3422 touching `apps/server/test/wire.test.ts`. Both concern provider checks; proceed with one independent translation key and one remote-identity route registration. No other branch is adopted or modified.

## Tests first

- Before authentication changes, `vitest run apps/server/test/tailnet-owner.test.ts`: 9 failed, 6 passed. Failures included owner GET 401 instead of 200, unsafe ambient requests 401 instead of CSRF 403, socket replacement instead of refusal, and paired enrollment 401 instead of 403. Existing A1/A3/A4/A9 denial guards already passed; they were not weakened to manufacture failures.
- Before metadata plumbing, `vitest run apps/server/test/tsnet-remote.test.ts apps/server/test/tsnet-sidecar.test.ts`: 4 failed, 56 passed (socket-only activation/startup, owner propagation and stale metadata).
- Go owner tests failed with empty Self owner metadata and a sharee receiving identity. The ready test failed with a payload containing only type and DNS name. They passed after the fixes.
- The active-socket test failed because a second listener replaced the existing endpoint; now it refuses startup and the original listener remains reachable.

## Checks

| Command | Result |
|---|---|
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed across workspace packages |
| `pnpm spec:parse` | Passed: 217 browser files, 70 integration files |
| `pnpm exec vitest run --changed` with the ten focused existing server/i18n test files | 310 passed |
| `pnpm exec vitest run apps/server/test/tailnet-owner.test.ts` | 16 passed |
| `pnpm --filter @cairn/web e2e:affected apps/server/src/lib/token-auth.ts apps/web/e2e/token-gate-tailnet-owner.spec.ts` | 20 passed, including token/login-link fallbacks and four new owner browser cases |
| `go vet ./...` and `go test ./...` in `apps/tsnet-sidecar` | Passed using the installed Go toolchain |

The unrestricted `pnpm exec vitest run --changed` expands through the shared app helper into broad server/integration coverage. Two local attempts exceeded the command limit (120s and 360s); neither is claimed as a pass. A PR-review convergence test exceeded its deadline under the concurrent broad run and passed in isolation (1 passed, 61 skipped). The focused ten-file changed run above passed without that load. Full-suite results belong to CI.

The e2e affected selector reports a full fallback for the shared dictionary; the explicit scoped command above avoids a routine full local browser run. CI retains its complete selection.

## Browser and wire evidence

The browser test runs the actual server, SQLite seed, production static handler, auth middleware, sidecar supervisor and private Unix socket. It launches a synthetic sidecar emitting a synthetic owner and DNS name, plus an isolated HTTPS proxy that strips incoming identity headers and adds that synthetic owner. No browser API response is mocked. Browser TLS certificate verification is disabled only for the local test certificate. This verifies the application/proxy contract, not Tailscale's control plane or live Serve configuration.

`calls.txt` and `calls.png` capture actual response statuses and the identity JSON. Pairing code values are omitted. Screenshots precede QR creation, so they contain no usable pairing credential.

| State | Reference | Ours | Verdict |
|---|---|---|---|
| Owner, light desktop | t3code Environments empty | `compare-light-1440.png` | Keeps the quiet settings hierarchy; ours adds an owner line and usable route rather than t3code's saved-environment empty state. |
| Owner, dark desktop | Same reference, light only | `compare-dark-1440.png` | Same hierarchy on existing dark tokens; no dark reference was available for this exact state. |
| Owner, light phone | Same reference, desktop only | `compare-light-390.png` | Uses the existing narrow settings layout and has no horizontal overflow; reference differs in viewport. |
| Owner, dark phone | Same reference, desktop/light only | `compare-dark-390.png` | The line wraps naturally in the existing layout; exact dark/mobile reference is unavailable. |

Surface: Settings. Reference: `docs/design/references/settings/t3code-environments-empty.png`. Checked P1/P2, C1/C2/C3, V1/V3/V4/V8/V10, T1/T2, R1; automated assertions cover no token gate, no stored token, expected login, pairing QR and zero horizontal overflow at both widths.

Live: isolated real HTTP/SQLite server through its private Unix listener; compiled fixture-mode web assets without any scenario URL.
Mocked: sidecar ready metadata, WhoIs identity ingress and test HTTPS certificate; LocalAPI status shapes are injected in focused server tests.
Not covered: real tailnet transport, actual Serve repoint, Mac/App Store Unix support, account changes on a live node, long-login/offline UI captures and providers (no LLM calls). Missing/error identity renders no signed-in claim.
Rollback: leave Serve pointed at its existing TCP target for token-only access; do not widen socket permissions. No schema migration or daemon credential change.
