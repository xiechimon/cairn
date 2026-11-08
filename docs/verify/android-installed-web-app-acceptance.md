# Android installed web app: owner acceptance

Date: 2026-11-08
Status: Future acceptance recipe; implementation and all device results pending

Requirement: [#3475](https://github.com/xiechimon/cairn/issues/3475). The owner will run this on their own Android phone after the implementation is deployed. These steps do not describe features available in the documentation-only segment.

## Preparation supplied by the implementer

Provide the deployed version, exact entry labels, the two category settings, a harmless pending question and a disposable task that can complete. Provide a safe way to trigger each event using normal product controls; the owner should not need API tokens, database commands or developer mode. Mark synthetic push transport distinctly from real delivery.

Record Android version, browser/version, launcher and install type (installed web app/WebAPK versus a bookmark). Keep server addresses, account identifiers, task contents and credentials out of public evidence. Use harmless test text such as Review the release checklist. Do not reinstall or clear browser data until unsent drafts have been saved elsewhere.

The implementation session fills the observed-result column. A desktop browser at a mobile viewport is not an Android result.

## Phone steps

| Case | What the owner does | Expected result | Observed result |
| --- | --- | --- | --- |
| Existing install | Open cairn from the home-screen icon and check the deployed version | Existing session and ordinary navigation still work | Pending |
| Permission denial | With notification permission not granted, choose Enable and deny the OS/browser prompt | Switch remains off; blocked guidance points to site/app settings; no repeated prompt | Pending |
| Permission dismissal | Dismiss rather than grant the permission prompt | Remains off; not falsely described as permanently denied | Pending |
| Enable | Allow permission in site/app settings, return and enable this device | Server-backed device subscription shows on only after success | Pending |
| Categories 1 | Keep Needs your answer on and Completed work off; trigger one of each | Only the question notification arrives; completed task still appears in the product | Pending |
| Categories 2 | Turn Needs your answer off and Completed work on; trigger one of each | Only future completion arrives; question remains available in needs-you | Pending |
| Both/off | Test both on, then both off, then master off | Independent choices persist on reload; master off unsubscribes this device | Pending |
| Notification labels | With both categories on, expand notifications for a question and a completed task | Clear category wording; neither replaces the other for the same thread | Pending |
| Answer, cold | Close cairn; expand a pending question notification and tap Answer if shown | Sign-in if needed, then the exact question and options are visible and answerable | Pending |
| Answer, warm | Leave cairn open on another thread, then tap another question notification body | Opens the exact new question, not the unrelated composer or old thread | Pending |
| Already answered | Answer the question elsewhere, then tap the old notification | Shows already answered; no duplicate submission or misleading failure | Pending |
| Answer failure | Enter a harmless answer, go offline and attempt submit | Clear offline/not-sent state; draft remains; reconnect permits explicit submission once | Pending |
| Locked phone | Receive a question while locked, unlock and tap it | Lock-screen redaction follows device policy; exact question opens after unlock/login | Pending |
| New-task shortcut | Long-press the installed icon and choose New task | Existing creation surface opens directly; typed draft is preserved, nothing is sent | Pending |
| Needs-you shortcut | Long-press icon and choose Needs you | Shows all current pending work without a stale project filter | Pending |
| Shortcut replay | Refresh/back after either shortcut | Does not repeatedly reopen, clear or submit work | Pending |
| Text share | From another app, share selected harmless text to cairn | Local review contains the text; no task exists before explicit confirmation | Pending |
| Link share | Share a page from the browser, then share a URL embedded in text | Correct title/text/link survive; no dependence on a nonempty dedicated url field | Pending |
| File share | Share a supported image/file, then an unsupported or oversized file | Supported file can be reviewed and attached; rejected file has a clear reason, no silent loss | Pending |
| Offline cold share | After one successful online setup, close cairn, enable airplane mode and share text | Local review loads and durably saves; close/reopen retains it; upload/send remain disabled | Pending |
| Offline creation | Open New task or Needs you offline | Clear offline state; no claim of live task data or successful submission | Pending |
| Login return | Sign out, share harmless content and sign in again | Local incoming share survives sign-in and awaits destination confirmation | Pending |
| Account boundary | If a safe second test account/team exists, sign in there with an unsent share | No automatic upload; explicit destination confirmation required. Otherwise mark not covered | Pending |
| Draft collision | Type an ordinary draft, then share new content | Existing draft is not overwritten; owner chooses where incoming content goes | Pending |
| Save/submit failure | Interrupt connectivity during upload/creation | Draft/files remain recoverable; accepted task is not duplicated on retry/reopen | Pending |
| Discard | Discard an unsent incoming share and confirm | Only that incoming share is removed | Pending |
| Readability | Repeat review, settings and question cases in light and dark with the keyboard open | Controls remain reachable; no horizontal scroll; category and status not color-only | Pending |

Permission-reset and account-switch cases must use safe test data. Browser storage denial/quota failure can be verified by targeted automation when the owner cannot reproduce it; label it automated, not real-device coverage.

## If launcher or share entries are missing

First verify that this is an installed web app, not a browser bookmark, and that it opens the expected deployment. Android WebAPK metadata can lag the site. The [Chrome manifest-update guide](https://web.dev/articles/manifest-updates#updates_on_chrome_for_android) describes update checks and `about://webapks`. With the app closed, charging and on Wi-Fi, inspect its update status if the browser exposes that page. This is a diagnostic for the owner, not an application retry loop or acceptance-by-waiting.

If the browser/launcher lacks that capability, report the exact limitation. Do not call an in-app link proof that the Android launcher shortcut or share chooser works. Reinstallation is a last, explicit owner choice after backing up unsent content, not the default recovery step.

## Result report

Return this compact result to the implementation thread:

```text
Deployment/version:
Android / browser / launcher / install type:
Passed cases:
Failed cases and exact step:
Not covered cases:
Action button visible on expanded question notification: yes / no
Launcher shortcuts visible: yes / no
cairn visible in other apps' share chooser: yes / no
Cold-offline shared draft survives close/reopen: yes / no
```

Attach sanitized screenshots for light and dark settings, expanded question/completion notifications, launcher shortcuts, share chooser/review, denied permission and offline states. Own-product evidence belongs in the public evidence repository using SHA-pinned links; personal or third-party account captures remain private. Never include tokens, full endpoints or unrelated notifications.

Platform limits to state in the implementation PR: category preferences are in cairn, not guaranteed separate Android OS channels; Answer opens the question rather than providing portable inline text reply; action visibility depends on browser/OS/lock-screen policy; shortcuts and inbound sharing require a supporting installed app and refreshed manifest; background push delivery timing is browser/OS controlled; browser-data clearing can remove offline local drafts.
