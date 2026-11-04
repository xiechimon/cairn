# #1279 restart combo line classified as a user bubble

Live stack (`VERIFY_PORT` 8791, `VERIFY_WEB_PORT` 5273, fresh `PACMAN_HOME`). No daemon, no LLM. Probe: `.claude/skills/verify-pacman/scripts/drive-1279-restart-combo.mts`.

The todo is created as `漂移前俳句`, the restart combo is composed with that title, then `PATCH /api/todos/:id` sets the title to `漂移后俳句`. The transcript upload plants five user rows plus one assistant row:

| row | classifyUserText before | bubble before | classifyUserText after | bubble after |
|---|---|---|---|---|
| feedback `把句号改成叹号试试` | user | yes | user | yes |
| stale task text, no instruction | user | yes | user | yes |
| bare `buildRestartPrompt` | synthetic | no | synthetic | no |
| combo with the current title | synthetic | no | synthetic | no |
| combo with the old title | user | yes | synthetic | no |

Before: 6/6, `bubbles=3`, the third bubble is the drifted combo (`before-result.json`, `before-classify.json`). After: 6/6, `bubbles=2`, that combo is gone (`after-result.json`, `after-classify.json`). The description area shows the current title. The feedback row stays.

```sh
node .claude/skills/verify-pacman/scripts/launch.mjs
cd apps/server && pnpm exec tsx ../../.claude/skills/verify-pacman/scripts/drive-1279-restart-combo.mts --expect=new
```

`--expect=old` is the pre-fix shape (drifted combo is a user bubble).
