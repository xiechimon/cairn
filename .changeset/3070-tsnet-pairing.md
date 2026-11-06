---
'@xiechimon/cairn': minor
---

Add phone pairing for remote access. A new `GET /api/remote/descriptor` (no auth, only the environment id and a version) and `GET /api/remote/routes` list how to reach this machine. The owner creates a one-time code (QR in Settings, Remote access), the phone exchanges it for its own device token, and each device can be revoked alone. Pairing needs token auth and never works with `CAIRN_AUTH=off`.
