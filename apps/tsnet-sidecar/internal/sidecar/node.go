package sidecar

import (
	"context"
	"net"
	"strings"

	"tailscale.com/client/tailscale/apitype"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tsnet"
)

const backendRunning = "Running"

type Status struct {
	Running    bool
	AuthURL    string
	DNSName    string
	IPs        []string
	OwnerLogin string
	SelfTagged bool
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
	return statusFromLocal(status), nil
}

func statusFromLocal(status *ipnstate.Status) Status {
	result := Status{
		Running: status.BackendState == backendRunning,
		AuthURL: status.AuthURL,
	}
	if status.Self != nil {
		result.DNSName = strings.TrimSuffix(status.Self.DNSName, ".")
		result.SelfTagged = status.Self.IsTagged()
		if !result.SelfTagged {
			result.OwnerLogin = status.User[status.Self.UserID].LoginName
		}
	}
	for _, ip := range status.TailscaleIPs {
		result.IPs = append(result.IPs, ip.String())
	}
	return result
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
	return identityFromWhoIs(response), nil
}

func identityFromWhoIs(response *apitype.WhoIsResponse) Identity {
	if response.Node == nil || response.Node.IsTagged() || (response.Node.Hostinfo.Valid() && response.Node.Hostinfo.ShareeNode()) {
		return Identity{}
	}
	if response.UserProfile == nil {
		return Identity{}
	}
	return Identity{Login: response.UserProfile.LoginName, Name: response.UserProfile.DisplayName}
}

func (n *TsnetNode) Close() error {
	return n.server.Close()
}
