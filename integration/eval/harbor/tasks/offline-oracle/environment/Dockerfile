FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV UV_PYTHON_PREFERENCE=only-system

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/*

COPY vendor/uv-0.9.7 /usr/local/bin/uv
COPY vendor/site /opt/verifier/site
RUN chmod 755 /usr/local/bin/uv \
  && mkdir -p /opt/verifier/bin \
  && printf '%s\n' '#!/bin/sh' 'export PYTHONPATH=/opt/verifier/site${PYTHONPATH:+:$PYTHONPATH}' 'exec python3 -m pytest "$@"' > /opt/verifier/bin/pytest \
  && chmod 755 /opt/verifier/bin/pytest

WORKDIR /app
