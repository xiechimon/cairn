# #2182 evidence

- `environment.json` and `branch-policies.json`: `gh api repos/xiechimon/cairn/environments/npm` and its deployment branch policies, captured 2026-10-30. The environment `npm` has one protection rule, `branch_policy`, which allows only the branch `main`. It has no required reviewers.
- `probe-run.txt`: `gh run view 41000936020`. A throwaway branch `probe/2182-env-deny` pushed a workflow whose only job deploys to `npm`. GitHub rejected it: `Branch "probe/2182-env-deny" is not allowed to deploy to npm due to environment protection rules.` The job ran no steps, and no npm or OIDC call was made. The branch was then deleted.
- `green.log`: `node --test scripts/release-config.test.mjs`. 29 pass, 0 fail. This includes the check that the pin names `environment: npm` once inside `publish`, and fixture 23, which removes that line and is rejected.
