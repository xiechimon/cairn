# Server account avatar fallback

Research: [OS photo sources and bounded raster processing](../research/owner-system-avatar-2026-11-16.md).

## Contract

Before serving HTTP, load the Cairn server process account's system photo only when `seeded.user.avatarUrl` is null. Do not use the browser's machine, another account, or the interactive desktop's default user. Existing persisted avatars, including legacy/custom values, are never modified. The fallback exists only on the shared in-memory user record; no database column, migration, new setting or provenance marker is needed. A restart retries missing photos and observes changed system photos. GitHub profile avatars remain identity-v2 work; a persisted GitHub avatar takes precedence over this fallback.

| State/read/write path | Expected behavior and acceptance test |
| --- | --- |
| Fresh or upgraded database with null avatar | Startup fills the runtime record from the server account photo; the database stays null. Session, me and members expose the same sanitized data URL. |
| Existing non-null avatar | Preserve it byte-for-byte and skip all system-photo access, even if the system photo differs. |
| Rename via `PATCH /api/user/me` | The shared runtime record retains its photo; display-name persistence remains unchanged. |
| Restart and previously unavailable photo | A newly available photo is used on the next startup; a removed photo returns to the existing initials fallback. No automatic value becomes a custom persisted override. |
| Notifications and Coordinator identity readers | Reuse the same runtime user, as they already do; at most an 8 KiB thumbnail (about 11 KiB base64) is copied into notification records. Historical notices retain their historical image; deduplicating that existing storage model is outside this change. Web-push payloads do not include avatars. |
| Linux photo selection | Try `userInfo().homedir/.face`, then `/var/lib/AccountsService/icons/<username>`; an invalid first candidate must not hide a valid second one. |
| macOS photo selection | Fixed `/usr/bin/dscl -plist` and `/usr/bin/plutil` commands read `JPEGPhoto`, then `Picture`; test binary photo precedence, path fallback and command failure. No shell interpolation. |
| Windows photo selection | A fixed, noninteractive, no-profile PowerShell command gets the current process SID and reads account-picture registry values in size order. Accept local drive paths only, never UNC/network paths; test non-ASCII paths, absence and command failure. This is best-effort and needs real Windows acceptance. |
| Unsafe or unavailable input | Reject non-files, more than 2 MiB, SVG/HTML/other formats, corrupt data and more than 16 million pixels. Animated inputs become a static decoded frame, never a moving or metadata-bearing avatar. Every failure yields the next candidate or null, never a startup failure or filesystem path in HTTP/logs. Test each rejection class and valid JPEG/PNG/WebP. |

## Processing and boundaries

Read through a file descriptor, check it is a regular file, and read no more than 2 MiB + 1 byte even if the file changes. Nonblocking open avoids FIFO hangs. Platform commands have a two-second timeout, a three-second shared query budget and bounded output; read only, without elevation or shell execution. The maintained pure-JS `image-size` parser checks JPEG/PNG/WebP format and dimensions before decoding. Photon WASM decodes, applies EXIF orientation, resizes to at most 128 × 128, then emits a metadata-free WebP; JPEG at bounded qualities is the fallback for a thumbnail over 8 KiB. A successful result is an image data URL, never the source path. Existing macOS default account pictures count as system photos when encoded as JPEG/PNG/WebP; HEIC/TIFF and unavailable photos leave initials.

Use the Photon 0.3.3 WASM already bundled into `dist/photon_rs_bg.wasm`, with a direct build-time dependency so esbuild includes its JS wrapper. No new native runtime dependency is added: the same bundle and WASM are already copied into npm, Docker and desktop distributions. Do not add avatar processing to the Coordinator/LLM seam. Sharp is a development-only independent decoder/fixture generator for tests, not a production import. Validate the actual server bundle with an OS-photo fixture and the desktop staged file set; do not claim actual cross-architecture or Docker execution without running it.

Keep the current avatar UI and initials design. Exercise a synthetic system photo and missing-photo fallback in light/dark at 1440 and 390, confirm actual image decoding, inspect screenshots and score each affected avatar/account element at least 9. No actual host photo or account path belongs in committed evidence. Test fixtures replace only OS/file access in isolated tests; do not change this host's account picture.

## Risks and non-goals

The Windows registry convention and macOS command composition have not been tested on real Windows or macOS. A Windows drive letter may also refer to a mapped network drive; UNC paths are rejected but local-drive validation is not a network sandbox. Photon parses local image bytes in WebAssembly under input/dimension limits, not an OS sandbox; synchronous decoding/resizing is outside the three-second OS-query budget and its memory high-water mark is process-wide. Twenty truncated-PNG failures followed by real Coordinator image processing succeeded in the same process; retain a regression test without claiming coverage of allocation failure or other WASM panics. A system photo is intentionally visible to the authenticated Cairn owner and its existing notification readers. Changing the OS photo is observed at restart, not live. This change does not add avatar editing, GitHub credentials, identity changes or deployment.
