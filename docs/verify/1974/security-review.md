# Feishu credential configuration security review

Scope: `routes-feishu.ts`, `services/feishu.ts`, the `feishu_binding` schema columns, the shared configuration contract, and the account form. This review was performed in the fix round after the review-gate finding that the earlier manual review had not been run as a review; the named `security-review` skill is not installed in this session or checkout, so the review below is the recorded review for this delivery.

## Trust boundaries

- The new GET, PUT and DELETE endpoints remain behind the existing server token authentication middleware. Each checks `requireTeam` before reading a body or accessing credentials. MCP and machine credentials do not authorize these member endpoints.
- Caller-controlled configuration is parsed with the shared schema. App and recipient identifiers have bounded formats; origin validation rejects non-HTTP(S) URLs, user information, paths, query strings and fragments. Configuration is stored without any outgoing HTTP request or socket connection.
- The member API returns an explicit status projection containing only configuration state, App ID, recipient and origin. Neither App Secret nor a credential row ID or ciphertext is included. The password field is cleared on successful save and unbinding, and is never restored from the server or browser storage.
- Credentials are binding columns, not `secret` rows. `feishu_binding` stores `appIdCipher` and `appSecretCipher` through the existing authenticated SecretBox encryption, alongside `createdAt` and `updatedAt`. `services/secrets.ts` is unchanged from main: public secret listing, lookup, value opening, creation and deletion only ever touch the `secret` table, so they cannot expose, overwrite or delete the binding ciphers. Chief `set_secret` and `delete_secrets` delegate to the same unchanged public secret service.
- Credential replacement and binding changes execute inside one synchronous SQLite transaction. An injected encryption failure demonstrates rollback. Changing App ID requires an explicit replacement secret. Unbinding deletes only the team's `feishu_binding` row.
- Ordinary secret names, including names that start with `feishu.bot.`, remain fully usable; no reserved namespace exists. A user secret with such a name is listed, opened, updated and deleted like any other secret, and never collides with the binding columns.

## Candidate findings checked

1. Guessing a stored secret ID or binding team ID: public secret lookup and value queries only read the `secret` table; the binding ciphers are not in that table and cannot be selected by any ID. No finding.
2. Shadowing or overwriting the credential via a same-named secret: `feishu.bot.*` names are ordinary names with no reservation; a user-owned secret with that name coexists with the binding columns and is managed normally. No finding.
3. Partial replacement after encryption failure: transaction rollback preserves both old ciphertexts and the binding row. No finding.
4. Reusing a secret with a different App ID: rejected without a new App Secret. No finding.
5. Stored origin as an SSRF or approval entry point: this ticket has no network consumer, action route, runtime startup hook or SDK dependency. No finding.
6. Cross-team read/write: explicit team ownership check precedes all configuration service calls; the openId uniqueness check rejects a recipient already bound to another team. No finding.
7. Unbind side effects: unbinding deletes only the team's binding row; ordinary secrets are untouched (probe and tests confirm zero bindings and zero secrets after unbind only for synthetic data, and user secrets created during the same session remain listed). No finding.

Result: no confirmed security findings remain. Evidence: `probe.json`, `server-green.log`, `targeted-green.log`, and `e2e-green.log`. All evidence uses synthetic credentials. No real tokens, keys, or ciphertext payloads are archived.
