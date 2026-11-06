package sidecar

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"tailscale.com/net/netns"
	"tailscale.com/tailcfg"
	"tailscale.com/tsnet"
	"tailscale.com/tstest/integration/testcontrol"
)

func startTestControl(t *testing.T) *testcontrol.Server {
	t.Helper()
	netns.SetEnabled(false)
	t.Cleanup(func() { netns.SetEnabled(true) })
	control := &testcontrol.Server{
		RequireAuth:    true,
		DNSConfig:      &tailcfg.DNSConfig{Proxied: true},
		MagicDNSDomain: "tail-scale.ts.net",
	}
	control.HTTPTestServer = httptest.NewUnstartedServer(control)
	control.HTTPTestServer.Start()
	t.Cleanup(control.HTTPTestServer.Close)
	return control
}

func startTsnetHarness(t *testing.T, controlURL, stateDir string) *harness {
	t.Helper()
	node := NewTsnetNode(&tsnet.Server{
		Dir:        stateDir,
		Hostname:   "cairn-test",
		ControlURL: controlURL,
		UserLogf:   t.Logf,
	})
	sink := newEventSink()
	cfg := Config{
		TailnetUpstream: Upstream{Network: "unix", Address: shortSocketPath(t)},
		PollInterval:    50 * time.Millisecond,
		Logf:            discardLogf,
	}
	ctx, cancel := context.WithCancel(context.Background())
	h := &harness{events: sink, commands: make(chan Command, 8), cancel: cancel, done: make(chan error, 1), finished: make(chan struct{})}
	go func() {
		h.done <- Run(ctx, node, cfg, h.commands, NewEmitter(sink))
		close(h.finished)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-h.finished:
		case <-time.After(30 * time.Second):
		}
	})
	return h
}

func TestRealTsnetSurfacesLoginURLAndPersistsState(t *testing.T) {
	control := startTestControl(t)
	stateDir := t.TempDir()
	h := startTsnetHarness(t, control.HTTPTestServer.URL, stateDir)

	var authEvent Event
	deadline := time.After(60 * time.Second)
	for authEvent.Type != EventAuthURL {
		select {
		case authEvent = <-h.events.events:
		case <-deadline:
			t.Fatal("no login URL from a control server that requires authentication")
		}
	}

	if !strings.HasPrefix(authEvent.URL, control.HTTPTestServer.URL+"/auth/") {
		t.Fatalf("auth URL = %q", authEvent.URL)
	}
	h.cancel()
	select {
	case <-h.finished:
	case <-time.After(30 * time.Second):
		t.Fatal("sidecar did not stop")
	}
	if _, err := os.Stat(filepath.Join(stateDir, "tailscaled.state")); err != nil {
		t.Fatalf("node state was not persisted: %v", err)
	}
}
