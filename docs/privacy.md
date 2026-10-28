# Privacy

**Cairn sends nothing.** The product has no analytics service, no telemetry endpoint, no crash reporter and no usage beacon. Nothing about your work leaves the machine that runs the server unless you configure an integration yourself or press a button that opens a page.

The only exception is an integration you set up: once you connect a model provider or GitHub, Cairn talks to that provider because that is what the integration does. The list of providers and tokens is in the team settings, and every one of them is one you added.

## The first-PR prompt

After the first pull request from your team merges, Cairn can offer a link that opens a **prefilled GitHub Discussions post**. The link is a plain URL; opening it is your decision, and submitting the post is a second decision made on GitHub.

- The prompt is **off by default**. With the setting off, merging a first pull request creates nothing: no request, no page, no link.
- Even with the setting on, **Cairn opens nothing by itself**. It shows a dismissible card with a link. Nothing is sent until you click the link and then submit the post on GitHub.
- Dismissing the card hides it for good; the setting is stored per team and survives a restart.

## The prefilled post

The card's link is built locally. Its title and body contain these fields and nothing else:

- `time-to-first-pr`: the whole number of days between creating the team and the first recorded pull request, omitted when the first pull request predates the team record.

The prefilled text never contains a name, email address, avatar or GitHub login, a task title or task description, a repository name or `owner/repo` pair, a branch name, a commit, a diff, a file path, a pull-request number or pull-request URL, a machine name, a team id, or any API key or token. The link points at the public repository's new-discussion form, so the only identity it carries is the one GitHub already knows because you are signed in when you submit the post.

The link stays under the URL length limit: when the text would run long, the day count is dropped rather than truncated mid-sentence.

## What the prompt cannot see

The prompt is not analytics. It cannot tell the project how many people merged a first pull request, how many saw the card, or how many dismissed it. Those numbers exist only in whatever people choose to post publicly, which is the point: the only measurement is a public post a person decided to publish.

## Turning it off

Open **Account** and use **First-PR community prompt**, a team-wide setting that is off by default. Turning it off stops the card from appearing for that team; no previously created data is kept, because no data is collected.

## Where to ask

Questions about this document go to the [Q&A category](https://github.com/xiechimon/cairn/discussions) or the issue tracker. Security reports follow [SECURITY.md](../SECURITY.md).
