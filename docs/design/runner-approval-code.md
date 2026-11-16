# Approving a Runner from the desktop with a terminal code

Part of #5259. Today a new Runner prints an approval link and the owner opens it. On the desktop the owner already sits in the Add Runner dialog, so approval should happen there. The first attempt listed every pending enrollment with an Approve button. A read-only review found that this lets anyone who can reach the server start an enrollment under a copied name and wait for the owner to approve it from the list. The fix binds approval to something only the real terminal shows.

## Design

`POST /api/machine/enroll/start` returns `code` next to `enrollId` and `url`. The code is 8 characters from an unambiguous alphabet, shown as `XXXX-XXXX`. The CLI prints it with the link: open the link, or type the code in Add Runner.

`POST /api/machine/enroll/confirm` accepts `{ enrollId }` (the link path, unchanged) or `{ code }`. A code matches only an unexpired, unapproved enrollment for this team, compared after uppercasing and dropping `-` and spaces. A code that matches nothing returns 404. Confirm keeps its existing authorization: owner token, owner session, or a paired device (whose approval is recorded as not owner-approved, as today); API keys, machine tokens and anonymous callers get 401. Nothing lists pending enrollments.

## States and paths

| Path | Reads or writes | Behavior |
| --- | --- | --- |
| `enroll/start` | writes `ctx.enrollments[enrollId] = { teamId, name, createdAt, code }` | new random code per enrollment |
| `enroll/poll` | reads by enrollId | unchanged; never returns the code |
| `enroll/confirm {enrollId}` | sets `machine` on the entry | unchanged |
| `enroll/confirm {code}` | finds the entry by code, sets `machine` | 404 unknown or expired, 409 already approved, 403 foreign team |
| CLI `enrollThroughBrowser` | stores `code` in `enroll.json`, prints it | an old server without `code` prints the link only |
| Add Runner dialog | posts `{ code }` | success toast; the Runner comes online through the CLI's poll |

## Failures

- Old CLI on a new server: the extra response field is ignored, so the link still works.
- New CLI on an old server: no code is printed, so the link still works.
- Guessing: only the owner and paired devices can confirm, a code has about 10^12 values and lives 10 minutes, so guessing is out of reach. With auth off, confirm is already open, which is the case today.
- Restart: enrollments live in memory. A restart drops them and the CLI starts a new one, the same as today.
