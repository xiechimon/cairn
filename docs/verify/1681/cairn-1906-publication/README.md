# Offline-oracle evidence publication

These files preserve the runtime controls captured while reviewing implementation PR #1906. They are published separately because a concurrent bot refresh twice omitted the new archive from that PR branch. This publication changes no implementation code.

The tested implementation revision was 75cf2619a5da9bba1092c60940f13ae70b42a848. The original archive commit 340b9fa74cb21267856747075e29d954f9fa5cf9 added documentation only. The phrase "this branch" in the captured runtime README refers to that original implementation checkout.

The runtime image is sha256:f9b3e7d79aac10c634f9579808636465c1c2ddd837f788d0b2ac41e989eb035a. The runtime log records Docker-inspected network modes, verifier exit codes, rewards and the endpoint probe. Network mode none passed with reward 1; the host-network negative control exited before pytest with reward 0. The probe itself establishes endpoint reachability, while Docker network mode establishes the isolation setting.

The archive does not establish a new full Harbor run or production deployment. The original PR remains responsible for implementation acceptance and its final candidate must include or inherit these files.
