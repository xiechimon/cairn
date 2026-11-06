package sidecar

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func discardLogf(string, ...any) {}

func shortSocketPath(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "ts")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return filepath.Join(dir, "s.sock")
}

func serveOnUnix(t *testing.T, handler http.Handler) Upstream {
	t.Helper()
	path := shortSocketPath(t)
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewUnstartedServer(handler)
	server.Listener = listener
	server.Start()
	t.Cleanup(server.Close)
	return Upstream{Network: "unix", Address: path}
}

func echoHeaders(w http.ResponseWriter, r *http.Request) {
	seen := map[string]string{"Host": r.Host}
	for name, values := range r.Header {
		seen[name] = strings.Join(values, ",")
	}
	_ = json.NewEncoder(w).Encode(seen)
}

func fetchHeaders(t *testing.T, base string, forged map[string]string) map[string]string {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, base+"/api/ping?x=1", nil)
	if err != nil {
		t.Fatal(err)
	}
	for name, value := range forged {
		request.Header.Set(name, value)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var seen map[string]string
	if err := json.NewDecoder(response.Body).Decode(&seen); err != nil {
		t.Fatal(err)
	}
	return seen
}

var forgedHeaders = map[string]string{
	"Tailscale-User-Login":       "owner@example.com",
	"Tailscale-User-Name":        "Owner",
	"Tailscale-User-Profile-Pic": "https://example.com/p.png",
	"Tailscale-Headers-Info":     "https://tailscale.com/s/serve-headers",
	"X-Forwarded-For":            "100.64.0.1",
	"X-Forwarded-Host":           "attacker.example",
	"X-Forwarded-Proto":          "https",
	"Forwarded":                  "for=100.64.0.1;proto=https",
	"X-Real-Ip":                  "100.64.0.1",
	"Authorization":              "Bearer keep-me",
}

func TestStripUntrustedRemovesForgeableHeadersOnly(t *testing.T) {
	header := http.Header{}
	for name, value := range forgedHeaders {
		header.Set(name, value)
	}
	header.Set("Cookie", "a=b")
	header.Set("Tailscale_User_Login", "underscore")

	StripUntrusted(header)

	for name := range header {
		switch name {
		case "Authorization", "Cookie", "Tailscale_user_login":
		default:
			t.Errorf("header %q survived stripping", name)
		}
	}
	if header.Get("Authorization") != "Bearer keep-me" || header.Get("Cookie") != "a=b" {
		t.Fatalf("stripping removed headers the server needs: %v", header)
	}
}

func TestFunnelProxyStripsForgedHeadersAndNeverSetsIdentity(t *testing.T) {
	upstream := serveOnUnix(t, http.HandlerFunc(echoHeaders))
	front := httptest.NewServer(NewProxy(upstream, nil, discardLogf))
	t.Cleanup(front.Close)

	seen := fetchHeaders(t, front.URL, forgedHeaders)

	for name := range forgedHeaders {
		canonical := http.CanonicalHeaderKey(name)
		if canonical == "Authorization" {
			continue
		}
		if _, present := seen[canonical]; present {
			t.Errorf("forged header %q reached the server", canonical)
		}
	}
	if seen["Authorization"] != "Bearer keep-me" {
		t.Fatalf("Authorization was not forwarded: %v", seen)
	}
}

func TestTailnetProxyReplacesForgedIdentityWithWhoIs(t *testing.T) {
	upstream := serveOnUnix(t, http.HandlerFunc(echoHeaders))
	var asked string
	identify := func(_ context.Context, remoteAddr string) (Identity, error) {
		asked = remoteAddr
		return Identity{Login: "real@example.com", Name: "Real"}, nil
	}
	front := httptest.NewServer(NewProxy(upstream, identify, discardLogf))
	t.Cleanup(front.Close)

	seen := fetchHeaders(t, front.URL, forgedHeaders)

	if seen[HeaderUserLogin] != "real@example.com" || seen[HeaderUserName] != "Real" {
		t.Fatalf("identity headers = %q / %q, want the WhoIs identity", seen[HeaderUserLogin], seen[HeaderUserName])
	}
	if asked == "" {
		t.Fatal("WhoIs was not asked about the peer address")
	}
	for _, name := range []string{"X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "Forwarded", "X-Real-Ip", "Tailscale-User-Profile-Pic", "Tailscale-Headers-Info"} {
		if _, present := seen[name]; present {
			t.Errorf("forged header %q reached the server", name)
		}
	}
}

