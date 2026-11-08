# cairn for iOS (pilot)

A native SwiftUI client for the Coordinator: sign in with a server address and token, list the Coordinator thread and open tasks, open the thread, and send a message with the reply streamed live. Stack choice and platform requirements: [`docs/research/ios-app-pilot-2026-11-08.md`](../../docs/research/ios-app-pilot-2026-11-08.md).

This is a pilot, not a shipping app. It is not part of the pnpm workspace and has no CI job.

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

## UI journey test

`CairnUITests/PilotJourneyTests.swift` signs in with a wrong token (expects the rejection message), signs in with the real one, opens the Coordinator thread, sends a message and waits for the reply, attaching a screenshot at each step. Credentials come from the environment at run time:

```sh
TEST_RUNNER_CAIRN_PILOT_SERVER=http://127.0.0.1:8787 \
TEST_RUNNER_CAIRN_PILOT_TOKEN=<token> \
TEST_RUNNER_CAIRN_PILOT_APPEARANCE=light \
xcodebuild -project Cairn.xcodeproj -scheme Cairn \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro,OS=27.0' \
  CODE_SIGNING_ALLOWED=NO -resultBundlePath results.xcresult test
xcrun xcresulttool export attachments --path results.xcresult --output-path shots
```

The reply assertion matches the scratch stub model used for the pilot evidence; against a real model, relax it to "an assistant message appears".

## API used

| Screen | Request |
|---|---|
| Sign in | `GET /api/teams` with `Authorization: Bearer <token>` |
| Thread list | `GET /api/teams/:id/chief/threads`, `GET /api/todos?teamId=:id` |
| Thread | `GET /api/conversations/:tid/messages`, `GET /api/conversations/:tid/stream` (SSE `text_delta`, `message`, `step`) |
| Send | `POST /api/conversations/:tid/messages`, or `POST /api/teams/:id/chief/threads` for the first message |
