// The Tailscale transport of the "This iPhone" install route (README.md beside this file): a tsnet node inside the
// app, so idevice reaches this phone's own RemotePairing service through the Tailscale app's node while Tailscale
// is the VPN that's on (iOS resets plain sockets to the phone's own addresses; a tsnet connection is answered).
// Built as a c-archive by build.sh; Tailscale.swift calls these functions. Every function returning *C.char returns
// JSON (free it with TSFree). Only one node at a time; it runs only while signing in, testing or installing.
package main

/*
#include <stdlib.h>
#include <os/log.h>
static os_log_t ts_log_handle;
static void ts_log(const char *s) {
	if (!ts_log_handle) ts_log_handle = os_log_create("ifizbox.tailscale", "tsnet");
	os_log_with_type(ts_log_handle, OS_LOG_TYPE_DEFAULT, "%{public}s", s);
}
*/
import "C"

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"sync"
	"time"
	"unsafe"

	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tsnet"
)

func init() {
	// Nothing goes to Tailscale's log servers.
	os.Setenv("TS_NO_LOGS_NO_SUPPORT", "true")
	os.Setenv("TS_LOGS_DIR", os.TempDir())
}

func logf(format string, a ...any) {
	s := fmt.Sprintf(format, a...)
	cs := C.CString(s)
	C.ts_log(cs)
	C.free(unsafe.Pointer(cs))
}

var (
	mu     sync.Mutex
	srv    *tsnet.Server
	relays = map[string]net.Listener{} // "host:port" -> its 127.0.0.1 listener
)

func cjson(v any) *C.char {
	b, _ := json.Marshal(v)
	return C.CString(string(b))
}

type status struct {
	Running   bool     `json:"running"`        // the node is up (this process)
	State     string   `json:"state"`          // ipn's BackendState: NeedsLogin, NeedsMachineAuth, Starting, Running…
	AuthURL   string   `json:"authURL"`        // the login page, when State is NeedsLogin
	Name      string   `json:"name"`           // this node's MagicDNS name
	IPs       []string `json:"ips"`            // this node's Tailscale addresses
	KeyExpiry string   `json:"keyExpiry"`      // RFC 3339, empty when key expiry is off
	Expired   bool     `json:"expired"`        // the node key expired: sign in again
	Error     string   `json:"error,omitempty"`
}

func current(ctx context.Context, peers bool) (*ipnstate.Status, error) {
	mu.Lock()
	s := srv
	mu.Unlock()
	if s == nil {
		return nil, errors.New("not started")
	}
	lc, err := s.LocalClient()
	if err != nil {
		return nil, err
	}
	if peers {
		return lc.Status(ctx)
	}
	return lc.StatusWithoutPeers(ctx)
}

func summary(st *ipnstate.Status, err error) status {
	if err != nil {
		return status{Error: err.Error()}
	}
	out := status{Running: true, State: st.BackendState, AuthURL: st.AuthURL}
	for _, ip := range st.TailscaleIPs {
		out.IPs = append(out.IPs, ip.String())
	}
	if st.Self != nil {
		out.Name = strings.TrimSuffix(st.Self.DNSName, ".")
		out.Expired = st.Self.Expired
		if st.Self.KeyExpiry != nil {
			out.KeyExpiry = st.Self.KeyExpiry.UTC().Format(time.RFC3339)
		}
	}
	return out
}

// TSStart starts the node (state in dir, non-ephemeral, named hostname) and waits up to 20 s for it to be Running,
// to need a login (with its URL) or to need approval. Starting it again while it runs only reads its status.
//
//export TSStart
func TSStart(dir, hostname *C.char) *C.char {
	mu.Lock()
	if srv == nil {
		s := &tsnet.Server{Dir: C.GoString(dir), Hostname: C.GoString(hostname), Logf: logf, UserLogf: logf}
		if err := s.Start(); err != nil {
			mu.Unlock()
			logf("start failed: %v", err)
			return cjson(status{Error: "start: " + err.Error()})
		}
		srv = s
	}
	mu.Unlock()
	deadline := time.Now().Add(20 * time.Second)
	var last status
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		last = summary(current(ctx, false))
		cancel()
		switch {
		case last.State == "Running" && len(last.IPs) > 0, last.State == "NeedsMachineAuth":
			return cjson(last)
		case last.State == "NeedsLogin" && last.AuthURL != "":
			return cjson(last)
		}
		time.Sleep(250 * time.Millisecond)
	}
	return cjson(last)
}

