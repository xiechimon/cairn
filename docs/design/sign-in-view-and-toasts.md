# One sign-in view for every subscription, and toasts that say what failed — plan, 2026-11-28

## User scenario

A newcomer opens Settings, Models, Add provider and picks "ChatGPT subscription". Today a bare sentence with a URL and a code is squeezed in under the search box, and the provider list stays below it. There is no copy button, no open button, no sign that Cairn is waiting, and no way to cancel. After a redeploy the server had lost the pending login. The same user then got two stacked toasts in a Chinese UI: the generic "The action failed. Try again." and the raw English server text "Codex device login not found". The poll kept running, so the same failure kept stacking.

After this change every subscription sign-in shows the same view: ChatGPT, xAI, Claude, Devin and Antigravity. The view has:

- one line saying what to do
- the code, or for Claude the command to run, shown large with a Copy button
- a spinner line while Cairn waits
- Cancel

ChatGPT and xAI, the device logins, also get an "Open sign-in page" button. Success closes the view, and the new provider shows in the list. When a ChatGPT or xAI sign-in fails, the view says so and offers "Start over", and no toast appears. Claude keeps its paste-the-token form, and Devin and Antigravity keep their desktop-bridge flows (install step, bridge cancel). Only their instruction and waiting rows move onto the shared view.

Toasts anywhere in the app change too:

- An identical toast updates the visible one instead of stacking.
- An error toast's title names the action that failed in the user's language (Chinese `\u767b\u5f55 ChatGPT \u8ba2\u9605\u5931\u8d25` / English "Sign in to the ChatGPT subscription failed"; Chinese strings in this plan are written as JavaScript escapes because repository docs are English-only).
- The body is reason or status copy and never raw server text.

No new account, key or storage is involved. The device code lives in memory only while the view is open.

## Scope

1. **Shared component.** New `apps/web/src/components/sign-in-view.tsx` holds two pieces:
   - `SignInView`: an instruction line, an optional `DeviceCode`, an optional waiting line with a spinner, `role="status"` and an optional Cancel, and an optional failure line with `role="alert"`. While the code is loading it shows a code-shaped skeleton of the same height.
   - `DeviceCode`: moved from `resources/mcp-github-device-dialog.tsx`, and both GitHub device dialogs import it from here. Copy confirms in place: the button reads "Copied" for a moment, then "Copy" again, and no toast appears. A refused clipboard raises the existing "Copy failed" toast and never shows "Copied".
2. **ChatGPT and xAI device login.** New `apps/web/src/resources/device-sign-in.tsx` exports `useDeviceSignIn`. Its parts (title, body, footer, cancel) replace the body of the open Add provider surface: the dialog, or the inline first-run section. The underlying picker or xAI form stays mounted, so search text and form drafts survive.
   - **Polling.** Polling is sequential: the next poll is scheduled only after the previous one answers, at the server's `intervalSeconds`. Each start runs as its own effect generation. Cancel, Start over or unmount ends the generation, so a late start or poll answer is ignored and no second poll loop runs.
   - **Outcomes.** `complete` closes the surface; the mutation's `onSuccess` already invalidates every query, so the list refetches. `denied`, `expired` and `superseded` stop polling, keep the code greyed with a strike, hide Copy, show the matching sentence and turn the primary button into "Start over".
   - **Errors.** A start error shows "Could not get a sign-in code. Start over." A poll error, including the 404 left by a lost login, shows "Login expired. Please start again." (the copy main already uses for this case) Both errors are marked surfaced in the rejection handler, a microtask that runs before the fallback's `setTimeout(0)`, so no toast appears.
   - **Footer.** Cancel on the left. The primary button reads "Open sign-in page" (disabled until the code arrives), or "Start over" after a failure. Escape and the close button act as Cancel.
3. **AddProviderFlow.** `AddProviderFlow` gains the view `codex-sign-in`, used by "Sign in again" on a ChatGPT provider. Inside the picker, picking "ChatGPT subscription", or pressing the xAI form's sign-in button, sets a local sign-in kind. Cancel works per entry:
   - From the picker, it returns to the picker.
   - From the xAI form, it returns to the form with its draft.
   - From "Sign in again", it closes.

   This change deletes:
   - the inline device-code text and the `codexDevice`, `xaiDevice`, `*DeviceError` and `*SignInPending` props in `create-provider-dialog.tsx`
   - `useDeviceLogin`
   - the `autoStartCodex` / `onCodexStarted` props
