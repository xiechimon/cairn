---
Category: A shell-quoted commit body stored escaped newline characters instead of paragraph breaks
Source: #1671 reviewed delivery checkpoint (2026-10-28)
Level: 2
Safeguard: Write the complete message to a UTF-8 file and assert both absence of escaped newline characters and equality of raw git log output with that file after committing; since 2026-10-28
Intercepts: 0
Recurrences: 0
Notes: The raw message at 70e35faad56625bdf06094bf1064812e827b6e49 fails the escaped-newline assertion. The amended checkpoint uses git commit -F and passes the byte-equivalence check. No repository-wide hook changed; the repeatable checkpoint check is included in docs/verify/1671/README.md.
---
