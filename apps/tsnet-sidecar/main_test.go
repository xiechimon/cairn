package main

import "testing"

func TestParseOptionsLogUploadIsOffByDefault(t *testing.T) {
	opts, err := parseOptions([]string{"--state-dir", "s", "--tailnet-upstream", "unix:/t.sock"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.uploadLogs {
		t.Fatal("log upload must be off unless --upload-logs is passed")
	}
}

func TestParseOptionsLogUploadOptIn(t *testing.T) {
	opts, err := parseOptions([]string{"--upload-logs"})
	if err != nil {
		t.Fatal(err)
	}
	if !opts.uploadLogs {
		t.Fatal("--upload-logs must enable log upload")
	}
}

func TestParseOptionsRejectsUnknownFlags(t *testing.T) {
	if _, err := parseOptions([]string{"--no-such-flag"}); err == nil {
		t.Fatal("unknown flags must be rejected")
	}
}
