---
name: fetch-paper
description: "This skill should be used when the user asks to 'fetch paper', 'download paper', 'get the PDF', 'grab the paper', 'download from JSTOR', 'get this article', 'fetch PDF for', or needs to acquire a paywalled academic PDF."
user-invocable: true
---

# Fetch Paper

Download paywalled academic PDFs using WRDS SOCKS tunnel for institutional access (Penn IP).

## Resolution Chain

Try each step in order. Stop at the first success.

### Step 1: Check Paperpile Google Drive

Before downloading anything, check if we already have it:

```bash
# Search by author name or title fragment
fd -i "<author-or-keyword>" ~/Google\ Drive/My\ Drive/resources/Paperpile/All\ Papers/
```

If found, copy locally and stop. The file is already in the library.

### Step 2: Direct curl through WRDS SOCKS

Works for publishers without Cloudflare (NBER, working paper servers, open-access PDFs):

```bash
# Ensure tunnel is up (auto-starts if not)
wrds-tunnel --status || wrds-tunnel

# Download
source ~/.shell_aliases
fetch-paper "<pdf-url>" "<output.pdf>"
```

**Verify the result:**
```bash
file <output.pdf>  # Must say "PDF document", not "HTML document"
```

If `file` says HTML → publisher has Cloudflare or requires browser. Go to Step 3.

### Step 3: Chrome CDP through WRDS SOCKS

Works for Cloudflare-protected publishers (JSTOR, OUP, Wiley, Springer, HeinOnline):

```bash
fetch-paper-browser "<url>" "<output.pdf>"
```

This script auto-starts the WRDS tunnel, launches a headed Chrome through SOCKS with CDP, and handles:
- Cloudflare JS challenges
- Cookie consent banners
- JSTOR T&C (shadow DOM web component)
- Raw PDF byte extraction via `fetch()`

**Verify the result:**
```bash
file <output.pdf>  # Must say "PDF document"
wc -c <output.pdf>  # Should be >100KB for a real paper
```

### Step 4: Fallback — Paperpile find-and-add

If WRDS SOCKS fails (tunnel down, publisher blocks Penn IP), use the `/paperpile` skill which goes through EZproxy + browser CDP.

## URL Patterns by Publisher

| Publisher | URL to use | Step |
|-----------|-----------|------|
| NBER | `https://www.nber.org/system/files/working_papers/wNNNNN/wNNNNN.pdf` | 2 |
| JSTOR | `https://www.jstor.org/stable/<id>` | 3 |
| OUP (RFS, JFE) | `https://academic.oup.com/<journal>/article-pdf/...` | 3 |
| Wiley (JF) | `https://onlinelibrary.wiley.com/doi/pdfdirect/<doi>` | 3 |
| SSRN | `https://papers.ssrn.com/sol3/papers.cfm?abstract_id=<id>` | 3 |
| DOI redirect | `https://doi.org/<doi>` | 3 |
| Springer | `https://link.springer.com/article/<doi>` | 3 |
| HeinOnline | `https://heinonline.org/HOL/Page?handle=...` | 3 |

## Red Flags — STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| About to use `uva-vpn` for paper access | UVA VPN IP not registered with publishers — requires EZproxy | Use WRDS SOCKS tunnel (Penn IP is registered) |
| About to use rjds SOCKS for paper access | NYU IP also requires EZproxy, not IP-based | Use WRDS SOCKS (port 1081), not rjds (port 1080) |
| About to use `printToPDF` in CDP | Captures Chrome's PDF viewer UI, not the raw PDF | Use `fetch()` from page context to get raw bytes |
| About to launch headless Chrome for JSTOR | JSTOR detects headless and serves reCAPTCHA | `fetch-paper-browser` uses headed mode |
| `file` output says "HTML document" but proceeding anyway | Downloaded a Cloudflare page or login wall, not a PDF | Escalate to Step 3 or Step 4 |

## Output Convention

- If the user specifies an output path, use it
- Otherwise, save to `~/Downloads/papers/<filename>.pdf`
- After download, report: filename, size, and first-page title (via `pymupdf4llm`)

## Cleanup

After downloading, disconnect the tunnel if you started it:
```bash
wrds-tunnel --disconnect
```
