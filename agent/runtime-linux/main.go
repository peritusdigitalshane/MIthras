// Mithras Linux agent v0.1.0
//
// Single-binary endpoint agent for Linux. Heartbeats over the same
// HMAC-SHA256 signed channel as the Windows agent (Phase 1 contract):
//
//   signing_input = "<METHOD>\n<path>\n<unix_ts>\n<canonical_body>"
//   signature     = lowercase-hex HMAC-SHA256(secret, signing_input)
//   headers       = X-Agent-Id, X-Timestamp, X-Signature
//
// Collectors today: hostname, OS posture, kernel, uptime, package count,
// auditd state, listening sockets, recent sshd/sudo auth events from
// journalctl, installed package inventory (every hour).
//
// Active response, persistence collection, and policy enforcement are
// Windows-only for now and will land in v0.2.

package main

import (
	"bufio"
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"syscall"
	"time"
)

const (
	AgentVersion     = "0.1.0"
	HeartbeatEvery   = 60 * time.Second
	InventoryEvery   = 60 * time.Minute
	AuthEventsEvery  = 60 * time.Second
	DefaultConfigDir = "/etc/peritus"
)

type Config struct {
	AgentId     string `json:"agent_id"`
	AgentSecret string `json:"agent_secret"`
	ApiBaseUrl  string `json:"api_base_url"`
}

type EnrollRequest struct {
	EnrollmentToken string `json:"enrollment_token"`
	Hostname        string `json:"hostname"`
	OsVersion       string `json:"os_version,omitempty"`
	OsBuild         string `json:"os_build,omitempty"`
	Runtime         string `json:"runtime"`
}

type EnrollResponse struct {
	AgentId     string `json:"agent_id"`
	AgentSecret string `json:"agent_secret"`
	ApiBaseUrl  string `json:"api_base_url"`
}

// ─── canonical JSON ───────────────────────────────────────────────────────
//
// Must produce byte-identical output to the server-side canonicalizeJson()
// in supabase/functions/_shared/hmac.ts, otherwise signature_mismatch.

func canonicalJSON(v interface{}) ([]byte, error) {
	var b bytes.Buffer
	if err := canonicalize(&b, v); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

// jsonString matches JS JSON.stringify behaviour for a string: does NOT
// escape <, >, &, which Go's json.Marshal does by default.
func jsonString(s string) []byte {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(s)
	out := b.Bytes()
	// Encoder appends a trailing newline — strip it.
	if n := len(out); n > 0 && out[n-1] == '\n' {
		out = out[:n-1]
	}
	return out
}

func canonicalize(b *bytes.Buffer, v interface{}) error {
	switch x := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if x {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case string:
		b.Write(jsonString(x))
	case float64:
		// numbers: match TS Number.toString()
		enc, err := json.Marshal(x)
		if err != nil {
			return err
		}
		b.Write(enc)
	case int:
		fmt.Fprintf(b, "%d", x)
	case int64:
		fmt.Fprintf(b, "%d", x)
	case json.Number:
		b.WriteString(string(x))
	case []interface{}:
		b.WriteByte('[')
		for i, e := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := canonicalize(b, e); err != nil {
				return err
			}
		}
		b.WriteByte(']')
	case map[string]interface{}:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			b.Write(jsonString(k))
			b.WriteByte(':')
			if err := canonicalize(b, x[k]); err != nil {
				return err
			}
		}
		b.WriteByte('}')
	default:
		// Fall back to reflection for typed slices/maps (e.g. []map[string]interface{}).
		return canonicalizeReflect(b, v)
	}
	return nil
}

