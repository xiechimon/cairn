# Spec 15 · Untitled tasks and worker naming

Updated by #3481 under the [approved category-retirement cutover](../research/thread-category-runtime-cutover-3481.md). The original fixed-category worker contract is retired; untitled task creation and title backfill remain.

## Task creation

The new-task dialog accepts the task body without a separate title or category picker. A non-empty trimmed body enables saving. The body receives autofocus; unsaved-change detection follows the body. Explicit-title API creation remains supported.

`derivePlaceholderTitle(spec)` is shared by server creation and web fixtures: use the first non-empty line, trim surrounding whitespace, truncate to 50 characters and append `…` when truncated. Sequence numbers distinguish otherwise identical placeholders. A task saved without dispatch retains its placeholder.

## Ordinary worker naming

The first implementation step receives `set_task_meta({title})`. Its advertised input and daemon instructions contain only title backfill, with no category vocabulary. The server derives the task id from the authenticated step; later implementation, review and verification steps cannot rename it.

A title is plain text summarizing the body, at most 50 characters. Blank titles fail with 400; the server applies the shared truncation backstop. Successful naming uses the existing task update and event publication path. A metadata failure does not prevent work from continuing with the placeholder.

Retired `tag`, `tags` and `tagIds` arguments fail with 400 before any write, including null, empty and populated values. A request combining a valid title with a retired argument leaves the complete task, correction classification and associations unchanged. A title-only call preserves legacy associations and classification.

The Claude Code SDK host bridge preserves unknown ordinary metadata arguments until the canonical HTTP relay validates them. Its raw-shape helper would otherwise strip retired arguments and silently allow the title write. Coordinator create/update use the same preservation boundary for their retired assignment field; GitHub metadata and other host tools retain their existing SDK input handling.

Worker calls on tasks with sealed owner requests retain their title, request and body. Coordinator summary-title authority is a separate contract and is unchanged here.

## GitHub worker metadata

GitHub-backed projects retain their dedicated names-based label form: optional `title` and `tags`, including multiple names, an empty replacement and the legacy single-name `tag` alias. Names resolve only against dedicated GitHub labels. Invalid names fail atomically. Imported issue titles and sealed owner titles remain final. Generic categories cannot replace dedicated labels.

## Generic assignment retirement

REST create/update, Coordinator create/update and MCP create/update reject `tagIds` before writes, including null, empty arrays and populated or wrong-type values. Canonical task services and cited-request helpers also reject stale runtime objects. Published create/update inputs no longer offer the field. REST and MCP keep unrelated ignored fields compatible; Coordinator schemas retain their existing strictness.

Both MCP face registration and the Claude SDK Coordinator host bridge preserve unknown task-write keys until canonical validation. Real SDK `tools/call` must not turn an invalid assignment into a successful create or title update by stripping the key. The installed in-server Pi validator and ACP bridge already forward it unchanged.

## Staged legacy compatibility

Ordinary worker categories and generic vocabulary GET/POST routes are retired. REST and Coordinator project creation and server startup no longer seed or backfill categories. Generic assignment inputs and all category association insertion/replacement writers are removed. Legacy tables and read-only record `tagIds` remain until their atomic final retirement. The fixed-vocabulary constant is retained only for existing web/gallery fixtures until final model/fixture removal. Retained representation is not a current UI or worker category capability. Existing generic membership continues to participate in correction classification until its final provenance snapshot.

The settings Tags tab is already removed. Historical category-chip and filter recipes are not current UI acceptance checks. Git release `create_tag` is unrelated and remains available through its existing daemon-local boundary.

## Regression contract

- Create plain/local/hosted/GitHub projects through REST or supported Coordinator shapes: no generic categories are seeded; vocabulary routes return 404 without mutation.
- Restart with legacy categories: exact existing rows/associations and correction requirements survive; no fixed vocabulary is recreated.
- Save a multi-line body: the first non-empty line becomes the title; long lines truncate consistently in server and fixture surfaces.
- Claim an ordinary first implementation step: the advertised tool requires only `title`; its daemon prompt contains no category input or fixed vocabulary.
- Name a task: the title updates and version advances without altering its body, associations or correction requirement.
- Send each retired argument with null, empty or populated values: 400 and complete pre-call state retained, for ordinary and sealed-owner tasks.
- Exercise every task-write entry with retired `tagIds`: no task, cited request, correction flag, association, build or schedule changes. Existing reads and validated project-move cleanup remain.
- Call task writes through real MCP SDK, Claude SDK Coordinator, Pi validation and ACP transport paths: the retired key reaches canonical rejection; valid naming/create/update still work.
- Use a later implementation/review/verification step: naming is refused.
- Use GitHub metadata: dedicated label selection, empty replacement, invalid-name atomicity and imported-title finality remain intact.

The verification recipe is [.claude/skills/verify-cairn/features/tags.md](../../.claude/skills/verify-cairn/features/tags.md); the stale browser driver remains historical, not proof of the current worker contract.
