---
Category: An OAuth access-token expiry was treated as the login expiry despite the CLI's refresh mechanism
Source: #1845 (2026-10-27)
Level: 2
Safeguard: Expiry parsing tests distinguish access and refresh clocks and keep an unknown refresh expiry nonblocking
Intercepts: 1
Recurrences: 0
Notes: Negative control: the old parser returned the expired access clock even with a refresh token; see docs/verify/1845/refresh-red.log
---
