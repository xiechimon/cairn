# Original requirement and actual Swagger evidence

All API/GitHub/trial/canary data shown is explicitly simulated from existing test fixtures. The checker/report code and local HTTP requests are real. No provider, production account, Orb trial, deployment or actual 20-ticket batch is exercised.

PNG files are direct screenshots of the original GitHub source and unchanged Swagger UI Execute widgets, not a generated HTML report. The isolated /fixtures routes only bridge the actual function into the API tool; they are not product endpoints. JSON contains the actual returns.

Original D60 contract: https://github.com/xiechimon/cairn/pull/2866

Exact implementation head: 9d5d365688071d9d8280c2232a197cc8945a1f7d. A completed session and answered question pass; the same session with awaitingReply=true fails server-reply and omits trial-one success.
