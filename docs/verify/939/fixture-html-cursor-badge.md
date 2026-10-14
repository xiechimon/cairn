## Upstream

HTML embedding fixture (#1335): the Cursor badge footer the agent
injects after `<!-- CURSOR_AGENT_PR_BODY_END -->` must scan as
embedded, not bare. The footer is two `<a>` links wrapping `<picture>`
blocks, each with two `<source>` variants and an `<img>` fallback.
Stripping the footer at the lane that opens the PR is out of bounds,
so the gate has to recognize the form. Link-criteria fixture; no
mechanism is added.

## Verified

HTML embedding fixture; no output pair is pasted. The answer exists
to keep the section check satisfied while the link check exercises
the positive case from the bug report.

## Evidence

<div><a href="https://cursor.com/agents/bc-7e9e1a13-10a2-5704-ab80-78d53a3027df?cursor_ref=pr_footer&cursor_cta=open_in_web"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/open-in-web-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/open-in-web-light.png"><img alt="Open in Web" width="114" height="28" src="https://cursor.com/assets/images/open-in-web-dark.png"></picture></a>&nbsp;<a href="https://cursor.com/background-agent?bcId=bc-7e9e1a13-10a2-5704-ab80-78d53a3027df&cursor_ref=pr_footer&cursor_cta=open_in_cursor"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/open-in-cursor-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/open-in-cursor-light.png"><img alt="Open in Cursor" width="131" height="28" src="https://cursor.com/assets/images/open-in-cursor-dark.png"></picture></a>&nbsp;</div>