package sidecar

import "tailscale.com/envknob"

// ApplyLogPolicy must run before the tsnet server starts. tsnet always builds a
// log uploader and only TS_NO_LOGS_NO_SUPPORT turns its transport into a no-op;
// Server.Logf governs local debug output, not upload.
func ApplyLogPolicy(uploadLogs bool) {
	if uploadLogs {
		return
	}
	envknob.SetNoLogsNoSupport()
}
