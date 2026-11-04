# 1681 offline oracle

Harbor 0.24.0 job `offline-oracle-1681-final` on 2026-10-26, image `cairn-harbor-offline-oracle:1681`, compose `network_mode: none`. This run used the final verifier, where an online probe exits nonzero before pytest.

- Mean reward: 1.0 (1 trial, 0 exceptions)
- Trial: `offline-oracle__3jAE9FL`
- `verifier/reward.txt` reads `1`
- `verifier/network.txt` reads `offline`

Negative controls, run directly against the same image on this host:

- `docker run --rm --network host` : a TCP connect to `8.8.8.8:53` succeeds, so host-network scoring would be online and the verifier would score 0.
- `docker run --rm --network none` : a TCP connect to `1.1.1.1:443` fails with `Network is unreachable`.
