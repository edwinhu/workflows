# Institutional Paper Access via SOCKS/VPN

Alternative to EZproxy + browser CDP for downloading paywalled PDFs.
These tools live in dotfiles (`~/.local/bin/`) and are **optional** — the
EZproxy/CDP pipeline in `proxy_urls.md` remains the primary path.

## When to use

- Batch downloading PDFs programmatically (no browser needed)
- EZproxy is blocking non-browser clients
- CDP/browser automation is unavailable or broken
- Need `curl`/`wget` access to publisher sites with institutional credentials

## Methods

### 1. WRDS SOCKS Tunnel (NYU subscriptions)

```bash
wrds-tunnel              # start SOCKS5 on localhost:1081
wrds-tunnel --status     # check
wrds-tunnel --disconnect # stop

# Download through tunnel
proxy-curl https://www.jstor.org/stable/pdf/12345.pdf -o paper.pdf
fetch-paper https://doi.org/10.1111/jofi.12345 output.pdf
```

Publishers see Wharton/Penn IP — access via NYU's WRDS subscription.

### 2. UVA VPN (UVA subscriptions)

```bash
uva-vpn --library        # split tunnel: HPC + publisher sites
uva-vpn --full           # all traffic through UVA
uva-vpn --status
uva-vpn --disconnect

# Once connected, curl works directly (no SOCKS needed)
curl -L -o paper.pdf https://doi.org/10.1111/jofi.12345
```

Publishers see UVA IP — full institutional access.

### 3. Shell helpers

| Command | Description |
|---------|-------------|
| `proxy-curl <url>` | `curl` through SOCKS (default port 1081) |
| `proxy-wget <url>` | `curl -L -O` through SOCKS |
| `fetch-paper <url> [out.pdf]` | Download paper PDF through SOCKS with browser UA |
| `SOCKS_PORT=1080 fetch-paper <url>` | Use rjds tunnel instead |

## Resolution order for PDF acquisition

1. Check Paperpile Google Drive (`rclone`) — already have it?
2. WRDS SOCKS tunnel + `fetch-paper` — fast, no root needed
3. UVA VPN `--library` + `curl` — broader coverage, needs sudo
4. EZproxy + CDP browser automation — fallback for JS-heavy publishers
5. SSRN direct download — no auth needed, rate-limited
