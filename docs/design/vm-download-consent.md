# Download the Mac Linux VM only after the owner asks

Status: approved (mon X, 2026-11-17). Prototype: the "Linux 虚拟机可选下载原型" artifact in the thread that built it. Builds on [`mac-vm-computer.md`](mac-vm-computer.md).

## Problem

On an Apple-silicon Mac with macOS 26+, the first browser or computer tool call silently downloads about 1.4 GB: Apple's `container` runtime package (169,630,704 bytes, pinned in `computer-image/image.json`), the kata kernel that `container system start --enable-kernel-install` fetches (676,287,269 bytes, the 1.7.1 default URL) and the arm64 computer image (538,256,122 bytes of layers at the pinned digest). The owner never agreed to it and cannot skip it. Nothing a newcomer needs for a first result depends on it.

## Decision

- Nothing is downloaded until the owner asks. Two places ask: a default-off `Linux 虚拟机` switch on the first-run confirm step (only when the Coordinator's machine reports a VM computer that is not downloaded), and a `下载` button in the Computers panel, where the VM screen would be.
- A tool call before that is refused with a message the Coordinator turns into one sentence and a link to the Computers panel (`/app?pane=machines`). No card in the conversation.

## States

`absent → downloading → ready`, `downloading → failed → downloading`.

| State | Meaning | Daemon evidence |
|---|---|---|
| absent | Never downloaded | No `<CAIRN_HOME>/vm/downloaded` marker and no expanded own runtime |
| downloading | An install is running in this daemon | In-memory install promise |
| ready | Runtime started and the pinned image pulled once | Marker present, or a runtime expanded by an earlier version (existing installs stay usable) |
| failed | The last install threw | In-memory, until the next install; the next daemon start shows `absent` |

`doneBytes` counts the runtime package as it streams, adds the kernel when `container system start` returns and the image when `container image pull` returns; `totalBytes` is the sum of the three pinned sizes (`VM_DOWNLOAD_BYTES` in `@cairn/shared`). A runtime already present on the Mac (a running or system `container`) counts as done.

## Paths that read or write it

- Write: `VmDesktops.install()` (the only path that sets the runtime's permission and writes the marker), reached through the existing owner action route `POST /api/computers/:id/actions` with the new action `install` (outcome `installed`), dispatched as `computer_manage`.
- Read, daemon: `VmRuntime.resolve()` refuses with `VM_NOT_DOWNLOADED_MESSAGE` while the VM is not ready and no install runs. Every path that could download (`start`, `manage`, `sweep`, `presence`) goes through it; `sweep` and `presence` already return early with no known scopes.
- Read, wire: `capabilities.vmDownload` (`{ state, doneBytes, totalBytes }`) on enrollment and presence; parsed independently, older servers ignore it. The VM computer notifies presence on each state change and at most once per 5% of progress.
- Read, server: `listComputers` copies it to `ComputerRecord.download` (`null` for a host computer or an older Runner).
- Read, web: the machines panel shows the download surface instead of the screen until `ready`; the first-run confirm step shows the switch while `absent`.

## Failures

- Download, signature, expand, system start or image pull fails: the install throws, the state is `failed` with the action note, the panel shows `下载没完成` and `重试`. Partial files are removed by the existing provisioning cleanup.
- Daemon restarts mid-install: the call times out on the server (`COMPUTER_MANAGE_TIMEOUT_MS`), the next start reports `absent` and the owner retries; a fully expanded runtime counts as ready.
- Two install requests: the second joins the first.
- The Runner goes offline: the action route answers 409 as for every other action.

## Tests

`vm-runtime` refuses to resolve before install and resolves after; `VmDesktops.install` reports downloading, ready and failed with byte counts; the shared parser keeps a valid `vmDownload` and drops a malformed one; `listComputers` carries it.
