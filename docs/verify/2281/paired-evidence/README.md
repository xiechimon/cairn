# Original requirement and actual Swagger evidence

All API/GitHub/trial/canary data shown is explicitly simulated from existing test fixtures. The checker/report code and local HTTP requests are real. No provider, production account, Orb trial, deployment or actual 20-ticket batch is exercised.

PNG files are direct screenshots of the original GitHub source and unchanged Swagger UI Execute widgets, not a generated HTML report. The isolated /fixtures routes only bridge the actual function into the API tool; they are not product endpoints. JSON contains the actual returns.

Original requirement: https://github.com/xiechimon/cairn/issues/2281

Exact implementation head: 109cd77136a99ee5e20669d86cae777d252cb7f6. Simulated 20 distinct issues/10 merges pass;20 duplicate attempts count as1 issue/1 merge and fail the acceptance thresholds. Full JSON preserves rows and receipts. This is algorithm proof only; actual 20-ticket trial and post-trial canary remain unverified.
