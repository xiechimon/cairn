package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/xiechimon/cairn/apps/tsnet-sidecar/internal/sidecar"
	"tailscale.com/tsnet"
)

func main() {
	os.Exit(run())
}

func run() int {
	stateDir := flag.String("state-dir", "", "directory for tsnet state (required)")
	hostname := flag.String("hostname", "cairn", "node name on the tailnet")
	controlURL := flag.String("control-url", "", "coordination server URL (default: Tailscale)")
	tailnetUpstream := flag.String("tailnet-upstream", "", "server listener for tailnet traffic, unix:<path> or tcp:<host:port> (required)")
	funnelUpstream := flag.String("funnel-upstream", "", "server listener for Funnel traffic, unix:<path> or tcp:<host:port>")
	pollInterval := flag.Duration("poll-interval", time.Second, "status poll interval")
	flag.Parse()

	logger := log.New(os.Stderr, "tsnet-sidecar: ", log.LstdFlags)
	out := sidecar.NewEmitter(os.Stdout)

	fail := func(err error) int {
		out.Error(err.Error())
		return 1
	}

	if *stateDir == "" {
		return fail(fmt.Errorf("--state-dir is required"))
	}
	tailnet, err := sidecar.ParseUpstream(*tailnetUpstream)
	if err != nil {
		return fail(err)
	}
	var funnel sidecar.Upstream
	if *funnelUpstream != "" {
		if funnel, err = sidecar.ParseUpstream(*funnelUpstream); err != nil {
			return fail(err)
		}
	}
	if err := os.MkdirAll(*stateDir, 0o700); err != nil {
		return fail(err)
	}

	node := sidecar.NewTsnetNode(&tsnet.Server{
		Dir:        *stateDir,
		Hostname:   *hostname,
		ControlURL: *controlURL,
		UserLogf:   logger.Printf,
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg := sidecar.Config{
		TailnetUpstream: tailnet,
		FunnelUpstream:  funnel,
		PollInterval:    *pollInterval,
		Logf:            logger.Printf,
	}
	if err := sidecar.Run(ctx, node, cfg, sidecar.ReadCommands(os.Stdin, out), out); err != nil {
		return fail(err)
	}
	return 0
}
