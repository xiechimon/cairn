# Issue 1775: credential gateway prior art

Research date: 2026-10-27. This document supports design review; it does not approve or implement a gateway.

## Evidence scope

**Verified** means primary-source documentation or source code was retrieved and inspected during this research. It does not mean the software was deployed or adversarially tested here. **Inference** means a design consequence derived from those sources. **Unverified** means a claim remains unsupported by the inspected primary sources.

The prescribed `agent-reach` executable was absent at `/home/ian/.local/bin/agent-reach`. Retrieval used its documented GitHub CLI and Jina Reader channels. No gateway, TLS interception certificate, network policy, or privileged process was installed.

## SPACE

Verified: SPACE's installation guide requires a Linux x86_64 host with KVM, TUN, loop devices, btrfs support, and privileged Docker containers; it explicitly excludes direct macOS installation. Its architecture places guest execution in Firecracker microVMs. These deployment prerequisites make adopting its complete runtime incompatible with the issue's current Mac/Linux scope. Sources: [installation](https://github.com/perplexityai/SPACE/blob/146c77f0cc351e9742c8597b0683e997258dc764/docs/installation.md), [architecture](https://github.com/perplexityai/SPACE/blob/146c77f0cc351e9742c8597b0683e997258dc764/docs/architecture.md).

Verified: the inspected gateway credential code resolves credential headers from a certificate lease using HTTP method and URI path. Injection sets those headers on the sanitized request. Missing, invalid, or stale credential material is denied; temporarily unavailable material yields a service-unavailable response. This is a concrete example of server-side request mutation rather than returning credentials to a guest tool. Source: [credential resolution and injection](https://github.com/perplexityai/SPACE/blob/146c77f0cc351e9742c8597b0683e997258dc764/crates/libs/net/gateway/server/src/tcp_proxy/tls_http/credentials.rs).

Verified: inspected HTTPS forwarding checks request authority against the lease's host and port before credential authorization. Its authority validator rejects mismatched names or ports and duplicate Host headers. Credential-bearing protocol upgrades are refused. Plain HTTP host binding checks each request against the destination and DNS attribution before forwarding. Sources: [HTTPS forwarding and authority validation](https://github.com/perplexityai/SPACE/blob/146c77f0cc351e9742c8597b0683e997258dc764/crates/libs/net/gateway/server/src/tcp_proxy/tls_http/forward.rs), [HTTP host binding](https://github.com/perplexityai/SPACE/blob/146c77f0cc351e9742c8597b0683e997258dc764/crates/libs/net/gateway/server/src/tcp_proxy/http_host.rs).

Inference: Cairn should copy the separation of credential custody, per-request authorization, and upstream mutation rather than copy SPACE's runtime. IP admission alone cannot identify a tenant behind a shared CDN; every request authority needs binding to the authorized TLS origin. The inspected forwarding code establishes a useful authority-check pattern, but this research did not verify the complete SNI-to-lease construction or packet-source-validation chain.

Unverified: the issue's reported red-team totals, platform bypass totals, and historical attribution of fixes were not established from the inspected primary sources. They are not acceptance evidence for Cairn. No claim is made here that SPACE prevents every response from reflecting an injected credential.

## Agent Baseline

Verified: the reference architecture is version 1, dated 13 October 2026, and open for comment. It treats agent inputs and reachable destinations as untrusted and places credentials at an external egress proxy. Its network boundary is default deny and assumes the agent cannot bypass or reconfigure enforcement. Sources: [reference architecture](https://agentbaseline.org/reference-architecture), [source paper](https://github.com/agentbaseline/agentbaseline/blob/main/software-factory/software-factory.md).

Inference: this is a statement of required trust boundaries, not an implementation Cairn can enable by setting proxy environment variables. Cairn must separately establish that the agent cannot inspect gateway memory, alter policy, reach its administrative interface, or take a direct network path. An approved host remains potentially hostile; origin authorization alone cannot prove that responses contain no credentials.

## Envoy

Verified: Envoy supports listener TLS termination, upstream TLS origination, SNI, and configurable peer certificate verification. Its external authorization HTTP filter delegates request authorization to an HTTP or gRPC service. Its documentation explicitly warns that filters which clear the route cache after authorization can cause authorization bypass. Sources: [TLS support](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/security/ssl), [external authorization](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/ext_authz_filter).

Inference: Envoy is a candidate protocol engine for an enforced gateway with Cairn-owned authorization and credential custody. The inspected capabilities do not establish that its default configuration binds CONNECT authority, downstream SNI, HTTP Host or HTTP/2 authority, and upstream certificate identity together. That complete configuration must be demonstrated with negative tests before selection. TLS support also does not itself demonstrate dynamic interception certificate issuance, package availability on supported Macs, or process isolation from a same-user hostile shell.

Unverified: no production configuration, supported binary matrix, certificate-generation integration, update strategy, or route-mutation-safe Cairn integration was tested. Envoy is therefore a reuse candidate, not the selected dependency.

## mitmproxy

Verified: regular proxy mode requires client configuration, and the documentation explicitly identifies applications that bypass operating-system proxy settings. Local capture exists on Linux and macOS; Linux capture uses a privileged subprocess for eBPF and documents kernel and container restrictions. WireGuard mode has limited IPv6 forwarding and cannot transparently capture all traffic of its own host. Source: [proxy modes](https://docs.mitmproxy.org/stable/concepts/modes/).

Verified: HTTPS interception requires clients to trust the interception CA; certificate pinning can reject interception. The generated CA material includes a private key which must stay outside agent access. Source: [certificate handling](https://docs.mitmproxy.org/stable/concepts/certificates/).

Inference: mitmproxy is suitable for a controlled HTTPS research harness because it exposes decrypted HTTP, but capture support is not evidence of tamper-resistant enforcement. Production selection requires independent proof of descendant-process coverage, alternate DNS and IPv6 handling, direct-socket prevention, CA custody, destination validation, and protection against agent interference. Bypassing interception for a pinned client cannot remain an authenticated secret-injection path.

## Consequences for the approval decision

1. Credential injection and arbitrary egress restriction are separate deliverables. Neither proxy environment variables nor TLS interception alone establishes compulsory routing.
2. Prefer a mature HTTP/TLS engine over a new ad hoc parser, conditional on verified origin binding, failure behavior, deployment support, and an unmodifiable agent boundary.
3. A gateway can keep the original key out of tool results while still allowing authorized operations that misuse its authority. Operation and resource policy may need finer scope than hostname matching.
4. A malicious authorized server can reflect a credential, transform it, or encode it in a response. Exact-value redaction is defense in depth and cannot establish a universal no-disclosure guarantee. The supported upstream trust and response contract needs an explicit decision.
5. macOS and Linux enforcement need separate acceptance evidence. These sources establish neither a universal same-user process sandbox nor an approved cross-platform deployment design for Cairn.
6. Keep existing plaintext delivery unchanged until Ian approves policy migration, supported backend boundaries, the response contract, and the gateway reuse choice. Full microVM deployment remains out of scope.
