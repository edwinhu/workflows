# Proxy & Library Configuration

Edit values below to match the user's institutional access. The script reads
this file and parses the fenced `config` block at the bottom — keep that block
machine-readable.

## LibKey / Third Iron

LibKey is operated by Third Iron. Each subscribing library has a numeric
**library ID**. The DOI → best-PDF resolver URL is:

```
https://libkey.io/libraries/{libraryId}/openurl?genre=article&doi={doi}
```

This URL 302-chains through `libkey.io` → publisher (sometimes through the
EZproxy first). Cookies needed at each hop:

- `libkey.io`        — set when the user clicks any LibKey link from a
                       UVA Library page (creates a session cookie)
- `proxy01.its.virginia.edu` — UVA NetBadge SSO cookie
- publisher domain   — set after first authenticated visit to the publisher

### Discovering the library ID

The Third Iron public discovery API requires a static API key the user
doesn't have, so use the Chrome/CDP path:

1. Make sure Chrome is running with CDP on port 9250.
2. Navigate to: `https://search.lib.virginia.edu/?q=any+search`
3. Open any article result. The "View full text" button (LibKey) has an href
   like `https://libkey.io/libraries/NNNN/openurl?...`.
4. Copy `NNNN` into the `uva_libkey_id` value in the config block below.

(NYU's Bobst Library is also a Third Iron customer; same procedure if the
user wants NYU LibKey too.)

## EZproxy hosts

Standard wrapping format:

```
https://{ezproxy_host}/login?url={target_url}
```

`{target_url}` should be the publisher URL (preferred) or `https://doi.org/<doi>`.
The proxy resolves the DOI, then 302s to the publisher, rewriting the URL so
that the user is treated as an on-campus visitor.

Known hosts (verified 2026-04):

| Institution        | EZproxy host                  | SSO        |
|--------------------|-------------------------------|------------|
| UVA (all schools)  | `proxy1.library.virginia.edu` | NetBadge   |
| NYU                | `proxy.library.nyu.edu`       | NYU NetID  |

UVA notes:
- All of `proxy1.library.virginia.edu`, `proxy.library.virginia.edu`, and
  `login.proxy.library.virginia.edu` resolve to `128.143.86.71`, but the
  TLS cert is issued only to `proxy1.library.virginia.edu`. Use that
  hostname or strict-TLS clients (Bun, curl with default verify) reject
  the connection with `ERR_TLS_CERT_ALTNAME_INVALID`.
- The previous `proxy01.its.virginia.edu` host was decommissioned.

### Not authorized destinations

UVA's EZproxy menu does **not** whitelist every publisher. When a target host
isn't in the proxy's allow-list, `proxy1.library.virginia.edu` 302s the user
to a page like:

```
https://proxy1.library.virginia.edu/menu?...&error=Not+Authorized
```

Confirmed unwhitelisted (2026-04):

- **Elsevier ScienceDirect** (`10.1016/*`) — must reach via OpenAthens / direct
- **SSRN** (`10.2139/ssrn.*`) — no proxy needed; route SSRN-direct instead

The resolver detects this page via the `proxy1.library.virginia.edu/menu` URL
marker in `_dia_fetch_pdf` and fails fast so the chain falls through to:

1. **OpenAthens / publisher SSO** (`resolve_openathens`) — navigate Dia
   straight to `https://doi.org/<doi>`. Most major publishers (Elsevier,
   Wiley, Springer, OUP, Taylor & Francis, Cambridge) support
   institutional SSO directly on the landing page; cached UVA
   NetBadge / cert-keychain ACL credentials are picked up silently.
2. **Virgo article search** (`resolve_virgo`) — for no-DOI sources (older
   law reviews not in CrossRef), drive Dia to UVA's article-search results
   and let the publisher PDF detector find a direct link from there.

Pre-requisite for OpenAthens-direct: the user's keychain ACL must let Dia
present the institutional client cert without prompting (otherwise SSO
falls back to the regular NetBadge web flow).

## SSRN

SSRN abstract page: `https://ssrn.com/abstract={id}` redirects to
`https://papers.ssrn.com/sol3/papers.cfm?abstract_id={id}`.

Direct PDF download: `https://papers.ssrn.com/sol3/Delivery.cfm/{id}.pdf?abstractid={id}&mirid=1`

