# Paired requirement and API-tool evidence

Original source: https://github.com/xiechimon/cairn/issues/2427

Real isolated Cairn HTTP + SQLite through unmodified Swagger UI assets and a transparent local API proxy. No production/provider traffic.

The requirement PNG is a direct browser screenshot of the original GitHub issue. Swagger PNGs are direct screenshots of Swagger UI Execute requests and responses, not a custom report. The local tool bootstrap declares the operations and serves the unchanged installed Swagger UI bundle (SHA-256 bd2c846c71b05d9147f51a5b42a51e300ea7319be5c6709e95b6d04094ada51f).

The traffic JSON records GET false, POST release true, GET true and the actual SQLite global enabled row. Product UI before/after/phone captures remain on the same asset branch under docs/verify/2427. Production deployment, Coordinator tools and rollback remain unverified.