func canonicalizeReflect(b *bytes.Buffer, v interface{}) error {
	rv := reflect.ValueOf(v)
	for rv.Kind() == reflect.Ptr || rv.Kind() == reflect.Interface {
		if rv.IsNil() {
			b.WriteString("null")
			return nil
		}
		rv = rv.Elem()
	}
	switch rv.Kind() {
	case reflect.Slice, reflect.Array:
		b.WriteByte('[')
		for i := 0; i < rv.Len(); i++ {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := canonicalize(b, rv.Index(i).Interface()); err != nil {
				return err
			}
		}
		b.WriteByte(']')
		return nil
	case reflect.Map:
		// Convert keys to strings, sort, recurse.
		keys := rv.MapKeys()
		strKeys := make([]string, 0, len(keys))
		keyByStr := make(map[string]reflect.Value, len(keys))
		for _, k := range keys {
			s := fmt.Sprintf("%v", k.Interface())
			strKeys = append(strKeys, s)
			keyByStr[s] = k
		}
		sort.Strings(strKeys)
		b.WriteByte('{')
		for i, s := range strKeys {
			if i > 0 {
				b.WriteByte(',')
			}
			b.Write(jsonString(s))
			b.WriteByte(':')
			if err := canonicalize(b, rv.MapIndex(keyByStr[s]).Interface()); err != nil {
				return err
			}
		}
		b.WriteByte('}')
		return nil
	case reflect.Bool:
		if rv.Bool() {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
		return nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		fmt.Fprintf(b, "%d", rv.Int())
		return nil
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		fmt.Fprintf(b, "%d", rv.Uint())
		return nil
	case reflect.Float32, reflect.Float64:
		enc, err := json.Marshal(rv.Float())
		if err != nil {
			return err
		}
		b.Write(enc)
		return nil
	case reflect.String:
		b.Write(jsonString(rv.String()))
		return nil
	case reflect.Invalid:
		b.WriteString("null")
		return nil
	}
	return fmt.Errorf("canonicalize: unsupported type %T (kind=%s)", v, rv.Kind())
}

// ─── HMAC signing ────────────────────────────────────────────────────────

func signRequest(secret, method, path, timestamp string, body []byte) string {
	h := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(h, "%s\n%s\n%s\n%s", method, path, timestamp, string(body))
	return hex.EncodeToString(h.Sum(nil))
}

// ─── posture collectors ─────────────────────────────────────────────────

func collectHostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return h
}

func collectOS() (osID, osVersion, prettyName string) {
	f, err := os.Open("/etc/os-release")
	if err != nil {
		return "linux", "", "Linux"
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		i := strings.IndexByte(line, '=')
		if i < 0 {
			continue
		}
		k := line[:i]
		v := strings.Trim(line[i+1:], `"`)
		switch k {
		case "ID":
			osID = v
		case "VERSION_ID":
			osVersion = v
		case "PRETTY_NAME":
			prettyName = v
		}
	}
	if prettyName == "" {
		prettyName = osID + " " + osVersion
	}
	return
}

func collectKernel() string {
	out, err := exec.Command("uname", "-r").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func collectUptimeSeconds() float64 {
	b, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	parts := strings.Fields(string(b))
	if len(parts) == 0 {
		return 0
	}
	var s float64
	fmt.Sscanf(parts[0], "%f", &s)
	return s
}

func collectPackageCount() (int, string) {
	// Try dpkg first (Debian/Ubuntu), then rpm (RHEL/Rocky/Alma).
	if _, err := exec.LookPath("dpkg-query"); err == nil {
		out, err := exec.Command("dpkg-query", "-f", "${binary:Package}\n", "-W").Output()
		if err == nil {
			return strings.Count(strings.TrimSpace(string(out)), "\n") + 1, "dpkg"
		}
	}
	if _, err := exec.LookPath("rpm"); err == nil {
		out, err := exec.Command("rpm", "-qa").Output()
		if err == nil {
			return strings.Count(strings.TrimSpace(string(out)), "\n") + 1, "rpm"
		}
	}
	return 0, ""
}

func collectAuditdState() string {
	out, err := exec.Command("systemctl", "is-active", "auditd").Output()
	if err != nil {
		return "missing"
	}
	return strings.TrimSpace(string(out))
}

func collectListeningPorts() []map[string]interface{} {
	if _, err := exec.LookPath("ss"); err != nil {
		return nil
	}
	out, err := exec.Command("ss", "-Hlntu").Output()
	if err != nil {
		return nil
	}
	res := make([]map[string]interface{}, 0)
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 5 {
			continue
		}
		// 0=netid, 1=state, 2=recvq, 3=sendq, 4=local addr:port
		addr := fields[4]
		idx := strings.LastIndex(addr, ":")
		if idx < 0 {
			continue
		}
		port := addr[idx+1:]
		res = append(res, map[string]interface{}{
			"protocol": fields[0],
			"port":     port,
			"local":    addr,
		})
		if len(res) >= 100 {
			break
		}
	}
	return res
}

var authLineRe = regexp.MustCompile(`(?i)(failed password|accepted password|sudo:.*COMMAND=|invalid user|new user)`)

