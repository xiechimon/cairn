package sidecar

import (
	"context"
	"encoding/json"
	"tailscale.com/client/tailscale/apitype"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tailcfg"
	"tailscale.com/types/views"
	"testing"
)

func TestReadyReportsOwnerMetadata(t *testing.T) {
	sink := newEventSink()
	r := &runner{node: &fakeNode{status: Status{Running: true, DNSName: "cairn.tail.example", OwnerLogin: "owner@example.com", SelfTagged: false}}, out: NewEmitter(sink), cfg: Config{Logf: func(string, ...any) {}}}
	defer r.stop()
	if err := r.poll(context.Background()); err != nil {
		t.Fatal(err)
	}
	event := sink.expectType(t, EventReady)
	encoded, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["ownerLogin"] != "owner@example.com" || payload["selfTagged"] != false {
		t.Fatalf("ready lacks owner metadata: %s", encoded)
	}
}

func TestOwnerComesFromSelfUser(t *testing.T) {
	status := &ipnstate.Status{Self: &ipnstate.PeerStatus{UserID: 42}, User: map[tailcfg.UserID]tailcfg.UserProfile{42: {LoginName: "owner@example.com"}, 43: {LoginName: "other@example.com"}}}
	got := statusFromLocal(status)
	if got.OwnerLogin != "owner@example.com" || got.SelfTagged {
		t.Fatalf("owner metadata = %+v", got)
	}
	status.Self.Tags = new(views.Slice[string])
	*status.Self.Tags = views.SliceOf([]string{"tag:server"})
	got = statusFromLocal(status)
	if !got.SelfTagged || got.OwnerLogin != "" {
		t.Fatalf("tagged owner metadata = %+v", got)
	}
	delete(status.User, 42)
	status.Self.Tags = nil
	if got := statusFromLocal(status); got.OwnerLogin != "" {
		t.Fatalf("missing owner must fail closed: %+v", got)
	}
}

func TestShareeAndTaggedSourcesHaveNoIdentity(t *testing.T) {
	for _, node := range []*tailcfg.Node{
		{Hostinfo: (&tailcfg.Hostinfo{ShareeNode: true}).View()},
		{Tags: []string{"tag:client"}},
	} {
		got := identityFromWhoIs(&apitype.WhoIsResponse{Node: node, UserProfile: &tailcfg.UserProfile{LoginName: "owner@example.com"}})
		if got.Login != "" {
			t.Fatalf("untrusted source received identity: %+v", got)
		}
	}
	got := identityFromWhoIs(&apitype.WhoIsResponse{Node: &tailcfg.Node{}, UserProfile: &tailcfg.UserProfile{LoginName: "owner@example.com"}})
	if got.Login != "owner@example.com" {
		t.Fatalf("owner identity lost: %+v", got)
	}
	if got := identityFromWhoIs(&apitype.WhoIsResponse{}); got.Login != "" {
		t.Fatalf("missing identity: %+v", got)
	}
}
