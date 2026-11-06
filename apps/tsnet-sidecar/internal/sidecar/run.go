package sidecar

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"
)

const (
	TailnetAddr = ":443"
	FunnelAddr  = ":8443"

	shutdownTimeout = 5 * time.Second
)

type Config struct {
	TailnetUpstream Upstream
	FunnelUpstream  Upstream
	PollInterval    time.Duration
	Logf            func(format string, args ...any)
}

type listenerServer struct {
	server *http.Server
	done   chan struct{}
}

func serve(listener net.Listener, handler http.Handler) *listenerServer {
	ls := &listenerServer{server: &http.Server{Handler: handler}, done: make(chan struct{})}
	go func() {
		defer close(ls.done)
		_ = ls.server.Serve(listener)
	}()
	return ls
}

func (ls *listenerServer) close() {
	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if ls.server.Shutdown(ctx) != nil {
		_ = ls.server.Close()
	}
	<-ls.done
}

type runner struct {
	node    Node
	cfg     Config
	out     *Emitter
	tailnet *listenerServer
	funnel  *listenerServer

	running       bool
	dnsName       string
	lastAuthURL   string
	lastStatusErr string
}

func Run(ctx context.Context, node Node, cfg Config, commands <-chan Command, out *Emitter) error {
	if cfg.TailnetUpstream.IsZero() {
		return errors.New("tailnet upstream is required")
	}
	if err := node.Start(); err != nil {
		return err
	}
	r := &runner{node: node, cfg: cfg, out: out}
	defer r.stop()

	ticker := time.NewTicker(cfg.PollInterval)
	defer ticker.Stop()

	if err := r.poll(ctx); err != nil {
		return err
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if err := r.poll(ctx); err != nil {
				return err
			}
		case command, open := <-commands:
			if !open || command.Cmd == CommandShutdown {
				return nil
			}
			r.handle(command)
		}
	}
}

func (r *runner) stop() {
	if r.funnel != nil {
		r.funnel.close()
	}
	if r.tailnet != nil {
		r.tailnet.close()
	}
	_ = r.node.Close()
	r.out.Stopped()
}

func (r *runner) poll(ctx context.Context) error {
	status, err := r.node.Status(ctx)
	if err != nil {
		if message := err.Error(); message != r.lastStatusErr {
			r.lastStatusErr = message
			r.out.Error("status: " + message)
		}
		return nil
	}
	r.lastStatusErr = ""

	if !status.Running {
		r.running = false
		if status.AuthURL != "" && status.AuthURL != r.lastAuthURL {
			r.lastAuthURL = status.AuthURL
			r.out.AuthURL(status.AuthURL)
		}
		return nil
	}
	r.lastAuthURL = ""
	if status.DNSName == "" || r.running {
		return nil
	}
	if r.tailnet == nil {
		listener, err := r.node.ListenTLS(TailnetAddr)
		if err != nil {
			return err
		}
		r.tailnet = serve(listener, NewProxy(r.cfg.TailnetUpstream, r.node.WhoIs, r.cfg.Logf))
	}
	r.running = true
	r.dnsName = status.DNSName
	r.out.Ready(status.IPs, status.DNSName)
	return nil
}

func (r *runner) handle(command Command) {
	switch command.Cmd {
	case CommandFunnel:
		if command.Enabled {
			r.enableFunnel()
		} else {
			r.disableFunnel()
		}
	default:
		r.out.Error("unknown command: " + command.Cmd)
	}
}

func (r *runner) enableFunnel() {
	if r.funnel != nil {
		r.out.FunnelOn(funnelURL(r.dnsName))
		return
	}
	if !r.running {
		r.out.FunnelError("tailnet is not ready")
		return
	}
	if r.cfg.FunnelUpstream.IsZero() {
		r.out.FunnelError("funnel upstream is not configured")
		return
	}
	listener, err := r.node.ListenFunnel(FunnelAddr)
	if err != nil {
		r.out.FunnelError(err.Error())
		return
	}
	r.funnel = serve(listener, NewProxy(r.cfg.FunnelUpstream, nil, r.cfg.Logf))
	r.out.FunnelOn(funnelURL(r.dnsName))
}

func (r *runner) disableFunnel() {
	if r.funnel != nil {
		r.funnel.close()
		r.funnel = nil
	}
	r.out.FunnelOff()
}

func funnelURL(dnsName string) string {
	return "https://" + dnsName + FunnelAddr
}