func collectAuthEvents(maxLines int) []map[string]interface{} {
	cmd := exec.Command("journalctl", "_COMM=sshd", "-_COMM=sudo", "--since", "5 minutes ago", "-o", "short-iso", "--no-pager")
	cmd = exec.Command("journalctl", "--since", "5 minutes ago", "-o", "short-iso", "--no-pager", "-u", "ssh", "-u", "sshd", "-u", "sudo")
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	events := make([]map[string]interface{}, 0)
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		line := sc.Text()
		if !authLineRe.MatchString(line) {
			continue
		}
		ts := time.Now().UTC().Format(time.RFC3339)
		// crude timestamp parse
		if len(line) > 25 {
			if t, err := time.Parse("2006-01-02T15:04:05-0700", line[:24]); err == nil {
				ts = t.UTC().Format(time.RFC3339)
			}
		}
		evType := "system"
		sev := "info"
		ll := strings.ToLower(line)
		switch {
		case strings.Contains(ll, "failed password") || strings.Contains(ll, "invalid user"):
			evType = "login_failed"
			sev = "warning"
		case strings.Contains(ll, "accepted password"):
			evType = "login_success"
			sev = "info"
		case strings.Contains(ll, "sudo:") && strings.Contains(line, "COMMAND="):
			evType = "sudo"
			sev = "info"
		case strings.Contains(ll, "new user"):
			evType = "user_created"
			sev = "info"
		}
		events = append(events, map[string]interface{}{
			"event_type": evType,
			"severity":   sev,
			"summary":    line,
			"event_time": ts,
		})
		if len(events) >= maxLines {
			break
		}
	}
	return events
}

func collectPackageInventory(max int) []map[string]interface{} {
	if _, err := exec.LookPath("dpkg-query"); err == nil {
		out, err := exec.Command("dpkg-query", "-f", "${binary:Package}\t${Version}\t${Section}\n", "-W").Output()
		if err == nil {
			return parseTsv(string(out), max, "deb")
		}
	}
	if _, err := exec.LookPath("rpm"); err == nil {
		out, err := exec.Command("rpm", "-qa", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\t%{GROUP}\n").Output()
		if err == nil {
			return parseTsv(string(out), max, "rpm")
		}
	}
	return nil
}

func parseTsv(s string, max int, format string) []map[string]interface{} {
	out := make([]map[string]interface{}, 0)
	sc := bufio.NewScanner(strings.NewReader(s))
	for sc.Scan() {
		fields := strings.Split(sc.Text(), "\t")
		if len(fields) < 2 {
			continue
		}
		row := map[string]interface{}{
			"name":    fields[0],
			"version": fields[1],
			"format":  format,
		}
		if len(fields) >= 3 {
			row["category"] = fields[2]
		}
		out = append(out, row)
		if len(out) >= max {
			break
		}
	}
	return out
}

// ─── HTTP / heartbeat ───────────────────────────────────────────────────

// path: signing path WITHOUT the /functions/v1/ Kong prefix (e.g. /agent-heartbeat).
// The wire URL appends the prefix; the server's url.pathname after Kong rewrite
// will match the signing path.
func signedPost(cfg *Config, path string, body interface{}) (*http.Response, []byte, error) {
	canonical, err := canonicalJSON(body)
	if err != nil {
		return nil, nil, err
	}
	ts := fmt.Sprintf("%d", time.Now().Unix())
	sig := signRequest(cfg.AgentSecret, "POST", path, ts, canonical)
	url := strings.TrimRight(cfg.ApiBaseUrl, "/") + "/functions/v1" + path
	req, err := http.NewRequest("POST", url, bytes.NewReader(canonical))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Agent-Id", cfg.AgentId)
	req.Header.Set("X-Timestamp", ts)
	req.Header.Set("X-Signature", sig)
	req.Header.Set("User-Agent", "mithras-agent-linux/"+AgentVersion)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	respBody, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return resp, nil, err
	}
	return resp, respBody, nil
}

