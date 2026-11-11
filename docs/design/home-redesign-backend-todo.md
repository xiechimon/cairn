# Coordinator home redesign: backend to-do

The UI of the Coordinator home redesign is built against fixtures. The items below are the backend work it still waits for. They are not part of the UI change and are open for anyone to pick up. Shapes, data sources and fallbacks for each `G` item are in `docs/design/side-panels-backend-gaps.md`.

A box marked **owner route** changes a security surface from `packages/shared/merge-gate-paths.json` and needs the owner's review. A box marked **design first** changes persisted state, a wire protocol or the command boundary and needs a one-page design before code.

## Done with the UI change

- [x] Quick replies: `suggest_replies` tool and stored replies (`docs/design/coordinator-quick-replies.md`).
- [x] Uploads accept 0-byte files and common office and data files (`docs/design/attachment-upload-limits.md`, gaps G-B and G-C).

## Computers panel

- [ ] G3. Return the threads running on a machine (title, project, start time) so the work tab lists them instead of a count. Small, read-only.
- [ ] G1. Store and return the machine's own hostname. Small. **Owner route.**
- [ ] G2. Report, store and enforce the folders an agent may use on a machine. Large. **Owner route, design first.**
- [ ] Agent browser and desktop use on by default. The panel no longer shows the two switches; the owner wants both open by default. Today the browser capability is off per computer and desktop control is a lease the user takes. Needs a default, a place to turn it off, and the daemon side. **Design first.**

## Results panel

- [ ] G5. A result kind finer than code or document (design, page). Small for the field, medium for reliable classification.
- [ ] G6. A thumbnail per result. Large. **Owner route.**
- [ ] G7. Per-result visibility. Needs a product decision first.
- [ ] G8. Archive a result from its card menu. Small, the endpoint exists.

## Attachments and file preview

- [ ] G-A. Download under the file's own name through `?download=1`. Small.
- [ ] G-F. PDF inside the panel: check on a live stack whether the `sandbox` response header blocks the built-in viewer, then decide. Needs a security review.
- [ ] G-D. Attachment metadata endpoint, only if a size line is wanted.
- [ ] G-E. Preview of office documents. Medium, new dependency, owner decision.

## Sidebar and projects

- [ ] Refuse to delete a project that has running work, so a `Delete all` action on the archived page becomes safe to add.
- [ ] Decide whether a task thread inside an archived project stays writable; the UI still shows its composer.

## Verification still owed

- [ ] Run the redesigned home on a live stack: a real model calling `suggest_replies`, attachments end to end, the computers panel against a real machine.
- [ ] Regenerate the gallery snapshot baselines from the CI artifacts.

## Decided not to build

- Logout in the account menu.
- A hosted cloud computer: the user's own computer is the cloud computer.
- `Delete all` for archived projects until the first sidebar item above lands.
