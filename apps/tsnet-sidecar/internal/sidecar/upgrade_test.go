package sidecar

import (
	"bufio"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func echoUpgradeUpstream(t *testing.T) (Upstream, <-chan struct{}) {
	t.Helper()
	ended := make(chan struct{}, 4)
	upstream := serveOnUnix(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, buffered, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = io.WriteString(buffered, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
		_ = buffered.Flush()
		for {
			text, err := buffered.ReadString('\n')
			if err != nil {
				ended <- struct{}{}
				return
			}
			_, _ = io.WriteString(buffered, strings.ToUpper(text))
			_ = buffered.Flush()
		}
	}))
	return upstream, ended
}

type upgradedConn struct {
	conn   net.Conn
	reader *bufio.Reader
}

func openUpgraded(t *testing.T, address string) *upgradedConn {
	t.Helper()
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	_ = conn.SetDeadline(time.Now().Add(waitLimit))
	_, _ = io.WriteString(conn, "GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
	reader := bufio.NewReader(conn)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatalf("upgrade handshake: %v", err)
		}
		if line == "\r\n" {
			break
		}
	}
	return &upgradedConn{conn: conn, reader: reader}
}

func (u *upgradedConn) echoes() bool {
	_ = u.conn.SetDeadline(time.Now().Add(waitLimit))
	if _, err := io.WriteString(u.conn, "ping\n"); err != nil {
		return false
	}
	text, err := u.reader.ReadString('\n')
	return err == nil && text == "PING\n"
}

func (u *upgradedConn) isClosed() bool {
	_ = u.conn.SetReadDeadline(time.Now().Add(waitLimit))
	_, err := u.reader.ReadByte()
	return err != nil && !errors.Is(err, os.ErrDeadlineExceeded)
}

func expectSignal(t *testing.T, signal <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(waitLimit):
		t.Fatal(what)
	}
}

func TestDisablingFunnelEndsUpgradedFunnelConnectionsOnly(t *testing.T) {
	tailnetUpstream, tailnetEnded := echoUpgradeUpstream(t)
	funnelUpstream, funnelEnded := echoUpgradeUpstream(t)
	node := &fakeNode{status: runningStatus}
	h := startHarness(t, node, Config{TailnetUpstream: tailnetUpstream, FunnelUpstream: funnelUpstream})
	h.events.expectType(t, EventReady)
	h.commands <- Command{Cmd: CommandFunnel, Enabled: true}
	h.events.expectType(t, EventFunnel)
	public := openUpgraded(t, node.funnelAddr(t))
	private := openUpgraded(t, node.tailnetAddr(t))
	if !public.echoes() || !private.echoes() {
		t.Fatal("upgraded connections do not forward before the disable")
	}

	h.commands <- Command{Cmd: CommandFunnel, Enabled: false}
	if event := h.events.expectType(t, EventFunnel); *event.Enabled {
		t.Fatalf("disable = %+v", event)
	}

	if !public.isClosed() {
		t.Fatal("the upgraded Funnel connection stayed open after Funnel was disabled")
	}
	expectSignal(t, funnelEnded, "the server side of the Funnel connection stayed open")
	select {
	case <-tailnetEnded:
		t.Fatal("the tailnet connection ended")
	default:
	}
	if !private.echoes() {
		t.Fatal("the tailnet connection stopped forwarding")
	}
}

func TestShutdownEndsUpgradedConnections(t *testing.T) {
	tailnetUpstream, tailnetEnded := echoUpgradeUpstream(t)
	funnelUpstream, funnelEnded := echoUpgradeUpstream(t)
	node := &fakeNode{status: runningStatus}
	h := startHarness(t, node, Config{TailnetUpstream: tailnetUpstream, FunnelUpstream: funnelUpstream})
	h.events.expectType(t, EventReady)
	h.commands <- Command{Cmd: CommandFunnel, Enabled: true}
	h.events.expectType(t, EventFunnel)
	public := openUpgraded(t, node.funnelAddr(t))
	private := openUpgraded(t, node.tailnetAddr(t))
	if !public.echoes() || !private.echoes() {
		t.Fatal("upgraded connections do not forward before the shutdown")
	}

	h.commands <- Command{Cmd: CommandShutdown}

	if err := h.waitDone(t); err != nil {
		t.Fatal(err)
	}
	if !public.isClosed() || !private.isClosed() {
		t.Fatal("an upgraded connection survived the shutdown")
	}
	expectSignal(t, funnelEnded, "the server side of the Funnel connection stayed open")
	expectSignal(t, tailnetEnded, "the server side of the tailnet connection stayed open")
}