func TestTailnetProxyDropsForgedIdentityWhenWhoIsHasNoUser(t *testing.T) {
	upstream := serveOnUnix(t, http.HandlerFunc(echoHeaders))
	cases := map[string]Identifier{
		"whois error": func(context.Context, string) (Identity, error) { return Identity{}, errors.New("no such peer") },
		"tagged node": func(context.Context, string) (Identity, error) { return Identity{}, nil },
	}
	for name, identify := range cases {
		t.Run(name, func(t *testing.T) {
			front := httptest.NewServer(NewProxy(upstream, identify, discardLogf))
			t.Cleanup(front.Close)

			seen := fetchHeaders(t, front.URL, forgedHeaders)

			if _, present := seen[HeaderUserLogin]; present {
				t.Fatalf("forged %s reached the server", HeaderUserLogin)
			}
		})
	}
}

func TestProxyKeepsHostPathAndQuery(t *testing.T) {
	var gotURI string
	upstream := serveOnUnix(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotURI = r.RequestURI
		echoHeaders(w, r)
	}))
	front := httptest.NewServer(NewProxy(upstream, nil, discardLogf))
	t.Cleanup(front.Close)

	seen := fetchHeaders(t, front.URL, nil)

	if gotURI != "/api/ping?x=1" {
		t.Fatalf("request URI = %q", gotURI)
	}
	if seen["Host"] != strings.TrimPrefix(front.URL, "http://") {
		t.Fatalf("Host = %q, want the inbound host", seen["Host"])
	}
}

func TestProxyReportsBadGatewayWhenUpstreamIsDown(t *testing.T) {
	upstream := Upstream{Network: "unix", Address: shortSocketPath(t)}
	front := httptest.NewServer(NewProxy(upstream, nil, discardLogf))
	t.Cleanup(front.Close)

	response, err := http.Get(front.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", response.StatusCode)
	}
}

func TestProxyForwardsOverTCPUpstream(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(echoHeaders))
	t.Cleanup(backend.Close)
	upstream, err := ParseUpstream("tcp:" + strings.TrimPrefix(backend.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(NewProxy(upstream, nil, discardLogf))
	t.Cleanup(front.Close)

	seen := fetchHeaders(t, front.URL, nil)

	if len(seen) == 0 {
		t.Fatal("no response through the tcp upstream")
	}
}

func TestProxyStreamsServerSentEventsWithoutBuffering(t *testing.T) {
	release := make(chan struct{})
	upstream := serveOnUnix(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: first\n\n")
		w.(http.Flusher).Flush()
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	front := httptest.NewServer(NewProxy(upstream, nil, discardLogf))
	t.Cleanup(front.Close)
	t.Cleanup(func() { close(release) })

	response, err := http.Get(front.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	line := make(chan string, 1)
	go func() {
		text, _ := bufio.NewReader(response.Body).ReadString('\n')
		line <- text
	}()

	select {
	case text := <-line:
		if text != "data: first\n" {
			t.Fatalf("first event = %q", text)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("first event was buffered until the response ended")
	}
}

func TestProxyPassesWebSocketUpgrades(t *testing.T) {
	upstream := serveOnUnix(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, buffered, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = io.WriteString(buffered, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
		_ = buffered.Flush()
		text, _ := buffered.ReadString('\n')
		_, _ = io.WriteString(buffered, strings.ToUpper(text))
		_ = buffered.Flush()
	}))
	front := httptest.NewServer(NewProxy(upstream, nil, discardLogf))
	t.Cleanup(front.Close)

	conn, err := net.Dial("tcp", strings.TrimPrefix(front.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	_, _ = io.WriteString(conn, "GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
	reader := bufio.NewReader(conn)
	status, err := reader.ReadString('\n')
	if err != nil || !strings.HasPrefix(status, "HTTP/1.1 101") {
		t.Fatalf("upgrade status = %q, err %v", status, err)
	}
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if line == "\r\n" {
			break
		}
	}
	_, _ = io.WriteString(conn, "ping\n")
	echoed, err := reader.ReadString('\n')
	if err != nil || echoed != "PING\n" {
		t.Fatalf("echo = %q, err %v", echoed, err)
	}
}

func TestParseUpstream(t *testing.T) {
	valid := map[string]Upstream{
		"unix:/tmp/a.sock":    {Network: "unix", Address: "/tmp/a.sock"},
		"tcp:127.0.0.1:8787":  {Network: "tcp", Address: "127.0.0.1:8787"},
		"unix:C:\\cairn.sock": {Network: "unix", Address: "C:\\cairn.sock"},
	}
	for spec, want := range valid {
		got, err := ParseUpstream(spec)
		if err != nil || got != want {
			t.Errorf("ParseUpstream(%q) = %v, %v; want %v", spec, got, err, want)
		}
	}
	for _, spec := range []string{"", "unix:", "/tmp/a.sock", "tcp:8787", "udp:1.2.3.4:5", "http://x"} {
		if _, err := ParseUpstream(spec); err == nil {
			t.Errorf("ParseUpstream(%q) succeeded, want an error", spec)
		}
	}
}
