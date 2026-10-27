# Live replay not run

The two live replays from the ticket (closed real bug ticket, thin ticket) were not run on a live stack in this lane.

Missing prerequisites on this host:

- A scratch GitHub repository to hold the replayed issues. Posting on `xiechimon/cairn` is excluded, and creating a repository on the owner's account was not authorized for this task.
- A GitHub connection (token) stored on a verify-cairn stack and a project whose `githubRepo` points at that scratch repository.
- A chief bound to an agent with a model, plus an enrolled machine running a daemon, so that the chief step is claimed and the agent can run `gh issue comment` and `gh issue edit`.

What was verified instead is in `README.md` and `replay.md`: real issue payloads go through the real intake code (`createIssueIntake` with a GitHub fake) and produce the reproduce-first orchestration message. The agent behavior after that message (screenshot in the comment, `needs-info` label swap) is not evidenced and the Acceptance items for the live replays stay unchecked.

To run it: `node .claude/skills/verify-cairn/scripts/vp.mjs cleanup`, then `vp.mjs launch`, connect a token for the scratch repo, bind the chief, enroll a daemon, label two issues `bug` and `ready-for-agent`, wait for the chief step, then archive with `vp.mjs archive 1618 --from <evidence dir>`.
