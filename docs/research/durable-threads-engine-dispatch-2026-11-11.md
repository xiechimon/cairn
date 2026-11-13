# Durable thread harness and engine dispatch

Prior art for `docs/design/durable-threads-engine-dispatch.md`. Labels: **Observed** means read first-hand this session; **Inferred** means derived from that; **Guess** means the rest. Cairn paths are `origin/main` `7299c658e`.

## Comparison

| Source | How it does it | Trade-off | Evidence |
| --- | --- | --- | --- |
| pi-durable 1.5.0, installed at `apps/server/node_modules/@earendil-works/pi-durable` | One harness owns one storage. Entries, tasks, and `docs["pi.usage"]` commit before they are shown. `resume()` continues a crashed run; the same `requestId` does not submit twice. `abort()` stops the conversation. A second process may open `readOnly`. SQLite is one file, WAL, one writer. | Fits a server-owned session. It is not an external-engine dispatcher. The API is experimental. | Observed, README "Persist and Resume", "Abort and Subagents", "Usage and Cost", "Storage" |
| Cairn Coordinator | Server process, one sqlite per Coordinator thread under `coordinatorStoreDir`, product rows in `server.db`. Daemons do not open that store. | Already the owner's harness. Reuse it; do not put a second writer on the daemon. | Observed, `apps/server/src/coordinator/index.ts`, `runtime/harness.ts`, `runtime/thread-harnesses.ts` |
| Claude Agent SDK sessions | A session is the prompt, tool calls, results, and responses, written under the working directory. `resume` needs the session id. `fork` copies history. Cross-host resume is a separate documented concern. | Engine-local. Cairn already misses a resume when the jsonl is on another machine. | Observed, [Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions). Cross-host section not read in full. |
| Anthropic context editing | The API can clear old tool results and thinking, or the client SDK can compact by summary. | Model-context hygiene, not a product session store and not a stop or cost handle. | Observed, [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) |
| Codex CLI | `codex resume` reopens a local chat. `codex exec` is the non-interactive run. Subagents report back into the terminal session. App-server exists. | Session is local to the repo and machine. A good engine, a bad thread store. | Observed, [Codex CLI](https://developers.openai.com/codex/cli). App-server protocol not read. |
| Amp manual | A thread lives on an orb Amp creates. The same thread is opened from the web, phone, Mac, and TUI. Closing the laptop does not stop the orb. | Phone reachability is worth copying as a transcript. The thread living on the work machine is the opposite of a replaceable engine. | Observed, [Amp manual](https://ampcode.com/manual) |
| claude.ai, Claude desktop Code tab, t3code, Cursor | Not operated. The live view copies Cairn's computer-screen gateway, not those products' UI. | Not evidence for the socket, lease, or redaction contract. | Not operated. Reason: in-repo precedent is the contract. |

## Pattern that fits

Keep the durable session in the server, as the Coordinator does, and treat Claude Code, Codex, and Gemini as engines whose own session files die with the job. Amp's phone reachability is the transcript fallback, not a second terminal and not a reason to store the thread on the machine.

**Recommendation:** one server-owned pi store per thread; a dispatch record for each engine job; a PTY view copied from the computer-screen pairing, read-only until an explicit takeover. Codex stays the existing daemon pi backend, not a new CLI, until an owner decision says otherwise.
