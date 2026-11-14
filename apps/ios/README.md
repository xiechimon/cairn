# cairn for iOS

A native SwiftUI client: sign in with a server address and token, then a two-tab app. Tab 1 is the needs-you inbox (Coordinator questions, tasks waiting on you, failed tasks, and a collapsed Going on row); an item opens its full-screen thread or question card. Tab 2 is the Coordinator conversation. Layout and information architecture follow [`docs/design/mobile-information-architecture.md`](../../docs/design/mobile-information-architecture.md), shared with a future Android app. Stack choice and platform requirements: [`docs/research/ios-app-pilot-2026-11-08.md`](../../docs/research/ios-app-pilot-2026-11-08.md).

It is not part of the pnpm workspace and has no CI job; run its tests on a Mac.

## Requirements

- macOS with Xcode 27 (the iOS 27 SDK; required for App Store uploads from April 2027).
- XcodeGen (`brew install xcodegen`). The Xcode project is generated from `project.yml` and is not committed.
- Deployment target iOS 26.0. iOS 27-only APIs are gated with `#available(iOS 27, *)`.

## Build and run

```sh
cd apps/ios
xcodegen generate
open Cairn.xcodeproj
```

Pick an iOS 27 simulator and run. On first launch enter the server address and the token printed by `cairn token`. The token is stored in the Keychain (this device only) and is never written to the project.

The simulator shares the Mac's network, so `http://127.0.0.1:<port>` reaches a server on the Mac or one forwarded to it (`ssh -N -R 127.0.0.1:<port>:127.0.0.1:<port> <mac>`). Use `127.0.0.1` rather than `localhost` for an IPv4-only forward: in the pilot run `localhost` failed to connect while `127.0.0.1` worked. Plain HTTP is allowed only for local addresses (`NSAllowsLocalNetworking`); any other server needs HTTPS.

## Unit tests

`CairnTests` runs against a `URLProtocol` stub, so it needs no server: message history follows `nextCursor` to the oldest page, a task message returns the conversation it landed in, free-text questions answer with `text` and multi-select questions keep every pick, a conversation stream event reloads the open thread, and a failed session restore stays recoverable.

```sh
xcodebuild -project Cairn.xcodeproj -scheme Cairn \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro,OS=27.0' \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO -only-testing:CairnTests test
```

## UI journey test

`CairnUITests/PilotJourneyTests.swift` signs in with a wrong token (expects the rejection message), signs in with the real one, checks the inbox (one Coordinator question and three tasks), expands Going on, answers the question, opens a task thread, sends a Coordinator message and waits for the reply, and opens the account sheet, attaching a screenshot at each step. The server needs that seed: a pending `ask_user` question and tasks in `confirm`, `failed`, `review` and `building`. Credentials come from the environment at run time:

```sh
TEST_RUNNER_CAIRN_PILOT_SERVER=http://127.0.0.1:8787 \
TEST_RUNNER_CAIRN_PILOT_TOKEN=<token> \
TEST_RUNNER_CAIRN_PILOT_APPEARANCE=light \
xcodebuild -project Cairn.xcodeproj -scheme Cairn \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro,OS=27.0' \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO -only-testing:CairnUITests \
  -resultBundlePath results.xcresult test
xcrun xcresulttool export attachments --path results.xcresult --output-path shots
```

The reply assertion matches the scratch stub model used for the pilot evidence; against a real model, relax it to "an assistant message appears".

## App icon

`Cairn/AppIcon.icon` is an Icon Composer document: the plate colors and one vector layer per appearance (`mark.svg`, `mark-dark.svg`, `mark-tinted.svg`) from the brand spiral. Render any appearance without Xcode's UI:

```sh
"/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool" \
  Cairn/AppIcon.icon --export-image --output-file icon.png --platform iOS \
  --rendition TintedDark --width 1024 --height 1024 --scale 1
```

In-app marks use `CairnMark` (`Cairn/Brand/CairnMark.swift`), which draws the same spiral from its generator parameters; the tab icon is the small spiral as a template SVG.

## API used

| Screen | Request |
|---|---|
| Sign in | `GET /api/teams` with `Authorization: Bearer <token>` |
| Needs you | `GET /api/todos?teamId=`, `GET /api/projects?teamId=`, Coordinator messages for pending `ask_user_question` rows |
| Question | `POST /api/teams/:id/chief/threads/:tid/questions/:requestId/answer` |
| Task thread | `GET /api/conversations/<latestBuildId>/messages`, `POST /api/todos/:id/messages` (its `conversationId` replaces `latestBuildId`) |
| Coordinator | `GET /api/teams/:id/chief/threads`, `GET /api/conversations/:tid/messages`, `GET /api/conversations/:tid/stream` (SSE), `POST /api/conversations/:tid/messages` or `POST /api/teams/:id/chief/threads` for the first message |

## README screenshots

`scripts/readme-fixture-server.mjs` serves the README demo story (the `网店` and `我的事` projects, the order-export and Acme threads, the export-limit question) over the same routes as `apps/server`; the token picks the language, `readme-en` or `readme-zh`. `node scripts/capture-readme-shots.mjs [out-dir]` runs `CairnUITests/ReadmeShotsTests` against it in English and Chinese, light and dark, on the iPhone 18 Pro Max simulator (iOS 27.0) with the status bar at 9:41, and writes `ios-{home,thread,tasks}-*` WebP files (2x, rounded screen corners, a 1px border, no background) to `docs/assets/readme/` by default. It needs XcodeGen, Pillow and `cwebp`, and fails if Cairn or its test runner leaves a new crash report. On a cold-booted simulator it first opens Settings for 30 seconds: otherwise the runner's first launch spends minutes loading accessibility bundles on its main thread and XCTest's stall watchdog aborts it (`SIGABRT` in `-[XCTWaiter handleStalledWait:]`), which macOS reports with a crash dialog. The UI journey test runs against the same server: start it with `node scripts/readme-fixture-server.mjs` and set `TEST_RUNNER_CAIRN_PILOT_SERVER=http://127.0.0.1:8791` and `TEST_RUNNER_CAIRN_PILOT_TOKEN=readme-en`.