// TSStatus reads the running node's status ({running: false} when it isn't running).
//
//export TSStatus
func TSStatus() *C.char {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	st := summary(current(ctx, false))
	if st.Error == "not started" {
		return cjson(status{})
	}
	return cjson(st)
}

// TSRelay forwards a 127.0.0.1 port to host:port over the tailnet: every connection to it is dialed through tsnet.
// Returns the local port, or 0 when it can't listen. The same host:port gets the same listener until TSStop.
//
//export TSRelay
func TSRelay(host *C.char, port C.int) C.int {
	target := net.JoinHostPort(C.GoString(host), fmt.Sprint(int(port)))
	mu.Lock()
	defer mu.Unlock()
	if srv == nil {
		return 0
	}
	if l, ok := relays[target]; ok {
		return C.int(l.Addr().(*net.TCPAddr).Port)
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		logf("relay %s: listen: %v", target, err)
		return 0
	}
	relays[target] = l
	s := srv
	lp := l.Addr().(*net.TCPAddr).Port
	logf("relay 127.0.0.1:%d -> %s (tailnet)", lp, target)
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go bridge(s, c, target)
		}
	}()
	return C.int(lp)
}

// waitPeer waits (up to 10 s) for host to show up in the node's network map. Right after a start the node says
// Running before its peers arrive, and tsnet then dials the address through iOS itself, which resets the
// connection to the phone's own address ("connection reset by peer", "early eof").
func waitPeer(ctx context.Context, host string) *ipnstate.PeerStatus {
	deadline := time.Now().Add(10 * time.Second)
	for {
		if st, err := current(ctx, true); err == nil {
			for _, p := range st.Peer {
				for _, ip := range p.TailscaleIPs {
					if ip.String() == host {
						return p
					}
				}
			}
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
}

func bridge(s *tsnet.Server, c net.Conn, target string) {
	defer c.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t0 := time.Now()
	if h, _, _ := net.SplitHostPort(target); waitPeer(ctx, h) == nil {
		logf("relay %s: not in the network map after %s; dialing anyway", target, time.Since(t0).Round(time.Millisecond))
	}
	r, err := s.Dial(ctx, "tcp", target)
	cancel()
	if err != nil {
		logf("relay %s: dial failed after %s: %v", target, time.Since(t0).Round(time.Millisecond), err)
		return
	}
	defer r.Close()
	logf("relay %s: connected in %s", target, time.Since(t0).Round(time.Millisecond))
	var up, down int64
	done := make(chan struct{}, 2)
	go func() { up, _ = io.Copy(r, c); closeWrite(r); done <- struct{}{} }()
	go func() { down, _ = io.Copy(c, r); closeWrite(c); done <- struct{}{} }()
	<-done
	<-done
	logf("relay %s: closed (%d bytes up, %d down)", target, up, down)
}

func closeWrite(c net.Conn) {
	if cw, ok := c.(interface{ CloseWrite() error }); ok {
		cw.CloseWrite()
	} else {
		c.Close()
	}
}

// The RemotePairing handshake (as idevice sends it first): the phone answers it before any pairing.
var handshake = func() []byte {
	m := map[string]any{"message": map[string]any{"plain": map[string]any{"_0": map[string]any{"request": map[string]any{"_0": map[string]any{
		"handshake": map[string]any{"_0": map[string]any{"hostOptions": map[string]any{"attemptPairVerify": true}, "wireProtocolVersion": 19}}}}}}},
		"originatedBy": "host", "sequenceNumber": 0}
	b, _ := json.Marshal(m)
	return b
}()

type testResult struct {
	OK     bool   `json:"ok"`
	Code   string `json:"code,omitempty"` // not_running, needs_login, needs_approval, expired, acl, no_answer, refused
	Detail string `json:"detail,omitempty"`
	Peer   string `json:"peer,omitempty"` // the phone's node as the tailnet knows it
	Ms     int64  `json:"ms,omitempty"`
}

// TSTest dials host:port (this phone's own Tailscale address and RemotePairing port) through the tailnet and sends
// RemotePairing's handshake. ok when the phone answers; otherwise a code for the page to explain.
//
//export TSTest
func TSTest(host *C.char, port C.int) *C.char {
	h := C.GoString(host)
	target := net.JoinHostPort(h, fmt.Sprint(int(port)))
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	st, err := current(ctx, true)
	if err != nil {
		return cjson(testResult{Code: "not_running", Detail: err.Error()})
	}
	switch {
	case st.BackendState == "NeedsMachineAuth":
		return cjson(testResult{Code: "needs_approval"})
	case st.Self != nil && st.Self.Expired:
		return cjson(testResult{Code: "expired"})
	case st.BackendState == "NeedsLogin":
		return cjson(testResult{Code: "needs_login"})
	case st.BackendState != "Running":
		return cjson(testResult{Code: "not_running", Detail: st.BackendState})
	}
	peer := waitPeer(ctx, h)
	res := testResult{}
	if peer != nil {
		res.Peer = strings.TrimSuffix(peer.DNSName, ".")
	} else {
		// The tailnet's policy hides nodes this one may not reach: the phone's node isn't in its map at all.
		logf("test: %s isn't in this node's network map (%d peers)", h, len(st.Peer))
	}
	t0 := time.Now()
	dctx, dcancel := context.WithTimeout(ctx, 15*time.Second)
	c, err := srv.Dial(dctx, "tcp", target)
	dcancel()
	if err != nil {
		res.Code, res.Detail = "acl", err.Error()
		if peer != nil && strings.Contains(err.Error(), "refused") {
			res.Code = "refused"
		}
		logf("test: dial %s failed: %v", target, err)
		return cjson(res)
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(8 * time.Second))
	var buf bytes.Buffer
	buf.WriteString("RPPairing")
	binary.Write(&buf, binary.BigEndian, uint16(len(handshake)))
	buf.Write(handshake)
	if _, err := c.Write(buf.Bytes()); err != nil {
		res.Code, res.Detail = "no_answer", "write: "+err.Error()
		return cjson(res)
	}
	hdr := make([]byte, 11)
	if _, err := io.ReadFull(c, hdr); err != nil || !bytes.HasPrefix(hdr, []byte("RPPairing")) {
		res.Code = "no_answer"
		if err != nil {
			res.Detail = err.Error()
		}
		logf("test: %s: no RemotePairing answer: %v", target, err)
		return cjson(res)
	}
	body := make([]byte, binary.BigEndian.Uint16(hdr[9:]))
	io.ReadFull(c, body)
	res.OK = bytes.Contains(body, []byte("handshake"))
	if !res.OK {
		res.Code, res.Detail = "no_answer", "unexpected reply"
	}
	res.Ms = time.Since(t0).Milliseconds()
	logf("test: %s answered RemotePairing's handshake in %d ms", target, res.Ms)
	return cjson(res)
}

// TSProbe dials host:port through the tailnet and hangs up (B220: which port this phone's RemotePairing service is
// on). 1: it connected; 0: the phone refused it (nothing listens there); -1: no answer or another error; -2: the
// node isn't running.
//
//export TSProbe
func TSProbe(host *C.char, port C.int, ms C.int) C.int {
	mu.Lock()
	s := srv
	mu.Unlock()
	if s == nil {
		return -2
	}
	h := C.GoString(host)
	target := net.JoinHostPort(h, fmt.Sprint(int(port)))
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(int(ms))*time.Millisecond+10*time.Second)
	defer cancel()
	waitPeer(ctx, h) // as for a relay: dialing before the phone's node is known goes through iOS, which resets it
	dctx, dcancel := context.WithTimeout(ctx, time.Duration(int(ms))*time.Millisecond)
	defer dcancel()
	c, err := s.Dial(dctx, "tcp", target)
	if err == nil {
		c.Close()
		logf("probe %s: connected", target)
		return 1
	}
	logf("probe %s: %v", target, err)
	if strings.Contains(err.Error(), "refused") {
		return 0
	}
	return -1
}

// TSStop closes the relays and the node.
//
//export TSStop
func TSStop() {
	mu.Lock()
	s := srv
	srv = nil
	for k, l := range relays {
		l.Close()
		delete(relays, k)
	}
	mu.Unlock()
	if s != nil {
		s.Close()
		logf("stopped")
	}
}

// TSLogout logs the running node out (the tailnet removes a logged-out node's key), then stops it.
//
//export TSLogout
func TSLogout() *C.char {
	mu.Lock()
	s := srv
	mu.Unlock()
	var msg string
	if s != nil {
		if lc, err := s.LocalClient(); err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			if err := lc.Logout(ctx); err != nil {
				msg = err.Error()
			}
			cancel()
		}
	}
	TSStop()
	return cjson(map[string]any{"ok": msg == "", "error": msg})
}

//export TSFree
func TSFree(p *C.char) { C.free(unsafe.Pointer(p)) }

func main() {}