func heartbeat(cfg *Config, includeInventory bool) error {
	osID, osVer, pretty := collectOS()
	pkgCount, pkgManager := collectPackageCount()
	authEvents := collectAuthEvents(50)

	payload := map[string]interface{}{
		"agent_version": AgentVersion,
		"os_version":    pretty,
		"os_build":      osID + " " + osVer + " (kernel " + collectKernel() + ")",
		"uptime_seconds": collectUptimeSeconds(),
		"package_count":  pkgCount,
		"package_manager": pkgManager,
		"auditd":         collectAuditdState(),
		"listening_ports": collectListeningPorts(),
	}

	if includeInventory {
		inv := collectPackageInventory(2000)
		payload["software_inventory"] = inv
		payload["software_inventory_complete"] = true
	}

	if len(authEvents) > 0 {
		payload["auth_events"] = authEvents
	}

	resp, body, err := signedPost(cfg, "/agent-heartbeat", payload)
	if err != nil {
		return err
	}
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("heartbeat HTTP %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// ─── enrollment ─────────────────────────────────────────────────────────

func enroll(token, apiBaseUrl string) (*Config, error) {
	hostname := collectHostname()
	_, _, pretty := collectOS()
	body, _ := json.Marshal(EnrollRequest{
		EnrollmentToken: token,
		Hostname:        hostname,
		OsVersion:       pretty,
		OsBuild:         "kernel " + collectKernel(),
		Runtime:         "linux",
	})
	url := strings.TrimRight(apiBaseUrl, "/") + "/functions/v1/agent-enroll"
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("enroll HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	var r EnrollResponse
	if err := json.Unmarshal(respBody, &r); err != nil {
		return nil, err
	}
	cfg := &Config{
		AgentId:     r.AgentId,
		AgentSecret: r.AgentSecret,
		ApiBaseUrl:  r.ApiBaseUrl,
	}
	if cfg.ApiBaseUrl == "" {
		cfg.ApiBaseUrl = apiBaseUrl
	}
	return cfg, nil
}

// ─── config persistence ─────────────────────────────────────────────────

func loadConfig(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	if c.AgentId == "" || c.AgentSecret == "" || c.ApiBaseUrl == "" {
		return nil, errors.New("config missing required fields")
	}
	return &c, nil
}

func saveConfig(path string, c *Config) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, b, 0600); err != nil {
		return err
	}
	return nil
}

// ─── CLI / main ─────────────────────────────────────────────────────────

func usage() {
	fmt.Fprintf(os.Stderr, `mithras-agent v%s (%s/%s)

Commands:
  enroll  --token=<token> [--api=https://api.mithras.com.au] [--config=/etc/peritus/config.json]
  run     [--config=/etc/peritus/config.json]
  version

`, AgentVersion, runtime.GOOS, runtime.GOARCH)
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	cmd := os.Args[1]

	switch cmd {
	case "version":
		fmt.Println(AgentVersion)
	case "enroll":
		fs := flag.NewFlagSet("enroll", flag.ExitOnError)
		token := fs.String("token", "", "enrollment token from the Mithras dashboard")
		api := fs.String("api", "https://api.mithras.com.au", "platform API base URL")
		cfgPath := fs.String("config", filepath.Join(DefaultConfigDir, "config.json"), "config file path")
		fs.Parse(os.Args[2:])
		if *token == "" {
			fmt.Fprintln(os.Stderr, "error: --token is required")
			os.Exit(2)
		}
		cfg, err := enroll(*token, *api)
		if err != nil {
			fmt.Fprintf(os.Stderr, "enroll failed: %v\n", err)
			os.Exit(1)
		}
		if err := saveConfig(*cfgPath, cfg); err != nil {
			fmt.Fprintf(os.Stderr, "save config failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("enrolled agent_id=%s config=%s\n", cfg.AgentId, *cfgPath)
	case "run":
		fs := flag.NewFlagSet("run", flag.ExitOnError)
		cfgPath := fs.String("config", filepath.Join(DefaultConfigDir, "config.json"), "config file path")
		fs.Parse(os.Args[2:])
		cfg, err := loadConfig(*cfgPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "load config: %v\n", err)
			os.Exit(1)
		}
		runLoop(cfg)
	default:
		usage()
		os.Exit(2)
	}
}

func runLoop(cfg *Config) {
	log := func(level, msg string) {
		fmt.Fprintf(os.Stderr, "%s [%s] %s\n", time.Now().UTC().Format(time.RFC3339), level, msg)
	}
	log("INFO", fmt.Sprintf("mithras-agent v%s starting (agent_id=%s)", AgentVersion, cfg.AgentId))

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)

	heartbeatTick := time.NewTicker(HeartbeatEvery)
	defer heartbeatTick.Stop()

	lastInventory := time.Time{}

	if err := heartbeat(cfg, true); err != nil {
		log("WARN", "initial heartbeat: "+err.Error())
	} else {
		lastInventory = time.Now()
		log("INFO", "initial heartbeat ok (inventory included)")
	}

	for {
		select {
		case <-stop:
			log("INFO", "received SIGTERM/SIGINT, shutting down")
			return
		case <-heartbeatTick.C:
			includeInventory := time.Since(lastInventory) >= InventoryEvery
			if err := heartbeat(cfg, includeInventory); err != nil {
				log("WARN", "heartbeat: "+err.Error())
			} else if includeInventory {
				lastInventory = time.Now()
				log("INFO", "heartbeat ok (inventory included)")
			} else {
				log("INFO", "heartbeat ok")
			}
		}
	}
}
