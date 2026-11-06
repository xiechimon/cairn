package sidecar

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

const waitLimit = 5 * time.Second

type eventSink struct {
	events chan Event
}

func newEventSink() *eventSink {
	return &eventSink{events: make(chan Event, 64)}
}

func (s *eventSink) Write(p []byte) (int, error) {
	var event Event
	if err := json.Unmarshal(p, &event); err != nil {
		return 0, err
	}
	s.events <- event
	return len(p), nil
}

func (s *eventSink) next(t *testing.T) Event {
	t.Helper()
	select {
	case event := <-s.events:
		return event
	case <-time.After(waitLimit):
		t.Fatal("timed out waiting for an event")
		return Event{}
	}
}

func (s *eventSink) expectType(t *testing.T, eventType string) Event {
	t.Helper()
	event := s.next(t)
	if event.Type != eventType {
		t.Fatalf("event = %+v, want type %q", event, eventType)
	}
	return event
}

func (s *eventSink) expectNone(t *testing.T) {
	t.Helper()
	select {
	case event := <-s.events:
		t.Fatalf("unexpected event %+v", event)
	case <-time.After(60 * time.Millisecond):
	}
}

type fakeNode struct {
	mu           sync.Mutex
	status       Status
	statusErr    error
	startErr     error
	tlsErr       error
	funnelErr    error
	identity     Identity
	tlsListeners []net.Listener
	funnels      []net.Listener
	tlsCalls     int
	funnelCalls  int
	closed       int
}

func (n *fakeNode) setStatus(status Status) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.status = status
}

func (n *fakeNode) setFunnelErr(err error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.funnelErr = err
}

func (n *fakeNode) Start() error { return n.startErr }

func (n *fakeNode) Status(context.Context) (Status, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.status, n.statusErr
}

func (n *fakeNode) listen(calls *int, failure error, into *[]net.Listener) (net.Listener, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	*calls++
	if failure != nil {
		return nil, failure
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	*into = append(*into, listener)
	return listener, nil
}

func (n *fakeNode) ListenTLS(string) (net.Listener, error) {
	return n.listen(&n.tlsCalls, n.tlsErr, &n.tlsListeners)
}

func (n *fakeNode) ListenFunnel(string) (net.Listener, error) {
	return n.listen(&n.funnelCalls, n.funnelErr, &n.funnels)
}

func (n *fakeNode) WhoIs(context.Context, string) (Identity, error) {
	return n.identity, nil
}

func (n *fakeNode) Close() error {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.closed++
	return nil
}

func (n *fakeNode) funnelAddr(t *testing.T) string {
	t.Helper()
	n.mu.Lock()
	defer n.mu.Unlock()
	if len(n.funnels) == 0 {
		t.Fatal("no funnel listener")
	}
	return n.funnels[len(n.funnels)-1].Addr().String()
}

func (n *fakeNode) tailnetAddr(t *testing.T) string {
	t.Helper()
	n.mu.Lock()
	defer n.mu.Unlock()
	if len(n.tlsListeners) == 0 {
		t.Fatal("no tailnet listener")
	}
	return n.tlsListeners[0].Addr().String()
}

type harness struct {
	node     *fakeNode
	events   *eventSink
	commands chan Command
	cancel   context.CancelFunc
	done     chan error
	finished chan struct{}
}

func startHarness(t *testing.T, node *fakeNode, cfg Config) *harness {
	t.Helper()
	if cfg.PollInterval == 0 {
		cfg.PollInterval = 5 * time.Millisecond
	}
	if cfg.TailnetUpstream.IsZero() {
		cfg.TailnetUpstream = Upstream{Network: "unix", Address: shortSocketPath(t)}
	}
	cfg.Logf = discardLogf
	sink := newEventSink()
	ctx, cancel := context.WithCancel(context.Background())
	h := &harness{node: node, events: sink, commands: make(chan Command, 8), cancel: cancel, done: make(chan error, 1), finished: make(chan struct{})}
	go func() {
		h.done <- Run(ctx, node, cfg, h.commands, NewEmitter(sink))
		close(h.finished)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-h.finished:
		case <-time.After(waitLimit):
		}
	})
	return h
}

