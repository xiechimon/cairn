package sidecar

import (
	"bufio"
	"encoding/json"
	"io"
	"sync"
)

const (
	EventAuthURL = "authUrl"
	EventReady   = "ready"
	EventFunnel  = "funnel"
	EventError   = "error"
	EventStopped = "stopped"

	CommandFunnel   = "funnel"
	CommandShutdown = "shutdown"
)

type Event struct {
	Type       string   `json:"type"`
	URL        string   `json:"url,omitempty"`
	IPs        []string `json:"ips,omitempty"`
	DNSName    string   `json:"dnsName,omitempty"`
	OwnerLogin string   `json:"ownerLogin,omitempty"`
	SelfTagged bool     `json:"selfTagged"`
	Enabled    *bool    `json:"enabled,omitempty"`
	Error      string   `json:"error,omitempty"`
}

type Command struct {
	Cmd     string `json:"cmd"`
	Enabled bool   `json:"enabled"`
}

type Emitter struct {
	mu  sync.Mutex
	enc *json.Encoder
}

func NewEmitter(w io.Writer) *Emitter {
	return &Emitter{enc: json.NewEncoder(w)}
}

func (e *Emitter) Emit(ev Event) {
	e.mu.Lock()
	defer e.mu.Unlock()
	_ = e.enc.Encode(ev)
}

func (e *Emitter) AuthURL(url string) {
	e.Emit(Event{Type: EventAuthURL, URL: url})
}

func (e *Emitter) Ready(status Status) {
	e.Emit(Event{Type: EventReady, IPs: status.IPs, DNSName: status.DNSName, OwnerLogin: status.OwnerLogin, SelfTagged: status.SelfTagged})
}

func (e *Emitter) FunnelOn(url string) {
	enabled := true
	e.Emit(Event{Type: EventFunnel, Enabled: &enabled, URL: url})
}

func (e *Emitter) FunnelOff() {
	enabled := false
	e.Emit(Event{Type: EventFunnel, Enabled: &enabled})
}

func (e *Emitter) FunnelError(message string) {
	enabled := false
	e.Emit(Event{Type: EventFunnel, Enabled: &enabled, Error: message})
}

func (e *Emitter) Error(message string) {
	e.Emit(Event{Type: EventError, Error: message})
}

func (e *Emitter) Stopped() {
	e.Emit(Event{Type: EventStopped})
}

func ReadCommands(r io.Reader, out *Emitter) <-chan Command {
	commands := make(chan Command)
	go func() {
		defer close(commands)
		scanner := bufio.NewScanner(r)
		scanner.Buffer(make([]byte, 0, 4096), 64*1024)
		for scanner.Scan() {
			line := scanner.Bytes()
			if len(line) == 0 {
				continue
			}
			var command Command
			if err := json.Unmarshal(line, &command); err != nil {
				out.Error("invalid command: " + err.Error())
				continue
			}
			commands <- command
		}
	}()
	return commands
}
