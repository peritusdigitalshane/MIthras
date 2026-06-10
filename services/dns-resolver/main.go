// Mithras DNS resolver.
//
// DoH server (RFC 8484) that:
//   1. Accepts queries at https://dns.mithras.com.au/{org-uuid}/dns-query
//   2. Looks up the org's DNS policy (cached for 30s)
//   3. Applies allowlist / blocklist / category checks
//   4. Forwards allowed queries to the policy's chosen upstream
//   5. Logs every decision to dns_query_logs (batched, async)
//
// Internal-suffix split DNS is handled CLIENT-SIDE via NRPT — the agent
// installs rules so internal suffixes never reach this resolver. We log
// only what comes through.
//
// Run: ./mithras-dns-resolver
//   env DATABASE_URL=postgres://... LISTEN_ADDR=127.0.0.1:8053 PLATFORM_UPSTREAM=cloudflare_family

package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/miekg/dns"
)

const (
	defaultListenAddr = "127.0.0.1:8053"
	policyCacheTTL    = 30 * time.Second
	logFlushInterval  = 5 * time.Second
	logFlushBatch     = 200
	requestTimeout    = 10 * time.Second
)

type categoryToggles struct {
	Malware  bool
	Phishing bool
	Adult    bool
	Gambling bool
	Social   bool
}

type policy struct {
	ID               string
	OrgID            string
	UpstreamProvider string // empty → use platform default
	UpstreamDoHURI   string
	Categories       categoryToggles
	AllowList        map[string]struct{}
	BlockList        map[string]struct{}
}

type policyCacheEntry struct {
	pol      *policy
	cachedAt time.Time
}

type resolver struct {
	pool           *pgxpool.Pool
	httpClient     *http.Client
	platformUpDoH  string // platform-default upstream DoH (e.g. https://family.cloudflare-dns.com/dns-query)
	cache          sync.Map // orgID → policyCacheEntry
	queryLogCh     chan *queryLog
}

type queryLog struct {
	OrgID        string
	EndpointID   *string
	PolicyID     *string
	Time         time.Time
	Name         string
	Type         string
	Action       string // allowed | blocked | forwarded
	BlockReason  *string
	ClientIP     string
	UpstreamUsed *string
	LatencyMs    int
	ResponseCode string
}

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL required")
	}
	listenAddr := os.Getenv("LISTEN_ADDR")
	if listenAddr == "" {
		listenAddr = defaultListenAddr
	}
	platformUpstream := os.Getenv("PLATFORM_UPSTREAM")
	if platformUpstream == "" {
		platformUpstream = "cloudflare_family"
	}
	// Sanity-check the platform upstream URL up front — fail fast rather
	// than silently falling back to the empty string at first query.
	platformDoH := providerDoH(platformUpstream)
	if err := validateUpstreamURI(platformDoH); err != nil {
		log.Fatalf("platform upstream %q is invalid: %v", platformUpstream, err)
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatalf("postgres connect: %v", err)
	}
	defer pool.Close()

	r := &resolver{
		pool:          pool,
		httpClient:    newSSRFSafeClient(),
		platformUpDoH: platformDoH,
		queryLogCh:    make(chan *queryLog, 4096),
	}

	go r.flushLogsLoop(ctx)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})
	// DoH: /{org-uuid}/dns-query
	mux.HandleFunc("/", r.handleDoH)

	log.Printf("mithras-dns-resolver listening on %s; platform upstream: %s", listenAddr, platformUpstream)
	if err := http.ListenAndServe(listenAddr, mux); err != nil {
		log.Fatalf("listen: %v", err)
	}
}

// SSRF defense: upstream URIs come from per-org policy rows, set by org
// admins. Without validation, an admin could point upstream_doh_uri at any
// internal service on the resolver's network — supabase-db, kong admin,
// IMDS endpoints, etc. We enforce both at request-validation time and at
// connect time (DNS-rebinding defense via the custom dialer below).

var cgnatPrefix = netip.MustParsePrefix("100.64.0.0/10")

// isUnsafeIP reports whether an IP belongs to a range we refuse to talk to:
// loopback, link-local, RFC1918 + ULA (via IsPrivate), CGNAT, unspecified.
func isUnsafeIP(ip netip.Addr) bool {
	if !ip.IsValid() {
		return true
	}
	return ip.IsLoopback() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsPrivate() || // covers RFC1918 v4 + fc00::/7 v6 ULA
		ip.IsUnspecified() ||
		cgnatPrefix.Contains(ip)
}

