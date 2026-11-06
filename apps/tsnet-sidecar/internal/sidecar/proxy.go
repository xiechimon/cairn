package sidecar

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"strings"
)

const (
	HeaderUserLogin = "Tailscale-User-Login"
	HeaderUserName  = "Tailscale-User-Name"
)

var untrustedHeaderPrefixes = []string{"Tailscale-", "X-Forwarded-"}

var untrustedHeaders = []string{"Forwarded", "X-Real-Ip", "True-Client-Ip", "X-Client-Ip"}

type Upstream struct {
	Network string
	Address string
}

func ParseUpstream(spec string) (Upstream, error) {
	network, address, found := strings.Cut(spec, ":")
	if !found || address == "" {
		return Upstream{}, fmt.Errorf("upstream %q must look like unix:<path> or tcp:<host:port>", spec)
	}
	switch network {
	case "unix":
		return Upstream{Network: network, Address: address}, nil
	case "tcp":
		if _, _, err := net.SplitHostPort(address); err != nil {
			return Upstream{}, fmt.Errorf("upstream %q has an invalid tcp address: %w", spec, err)
		}
		return Upstream{Network: network, Address: address}, nil
	default:
		return Upstream{}, fmt.Errorf("upstream %q has unsupported network %q", spec, network)
	}
}

func (u Upstream) IsZero() bool {
	return u.Network == ""
}

type Identity struct {
	Login string
	Name  string
}

type Identifier func(ctx context.Context, remoteAddr string) (Identity, error)

func StripUntrusted(header http.Header) {
	for name := range header {
		for _, prefix := range untrustedHeaderPrefixes {
			if strings.HasPrefix(http.CanonicalHeaderKey(name), prefix) {
				header.Del(name)
			}
		}
	}
	for _, name := range untrustedHeaders {
		header.Del(name)
	}
}

func NewProxy(upstream Upstream, identify Identifier, logf func(format string, args ...any)) http.Handler {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var dialer net.Dialer
			return dialer.DialContext(ctx, upstream.Network, upstream.Address)
		},
		DisableCompression: true,
	}
	return &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			StripUntrusted(pr.Out.Header)
			pr.Out.URL.Scheme = "http"
			pr.Out.URL.Host = pr.In.Host
			pr.Out.Host = pr.In.Host
			if identify == nil {
				return
			}
			identity, err := identify(pr.In.Context(), pr.In.RemoteAddr)
			if err != nil || identity.Login == "" {
				return
			}
			pr.Out.Header.Set(HeaderUserLogin, identity.Login)
			if identity.Name != "" {
				pr.Out.Header.Set(HeaderUserName, identity.Name)
			}
		},
		Transport:     transport,
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			logf("proxy %s %s: %v", r.Method, r.URL.Path, err)
			http.Error(w, "upstream unavailable", http.StatusBadGateway)
		},
	}
}
