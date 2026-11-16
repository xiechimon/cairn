---
"@xiechimon/cairn-cli": patch
"@xiechimon/cairn": patch
---

The Linux task sandbox now starts on Ubuntu 23.10 and later with their AppArmor user-namespace restriction: the task unit no longer sets `ProtectControlGroups`, which made systemd create a user namespace that AppArmor then confined, while bubblewrap's read-only root still keeps the cgroup tree read-only. The Runner page now names two more causes, a bubblewrap older than 0.11 and a system that blocks user namespaces, each with its fix, and getting started has the commands for Ubuntu 24.04 and Debian 12.