func (h *harness) waitDone(t *testing.T) error {
	t.Helper()
	select {
	case err := <-h.done:
		return err
	case <-time.After(waitLimit):
		t.Fatal("Run did not return")
		return nil
	}
}

var runningStatus = Status{Running: true, DNSName: "cairn.tail-scale.ts.net", IPs: []string{"100.64.0.7", "fd7a::7"}}

func TestLoginURLIsReportedOncePerURLAndAgainAfterReauth(t *testing.T) {
	node := &fakeNode{status: Status{AuthURL: "https://login.example/a"}}
	h := startHarness(t, node, Config{})

	first := h.events.expectType(t, EventAuthURL)
	if first.URL != "https://login.example/a" {
		t.Fatalf("first auth URL = %q", first.URL)
	}
	h.events.expectNone(t)

	node.setStatus(Status{AuthURL: "https://login.example/b"})
	if got := h.events.expectType(t, EventAuthURL).URL; got != "https://login.example/b" {
		t.Fatalf("second auth URL = %q", got)
	}

	node.setStatus(runningStatus)
	h.events.expectType(t, EventReady)

	node.setStatus(Status{AuthURL: "https://login.example/b"})
	if got := h.events.expectType(t, EventAuthURL).URL; got != "https://login.example/b" {
		t.Fatalf("auth URL after expiry = %q, want it surfaced again", got)
	}
}

func TestReadyCarriesIPsAndDNSNameAndOpensTailnetListenerOnce(t *testing.T) {
	node := &fakeNode{status: runningStatus}
	h := startHarness(t, node, Config{})

	ready := h.events.expectType(t, EventReady)
	if ready.DNSName != "cairn.tail-scale.ts.net" || len(ready.IPs) != 2 || ready.IPs[0] != "100.64.0.7" {
		t.Fatalf("ready = %+v", ready)
	}
	h.events.expectNone(t)

	node.setStatus(Status{AuthURL: "https://login.example/a"})
	h.events.expectType(t, EventAuthURL)
	node.setStatus(runningStatus)
	h.events.expectType(t, EventReady)

	node.mu.Lock()
	defer node.mu.Unlock()
	if node.tlsCalls != 1 {
		t.Fatalf("ListenTLS called %d times, want 1", node.tlsCalls)
	}
}

func TestReadyWaitsForADNSName(t *testing.T) {
	node := &fakeNode{status: Status{Running: true}}
	h := startHarness(t, node, Config{})

	h.events.expectNone(t)
	node.setStatus(runningStatus)
	h.events.expectType(t, EventReady)
}

func TestTailnetListenFailureStopsTheSidecar(t *testing.T) {
	node := &fakeNode{status: runningStatus, tlsErr: errors.New("HTTPS is not enabled")}
	h := startHarness(t, node, Config{})

	err := h.waitDone(t)

	if err == nil || err.Error() != "HTTPS is not enabled" {
		t.Fatalf("Run error = %v", err)
	}
	node.mu.Lock()
	defer node.mu.Unlock()
	if node.closed != 1 {
		t.Fatalf("node closed %d times, want 1", node.closed)
	}
}

func TestStartFailureIsReturned(t *testing.T) {
	node := &fakeNode{startErr: errors.New("state dir unreadable")}
	h := startHarness(t, node, Config{})

	if err := h.waitDone(t); err == nil || err.Error() != "state dir unreadable" {
		t.Fatalf("Run error = %v", err)
	}
}

func TestRunRequiresATailnetUpstream(t *testing.T) {
	err := Run(context.Background(), &fakeNode{}, Config{PollInterval: time.Millisecond}, make(chan Command), NewEmitter(newEventSink()))
	if err == nil {
		t.Fatal("Run accepted a missing tailnet upstream")
	}
}

func TestStatusErrorsAreReportedOnceAndPollingContinues(t *testing.T) {
	node := &fakeNode{statusErr: errors.New("local api not ready")}
	h := startHarness(t, node, Config{})

	if got := h.events.expectType(t, EventError).Error; got != "status: local api not ready" {
		t.Fatalf("error = %q", got)
	}
	h.events.expectNone(t)

	node.mu.Lock()
	node.statusErr = nil
	node.status = runningStatus
	node.mu.Unlock()
	h.events.expectType(t, EventReady)
}

