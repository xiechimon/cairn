---
Category: Attachment-token neutralization in GitHub imports was incomplete: the title was missed first, then the format characters that fenced-quote stripping removes (U+200B etc. inserted between attach and ment:, reviving the token after stripping)
Source: #1481 (2026-10-24)
Level: 1
Safeguard: the neutralization regex derives from FORMAT_CHARS in prompts.ts (neutralizeIssueAttachmentTokens and quoteIssueLines share the source, so changing the stripped character set changes the neutralization surface in step); the github-issues integration test assembles the import product into a real task prompt, parses attachments per the issue fence, carries tokens in the title and the body separately, and runs one case each for U+200B / U+200C / U+200D / U+FEFF / U+2060
Intercepts: 2
Recurrences: 1
Notes: negative control: with the body fixed but not the title, the secret still parsed out; green once the title was neutralized too; under the literal regex all five invisible-character cases went red (parsing out title / secret / spread references), all green once derived from FORMAT_CHARS. Neutralizing team-authored quote references stays out of scope
---