4. **Devin, Antigravity and Claude.**
   - Devin's waiting row and Antigravity's three waiting rows render `SignInView` with the same copy and test ids: the add dialog, the re-login dialog (no inline cancel, as today) and the subscription-detail re-login.
   - Claude's dialog renders `SignInView` with one instruction line and `claude setup-token` as the copyable code, above the unchanged label and token fields.
5. **Toast wrapper.** `apps/web/src/components/ui/toaster.tsx` exports the app's `toast`: callable, plus `error`, `success`, `info`, `warning` and `dismiss`, wrapping sonner.
   - A toast with a string title, no `id`, no `action` and no `cancel` gets the id `JSON.stringify([kind, title, description])`, so an identical toast updates the visible one.
   - Toasts with an action (Undo, Retry, Open) or an explicit id are passed through unchanged.
   - Every `from 'sonner'` import in `apps/web/src` outside `toaster.tsx` moves to it.
6. **No server text in toasts.** `describeError` gains `{ serverText: false }`; `toastError` describes with it (`describeErrorForToast`), and so does `announce-unsent.ts`. `providers-page.tsx` stops using `describeError` output as a toast title. `describeErrorDefault` is deleted, and its one test caller moves to `describeErrorForToast`. In-surface error lines keep their wording. They are listed in the audit for a later slice.
7. **Mutation action labels.** Every `useMutation` in `apps/web/src` opens with `meta: { action: '<zh verb phrase>' }`, typed through TanStack `Register.mutationMeta`.
   - The product QueryClient's default `onError` is still the fallback. A mutation-level `onError` replaces it, as TanStack defines, and already-surfaced errors are skipped.
   - Its title is `translate('{action}\u5931\u8d25', { action: translate(action) })`. Chinese gives `\u6dfb\u52a0\u670d\u52a1\u5546\u5931\u8d25` and English gives "Add provider failed". Without `meta`, the title falls back to the old generic one.
   - Each action phrase has an `en.ts` entry.
8. **Gate.** `scripts/ui-guidelines-gate.mjs` gains four C5 checks over `apps/web/src`:
   - (a) `.userCode` or `.verificationUri` in a `.tsx` file outside `components/sign-in-view.tsx`, `resources/device-sign-in.tsx` and the two GitHub device dialogs
   - (b) `from 'sonner'` outside `components/ui/toaster.tsx`
   - (c) `describeError(` without `serverText: false`, or `.message`, inside a `toast(`, `toast.*(`, `toastError(` or `toastSuccess(` call
   - (d) a `useMutation({` whose options do not open with `meta: { action: '…' }`, or whose action has no `en.ts` key

   A value assigned to a variable first and then passed in (finding 6) is outside what a static check can see. Scope 6 closes that path at the source instead: `toastError` never prints server text, whatever it is handed.
9. **Audit.** `docs/design/web-ui-audit-2026-11-28.md` holds one table (file, what, rule, slice) of the ad-hoc UI sites found by a whole-tree scan of `apps/web/src`, in five classes:
   1. inline sign-in or device code
   2. hand-rolled dialog
   3. link or bare button used as an action
   4. raw server text in a toast or error line
   5. other which-component violations

   This change fixes class 1 and the toast half of class 4. Every other row is scheduled as a follow-up commit in this lane, one commit per class.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Pick ChatGPT subscription | View "Sign in to ChatGPT": instruction line, code large with Copy, Open sign-in page, waiting line; search box and list are gone | `apps/web/e2e/provider-device-sign-in.spec.ts` (red on parent: inline text, no view) | this change |
