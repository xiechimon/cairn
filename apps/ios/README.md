# cairn for iOS

A native SwiftUI client: sign in with a server address and token, then the web phone layout in iOS 27 components. Tab 1, the home, is the Coordinator conversation: user and reply bubbles, a thread row on the reply that started each thread, and pending questions as option chips with the recommended one first. Tab 2 is Tasks (`Needs you`, `In progress`, `To start`, `Done`), Tab 3 is Made, and the computers list is the trailing round tab. Colors are the `apps/web` tokens in `Cairn/Brand/Palette.swift`. Layout and information architecture follow [`docs/design/mobile-information-architecture.md`](../../docs/design/mobile-information-architecture.md), shared with a future Android app. Stack choice and platform requirements: [`docs/research/ios-app-pilot-2026-11-08.md`](../../docs/research/ios-app-pilot-2026-11-08.md).

It is not part of the pnpm workspace and has no CI job; run its tests on a Mac.

## Languages

The UI ships in English and Simplified Chinese from `Cairn/Localizable.xcstrings`, with the wording of `apps/web/src/i18n/en.ts` (Chinese is the web's source string). It follows the system language; pass `-AppleLanguages "(zh-Hans)"` as a launch argument to force Chinese.

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

`CairnUITests/PilotJourneyTests.swift` signs in with a wrong token, then the real one, and checks the home: two user messages, two thread rows, the question chips above the composer and the Tasks count of 3. It opens the first thread, answers the question with its recommended chip, opens Tasks (two rows still need you, three others), Made and the account sheet, attaching a screenshot at each step. The server needs the README demo seed: two user messages that each start a thread, a pending three-option question, and five tasks of which two need you. Credentials come from the environment at run time:

```sh
TEST_RUNNER_CAIRN_PILOT_SERVER=http://127.0.0.1:8787 \
TEST_RUNNER_CAIRN_PILOT_TOKEN=<token> \
TEST_RUNNER_CAIRN_PILOT_APPEARANCE=light \
xcodebuild -project Cairn.xcodeproj -scheme Cairn \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro Max,OS=27.0' \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO -only-testing:CairnUITests/PilotJourneyTests \
  -resultBundlePath results.xcresult test
xcrun xcresulttool export attachments --path results.xcresult --output-path shots
```

## App icon

`Cairn/AppIcon.icon` is an Icon Composer document: the plate colors and one vector layer per appearance (`mark.svg`, `mark-dark.svg`, `mark-tinted.svg`) from the brand spiral. Render any appearance without Xcode's UI:

```sh
"/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool" \
  Cairn/AppIcon.icon --export-image --output-file icon.png --platform iOS \
  --rendition TintedDark --width 1024 --height 1024 --scale 1
```

In-app marks use `CairnMark` (`Cairn/Brand/CairnMark.swift`), which draws the same spiral from its generator parameters; the tab icon is the small spiral as a template SVG. The Coordinator status mark on the home is `StatusMarkGlyph` (`Cairn/Brand/StatusMark.swift`), a port of the web's `status-mark.ts` with the same shapes and animation.

## API used

| Screen | Request |
|---|---|
| Sign in | `GET /api/teams` with `Authorization: Bearer <token>` |
| Tasks, Made | `GET /api/todos?teamId=`, `GET /api/projects?teamId=`, Coordinator messages for pending `ask_user_question` rows |
| Computers | `GET /api/teams/:id/machines` |
| Attachments | `POST /api/uploads/grant`, then `POST /api/uploads/upload` (multipart `grant` and `file`); the message carries `![name](attachment:key)` |
| Question | `POST /api/teams/:id/chief/threads/:tid/questions/:requestId/answer` |
| Task thread | `GET /api/conversations/<latestBuildId>/messages`, `POST /api/todos/:id/messages` (its `conversationId` replaces `latestBuildId`) |
| Coordinator | `GET /api/teams/:id/chief/threads`, `GET /api/conversations/:tid/messages`, `GET /api/conversations/:tid/stream` (SSE), `POST /api/conversations/:tid/messages` or `POST /api/teams/:id/chief/threads` for the first message |
