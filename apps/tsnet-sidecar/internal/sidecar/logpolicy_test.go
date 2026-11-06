package sidecar

import (
	"testing"

	"tailscale.com/envknob"
)

func clearNoLogs(t *testing.T) {
	t.Helper()
	t.Setenv("TS_NO_LOGS_NO_SUPPORT", "")
}

func TestApplyLogPolicyDisablesUploadUnlessOptedIn(t *testing.T) {
	clearNoLogs(t)
	ApplyLogPolicy(false)
	if !envknob.NoLogsNoSupport() {
		t.Fatal("log upload must be disabled when the opt-in is absent")
	}
}

func TestApplyLogPolicyLeavesUploadAloneOnOptIn(t *testing.T) {
	clearNoLogs(t)
	ApplyLogPolicy(true)
	if envknob.NoLogsNoSupport() {
		t.Fatal("opting in must not disable log upload")
	}
}

func TestApplyLogPolicyKeepsAnInheritedDisable(t *testing.T) {
	t.Setenv("TS_NO_LOGS_NO_SUPPORT", "true")
	ApplyLogPolicy(true)
	if !envknob.NoLogsNoSupport() {
		t.Fatal("an inherited disable must survive the opt-in flag")
	}
}
