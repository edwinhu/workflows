# Institutional Paper Access via SOCKS/VPN

Alternative to EZproxy + browser CDP for downloading paywalled PDFs.
These tools live in dotfiles (`~/.local/bin/`) and are **optional** — the
EZproxy/CDP pipeline in `proxy_urls.md` remains a fallback.

## Methods

### 1. WRDS SOCKS Tunnel (primary — Penn IP, registered with publishers)

```bash
wrds-tunnel              # start SOCKS5 on localhost:1081
wrds-tunnel --status     # check
wrds-tunnel --disconnect # stop
```

Publishers see Wharton/Penn IP (`165.123.x.x`) — recognized for institutional access.

**Simple publishers (no Cloudflare):**
```bash
fetch-paper https://www.nber.org/system/files/working_papers/w28303/w28303.pdf paper.pdf
```

**Cloudflare-protected publishers (JSTOR, OUP, Wiley, etc.):**
```bash
fetch-paper-browser https://www.jstor.org/stable/1912934 white1980.pdf
```

This launches a headed Chrome through SOCKS with CDP automation that handles:
- Cloudflare JS challenges (via `--host-resolver-rules` for remote DNS)
- Cookie consent banners (OneTrust, Allow All, etc.)
- JSTOR T&C (shadow DOM custom web component)
- Raw PDF byte extraction via `fetch()` (not `printToPDF`)

### 2. UVA VPN (limited — IP not registered with publishers)

```bash
uva-vpn --library        # split tunnel: HPC + publisher sites
uva-vpn --full           # all traffic through UVA
```

**Important:** UVA VPN gives a generic UVA IP (`128.143.x.x`) but publishers
cannot determine school affiliation (Law, Business, A&S) from IP alone.
Different schools have different subscriptions, so UVA requires EZproxy or
Shibboleth to authenticate school-level entitlements. The VPN is useful for
HPC, not paper downloads. WRDS/Wharton works because Penn registers the
entire IP range with broad publisher access — no per-school disambiguation.

### 3. Shell helpers

| Command | Description |
|---------|-------------|
| `wrds-tunnel` | Manage WRDS SOCKS tunnel (start/status/disconnect) |
| `fetch-paper <url> [out.pdf]` | `curl` through SOCKS — simple publishers only |
| `fetch-paper-browser <url> [out.pdf]` | Chrome CDP through SOCKS — handles Cloudflare/T&C |
| `proxy-curl <url>` | `curl` through SOCKS (raw) |
| `tunnel-browser.sh <port> <url>` | Interactive Chrome through SOCKS |

## Resolution order for PDF acquisition

1. Check Paperpile Google Drive (`rclone`) — already have it?
2. `fetch-paper` via WRDS SOCKS — fast `curl`, works for NBER and simple publishers
3. `fetch-paper-browser` via WRDS SOCKS — Chrome CDP, handles Cloudflare + T&C (JSTOR confirmed)
4. EZproxy + CDP browser automation — fallback for publishers that block non-Penn IPs
5. SSRN direct download — no auth needed, rate-limited

## Test results (2026-05-09)

| Publisher | `curl` + SOCKS | Chrome + SOCKS | Notes |
|-----------|---------------|----------------|-------|
| NBER | PDF downloaded (2.2MB) | N/A | No Cloudflare |
| JSTOR | HTML (consent page) | PDF downloaded (1.77MB) | Shadow DOM T&C button |
| OUP | HTML (Cloudflare) | Cloudflare passes, page loads | Stale PDF URL in test |
| Wiley | Timeout | Timeout without DNS fix, loads with fix | Needs `--host-resolver-rules` |
| HeinOnline | HTML (JS redirect) | Not tested | Likely works with Chrome |
| SSRN | 403 | Not tested | Rate-limited, may need login |

## Key technical findings

- **`--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE localhost"`** is required
  for Chrome through SOCKS — without it, CDN sites time out (DNS resolved locally
  but CDN routes differently through the tunnel)
- **`printToPDF` captures Chrome's PDF viewer UI** — use `fetch()` from page context
  to get raw PDF bytes instead
- **JSTOR T&C uses `<terms-and-conditions-pharos-button>`** — a custom web component
  with shadow DOM; must click `shadowRoot.querySelector('button')`
- **Headless Chrome is detected** by JSTOR (Access Check / reCAPTCHA) — use headed mode
- **Dia ignores system SOCKS proxy** — must launch Chrome separately with `--proxy-server`
- **Only Penn/WRDS has IP-based publisher access** — both UVA (`128.143.x.x`) and
  NYU (`128.122.x.x` via rjds) require EZproxy/Shibboleth. Penn registers its
  entire IP range; most universities don't
