# Scoped root runner for reviewed ops scripts (#2362)

`cairn-ops-run` lets agents on omarchy run a fixed set of ops scripts as root without ian typing his password. It runs only code merged into `main` on GitHub.

## Trust statement

Installing this lets any process running as `ian` run main-merged ops scripts as root unattended. ian is already in `docker` and `wheel`, both root-equivalent (noted on #2345), so this adds no new principal. What it changes is who must be present: the gate on what runs as root moves from ian typing a password to the owner-routed merge of `scripts/**` into `main`. Anyone who can merge to `main` can change what a configured task does. Only root can change which tasks exist, their interpreters, argv and environment allowlists.

## Usage

```sh
sudo cairn-ops-run <task> <full-commit-sha> [--dry-run] [--env NAME=VALUE]...
sudo cairn-ops-run secret-reach-setup "$(git rev-parse origin/main)" --dry-run
sudo cairn-ops-run orb-install-host "$(git rev-parse origin/main)" --env CAIRN_ORB_NODE_MAJOR=26
```

`--dry-run` is appended to the task's fixed argv. `--env` accepts only names listed for that task in `/etc/cairn-ops/tasks.json`, each with a value pattern matched in full. The caller's environment is never passed on; sudo resets it and the wrapper starts Node with `env -i`. Refusals exit `2`; otherwise the task's exit code is returned.

## What a run does

1. Takes the run lock `/var/lib/cairn-ops/run.lock` (`flock`); concurrent runs wait.
2. Refuses unless every path it relies on, and every ancestor of its real path, is owned by root and not group- or world-writable: the wrapper, the module and its `layout.json`, the config, state, mirror and work directories, `git`, `node`, `flock`, `env`, every task `PATH` directory, the task interpreter and the log directory.
3. Validates `tasks.json` strictly. Unknown fields, unsafe paths and reserved environment names (`PATH`, `LD_*`, `NODE_*`, `BASH_*`, `GIT_*` and similar) are refused.
4. Fetches `main` from the configured URL into the root-owned bare mirror `/var/lib/cairn-ops/cairn.git` through the configured proxy, with system and global Git config disabled.
5. Refuses unless the argument is a full 40-character lowercase SHA of a commit reachable from `origin/main`. Short, uppercase and symbolic names are refused.
6. Lists only the task directory at that commit. Any symlink, submodule, `.`/`..`/`.git` segment or entry outside the directory is refused. Each blob is written with `O_EXCL | O_NOFOLLOW` into a fresh root-owned `0755` directory under `/var/lib/cairn-ops/work`, readable but not writable by other users so a task that drops to ian's uid (as `setup-runner-user.mjs` does) can still load its own files. Nothing is read from a checkout, `$HOME` or the caller's environment.
7. Runs `<interpreter> <directory>/<entry> <args...> [--dry-run]` with `PATH=/usr/local/sbin:/usr/local/bin:/usr/bin`, `HOME=/root`, `LANG=C.UTF-8`, `CAIRN_OPS_TASK`, `CAIRN_OPS_COMMIT` and the accepted `--env` values. The work directory is deleted afterwards.
8. Appends JSON lines to `/var/log/cairn-ops/run.log`: a `start` record, then an `end` record with task, commit, argv, start and end times, exit code and any refusal reason. Refusals are logged too.

The runner cannot stop a task script from deliberately reaching into ian-writable paths. Review each task script with that in mind before it merges.

## Install (ian, once)

From a fresh clone of the reviewed commit, not a working checkout:

```sh
git clone https://github.com/xiechimon/cairn.git /tmp/cairn-ops-install
git -C /tmp/cairn-ops-install checkout --detach <reviewed-sha>
sh /tmp/cairn-ops-install/scripts/ops/cairn-ops/install.sh --dry-run
sudo sh /tmp/cairn-ops-install/scripts/ops/cairn-ops/install.sh
sudo -n -l /usr/local/sbin/cairn-ops-run
```

The installer needs `/usr/bin/node`, `/usr/bin/git`, `/usr/bin/flock`, `/usr/bin/env` and `/usr/bin/visudo`. It prints every change, skips satisfied ones on rerun, and with `--dry-run` changes nothing (it can run without sudo; unreadable root-only paths are reported as such). It validates the sudoers rule with `visudo -cf` before writing anything and installs:

| Path | Owner and mode |
| --- | --- |
| `/usr/local/sbin/cairn-ops-run` | `root:root 0755` |
| `/usr/local/lib/cairn-ops/run.mjs`, `layout.json` | `root:root 0644` |
| `/etc/cairn-ops/tasks.json` | `root:root 0644` |
| `/var/lib/cairn-ops`, `work/` | `root:root 0711` |
| bare mirror `/var/lib/cairn-ops/cairn.git` | `root:root 0700` |
| `/var/log/cairn-ops/run.log` | `root:root 0644` |
| `/etc/sudoers.d/zz-cairn-ops` | `root:root 0440` |

The sudoers file is named `zz-` so it sorts after other drop-ins; sudo applies the last matching rule. It contains:

```
Defaults!/usr/local/sbin/cairn-ops-run env_reset, !setenv
ian ALL=(root) NOPASSWD: /usr/local/sbin/cairn-ops-run
```

The last command above must print `/usr/local/sbin/cairn-ops-run` without asking for a password.

## Adding or changing a task

Edit `scripts/ops/cairn-ops/tasks.json`, merge it, then ian reruns the installer from a fresh clone of that commit with sudo. A merged edit has no effect until then.

## Removal

```sh
sudo rm /etc/sudoers.d/zz-cairn-ops
```

Removing the sudoers file revokes the grant; the other files are inert without it.
