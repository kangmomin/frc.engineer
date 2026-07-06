package platformsvc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// steamOpenIDEndpoint is Steam's OpenID 2.0 provider endpoint. It is pinned:
// we never trust the op_endpoint echoed back in the assertion, and direct
// verification (check_authentication) is always POSTed here.
const steamOpenIDEndpoint = "https://steamcommunity.com/openid/login"

// steamOpenIDNS is the OpenID 2.0 namespace.
const steamOpenIDNS = "http://specs.openid.net/auth/2.0"

// claimedIDRe anchors the whole claimed_id so only Steam's canonical identity
// URL with a 17-digit SteamID64 is accepted — no prefix/suffix or lookalike
// subdomain can slip a forged id through.
var claimedIDRe = regexp.MustCompile(`^https://steamcommunity\.com/openid/id/([0-9]{17})$`)

// nonceFreshness bounds how old an OpenID response_nonce may be, on top of the
// single-use DB guard.
const nonceFreshness = 5 * time.Minute

// ErrAuth is returned when an OpenID assertion fails any verification step.
var ErrAuth = errors.New("platformsvc: steam auth failed")

// SteamAuth performs Steam OpenID 2.0 login and Steam Web API profile lookups.
type SteamAuth struct {
	store     *Store
	http      *http.Client
	apiKey    string // STEAM_API_KEY, for GetPlayerSummaries (display only)
	realm     string // OpenID realm, e.g. https://platform.example.com
	returnURL string // absolute callback URL under realm
	endpoint  string // OpenID OP endpoint; pinned to steamOpenIDEndpoint in prod
	log       *slog.Logger
}

// NewSteamAuth builds a SteamAuth. realm is the public base URL (PUBLIC_BASE_URL);
// returnURL is where Steam redirects back (must be under realm). The OP endpoint
// is pinned to Steam's; tests override it via setEndpoint.
func NewSteamAuth(store *Store, apiKey, realm, returnURL string, log *slog.Logger) *SteamAuth {
	return &SteamAuth{
		store:     store,
		http:      &http.Client{Timeout: 10 * time.Second},
		apiKey:    apiKey,
		realm:     realm,
		returnURL: returnURL,
		endpoint:  steamOpenIDEndpoint,
		log:       log,
	}
}

// LoginURL builds the Steam redirect for identifier_select login. state is an
// opaque anti-CSRF value carried on the return_to query and echoed back by
// Steam; the caller binds it to the browser (e.g. a cookie).
func (a *SteamAuth) LoginURL(state string) string {
	ret := a.returnURL
	if state != "" {
		if strings.Contains(ret, "?") {
			ret += "&state=" + url.QueryEscape(state)
		} else {
			ret += "?state=" + url.QueryEscape(state)
		}
	}
	q := url.Values{
		"openid.ns":         {steamOpenIDNS},
		"openid.mode":       {"checkid_setup"},
		"openid.return_to":  {ret},
		"openid.realm":      {a.realm},
		"openid.identity":   {"http://specs.openid.net/auth/2.0/identifier_select"},
		"openid.claimed_id": {"http://specs.openid.net/auth/2.0/identifier_select"},
	}
	return a.endpoint + "?" + q.Encode()
}

