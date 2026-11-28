# In-App Cairn Cloud Account and Subscription Flow

## Newcomer overview

Someone who installs Cairn today starts in local mode on their Mac or self-hosted server, with the bottom-left sidebar footer showing their local display name (`user.displayName`). They never have to discover or bookmark an external control-plane dashboard. Pressing their account button in the bottom-left sidebar opens an upward account popover where they can sign in with Clerk on the Cairn Cloud control plane, subscribe to Cairn Cloud via Creem Checkout (`$12/month`), open the native Creem Customer Billing Portal to manage subscriptions and invoices, inspect cloud workspace readiness, open or switch between Local and Cairn Cloud workspaces, jump to local backup export/import for migration, or sign out back to local mode.

- **Prerequisite knowledge**: None for local usage; clicking **Sign in to Cairn** opens the hosted Cairn Cloud page to sign in with Clerk and consent once.
- **Accounts, payments, and keys requested**: Only a Clerk sign-in on Cairn Cloud (and Creem payment on Creem's hosted Checkout if subscribing). No manual API tokens or control-plane secrets are ever entered in Cairn.
- **Where credentials are stored**: The local Cairn server seals the received `ccs_` cloud session token and cached user profile inside `<dataDir>/cloud-account.enc` (by default `<CAIRN_HOME>/server/cloud-account.enc`) using `SecretBox` (AES-256-GCM encrypted with `secretbox.key`).
- **When it fails or blocks**: If the Clerk/PKCE login is cancelled or fails, Cairn keeps the existing local state and reports a clean error notice. If Cairn Cloud returns `401 Unauthorized` (or local `expiresAt` has passed or the file cannot be decrypted), the server clears the stored credentials and reverts to unlinked local display. If Cairn Cloud is temporarily unreachable while linked, Cairn preserves the cached profile and shows an offline status line inside the popover rather than blocking local work.

### Why

Owners tested the standalone Cairn Cloud webpage and immediately asked why subscription, billing portal, and Clerk account identity had no native entry inside Cairn itself, and why the bottom-left sidebar still showed a generic brand footer instead of the signed-in user's identity. Integrating Direction 1 (`SidebarAccount` footer trigger + upward popover) puts sign-in, hosted Creem checkout, hosted Creem customer portal, cloud workspace status/switch, migration shortcut, and sign-out inside one predictable surface across Mac Desktop and Web.

| Scenario | What the user sees | What the system does | Wait / Cost |
|---|---|---|---|
| Unlinked local user opens Cairn | Bottom-left shows local `SeededAvatar` and `user.displayName` | `GET /api/cloud/status` returns `{ configured, linked: false }` (paired phones/fixtures fall back silently to unlinked local UI) | Instant / Free |
| User clicks **Sign in to Cairn** | Browser opens Cairn Cloud `/connect` showing Clerk avatar and name; after consent, browser returns to Cairn (or Desktop shows completion page and refreshes automatically) with Clerk avatar + display name | Local server mints PKCE state + `S256` challenge, validates relative `returnTo`, receives `cca_` code at `/api/cloud/callback`, exchanges for `ccs_` token, seals `<dataDir>/cloud-account.enc` | ~2–5s / Free |
| Linked unsubscribed user clicks **Subscribe to Cairn Cloud ($12/mo)** | Hosted Creem Checkout opens in a new tab; returning to Cairn shows Active subscription + workspace status | Server calls `POST /api/billing/checkout` with `Bearer ccs_`, validates returned `checkoutUrl`, and polls `/api/cloud/status` | ~1–3s / $12/mo on checkout |
| Subscribed / customer user clicks **Manage subscription & invoices** | Hosted Creem Customer Portal opens in a new tab | Server calls `POST /api/billing/portal` with `Bearer ccs_`, validates returned `portalUrl`, and opens it externally | ~1s / Free |
| Linked user with ready cloud workspace opens/switches workspace | Shows workspace status (`ready` / `provisioning` / `suspended`) and opens cloud workspace (or switches Desktop host between Local and Cloud) | Validates HTTPS `workspace.url`; Browser opens `workspace.url`; Desktop switches via `addAndSwitchRemoteHost` / `switch('local')` | ~1–2s / Free |
| Linked user clicks **Sign out of Cairn** | Bottom-left immediately reverts to local `SeededAvatar` + `user.displayName` | Server calls `POST /api/app-auth/revoke` (best effort) and removes `<dataDir>/cloud-account.enc` | Instant / Free |

## User scenario

A user running Cairn (either Mac Desktop or the web app connected to a Cairn server configured with `CAIRN_CLOUD_URL`) looks at the bottom-left sidebar footer, sees their local display name by default, clicks it to open the account popover, signs in to Cairn Cloud via PKCE browser authorization, sees their Clerk avatar and name in the footer, subscribes or opens the Creem billing portal in a new tab, checks or opens/switches to their Cairn Cloud workspace or jumps to Account Backup migration, and can sign out cleanly back to local mode.

## Scope

1. Add `CAIRN_CLOUD_URL` (`cloudUrl` in `ServerConfig`, registered in `scripts/product-surface-registry.json` and `docs/configuration.md`), restricted to `https:` (or loopback `http://127.0.0.1` / `localhost` / `[::1]`) origins with no credentials, path, query, or fragment. Default `CAIRN_CLOUD_URL` to `https://cairn-cloud-portal.fly.dev` in both `apps/desktop/src/main.ts` (`startServer`) and `apps/desktop/src/resident-host.ts` (`buildResidentPlist`) unless explicitly overridden or set to `off`/`false`/`none`/`0`.
2. Define shared Zod schemas and response types in `packages/shared/src/remote-access.ts` for `cloudStatusResponseSchema` (`configured`, `linked`, `cloudReachable`, `user`, `subscribed`, `hasBillingCustomer`, `subscriptionStatus`, `currentPeriodEnd`, `workspace`), `cloudConnectStartBodySchema` (`returnTo`, `shell`), `cloudConnectStartResponseSchema` (`authorizationUrl`), `cloudExternalUrlResponseSchema` (`url`), and whitelist `/api/cloud/callback` in `isBrowserAuthExempt`.
3. Implement `apps/server/src/services/cloud-account.ts` and `apps/server/src/routes-cloud.ts` providing `GET /api/cloud/status`, `POST /api/cloud/connect/start`, `GET /api/cloud/callback`, `POST /api/cloud/checkout`, `POST /api/cloud/billing-portal`, and `POST /api/cloud/disconnect`:
   - Enforce owner-only access (`ctx.authToken === null`, owner `Bearer`, or `ownerIdentity.via === 'session' | 'access'`), explicitly rejecting paired devices (`ownerIdentity.via === 'device'`) with `403` on every `/api/cloud/*` route except `GET /api/cloud/callback`.
   - Validate `returnTo` strictly as a relative `/app...` path (rejecting non-`/app` prefixes, `//`, `\`, `@`, and origin changes), derive `origin` via `requestOrigin(c, ctx.webOrigin, ctx.trustedProxies)`, and validate every URL received from Cairn Cloud (`authorizationUrl`, `checkoutUrl`, `portalUrl`, `workspace.url`) to allow only `https:` (or loopback `http:` exclusively when configured `cloudUrl` is loopback).
   - For `shell === 'desktop'` (when Electron opens system browser via `shell.openExternal`), return a clean local HTML completion page from `GET /api/cloud/callback` (and use relative `/app?cloud=error&reason=state` redirects on invalid/expired state), avoiding the external browser hitting local Cairn's token-auth gate while the Desktop window polls / refetches on window focus.
   - Persist encrypted session data atomically in `<dataDir>/cloud-account.enc` via `SecretBox` (`0o600`), compare token/`updatedAt` before deleting on `401` to avoid clobbering a concurrent login write, recover cleanly (`linked: false`) on corrupt/wrong-key `SecretBoxError` or expired `expiresAt`, sweep expired PKCE states before capping active flows at `32` (`429` if full), and never log `ccs_`, `cca_`, or `verifier` values.
4. Implement React Query hooks in `apps/web/src/api/hooks.ts` (treating `403`/`404` or non-live mode silently as unlinked, refetching on focus and briefly polling while a login/checkout external tab is active) and `apps/web/src/board/sidebar-account.tsx` replacing the `sidebar-footer-brand` block in `apps/web/src/board/sidebar.tsx` across both browser and Mac Desktop shells while keeping compact `min-w-0 flex-1` truncation, 56px footer height, and right-aligned utility button alignment. Support opening `workspace.url` (and Desktop `addAndSwitchRemoteHost` / `switch('local')` when `desktopHost()` is available), migration shortcut to `/app/settings/account`, removing `.sidebar-footer-brand` from `apps/web/src/styles/app.css`, and adding English translations in `apps/web/src/i18n/en.ts`.
5. Update `apps/web/e2e/desktop-update.spec.ts` and `docs/design/surfaces/sidebar.md`, verify `apps/web/e2e/sidebar-visual.spec.ts`, and add automated unit/component proving tests `apps/server/test/cloud-account.test.ts` and `apps/web/test/sidebar-account.test.ts`.

## State, persistence, and security model

- **In-memory PKCE flow map**: Keyed by single-use `state` (`32` random bytes base64url), holding `{ verifier, returnTo, origin, shell, createdAt }` with 10-minute TTL and bounded capacity (`32` active non-expired flows). Sweeps expired entries before insertion and rejects overflow with `429`. `consumePkceState` deletes the entry atomically on lookup.
- **Encrypted persistence (`<dataDir>/cloud-account.enc`)**: Written via `SecretBox.sealJson` (`0o600` atomic write) containing `{ accessToken, expiresAt, user: { sub, name, email, avatarUrl }, updatedAt }`. Readers (`status`, `checkout`, `billingPortal`, `disconnect`) tolerate `ENOENT`, `SecretBoxError`, malformed JSON, schema mismatch, or `expiresAt <= Date.now()` by returning unlinked state cleanly. Delete-on-`401` checks serialized file mutations / matches exact `accessToken` so a concurrent callback write is never deleted by an in-flight stale `401` check.
- **Transport & URL safety**: `CAIRN_CLOUD_URL` accepts `https:` (or loopback `http:`) origins only; external checkout/portal/workspace URLs returned by the control plane are validated before leaving `/api/cloud/*` and again before `window.open` / Desktop host switch.

## Edge cases

| Edge case | User-visible behavior | Proving test | Slice/Status |
|---|---|---|---|
| Paired device (`via === 'device'`) calls `GET /api/cloud/status` or `/connect/start`, `/checkout`, `/billing-portal`, or `/disconnect` | Server returns `403 owner session required`; web UI silently falls back to local unlinked display without error toasts or retry loops | apps/server/test/cloud-account.test.ts; apps/web/test/sidebar-account.test.ts | this change |
| Unconfigured server (`CAIRN_CLOUD_URL` unset) or non-HTTPS remote `CAIRN_CLOUD_URL` | Unconfigured status returns `{ configured: false, linked: false }` and actions return `409`; insecure non-loopback `http://` config is rejected at startup | apps/server/test/cloud-account.test.ts | this change |
| Invalid `returnTo` (external URL, `//evil.com`, `\`, non-`/app`) or malformed non-HTTPS control-plane redirect URL | Server rejects invalid `returnTo` with `400` and rejects unsafe checkout/portal/workspace URLs from control plane with `502` before client opens them | apps/server/test/cloud-account.test.ts | this change |
| Replayed, missing, or expired OAuth `state` hits `GET /api/cloud/callback` (and Desktop `shell === 'desktop'` completion) | Browser flow redirects `302` to validated `/app` on first use and relative `/app?cloud=error&reason=state` on replay/expired; Desktop flow serves clean `200` confirmation HTML without redirecting external browser into local token gate | apps/server/test/cloud-account.test.ts | this change |
| Control plane `401`, concurrent login vs stale `401` delete race, corrupt/wrong-key `cloud-account.enc`, expired `expiresAt`, or offline cloud control plane | On `401`, removes only matching token so concurrent login survives; corrupt key or expired token yields `linked: false` without `500`; offline cloud returns cached profile with `cloudReachable: false` | apps/server/test/cloud-account.test.ts | this change |
| PKCE pending map reaches 32 active flows | Expired flows (>10 min) are pruned first; 33rd non-expired request fails cleanly with `429` | apps/server/test/cloud-account.test.ts | this change |
| Desktop `startServer` and `buildResidentPlist` default vs `CAIRN_CLOUD_URL=off` | Default sets `https://cairn-cloud-portal.fly.dev` in both regular spawn and launchd plist; explicit `off` yields `cloudUrl: null` | apps/server/test/cloud-account.test.ts | this change |
| Bottom-left `SidebarAccount` renders unlinked local state vs linked Clerk profile, workspace actions, & opens upward popover cleanly | Shows local `user.displayName` by default in both browser and desktop (and in fixture mode), switches to Clerk `avatarUrl` + `name` when linked, handles Sign in / Subscribe / Manage Billing Portal / Open or Switch Workspace / Migration / Sign out cleanly | apps/web/test/sidebar-account.test.ts | this change |
| Sidebar footer keeps compact 56px height and right-aligned footer utility icons unchanged | Replacing `sidebar-footer-brand` preserves `sidebar-footer` height and right utility button coordinates | apps/web/e2e/sidebar-visual.spec.ts | this change |

## Out of scope

- Building a custom in-app payment card form or billing invoice table instead of Creem hosted Checkout and Creem hosted Customer Billing Portal.
- Automatic one-click cloud database upload/restore automation inside this slice (users open existing Export/Import Backup under Account Settings via the popover's migration shortcut).
- Removing existing Cloudflare Access or self-hosted Clerk server auth (`CAIRN_CLERK_*`) flows.

## Review

- Reviewer: research-flash-subagent (51a9e937-4411-4cf9-8130-0cacc528c737)
- Author-Model: gemini-3.1-pro-preview
- Reviewer-Model: gemini-3-flash-preview
- Verdict: PASS
- Plan-SHA256: cd913722acaedefd466596de7a33f368dec7693daf89822526a06b1ac741b0cd
- Findings: First pass identified 6 blocking gaps (returnTo/origin validation, CAIRN_CLOUD_URL & returned URL HTTPS checks, paired-device 403/silent UI fallback, resident-host plist default env, Desktop external browser callback completion HTML + workspace switch contract, and persisted-state race/corrupt-key/expiry/PKCE-cap handling). Second pass confirmed all 6 addressed cleanly; 0 blocking findings remain. Updated web test extension to .ts matching apps/web/vitest.config.ts.
