# Use the project runtime for verification

The first verification pass inherited Homebrew Node 26 instead of the repository's Node 24. Running focused process tests alongside the complete script suite also produced timing failures in dispatch startup checks.

Use the version declared in `.nvmrc` through `fnm exec --using=24.14.0` for this checkout. Run the complete script suite serially before interpreting process timing failures. Preserve failed attempts in the verification record and distinguish runtime or sandbox failures from code failures.

The subsequent focused Node 24 run passed the dispatch tests. The full serial suite still failed the missing-command startup check, which observes process state after a fixed grace period. Loopback-listener restrictions and the native Node import failure in the unchanged harness worker test remain separate verification limits.
