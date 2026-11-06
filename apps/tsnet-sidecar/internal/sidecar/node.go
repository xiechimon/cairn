package sidecar

import (
	"context"
	"net"
	"strings"

	"tailscale.com/tsnet"
)

const backendRunning = "Running"

type Status struct {
	Running bool
	AuthURL string
	DNSName string
	IPs     []string
}

type Node interface {
	Start() error
	Status(ctx context.Context) (Status, error)
	ListenTLS(addr string) (net.Listener, error)
	ListenFunnel(addr string) (net.Listener, error)
	WhoIs(ctx context.Context, remoteAddr string) (Identity, error)
	Close() error
}

type TsnetNode struct {
	server *tsnet.Server
}

func NewTsnetNode(server *tsnet.Server) *TsnetNode {
	return &TsnetNode{server: server}
}

func (n *TsnetNode) Start() error {
	return n.server.Start()
}

func (n *TsnetNode) Status(ctx context.Context) (Status, error) {
	client, err := n.server.LocalClient()
	if err != nil {
		return Status{}, err
	}
	status, err := client.StatusWithoutPeers(ctx)
	if err != nil {
		return Status{}, err
	}
	result := Status{
		Running: status.BackendState == backendRunning,
		AuthURL: status.AuthURL,
	}
	if status.Self != nil {
		result.DNSName = strings.TrimSuffix(status.Self.DNSName, ".")
	}
	for _, ip := range status.TailscaleIPs {
		result.IPs = append(result.IPs, ip.String())
	}
	return result, nil
}

func (n *TsnetNode) ListenTLS(addr string) (net.Listener, error) {
	return n.server.ListenTLS("tcp", addr)
}

func (n *TsnetNode) ListenFunnel(addr string) (net.Listener, error) {
	return n.server.ListenFunnel("tcp", addr, tsnet.FunnelOnly())
}

func (n *TsnetNode) WhoIs(ctx context.Context, remoteAddr string) (Identity, error) {
	client, err := n.server.LocalClient()
	if err != nil {
		return Identity{}, err
	}
	response, err := client.WhoIs(ctx, remoteAddr)
	if err != nil {
		return Identity{}, err
	}
	if response.Node != nil && response.Node.IsTagged() {
		return Identity{}, nil
	}
	if response.UserProfile == nil {
		return Identity{}, nil
	}
	return Identity{Login: response.UserProfile.LoginName, Name: response.UserProfile.DisplayName}, nil
}

func (n *TsnetNode) Close() error {
	return n.server.Close()
}
