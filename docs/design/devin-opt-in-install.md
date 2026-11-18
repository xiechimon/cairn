# Install Devin only for an enabled subscription

The Runner currently downloads Devin on every startup, even for a fresh pi-only
installation. Installation must follow the owner's existing subscription choice,
not runtime detection (which requires the binary to be installed first).

The authenticated machine presence response adds optional `installDevin: boolean`.
The server derives it from the machine's own team's enabled, unexpired Devin
subscription. It contains no token or caller-supplied installation URL. Old
servers omit it and new Runners treat omission as false; old Runners ignore it.
Enrollment and dispatch authorization are unchanged.

On each presence response, the Runner starts installation only when this flag is
true and no installation is running or has succeeded in this process. Startup
does not wait for the network download. A successful install is reported through
the existing capability report on the next presence, allowing existing dispatch
gates to admit Devin tasks. Failed or unsupported installs remain unavailable and
can retry on a later presence. Concurrent presence responses share one install.
Disabling or expiring the subscription prevents future starts/retries; an already
started download may finish, and existing files are not deleted. A restart checks
the chosen subscription again before checking for Devin updates.

Regression coverage exercises absent/disabled/expired/foreign subscriptions at
the HTTP boundary, a running Runner switching from no request to an install
request, overlapping presence and failure/retry, and existing Devin installer
tests for archive validation. The pi-only path must make zero installer calls.
