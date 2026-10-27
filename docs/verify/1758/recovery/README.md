# Main recovery review controls

Both tests were written and run against PR #1787 before changing the calculator. `red.log` records the two failures: overlapping successful runs produced 120 minutes instead of 30, and a successful completion after the report timestamp prematurely counted as recovery.

`green.log` records 25 passing cases across the existing delivery metrics tests and the new recovery controls. These are deterministic calculator and CLI fixtures, not acceptance of the scheduled workflow, production trajectory ingestion, or repository publication. Those parts of issue #1758 remain outstanding.