func TestFunnelIsRefusedBeforeTheTailnetIsReady(t *testing.T) {
	node := &fakeNode{status: Status{AuthURL: "https://login.example/a"}}
	h := startHarness(t, node, Config{FunnelUpstream: Upstream{Network: "unix", Address: shortSocketPath(t)}})
	h.events.expectType(t, EventAuthURL)

	h.commands <- Command{Cmd: CommandFunnel, Enabled: true}

	event := h.events.expectType(t, EventFunnel)
	if event.Error == "" || *event.Enabled {
		t.Fatalf("funnel event = %+v, want a refusal", event)
	}
	node.mu.Lock()
	defer node.mu.Unlock()
	if node.funnelCalls != 0 {
		t.Fatal("ListenFunnel was called before the tailnet was ready")
	}
}

func TestFunnelIsRefusedWithoutAFunnelUpstream(t *testing.T) {
	node := &fakeNode{status: runningStatus}
	h := startHarness(t, node, Config{})
	h.events.expectType(t, EventReady)

	h.commands <- Command{Cmd: CommandFunnel, Enabled: true}

	if event := h.events.expectType(t, EventFunnel); event.Error == "" {
		t.Fatalf("funnel event = %+v, want a refusal", event)
	}
	node.mu.Lock()
	defer node.mu.Unlock()
	if node.funnelCalls != 0 {
		t.Fatal("ListenFunnel was called without a funnel upstream")
	}
}

func TestFunnelNotPermittedShowsTheErrorAndStaysOffUntilRetried(t *testing.T) {
	node := &fakeNode{status: runningStatus, funnelErr: errors.New("funnel not enabled for this node")}
	h := startHarness(t, node, Config{FunnelUpstream: Upstream{Network: "unix", Address: shortSocketPath(t)}})
	h.events.expectType(t, EventReady)

	h.commands <- Command{Cmd: CommandFunnel, Enabled: true}
	failed := h.events.expectType(t, EventFunnel)
	if failed.Error != "funnel not enabled for this node" || failed.URL != "" || *failed.Enabled {
		t.Fatalf("funnel event = %+v", failed)
	}

	node.setFunnelErr(nil)
	h.commands <- Command{Cmd: CommandFunnel, Enabled: true}
	enabled := h.events.expectType(t, EventFunnel)
	if enabled.URL != "https://cairn.tail-scale.ts.net:8443" || !*enabled.Enabled || enabled.Error != "" {
		t.Fatalf("funnel event = %+v", enabled)
	}
}

func TestFunnelEnableIsIdempotentAndDisableClosesTheListener(t *testing.T) {
	node := &fakeNode{status: runningStatus}
	h := startHarness(t, node, Config{FunnelUpstream: Upstream{Network: "unix", Address: shortSocketPath(t)}})
	h.events.expectType(t, EventReady)

	h.commands <- Command{Cmd: CommandFunnel, Enabled: true}
	h.events.expectType(t, EventFunnel)
	h.commands <- Command{Cmd: CommandFunnel, Enabled: true}
	if event := h.events.expectType(t, EventFunnel); !*event.Enabled {
		t.Fatalf("second enable = %+v", event)
	}
	node.mu.Lock()
	if node.funnelCalls != 1 {
		t.Fatalf("ListenFunnel called %d times, want 1", node.funnelCalls)
	}
	node.mu.Unlock()
	address := node.funnelAddr(t)

	h.commands <- Command{Cmd: CommandFunnel, Enabled: false}
	if event := h.events.expectType(t, EventFunnel); *event.Enabled {
		t.Fatalf("disable = %+v", event)
	}
	if conn, err := net.DialTimeout("tcp", address, time.Second); err == nil {
		_ = conn.Close()
		t.Fatal("funnel listener still accepts connections after disable")
	}
}