| Starting, slow network (400 ms) | Waiting line "Getting a code…", a code-shaped skeleton, Open disabled; the view's height changes by at most 4 px when the code lands | `apps/web/e2e/provider-device-sign-in.spec.ts` (bounding boxes before and after) | this change |
| Copy pressed | Button reads "Copied" in place, then returns to "Copy" on its own; the clipboard holds the code; no toast | `apps/web/e2e/provider-device-sign-in.spec.ts` (clipboard read, label returns within 4 s) | this change |
| Open sign-in page | The verification URL opens in a new window; the view keeps waiting | `apps/web/e2e/provider-device-sign-in.spec.ts` (stubbed `window.open`) | this change |
| Sign-in completes (ChatGPT or xAI) | The surface closes; the provider list refetches | `apps/web/e2e/provider-device-sign-in.spec.ts` (ChatGPT refetch and xAI close cases) | this change |
| Poll returns 404 (server lost the login) | Polling stops after that one poll; "Login expired. Please start again." (the copy main already uses for this case); zero toasts and no server text on the page; Start over gets a fresh code | `apps/web/e2e/provider-device-sign-in.spec.ts` (red on parent) | this change |
| Start request fails (502) | "Could not get a sign-in code. Start over."; no code; zero toasts; Start over retries | `apps/web/e2e/provider-device-sign-in.spec.ts` | this change |
| The user declines the sign-in | "ChatGPT sign-in was declined."; code struck and greyed; Copy hidden; Start over | `apps/web/e2e/provider-device-sign-in.spec.ts` (denied case) | this change |
| The code expires before sign-in | "The code expired. Start over."; same treatment | `apps/web/e2e/provider-device-sign-in.spec.ts` (expired case) | this change |
| A newer credential superseded this login | "A newer ChatGPT credential already exists; this sign-in did not replace it."; same treatment | `apps/web/e2e/provider-device-sign-in.spec.ts` (superseded case) | this change |
| Cancel while waiting | Back to the picker; no further polls | `apps/web/e2e/provider-device-sign-in.spec.ts` (poll count frozen after cancel) | this change |
| Escape while waiting | Same as Cancel | `apps/web/e2e/provider-device-sign-in.spec.ts` | this change |
| Cancel during start, then pick again quickly | The late answer of the first start is ignored; the new code shows; one poll loop runs, and every poll carries the new login's state | `apps/web/e2e/provider-device-sign-in.spec.ts` (two starts, polls only for `state-2`, at most one per second) | this change |
| xAI form sign-in button | Same view titled "Sign in to xAI"; Cancel returns to the xAI form with the typed API key kept | `apps/web/e2e/provider-device-sign-in.spec.ts` (xAI case) | this change |
| Sign in again on an expired ChatGPT provider | The same view opens directly; the code is requested once | `apps/web/e2e/providers-subscription-relogin.spec.ts` (updated, counts starts) | this change |
| First-run inline picker picks ChatGPT | The inline section shows the same view in place of the picker, no dialog; Cancel restores the picker list; live writes stay limited to live mode as before; focus handling is the inline section's existing one | `apps/web/e2e/first-run-setup.spec.ts` (ChatGPT signs in in place) | this change |
| Devin waiting | The shared waiting line with Cancel (`devin-local-login-cancel`) and the same copy | `apps/web/e2e/providers-subscription-relogin.spec.ts` (Devin copy and cancel) | this change |
| Antigravity waiting in the re-login dialog | The shared waiting line with the existing copy | `apps/web/e2e/providers-subscription-relogin.spec.ts` (status line inside `sign-in-view`) | this change |
| Antigravity waiting in the add dialog and in the subscription detail | The shared waiting line with its inline Cancel (`antigravity-local-login-cancel`, `antigravity-relogin-cancel`) | `apps/web/e2e/antigravity-local-login.spec.ts` (cancel case and detail re-login case) | this change |
| Claude add dialog | The instruction line and `claude setup-token` as the large code with Copy, above the token field | `apps/web/e2e/providers-claude-subscription.spec.ts` (`sign-in-code` holds the command) | this change |
| The same unhandled failure twice | One toast, updated in place (same id) | `apps/web/test/query-client-mutation-errors.test.ts` (red on parent: no id) | this change |
| An unhandled mutation failure | Chinese: title `\u6dfb\u52a0\u670d\u52a1\u5546\u5931\u8d25`, body `\u7f51\u7edc\u8fde\u63a5\u5f02\u5e38\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5\u3002`; English: title "Add provider failed", body "Network error. Check your connection and try again." | `apps/web/test/query-client-mutation-errors.test.ts` (red on parent) | this change |
| A mutation without `meta` | The old generic title "The action failed. Try again." | `apps/web/test/query-client-mutation-errors.test.ts` | this change |
| Server prose with a 404 or 500 | Body "This item no longer exists. Refresh and try again." or "The service hit a temporary error. Try again later.", never the prose | `apps/web/test/query-client-mutation-errors.test.ts` (red on parent) | this change |
| A mutation whose hook or call handles the error in place | Exactly one toast, the local one, when the call site raised `toastError`; none when the hook's own `onError` replaced the default | `apps/web/test/query-client-mutation-errors.test.ts` (surfaced case counts one call; override case) | this change |
| Two Undo toasts for two deletions; a toast with an explicit id | The wrapper adds no id to a toast with an action, so each Undo toast stays its own and undoes its own deletion as today; an explicit id is kept | `apps/web/test/query-client-mutation-errors.test.ts` (no id on actioned toasts) | this change |
| New code renders a device code inline, imports sonner, passes `describeError(...)` without `serverText: false` or `.message` straight into a toast call, or adds a mutation without `meta.action` | `ui-guidelines-gate` fails with C5; a value first stored in a variable is not seen by the gate, and `toastError` still drops its server text at run time | `scripts/ui-guidelines-gate.test.mjs` (six negative fixtures red on the parent gate, one positive fixture) | this change |
| A 390 px wide window | The view fits inside the window with no horizontal scroll; the code and both footer buttons stay visible | `apps/web/e2e/provider-device-sign-in.spec.ts` (390 px case) | this change |