func validateUpstreamURI(s string) error {
	if s == "" {
		return errors.New("empty uri")
	}
	u, err := url.Parse(s)
	if err != nil {
		return fmt.Errorf("parse: %w", err)
	}
	if u.Scheme != "https" {
		return fmt.Errorf("scheme must be https, got %q", u.Scheme)
	}
	host := u.Hostname()
	if host == "" {
		return errors.New("missing host")
	}
	// If the URI host is a literal IP, check it here. Hostnames are
	// re-checked at connect time by the SSRF-safe dialer.
	if ip, err := netip.ParseAddr(host); err == nil {
		if isUnsafeIP(ip) {
			return fmt.Errorf("upstream IP %s is in a blocked range", ip)
		}
	}
	return nil
}

// newSSRFSafeClient returns an http.Client whose underlying transport refuses
// to dial private / loopback / link-local / CGNAT / ULA destinations even if
// the upstream hostname resolves to one (DNS-rebinding defense). Resolution
// happens here, not at request-build time, so an attacker who controls a
// hostname returning a public IP at validation and a private IP at connect
// time still gets rejected.
func newSSRFSafeClient() *http.Client {
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			// Resolve and filter — only safe (public) IPs are eligible.
			res := net.DefaultResolver
			ips, err := res.LookupNetIP(ctx, "ip", host)
			if err != nil {
				return nil, err
			}
			d := net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
			var lastErr error
			for _, ip := range ips {
				if isUnsafeIP(ip) {
					lastErr = fmt.Errorf("blocked destination ip: %s", ip)
					continue
				}
				conn, err := d.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
				if err == nil {
					return conn, nil
				}
				lastErr = err
			}
			if lastErr != nil {
				return nil, lastErr
			}
			return nil, fmt.Errorf("no safe address for %s", host)
		},
		MaxIdleConns:        50,
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 5 * time.Second,
		ForceAttemptHTTP2:   true,
	}
	return &http.Client{Timeout: requestTimeout, Transport: transport}
}

func providerDoH(prov string) string {
	switch prov {
	case "cloudflare_family":
		return "https://family.cloudflare-dns.com/dns-query"
	case "cloudflare":
		return "https://cloudflare-dns.com/dns-query"
	case "quad9":
		return "https://dns.quad9.net/dns-query"
	case "opendns_family":
		return "https://doh.familyshield.opendns.com/dns-query"
	case "google":
		return "https://dns.google/dns-query"
	default:
		// Treat unknown as a literal URI passthrough.
		if strings.HasPrefix(prov, "https://") {
			return prov
		}
		return "https://family.cloudflare-dns.com/dns-query"
	}
}

func (r *resolver) handleDoH(w http.ResponseWriter, req *http.Request) {
	// URL path: /{org-uuid}/dns-query
	path := strings.TrimPrefix(req.URL.Path, "/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) != 2 || parts[1] != "dns-query" {
		http.NotFound(w, req)
		return
	}
	orgID := parts[0]
	if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "invalid org id", http.StatusBadRequest)
		return
	}

	// Decode the DNS message — RFC 8484 supports both GET (?dns=base64) and POST (body).
	var rawMsg []byte
	switch req.Method {
	case http.MethodGet:
		q := req.URL.Query().Get("dns")
		if q == "" {
			http.Error(w, "missing dns parameter", http.StatusBadRequest)
			return
		}
		decoded, err := base64.RawURLEncoding.DecodeString(q)
		if err != nil {
			http.Error(w, "bad base64", http.StatusBadRequest)
			return
		}
		rawMsg = decoded
	case http.MethodPost:
		if ct := req.Header.Get("Content-Type"); ct != "application/dns-message" {
			http.Error(w, "expected application/dns-message", http.StatusUnsupportedMediaType)
			return
		}
		body, err := io.ReadAll(io.LimitReader(req.Body, 65535))
		if err != nil {
			http.Error(w, "read body", http.StatusBadRequest)
			return
		}
		rawMsg = body
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	in := new(dns.Msg)
	if err := in.Unpack(rawMsg); err != nil {
		http.Error(w, "invalid dns message", http.StatusBadRequest)
		return
	}
	if len(in.Question) == 0 {
		http.Error(w, "no question", http.StatusBadRequest)
		return
	}
	q := in.Question[0]
	queryName := strings.TrimSuffix(strings.ToLower(q.Name), ".")
	queryType := dns.TypeToString[q.Qtype]
	clientIP := remoteIP(req)

	startedAt := time.Now()

	// Load policy (cached). Failing closed: if we can't load, log + forward to platform upstream.
	pol := r.loadPolicy(req.Context(), orgID)

	logRec := &queryLog{
		OrgID:    orgID,
		Time:     startedAt,
		Name:     queryName,
		Type:     queryType,
		ClientIP: clientIP,
	}
	if pol != nil {
		logRec.PolicyID = &pol.ID
	}

	// Decision
	if pol != nil {
		if _, ok := pol.AllowList[queryName]; ok {
			r.forward(w, in, pol, logRec)
			return
		}
		if _, ok := pol.BlockList[queryName]; ok {
			reason := "custom_blocklist"
			logRec.BlockReason = &reason
			r.block(w, in, logRec)
			return
		}
		// Category check — Phase 1 deferred to upstream resolver: Cloudflare
		// Family / Quad9 block malware natively. We don't enforce categories
		// in-resolver yet; future phase will pull a feed.
	}

	r.forward(w, in, pol, logRec)
}