SSRN does NOT require auth for most papers (publishing authors waive paywall),
but rate-limits aggressive scraping. Including a session cookie from a logged-in
SSRN session in Dia is recommended:

- Domain: `papers.ssrn.com` and `ssrn.com`
- Cookies: `JSESSIONID`, `SSRN_*` — the script picks these up via `scholar`'s
  CDP cookie extraction, no manual export needed.

## EZproxy blocks non-browser clients

Verified 2026-04-24 against `proxy.library.virginia.edu`:

- TLS handshake completes, but the server sends RST after ~12s with no HTTP
  response. Affects `curl`, `wget`, Bun `fetch()` — anything that isn't a
  full browser.
- The proxy appears to require the EZproxy JS challenge cookie (`ezproxy`)
  to even respond to `/login`. That cookie is set by client-side JS the
  first time a real browser hits the host.
- Workaround: drive Dia via `mcp__chrome-devtools__navigate_page` to the
  EZproxy URL, let the browser handle the JS challenge + NetBadge SSO, then
  use `mcp__chrome-devtools__evaluate_script` to read the final PDF blob (or
  let the browser save it and `mv` from `~/Downloads/`).
- NYU's proxy (`proxy.library.nyu.edu`) does *not* RST curl — it just
  redirects to a Shibboleth login page (HTML). Still requires browser auth
  to actually fetch the PDF.

When the script reports `[uva] fail Connection reset` or `socket connection
was closed unexpectedly`, this is the cause. It is **not** fixable from
inside the resolver's HTTP layer; it needs a browser-driven hop.

## Cookie staleness — practical notes

- Google auth cookies (`SAPISID`, `__Secure-3PSID`) get rotated by the live
  browser silently; CDP snapshots drift within ~1 hour. Re-snapshot per batch.
- UVA NetBadge sessions: 30 min idle timeout, 8 h hard cap.
- NYU NetID (Shibboleth): 8 h hard cap, no idle timeout.
- LibKey session cookies: piggyback on the institution session; expire when
  it expires.
- SSRN: session cookies last days, but unauthenticated requests are
  rate-limited per IP.

If a fetch fails with `paywall page` or `HTTP 302 → login`, the answer is
almost always: re-open Dia, log in to NetBadge / NYU, then re-run.

## Configuration (edit these)

```config
uva_libkey_id      = TODO  # Numeric, see "Discovering the library ID"
uva_ezproxy_host   = proxy1.library.virginia.edu
nyu_ezproxy_host   = proxy.library.nyu.edu
ssrn_session_pref  = use-cdp                 # use-cdp | none
default_output_dir = /tmp/paperpile-resolve
```

## Session-persistence stack

Three pieces keep the institutional session warm across Dia restarts and the
30-min EZproxy idle timeout:

1. **launchd KeepAlive for Chrome CDP** — dedicated Chrome instance at `~/.config/chrome-cdp`
   with `--remote-debugging-port=9250 --remote-allow-origins=*`
   if it exits. The plist is *not* auto-bootstrapped; explicit boot:

   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.dia.cdp.plist
   # Unload:
   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.dia.cdp.plist
   ```

   Logs: `/tmp/dia-cdp.out.log`, `/tmp/dia-cdp.err.log`.

2. **Warmup cron** — `scripts/warmup.sh` runs `resolve_pdf.py --login-only`
   every 25 min via user crontab to defeat the 30-min UVA NetBadge idle
   timeout. Install (must be done from a terminal with Full Disk Access —
   macOS' suid `crontab` blocks otherwise):

   ```bash
   crontab /tmp/paperpile-resolve-crontab.txt   # or:
   (crontab -l 2>/dev/null; cat /tmp/paperpile-resolve-crontab.txt) | crontab -
   ```

   Verify with `crontab -l | grep paperpile`. Output:
   `/tmp/librarian-warmup.log`.

3. **Cookie hydration on startup** — `resolve_pdf.py` calls
   `hydrate_cookies()` early in `main()` (when `--via-dia` is set) to push
   snapshotted cookies from `~/.claude-work/skills/paperpile/cookies/`
   back into Dia via `Network.setCookies`, so a fresh Dia restart can reuse
   the prior session without re-driving NetBadge SSO.
