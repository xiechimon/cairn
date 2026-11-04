# Coordinator sidecar (D72)

The Coordinator runs in `apps/coordinator`, a separate process next to the server that owns a Pi Durable SQLite store. It enrolls as a machine and claims Coordinator turns over the machine API. The server hands it those turns only when `CAIRN_COORDINATOR_MACHINE_ID` names its machine; while that variable is unset, daemons keep running the Coordinator as before.

## What it needs

- A machine token for the sidecar, in `$CAIRN_HOME/coordinator/machine-token`, mode 0600. The sidecar refuses a file other users can read.
- The Coordinator routed to a Pi-runtime model: a keyed provider with `api: anthropic-messages` (C5) and the team's Claude usage set to `allow-paid` when the model is Claude. A turn routed to the claude-code runtime stays with the daemons.
- The summary model (`CAIRN_COORDINATOR_SUMMARY_MODEL`) listed in that provider's models; without it, folds fail and the context grows until a turn has to wait.
- Environment:

| Variable | Default | Meaning |
|---|---|---|
| `CAIRN_HOME` | `~/.cairn` | Token file and store live under `coordinator/` |
| `CAIRN_COORDINATOR_SERVER_URL` | `http://127.0.0.1:8787` | Server the sidecar claims from |
| `CAIRN_COORDINATOR_TOKEN_FILE` | `$CAIRN_HOME/coordinator/machine-token` | Machine token |
| `CAIRN_COORDINATOR_STORE_DIR` | `$CAIRN_HOME/coordinator/threads` | Directory of Pi Durable stores, one `<chief thread id>.sqlite` per Coordinator thread |
| `CAIRN_COORDINATOR_SUMMARY_MODEL` | `claude-haiku-5-5` | Model that folds old turns, on the Coordinator's provider |

## Cutover

0. Check the two preconditions; until both hold, leave `CAIRN_COORDINATOR_MACHINE_ID` unset. Both queries must return a row:

   ```bash
   sqlite3 -readonly ~/.cairn/server/server.db \
     "select providerId from provider where api = 'anthropic-messages' and apiKeyCipher is not null and baseUrl like 'https://api.anthropic.com%';"
   sqlite3 -readonly ~/.cairn/server/server.db "select id from team where claudeUsage = 'allow-paid';"
   ```

   Without them the Coordinator is not routed to Pi, the sidecar takes no turns, and the daemons keep running the Coordinator.

1. Back up the server database and keep the copy read-only:

   ```bash
   sqlite3 ~/.cairn/server/server.db ".backup /tmp/coordinator-cutover.db"
   ```

2. Create a new team API key with machine access for the sidecar alone. A key enrolls exactly one machine, so reusing the daemon's key would take over the daemon's machine row. Enroll with it; the token goes straight into a 0600 file and only the machine id is printed:

   ```bash
   mkdir -m 700 -p ~/.cairn/coordinator && cd ~/.cairn/coordinator && umask 077
   curl -s -X POST http://127.0.0.1:8787/api/machine/enroll \
     -H "authorization: Bearer $CAIRN_MACHINE_KEY" -H 'content-type: application/json' \
     -d "{\"teamId\":\"$TEAM_ID\",\"name\":\"coordinator-sidecar\"}" -o enroll.json
   node -e 'const r=require("./enroll.json");require("fs").writeFileSync("machine-token",r.token,{mode:0o600});console.log(r.machineId)'
   rm enroll.json
   ```

3. Seed the store from the C2 summary of the current thread and its newest rows. Each row is capped at 8,000 characters, tool calls keep only their name and arguments, and the command refuses a store that already holds a conversation:

   ```bash
   pnpm --filter @cairn/coordinator exec tsx src/seed-cli.ts \
     --db /tmp/coordinator-cutover.db --thread "$THREAD_ID" \
     --summary <fold state.json> --store ~/.cairn/coordinator/threads/"$THREAD_ID".sqlite \
     --provider <Coordinator provider id> --model <Coordinator model id>
   ```

   The fold state is `{ "summary": "...", "at": <createdAt of the last folded row> }`. Rows after `at` are seeded verbatim, at most the newest 100; older ones stay readable through `read_history`.

4. Restart the server with `CAIRN_COORDINATOR_MACHINE_ID=<machineId>`.
5. Start the sidecar: `pnpm --filter @cairn/coordinator dev`. It logs `turn <step> claimed` and `turn <step> success` per turn. It holds `threads.lock` beside the store directory with its pid; a second sidecar on the same directory exits with `in use by another Coordinator sidecar`. To stop it, signal the pid in that file, not `pnpm`: killing `pnpm` with SIGKILL leaves the node process running.
6. Send the Coordinator a message and check that its answer appears in the conversation.

## Rollback

Stop the sidecar and restart the server without `CAIRN_COORDINATOR_MACHINE_ID`. Daemons take Coordinator turns again. A turn the sidecar held goes back to pending once its heartbeat is 120 seconds stale. The sidecar store stays on disk for a later retry.

## Crash and restart

Restart the sidecar the same way. It claims its unfinished turn again under the same step id, which is Pi's request id, so the turn resumes instead of running twice: an interrupted model request is retried, read tools rerun, and a dispatching tool that was cut off comes back to the model as interrupted.

## Upgrading Pi Durable

Stored data migrates one way: once a newer pi-durable has written the store, an older one cannot open it. Before changing the pinned version, stop the sidecar and copy the `threads` directory; roll back by restoring that copy, which loses the turns since.