func (r *resolver) block(w http.ResponseWriter, in *dns.Msg, logRec *queryLog) {
	out := new(dns.Msg)
	out.SetRcode(in, dns.RcodeNameError) // NXDOMAIN
	logRec.Action = "blocked"
	logRec.ResponseCode = "NXDOMAIN"
	logRec.LatencyMs = int(time.Since(logRec.Time).Milliseconds())
	r.enqueueLog(logRec)
	writeDoH(w, out)
}

func (r *resolver) forward(w http.ResponseWriter, in *dns.Msg, pol *policy, logRec *queryLog) {
	upstreamURI := r.platformUpDoH
	upstreamLabel := "platform_default"
	// Per-policy override, but only if the URI passes SSRF validation. If a
	// policy has a bogus URI we silently fall back to the platform default
	// rather than failing the query — operators see the failure in /dns-policy
	// validation, end users still get DNS.
	if pol != nil && pol.UpstreamDoHURI != "" {
		if err := validateUpstreamURI(pol.UpstreamDoHURI); err == nil {
			upstreamURI = pol.UpstreamDoHURI
			upstreamLabel = pol.UpstreamProvider
			if upstreamLabel == "" {
				upstreamLabel = "policy_custom"
			}
		} else {
			log.Printf("rejected upstream_doh_uri for policy %s: %v", pol.ID, err)
		}
	}

	out, err := r.queryUpstream(upstreamURI, in)
	if err != nil {
		// Hard failure: return SERVFAIL.
		log.Printf("upstream failure: %v", err)
		fail := new(dns.Msg)
		fail.SetRcode(in, dns.RcodeServerFailure)
		logRec.Action = "forwarded"
		logRec.UpstreamUsed = &upstreamLabel
		logRec.ResponseCode = "SERVFAIL"
		logRec.LatencyMs = int(time.Since(logRec.Time).Milliseconds())
		r.enqueueLog(logRec)
		writeDoH(w, fail)
		return
	}

	logRec.Action = "forwarded"
	logRec.UpstreamUsed = &upstreamLabel
	logRec.ResponseCode = dns.RcodeToString[out.Rcode]
	logRec.LatencyMs = int(time.Since(logRec.Time).Milliseconds())
	r.enqueueLog(logRec)
	writeDoH(w, out)
}

func (r *resolver) queryUpstream(uri string, in *dns.Msg) (*dns.Msg, error) {
	packed, err := in.Pack()
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, uri, bytes.NewReader(packed))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/dns-message")
	req.Header.Set("Accept", "application/dns-message")
	resp, err := r.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upstream HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 65535))
	if err != nil {
		return nil, err
	}
	out := new(dns.Msg)
	if err := out.Unpack(body); err != nil {
		return nil, err
	}
	return out, nil
}