// Authenticate verifies an OpenID callback and returns the resolved account,
// upserting it. values are the callback request's query parameters. It enforces
// mode, an anchored claimed_id, a pinned op_endpoint, nonce freshness +
// single-use, and Steam direct verification. It does NOT check the CSRF state
// (that is the transport layer's job, bound to the browser).
func (a *SteamAuth) Authenticate(ctx context.Context, values url.Values) (*Account, error) {
	if values.Get("openid.mode") != "id_res" {
		return nil, fmt.Errorf("%w: mode=%q", ErrAuth, values.Get("openid.mode"))
	}

	// Pin the OP endpoint: reject an assertion claiming a different provider.
	if ep := values.Get("openid.op_endpoint"); ep != a.endpoint {
		return nil, fmt.Errorf("%w: unexpected op_endpoint %q", ErrAuth, ep)
	}

	// Anchored claimed_id → SteamID64.
	m := claimedIDRe.FindStringSubmatch(values.Get("openid.claimed_id"))
	if m == nil {
		return nil, fmt.Errorf("%w: bad claimed_id", ErrAuth)
	}
	steamID64 := m[1]

	// Nonce freshness (cheap check before the network round-trip).
	nonce := values.Get("openid.response_nonce")
	if t, ok := parseNonceTime(nonce); !ok {
		return nil, fmt.Errorf("%w: unparseable nonce", ErrAuth)
	} else if age := time.Since(t); age < -nonceFreshness || age > nonceFreshness {
		return nil, fmt.Errorf("%w: stale nonce (age %s)", ErrAuth, age)
	}

	// Direct verification: ask Steam whether it really signed this.
	if err := a.verifyWithSteam(ctx, values); err != nil {
		return nil, err
	}

	// Single-use: claim the nonce only after the signature checks out. A replay
	// loses the race here.
	if fresh, err := a.store.claimNonce(ctx, nonce); err != nil {
		return nil, err
	} else if !fresh {
		return nil, fmt.Errorf("%w: replayed nonce", ErrAuth)
	}

	persona, avatar := a.fetchPlayerSummary(ctx, steamID64)
	id, err := a.store.UpsertSteamAccount(ctx, steamID64, persona, avatar)
	if err != nil {
		return nil, err
	}
	return a.store.GetAccount(ctx, id)
}

// verifyWithSteam POSTs the assertion back to the pinned endpoint with
// mode=check_authentication and requires is_valid:true.
func (a *SteamAuth) verifyWithSteam(ctx context.Context, values url.Values) error {
	form := url.Values{}
	for k, v := range values {
		if strings.HasPrefix(k, "openid.") {
			form[k] = v
		}
	}
	form.Set("openid.mode", "check_authentication")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("%w: build verify request: %v", ErrAuth, err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := a.http.Do(req)
	if err != nil {
		return fmt.Errorf("%w: verify request: %v", ErrAuth, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if err != nil {
		return fmt.Errorf("%w: read verify response: %v", ErrAuth, err)
	}
	// Response is key:value lines. Require an exact is_valid:true line.
	for _, line := range strings.Split(strings.TrimSpace(string(body)), "\n") {
		if strings.TrimSpace(line) == "is_valid:true" {
			return nil
		}
	}
	return fmt.Errorf("%w: steam rejected assertion", ErrAuth)
}

// steamPlayerSummary is the subset of GetPlayerSummaries we display.
type steamPlayerSummary struct {
	Response struct {
		Players []struct {
			SteamID     string `json:"steamid"`
			PersonaName string `json:"personaname"`
			AvatarFull  string `json:"avatarfull"`
		} `json:"players"`
	} `json:"response"`
}

// fetchPlayerSummary looks up persona/avatar via the Steam Web API. Display-only
// and best-effort: any failure yields empty strings (never blocks login).
func (a *SteamAuth) fetchPlayerSummary(ctx context.Context, steamID64 string) (persona, avatar string) {
	if a.apiKey == "" {
		return "", ""
	}
	u := "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=" +
		url.QueryEscape(a.apiKey) + "&steamids=" + url.QueryEscape(steamID64)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		a.log.Warn("steam summary: build request", "error", err)
		return "", ""
	}
	resp, err := a.http.Do(req)
	if err != nil {
		a.log.Warn("steam summary: request", "error", err)
		return "", ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		a.log.Warn("steam summary: status", "status", resp.StatusCode)
		return "", ""
	}
	var out steamPlayerSummary
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil {
		a.log.Warn("steam summary: decode", "error", err)
		return "", ""
	}
	if len(out.Response.Players) == 0 {
		return "", ""
	}
	p := out.Response.Players[0]
	return p.PersonaName, p.AvatarFull
}

// parseNonceTime extracts the RFC3339 timestamp prefix of an OpenID
// response_nonce (format: "<RFC3339Z><unique-salt>").
func parseNonceTime(nonce string) (time.Time, bool) {
	i := strings.IndexByte(nonce, 'Z')
	if i < 0 {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, nonce[:i+1])
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}
