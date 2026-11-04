# #2002 funding links

`.github/FUNDING.yml` lists one funding destination:

- `github: xiechimon` renders the repository Sponsor button. GitHub derives the link from the account handle, so the URL is not written into the file.

The Afdian (`爱发电`) link is intentionally not in the committed file. `https://afdian.com/a/xiechimon` is not a real profile: the Afdian API returns `{"ec":400,"em":"用户不存在","data":{}}` for the slug `xiechimon`, the same response as for a nonexistent slug, while known slugs return `ec:200` with user data. The page's 200 response is the generic client-rendered shell, not proof of a profile. The owner's real Afdian profile slug is needed before a `custom` entry can be committed; `funding-yml-gate.mjs` already validates any future `custom` entry the way GitHub does.

## Rules the file has to keep

`scripts/funding-yml-gate.mjs` reads the file the way GitHub does and fails on:

- a missing `.github/FUNDING.yml`;
- a file without a `github` key, because the Sponsor button is the acceptance-relevant account;
- a duplicate platform key, which YAML readers resolve last-wins;
- a key that is not one of GitHub's funding platforms (Afdian is not one, so it has to travel under `custom`);
- a key with no entries, a `github` handle that is not a login, more than one account for a single-account platform, and a `custom` entry that is not an https link.

`funding-yml-gate.test.mjs` pins the committed file to exactly `github: xiechimon`: a wrong handle, an extra key, or any `custom` entry fails the committed-file test.

## Evidence

- `tests-red.log`: the new tests against the old gate and file (4 of 5 red: unpinned file, missing `github` accepted, duplicate keys accepted).
- `tests-pin-red.log`: the committed-file pin with `custom: ['https://afdian.com/a/someoneelse']` in place of the real file (1 of 5 red).
- `tests-green.log`: `node --test scripts/funding-yml-gate.test.mjs`, 5 of 5 pass.
- `gate-green.log`: `node scripts/funding-yml-gate.mjs`, 0 problems.

## Not done here

- The Sponsor button only appears after the owner enrolls in GitHub Sponsors with bank and tax details. `https://github.com/sponsors/xiechimon` redirects to the plain profile today, so enrollment has not happened; that acceptance box on the ticket stays open and cannot be done from the repository.
- The Afdian entry needs the owner's real Afdian profile slug; the slug `xiechimon` does not exist.
