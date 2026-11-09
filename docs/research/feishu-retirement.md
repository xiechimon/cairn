# Feishu retirement — task 161

## Decision and primary-source inventory

The owner explicitly requested removal, including stored configuration, and moved this task out of Coordinator management. This is deletion, not a replacement integration or notification redesign. Review is through the PR's cloud code review; protected auth changes remain on coordinator-hold for the orchestrator.

| Source | First-hand observation | Consequence |
| --- | --- | --- |
| [main at 0719ece9](https://github.com/xiechimon/cairn/tree/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16) | Observed: routes-feishu, services/feishu and AccountPage only save and display a binding; no transport, notification delivery or callback exists. Package manifests and lockfile have no Feishu SDK. | Remove the configuration surface; no dependency or lockfile edit is needed. |
| [historical binding migration](https://github.com/xiechimon/cairn/blob/0719ece9fc6c07f8c69c3dcb02a4cacb55ed1c16/apps/server/drizzle/0062_feishu_binding.sql) | Observed: encrypted app credentials and recipient identity are isolated in feishu_binding. | Drop this table in a forward migration without decrypting or logging values. Preserve historical migrations and the frozen agent-layer oracle. |
| [migration helper](../../apps/server/test/migrate-helpers.ts) | Observed: existing tests migrate through a named journal entry, seed old data, then apply current migrations. | Reuse this upgrade-test pattern rather than copying main implementation. |
| [1976](https://github.com/xiechimon/cairn/issues/1976), [1978](https://github.com/xiechimon/cairn/issues/1978) | Observed: both are now closed; they proposed transport and remote approvals, opposite to this task. | This removal supersedes their direction; do not implement them. |
| [3469](https://github.com/xiechimon/cairn/pull/3469), [3471](https://github.com/xiechimon/cairn/pull/3471) | Observed: 3469 is closed and concerns task naming; 3471 is open and changes owner escalation, not Feishu. | Leave task naming, questions, notifications and build approval services unchanged. |

## States, transitions and failure behavior

Configured and unconfigured installations both converge to no binding table. A new installation runs historical migrations followed by the drop; an upgrade drops all binding rows across teams. Startup migration failure aborts rather than serving a partial schema. The migration uses Drizzle's transactional journal and does not open ciphertext, so malformed or old-key ciphertext is also removable. Re-running migration is a no-op. Backups may still contain old encrypted values; rollback must restore a pre-upgrade database and old application together. Dropping the table is logical deletion, not a promise to erase backup or filesystem remnants.

| Read/write entry path | Expected behavior | Test |
| --- | --- | --- |
| Account page initial load and reload | No bot entry or Feishu request; language and Cairn push switch still work | account retirement browser regression |
| GET, PUT, DELETE binding API | Authenticated requests return 404, never configuration or submitted values | retired API regression |
| Owner/device auth classifier | No Feishu-specific owner grant; other credential routes remain owner-only | retired device API regression and remote-access suite |
| Fresh DB, empty upgrade, configured upgrade | No binding table or index; unrelated rows preserved | retirement migration matrix |
| Repeated startup | No recreation or duplicate migration; native plan and notification rows retained | migration idempotence check |
| User-owned secrets named feishu.bot.* | Remain ordinary secrets, never deleted by name | migration preservation and secret API regression |
| REST/table/feature/screenshot/restore registries | No active Feishu registration | registry regression and generated feature map |
| Cairn in-app notifications, Web Push and approval actions | Existing behavior and authority unchanged | focused notifications, push, plan approval and review rejection suites |

## UI brief

Surface: account settings. Goal: remove the unwanted bot block, not replace it with a disabled feature or placeholder. Rules: C2, C3, V1, T1, R1. Reference: docs/design/references/settings/t3code-general.jpg (opened before editing): compact settings rows and native notification controls. Draft exempt: one setting removal.

| Component | Main state | Loading/error/offline | Long content/pending question | Phone/dark |
| --- | --- | --- | --- | --- |
| Account settings | Live page without bot section, language and push controls retained | Removed block has no loading/error state or network dependency; other controls unchanged | No bot content or question; other account content unchanged | Check 390px and 1440px, light and dark, no overflow |

Acceptance evidence uses an isolated stack only. No production writes, credentials, third-party network connection or new dependency is required.
