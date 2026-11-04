---
Category: The GitHub import's attachment-token neutralization was incomplete: first the title was missed, then the format characters that fenced-quote stripping removes were missed (U+200B etc. inserted between attach and ment:, reviving the token after stripping)
Source: #1481 (2026-10-24)
Level: 1
Safeguard: The neutralization regex is derived from FORMAT_CHARS in prompts.ts (neutralizeIssueAttachmentTokens and quoteIssueLines share the source — changing the stripped character set changes the neutralization surface in sync); the github-issues integration test assembles imported artifacts into a real task prompt, parses attachments per the issue fence, carries tokens in the title and body separately, and runs one case each for U+200B / U+200C / U+200D / U+FEFF / U+2060
Intercepts: 2
Recurrences: 1
Notes: Negative control: with the body fixed but the title not, a secret still parses out; green after neutralizing the title too; under the literal regex all five invisible-character cases go red (parsing out title / secret / spread references), all green after deriving from FORMAT_CHARS. The team's original-quote authorization remains follow-up scope
---