## Out of scope

- The server side of lost device logins (the draft-on-deploy lane: persistence across redeploys).
- In-surface error lines that show server prose today (schedule popover, side chat send error, skill dialogs). They are audit rows for a follow-up slice, and their e2e oracles stay untouched here.
- The layout of the GitHub connect device dialogs: they keep their own steps, and only `DeviceCode` is shared.
- iOS and the desktop tray.

## Review

- Verdict: PASS
- Plan-SHA256: 876a5df2f7b9b1699f92ca350aaa6e52d072d0b5ccb3a1587d4930e64f1b0449
- Author-Model: claude-opus-5-5
- Reviewer: Pi, fresh context, low effort, one pass (`docs/ops/plan-gate.md` step 2). All findings were fixed in this revision.
- Reviewer-Model: openai-codex/gpt-6.2-sol
- Findings: 12, of which 7 blocking and 5 should-fix:
  1. Overlapping `setInterval` polls: now a sequential poll per generation.
  2. Start failure undefined: own row and copy, zero-toast assertion.
  3. Lost xAI draft: the view replaces the surface body and keeps the form mounted.
  4. First-run path: the same component path, with the walk deferred.
  5. Fallback versus local precedence: stated in scope 7, with existing tests.
  6. Static check limits: scope 8 names them and scope 6 closes them at the source.
  7. Denied and superseded rows, and the Antigravity and Claude rows, are split out.
  8. The "no toast, Start over" promise is limited to ChatGPT and xAI.
  9. Colon collision: the id is now a JSON tuple.
  10. Exact Chinese and English titles.
  11. Layout-jump and copy-failure criteria.
  12. Audit class boundaries.
- Confirm-only pass (same reviewer model, findings 1..12 only): 2, 8 and 12 confirmed; 1, 3, 4, 5, 6, 7, 9, 10 and 11 asked for sharper proof. That proof is in this revision: the restart test checks polled states; the xAI completion case; the inline first-run row; the local-handler and actioned-toast rows; the gate's limits; the split Antigravity rows; the Chinese body assertion; the copy timing and refused-clipboard case.
- Re-stamp pass (same reviewer model, diff only): the English-only rewrite of quoted UI copy, with exact Chinese expected values kept as JavaScript escapes, changes no scope row, edge case, proving test or slice. UNCHANGED, PASS.
- Rebase re-stamp (same reviewer model, diff only): the lost-login message now uses main's existing copy "Login expired. Please start again.". UNCHANGED, PASS.
