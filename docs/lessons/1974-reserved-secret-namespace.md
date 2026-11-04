---
Category: A reserved secrets namespace let ordinary secret APIs shadow, overwrite or delete bot credentials
Source: Issue #1974 fix round (2026-10-28)
Level: 1
Safeguard: The acceptance checklist specifies binding-column storage (feishu_binding.appIdCipher / appSecretCipher) with timestamps; credentials never live in the shared secret table, so no reserved-name filters or deletion paths are needed and user secrets keep every ordinary name
Intercepts: 1
Recurrences: 0
Notes: The first implementation stored credentials as feishu.bot.* secret rows, required notLike filters in every public secret query and a reserved-name rejection in create/rename, and deleted those rows on unbind; the review gate blocked it because user secrets with the same names became inaccessible and could be overwritten or deleted. The negative control for the fix is a test that creates, lists, opens, updates and deletes a user secret named feishu.bot.app-secret while the binding stays untouched. A reserved namespace is a second source of truth and invites exactly these collisions; storing the credential in its owning row removes the filters, the rejection and the special deletion path.
---
