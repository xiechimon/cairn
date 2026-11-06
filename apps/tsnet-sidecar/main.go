package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/xiechimon/cairn/apps/tsnet-sidecar/internal/sidecar"
	"tailscale.com/tsnet"
)

type options struct {
	stateDir        string
	hostname        string
	controlURL      string
	tailnetUpstream string
	funnelUpstream  string
	pollInterval    time.Duration
	uploadLogs      bool
}

func parseOptions(args []string) (options, error) {
	var opts options
	flags := flag.NewFlagSet("tsnet-sidecar", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&opts.stateDir, "state-dir", "", "directory for tsnet state (required)")
	flags.StringVar(&opts.hostname, "hostname", "cairn", "node name on the tailnet")
	flags.StringVar(&opts.controlURL, "control-url", "", "coordination server URL (default: Tailscale)")
	flags.StringVar(&opts.tailnetUpstream, "tailnet-upstream", "", "server listener for tailnet traffic, unix:<path> or tcp:<host:port> (required)")
	flags.StringVar(&opts.funnelUpstream, "funnel-upstream", "", "server listener for Funnel traffic, unix:<path> or tcp:<host:port>")
	flags.DurationVar(&opts.pollInterval, "poll-interval", time.Second, "status poll interval")
	flags.BoolVar(&opts.uploadLogs, "upload-logs", false, "allow tsnet to upload node logs to Tailscale (off by default)")
	if err := flags.Parse(args); err != nil {
		return options{}, err
	}
	return opts, nil
}

func main() {
	os.Exit(run())
}

func run() int {
	logger := log.New(os.Stderr, "tsnet-sidecar: ", log.LstdFlags)
	out := sidecar.NewEmitter(os.Stdout)

	fail := func(err error) int {
		out.Error(err.Error())
		return 1
	}

	opts, err := parseOptions(os.Args[1:])
	if err != nil {
		return fail(err)
	}
	if opts.stateDir == "" {
		return fail(fmt.Errorf("--state-dir is required"))
	}
	tailnet, err := sidecar.ParseUpstream(opts.tailnetUpstream)
	if err != nil {
		return fail(err)
	}
	var funnel sidecar.Upstream
	if opts.funnelUpstream != "" {
		if funnel, err = sidecar.ParseUpstream(opts.funnelUpstream); err != nil {
			return fail(err)
		}
	}
	if err := os.MkdirAll(opts.stateDir, 0o700); err != nil {
		return fail(err)
	}

	sidecar.ApplyLogPolicy(opts.uploadLogs)

	node := sidecar.NewTsnetNode(&tsnet.Server{
		Dir:        opts.stateDir,
		Hostname:   opts.hostname,
		ControlURL: opts.controlURL,
		UserLogf:   logger.Printf,
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg := sidecar.Config{
		TailnetUpstream: tailnet,
		FunnelUpstream:  funnel,
		PollInterval:    opts.pollInterval,
		Logf:            logger.Printf,
	}
	if err := sidecar.Run(ctx, node, cfg, sidecar.ReadCommands(os.Stdin, out), out); err != nil {
		return fail(err)
	}
	return 0
}
