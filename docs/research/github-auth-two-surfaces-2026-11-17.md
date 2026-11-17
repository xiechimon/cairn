# GitHub authorization: product surface vs agent tool surface

Question (ian, 2026-11-17): cairn has two GitHub auth surfaces — the team `github_connection` (repo picker, server-side reads, step credentials) and the `mcp_connector` GitHub grant (agent MCP tools). A user who authorized one finds the other asks again. Is two-authorization the norm, and should they share?

## cairn current state (verified, local server.db + code)

- `mcp_connector` has a `github` row (`authKind=github-app`, `status=connected`, 49 tools) — the grant the user completed.
- `github_connection` is empty — so the repo picker shows the GitHub auth prompt again, and `adoptGithubProfile` never ran (`apps/server/src/services/github-profile.ts`), leaving `avatarUrl`/`displayName` untouched.
- Both grants are device-flow user access tokens (`ghu_`) on the same public `cairnwright` App with identical `offline_access` scope (`apps/server/src/services/github-device-core.ts`). Design doc: "both share the upstream App authorization ... revoking the App on GitHub ends both" (`docs/design/github-connection-device.md:22`) — separate storage buys lifecycle isolation, not independent revocation.

## Prior art

| Product | Product surface | Agent tool surface | Shared? | Source |
| --- | --- | --- | --- | --- |
| VS Code + Copilot | built-in GitHub auth session | official GitHub MCP reuses the existing GitHub token (vscode PR #325719); only hand-configured MCP servers get a separate OAuth | shared for first-party path | https://code.visualstudio.com/blogs/2025/06/12/full-mcp-spec-support, https://github.com/microsoft/vscode/issues/326073 |
| Copilot coding agent | same session | GitHub MCP "on by default; no auth needed" | shared | https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/README.md |
| Claude Code | `gh auth login` (OAuth token to the gh OAuth App) | MCP server needs its own PAT/OAuth header; users bridge by `gh auth token`; `/install-github-app` is a third grant for Actions | separate ×3 (users manually share) | https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-claude.md, https://code.claude.com/docs/en/github-actions |
| Cursor | "Cursor" GitHub App installation (Cloud Agents, Bugbot) | GitHub MCP via PAT in mcp.json | separate (installation token vs user token) | https://cursor.com/docs/integrations/github |
| Devin | "Devin.ai Integration" GitHub App install | each MCP connector authorizes independently; docs: "Plugin installation and MCP authentication are separate steps" | separate | https://docs.devin.ai/integrations/gh, https://docs.devin.ai/work-with-devin/mcp |
| Windsurf, Zed | no product-level GitHub auth | MCP via PAT/OAuth per server | n/a (only one surface) | install-windsurf.md, zed.dev/docs/ai/mcp |
| Vercel / Netlify | OAuth sign-in (identity) + GitHub App install (repos) | n/a or brokered via same install | login and repo access are two grants | vercel.com/docs/git/vercel-for-github, docs.netlify.com repo-permissions-linking |
| Linear | two Apps (integration, "Linear Code" for diffs) + per-member auth | none | deliberately split by permission boundary | linear.app/docs/github, linear.app/docs/diffs |
| OpenAI Codex cloud | "Install & Authorize" — one flow grants installation + user auth; agent reuses it | shared | https://help.openai.com/en/articles/11145903 |
| Google Jules | one App install covers picker/clone/branch | shared | https://jules.google/docs/ |

## Reading (inferred)

- Separation is normal **when the two surfaces need different credential types** (installation token vs user token vs PAT) or different permission boundaries. Cursor, Devin, Linear, Claude Code all fit.
- Sharing is the direction **when the credential type is the same**: VS Code explicitly built token reuse for its first-party MCP server; Codex/Jules use GitHub's `request_oauth_on_install` to deliver both in one screen.
- GitHub's remote MCP accepts any valid user credential including `ghu_` GitHub App user tokens (github-mcp-server `pkg/utils/token.go`, host-integration docs) — inferred: a `github_connection` token could serve as the MCP bearer directly; production acceptance still unverified (one stale 403 report predates `ghu_` support; our design doc also flags "need real validation").
- cairn is the odd case: two identical-looking device-flow dialogs issuing the same token type on the same App — the duplication is pure UX cost, while revocation is not actually independent.

## Direction if changed

- Reuse `github_connection` as the credential behind the `github` MCP connector (connector keeps its own enable/check lifecycle; bearer resolved from the connection) — matches the VS Code/Codex shared-grant pattern. Verify `ghu_` acceptance on `api.githubcopilot.com/mcp/` live first.
- Alternative: keep separate grants but differentiate the UX (copy, entry point), or merge auth+install via `request_oauth_on_install`.