func writeDoH(w http.ResponseWriter, m *dns.Msg) {
	packed, err := m.Pack()
	if err != nil {
		http.Error(w, "pack failure", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/dns-message")
	w.Header().Set("Cache-Control", "max-age=0")
	_, _ = w.Write(packed)
}

func remoteIP(req *http.Request) string {
	if xff := req.Header.Get("X-Forwarded-For"); xff != "" {
		// Caddy sets this; take the first.
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, ok := strings.Cut(req.RemoteAddr, ":")
	if ok {
		return host
	}
	return req.RemoteAddr
}

// loadPolicy is cached per-org for policyCacheTTL. Returns nil on missing org
// or DB error — caller uses platform-default upstream as a safe fallback.
func (r *resolver) loadPolicy(ctx context.Context, orgID string) *policy {
	if v, ok := r.cache.Load(orgID); ok {
		entry := v.(policyCacheEntry)
		if time.Since(entry.cachedAt) < policyCacheTTL {
			return entry.pol
		}
	}
	// Default to the org's is_default policy.
	row := r.pool.QueryRow(ctx, `
        SELECT id, organization_id, COALESCE(upstream_provider,''), COALESCE(upstream_doh_uri,''),
               block_malware, block_phishing, block_adult, block_gambling, block_social,
               custom_allowlist, custom_blocklist
          FROM public.dns_policies
         WHERE organization_id = $1 AND is_default
         LIMIT 1`, orgID)
	var (
		p         policy
		allowList []string
		blockList []string
	)
	err := row.Scan(&p.ID, &p.OrgID, &p.UpstreamProvider, &p.UpstreamDoHURI,
		&p.Categories.Malware, &p.Categories.Phishing, &p.Categories.Adult,
		&p.Categories.Gambling, &p.Categories.Social, &allowList, &blockList)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			log.Printf("loadPolicy %s: %v", orgID, err)
		}
		r.cache.Store(orgID, policyCacheEntry{pol: nil, cachedAt: time.Now()})
		return nil
	}
	if p.UpstreamProvider != "" && p.UpstreamDoHURI == "" {
		p.UpstreamDoHURI = providerDoH(p.UpstreamProvider)
	}
	p.AllowList = toSet(allowList)
	p.BlockList = toSet(blockList)
	r.cache.Store(orgID, policyCacheEntry{pol: &p, cachedAt: time.Now()})
	return &p
}

func toSet(in []string) map[string]struct{} {
	out := make(map[string]struct{}, len(in))
	for _, v := range in {
		out[strings.ToLower(strings.TrimSuffix(v, "."))] = struct{}{}
	}
	return out
}

func (r *resolver) enqueueLog(l *queryLog) {
	select {
	case r.queryLogCh <- l:
	default:
		// Channel full — drop. DNS resilience > log fidelity under burst.
	}
}

func (r *resolver) flushLogsLoop(ctx context.Context) {
	tick := time.NewTicker(logFlushInterval)
	defer tick.Stop()
	buf := make([]*queryLog, 0, logFlushBatch)
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if len(buf) > 0 {
				r.flushLogs(ctx, buf)
				buf = buf[:0]
			}
		case l := <-r.queryLogCh:
			buf = append(buf, l)
			if len(buf) >= logFlushBatch {
				r.flushLogs(ctx, buf)
				buf = buf[:0]
			}
		}
	}
}

func (r *resolver) flushLogs(ctx context.Context, batch []*queryLog) {
	if len(batch) == 0 {
		return
	}
	// Build a multi-row INSERT.
	const cols = 12
	args := make([]any, 0, len(batch)*cols)
	placeholders := make([]string, 0, len(batch))
	for i, l := range batch {
		base := i * cols
		placeholders = append(placeholders, fmt.Sprintf("($%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d)",
			base+1, base+2, base+3, base+4, base+5, base+6, base+7, base+8, base+9, base+10, base+11, base+12))
		args = append(args,
			l.OrgID, l.EndpointID, l.PolicyID, l.Time, l.Name, l.Type,
			l.Action, l.BlockReason, l.ClientIP, l.UpstreamUsed, l.LatencyMs, l.ResponseCode,
		)
	}
	sql := "INSERT INTO public.dns_query_logs (organization_id, endpoint_id, policy_id, query_time, query_name, query_type, action, block_reason, client_ip, upstream_used, latency_ms, response_code) VALUES " + strings.Join(placeholders, ",")
	if _, err := r.pool.Exec(ctx, sql, args...); err != nil {
		log.Printf("flushLogs: %v", err)
	}
}