func TestTailnetAndFunnelRouteToTheirOwnUpstreams(t *testing.T) {
	tailnetUpstream := serveOnUnix(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Seen-Login", r.Header.Get(HeaderUserLogin))
		_, _ = w.Write([]byte("tailnet"))
	}))
	funnelUpstream := serveOnUnix(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Seen-Login", r.Header.Get(HeaderUserLogin))
		_, _ = w.Write([]byte("funnel"))
	}))
	node := &fakeNode{status: runningStatus, identity: Identity{Login: "owner@example.com"}}
	h := startHarness(t, node, Config{TailnetUpstream: tailnetUpstream, FunnelUpstream: funnelUpstream})
	h.events.expectType(t, EventReady)
	h.commands <- Command{Cmd: CommandFunnel, Enabled: true}
	h.events.expectType(t, EventFunnel)

	fetch := func(address string) (string, string) {
		request, _ := http.NewRequest(http.MethodGet, "http://"+address+"/", nil)
		request.Header.Set(HeaderUserLogin, "forged@example.com")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body := make([]byte, 16)
		count, _ := response.Body.Read(body)
		return string(body[:count]), response.Header.Get("X-Seen-Login")
	}

	body, login := fetch(node.tailnetAddr(t))
	if body != "tailnet" || login != "owner@example.com" {
		t.Fatalf("tailnet listener gave %q with login %q", body, login)
	}
	body, login = fetch(node.funnelAddr(t))
	if body != "funnel" || login != "" {
		t.Fatalf("funnel listener gave %q with login %q, want no identity", body, login)
	}
}

func TestUnknownCommandIsReportedWithoutStopping(t *testing.T) {
	node := &fakeNode{status: runningStatus}
	h := startHarness(t, node, Config{})
	h.events.expectType(t, EventReady)

	h.commands <- Command{Cmd: "reboot"}

	if event := h.events.expectType(t, EventError); event.Error != "unknown command: reboot" {
		t.Fatalf("event = %+v", event)
	}
	h.commands <- Command{Cmd: CommandShutdown}
	if err := h.waitDone(t); err != nil {
		t.Fatal(err)
	}
}

func TestShutdownClosesListenersAndTheNode(t *testing.T) {
	cases := map[string]func(*harness){
		"shutdown command": func(h *harness) { h.commands <- Command{Cmd: CommandShutdown} },
		"stdin closed":     func(h *harness) { close(h.commands) },
		"context canceled": func(h *harness) { h.cancel() },
	}
	for name, stop := range cases {
		t.Run(name, func(t *testing.T) {
			node := &fakeNode{status: runningStatus}
			h := startHarness(t, node, Config{FunnelUpstream: Upstream{Network: "unix", Address: shortSocketPath(t)}})
			h.events.expectType(t, EventReady)
			h.commands <- Command{Cmd: CommandFunnel, Enabled: true}
			h.events.expectType(t, EventFunnel)
			tailnetAddress := node.tailnetAddr(t)
			funnelAddress := node.funnelAddr(t)

			stop(h)

			if err := h.waitDone(t); err != nil {
				t.Fatal(err)
			}
			h.events.expectType(t, EventStopped)
			for _, address := range []string{tailnetAddress, funnelAddress} {
				if conn, err := net.DialTimeout("tcp", address, time.Second); err == nil {
					_ = conn.Close()
					t.Fatalf("listener %s still accepts connections", address)
				}
			}
			node.mu.Lock()
			defer node.mu.Unlock()
			if node.closed != 1 {
				t.Fatalf("node closed %d times, want 1", node.closed)
			}
		})
	}
}

func TestReadCommandsParsesJSONLinesAndReportsGarbage(t *testing.T) {
	sink := newEventSink()
	input := `{"cmd":"funnel","enabled":true}` + "\n\nnot json\n" + `{"cmd":"shutdown"}` + "\n"

	commands := ReadCommands(strings.NewReader(input), NewEmitter(sink))

	if got := <-commands; got.Cmd != CommandFunnel || !got.Enabled {
		t.Fatalf("first command = %+v", got)
	}
	if got := <-commands; got.Cmd != CommandShutdown {
		t.Fatalf("second command = %+v", got)
	}
	if _, open := <-commands; open {
		t.Fatal("channel stayed open after EOF")
	}
	if event := sink.expectType(t, EventError); event.Error == "" {
		t.Fatalf("event = %+v", event)
	}
}
