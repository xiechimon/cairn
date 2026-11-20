# Design surface

Pages a task makes become versions that Cairn serves itself; the design view shows them beside the Coordinator chat. Design: `docs/design/design-surface.md` (phases, states and every read/write path).

## Getting a page

A page comes from a task in one of two ways: an info task publishes a deliverable `page`, or any task attaches an `.html` with `attach_file`. Either one writes a `design_version` row. To seed one on a live stack, run a task that attaches `index.html`, or insert an `attachment` row (`scope='message'`, `createdBy='step:<id>'`, `status='ready'`) plus its file, then a `design_version` row pointing at it.

## Checks

- `GET /api/todos/<id>/design` lists the page with `current.seq`, `versionCount`, `openComments`, `shareToken` and `shareOrigin` (`null` without a relay).
- `GET /api/design/versions/<versionId>/page` returns the HTML with `content-security-policy: sandbox allow-scripts allow-forms allow-downloads`. With `?print=1` it adds `allow-modals` and opens print.
- The page keeps opening after the task's step stops, because it is read from the attachment store and not from a task dev server.
- `GET /api/attachments/<id>/document-preview` returns docx, pptx or xlsx text sections.
