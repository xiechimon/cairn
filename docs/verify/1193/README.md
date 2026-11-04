# 1193 Create tags

Live stack: web `http://127.0.0.1:5273`, server `http://127.0.0.1:8791`, fresh `PACMAN_HOME` under `.claude/verify-run/home`. Seeded local machine `mJ_C1xP2HbM2VE8wDhX1X` (`enabledRuntimes: ["pi"]`). Agent `Psesx8nSyHS5NlOjFgapa`, display name `verify-1193`, provider null.

Each pass is a new browser context. The walk is the sidebar user menu, Account, the language list set to English (`document.documentElement.lang === "en"`), the team card, then the Permissions tab.

Before the dictionary change, the third tool switch accessible name is `Create labels`. The hint under it is `Let this Agent create git tags, which may trigger a release pipeline.` Pass 1 and pass 2 match. See `before-viewport.png`, `before-viewport-pass-2.png`, `before-perms.png`, `before-result.json`.

The same walk, while the dictionary still said `Create labels`, looking for a switch named `Create tags`, timed out. The page text at timeout still contains `Create labels` and the git tag hint. See `old-expect-tags.log` and `old-expect-tags.txt`.

After `创建标签` maps to `Create tags`, both passes report the switch names `Remote shell`, `Merge branches`, `Create tags`, `Push branches`, `Create skills`, `Update skills`. The `Create labels` switch count is 0. The git tag hint is unchanged. See `after-viewport.png`, `after-viewport-pass-2.png`, `after-perms.png`, `after-result.json`.
