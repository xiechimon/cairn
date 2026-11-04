# D69 control-plane unit evidence

Source: [D69 startup and authentication requirement](https://github.com/xiechimon/cairn/blob/3e1bde9971ce50552be344dd49396e82dbbd0a6c/docs/ops/control-plane-omarchy.md#4-start-omarchy). The original-document screenshot is the unmodified raw document, byte-checked against the pinned source.

Actual implementation: reviewed PR #2732 head `3826416501817186b886e3e3d67494f52c7098df`, executed in a uniquely named transient systemd user unit with its exact installed mise Node24 binary, heap/memory limits, restart policy and `NODE_USE_ENV_PROXY=1`. Only the working directory, loopback port, HOME/data directory and synthetic access token were replaced for isolation; no production EnvironmentFile or credentials were loaded. The real server stayed active/running with the same MainPID and zero restarts across the capture. Its process environment was checked for the scratch data root and proxy flag.

Official Swagger UI v5.34.1 performed an actual anonymous `GET /api/user/me`; the real Cairn response was HTTP401 with `{"error":"Unauthorized"}`. The screenshot displays the request, response and headers. The API viewer uses a small OpenAPI description of the existing route and the verified upstream distribution; it does not proxy or synthesize a response. Browser cross-origin enforcement is disabled only for this local API-tool capture, so product CORS is not evaluated. `capture.json` records the source digest, binary version, unit observations, exact API response and Swagger upstream blob hashes.

One-sentence check: the real isolated systemd server preserves the documented anonymous-authentication rejection while running the reviewed Node24/proxy environment.

Real: systemd unit, Node process and API response. Mock: none; only credentials and data are synthetic. Not covered: production deployment, production EnvironmentFile, phone/Tailscale, push delivery, web `/app` acceptance and a real provider fetch through the deployed proxy. Issue #2432 remains open for deployed acceptance. The unique proof unit and scratch data were cleaned up; production services were not modified.
