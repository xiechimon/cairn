# Paired requirement and API-tool evidence

Original source: https://github.com/xiechimon/cairn/issues/2278

Simulated existing API/GitHub test fixtures, actual PR checker function and real loopback HTTP through unmodified Swagger UI. No real Orb/provider/trial or GitHub merge.

The requirement PNG is a direct browser screenshot of the original GitHub issue. Swagger PNGs are direct screenshots of Swagger UI Execute requests and responses, not a custom report. The local tool bootstrap declares the operations and serves the unchanged installed Swagger UI bundle (SHA-256 bd2c846c71b05d9147f51a5b42a51e300ea7319be5c6709e95b6d04094ada51f).

The fixture harness exposes simulated API rows and calls checkTrialEvidence from exact PR head 24bbe258fdf301c78ee0bfdbfb0b048ef95b0187. JSON retains actual positive/negative return values. The harness /fixtures routes are evidence-tool endpoints, not product APIs. A successful fixture result does not satisfy trial-one acceptance. The original issue is currently closed by a human action, but no successful real trial evidence has been supplied; closure is not counted as proof.
