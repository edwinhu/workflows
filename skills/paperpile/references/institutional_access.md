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
| HeinOnline | HTML (JS redirect) | **Works — NYU tunnel, IP-entitled** | No EZproxy/Shibboleth/cert needed; see HeinOnline note below |
| SSRN | 403 | Not tested | Rate-limited, may need login |

## HeinOnline (verified 2026-08-03)

**Use the NYU tunnel and skip EZproxy entirely.** `access.heinonline.com`
renders "Provided By: NYU School of Law" on the rjds route with no proxy, no
Shibboleth and no client certificate. This is simpler than the WAYFless SSO path
`warmup.sh` sets up, and it works where that path currently does not.

**The div is not the page.** Hein addresses *sections of a bound volume* by a
`div` index, not by page number:

```
79 Tex. L. Rev. 271  ->  handle=hein.journals/tlr79, div=21/22
                          div=2 is the volume FRONT MATTER
```

Resolve the volume TOC, match the row whose start page is the cited page, take
that row's `div`. Fetching the handle directly yields div 2 — which is how a
plain browser fetch produced volume front matter labelled as an article.

**Verify page 2, not page 1.** Every Hein PDF opens with a Hein cover sheet
carrying the journal name and volume, so a page-1 title check passes on the
front matter. Check the article title and first author on page 2, and the
closing folio against the citation's end page.

## The UVA certificate is not installed on the Linux box

`warmup.sh`'s HeinOnline/EZproxy step reports "clicked cert login" and then
never leaves the IdP. The cause is that the Chrome profile's NSS store
(`~/.pki/nssdb`) contains **zero certificates** — the UVA digital certificate
has never been installed there, so the cert click is a silent no-op and every
proxied request lands on NetBadge SSO.

This makes `find-and-add`'s HeinOnline path fail with a misleading error
(`no TOC entry for page NNN`) that looks like a lookup problem and is actually
an authentication problem. Installing the cert, or logging in interactively at
:9250, is a USER action. The NYU route above sidesteps it entirely.

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
