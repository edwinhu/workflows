# Could `ortie` (or `crumb`) broker a Westlaw credential?

Read-only investigation, 2026-09-09. No config written, no login run, no token store touched. No secret value is reproduced below.

Short answer: **`ortie` cannot — it is an OAuth-2.0-grant runner and has no non-OAuth credential model at all. `crumb` is the right *shape* (browser session, cookie/page-state broker, and it is extensible by adding a profile record), but adding Westlaw buys nothing over the skill's current design, which already drives an authenticated browser. Recommendation: change nothing.**

---

## 1. Is `ortie` general-purpose across OAuth providers, or Google-specific?

General-purpose across **OAuth providers**, and already used for three: Microsoft Graph, Microsoft Power Automate/Flow, and Google. It is *not* Google-specific — but it is OAuth-specific.

`ortie --help`, verbatim:

```
CLI to manage OAuth 2.0 tokens

Usage: ortie [OPTIONS] [COMMAND]

Commands:
  auth         Get a fresh access token by running the account's OAuth grant
  token        Display and refresh an existing OAuth 2.0 access token
  repl         Start a persistent REPL session for one account
  manuals      Generate manual pages to the given directory
  completions  Generate completion script for the give shell(s) to the given directory
  help         Print this message or the help of the given subcommand(s)
```

There is **no provider-listing subcommand and no discovery subcommand**. Accounts are declared in a TOML file; `-a/--account <NAME>` selects one ("An account name corresponds to an entry in the table at the root level of your TOML configuration file"). Listing accounts therefore means reading the config, not running a command. This was already established independently in `/home/eh/nix/docs/uva-oauth-findings.md`:

> ortie has no discovery subcommand: it runs a grant that a config file has already declared (client id, auth/token URLs, scopes). It therefore cannot answer "will this tenant issue a token" on its own

**Registering a provider requires**, per the shipped config `/home/eh/.config/ortie/config.toml` (symlink into the nix store; the live file is `-r--r--r-- root root`, i.e. read-only, nix-managed):

- a `grant` — one of `device`, `authorization-code`, `client-credentials` (`ortie auth --help`: "Start an authorization-code, device or client-credentials grant")
- a literal `client-id` (config.toml:78 comment: "client-id must be a literal — ortie accepts `.command` on the secret but not on the id")
- for authorization-code, a `client-secret` (or `client-secret.command`) — config.toml:79
- explicit endpoint URLs: `endpoints.authorization`, `endpoints.token`, `endpoints.redirection`, or `endpoints.device-authorization` (config.toml:5–6, 38–39, 80–82). **There is no OIDC discovery-document support** — every endpoint is spelled out by hand.
- a `scopes` array
- `storage.read.command` / `storage.write.command` (config.toml:17–18, 46–47, 117–118)

So: a non-Google provider absolutely can be registered — two of the three accounts already are Microsoft. What cannot be registered is a provider for which you do not hold a client id and an OAuth endpoint pair.

## 2. Does `ortie` have any non-OAuth credential concept?

**No. OAuth is its only model.** Every subcommand is an OAuth verb:

- `ortie token --help`: "Display and refresh an existing OAuth 2.0 access token. This subcommand allows you to show your access token, inspect metadata associated to it, and refresh your access token using the refresh token (if available)." Subcommands: `show`, `inspect`, `refresh`.
- `ortie auth --help`: "Get a fresh access token by running the account's OAuth grant." Subcommands: `get`, `resume`.

There is no `set`, no `import`, no paste-a-bearer-token path, no cookie concept, no session concept. The storage layer is the only pluggable part, and what it stores is the OAuth token JSON the grant produced — a hand-pasted opaque credential would have nowhere to come from, because `token show` reaches for the refresh grant when the access token expires (`auto-refresh = true`, config.toml:15, 44, 115).

## 3. What apps does `crumb` support, and is that set fixed?

`crumb --help`, verbatim:

```
crumb — a browser-credential broker.

Usage:
  crumb state <app>              verified page state as JSON (notebooklm, pinpoint, scholar)
  crumb cookies <target-url>     the RFC 6265-scoped Cookie header for one full URL
  crumb sync [--port N]          import cookies from the chrome-cdp browser into the owned jar
  crumb login <app> [--port N]   sign in via the chrome-cdp automation profile, then harvest

Exit codes: 0 ok, 64 usage, 69 unavailable, 75 temporary, 77 not signed in.
```

The help text understates the app list. The source (`/home/eh/projects/crumb/src/profiles.ts`) carries **five** profiles in two families:

- `PROFILES` (page-state): `pinpoint` (:52), `notebooklm` (:61), `scholar` (:69)
- `MINT_PROFILES` (long-lived credential exchanged for a short-lived one): `morgen` (:92), `consensus` (:126)
- `ALL_PROFILES = { ...PROFILES, ...MINT_PROFILES }` (:169); the binary also exposes a `crumb token <app>` subcommand (`src/cli.ts:539`) that the help text omits.

**The set is EXTENSIBLE, by design and by written decision.** `profiles.ts:1-5`:

> App profiles are declarative data, not code (ADR 0001). A profile names the origin, the path to fetch, the hosts the final URL may legitimately land on, the fields to extract, and which of its own fields is the signed-in marker. **Adding a site is adding a record**; a site that needs real code belongs on the CDP fallback path instead.

Adding an app requires a record with: `name`, `origin`, `path`, `allowedFinalHosts`, `fields` (extractors of kind `boqField`, `urlParam`, or `pageStorage`), and a `signedInMarker` that must name something the profile actually collects — `profiles.ts:24-30`:

> What "signed in" means for this profile … Either way it must name something the profile actually collects, or verification could never observe its absence and a signed-out browser would pass.

Optionally a `mint` spec (`MintSpec`: url, method, `send`, `tokenField`, optional `cookieAuth` with an explicit cookie-name allowlist, optional `discover`) — ADR 0002, `docs/decisions/0002-brokered-credentials-beyond-cookies.md`. That record has to be written in TypeScript in the crumb repo and the binary rebuilt (it is a nix-built ELF, `/nix/store/jzgj0svh2v9770p88la0b1diipl4kcaf-crumb-0.2.0/bin/crumb`) — it is not user-config at runtime, though `CRUMB_ORIGIN_<APP>` / `CRUMB_MINT_URL_<APP>` env overrides exist for fixtures (`profiles.ts:181-198`).

**Importantly, `crumb cookies <url>` needs no profile at all.** `src/cli.ts:185-200`: it takes any full target URL, RFC-6265-scopes the jar against it, and prints a Cookie header; the error path notes "A target URL names no app, so the remedy names both doors into the jar rather than guessing." So a Westlaw Cookie header could be emitted **today**, with zero code change, provided a Westlaw session were in the jar (which would require `crumb sync` from an authenticated automation-profile browser — not run here).

## 4. Source located and confirmed

- `command -v ortie` → `/home/eh/.nix-profile/bin/ortie` → `/nix/store/w5x05ma8gcf87qhdqkkykdi02x2yz0ia-ortie-2.1.0/bin/ortie`. Nix packaging: `/home/eh/nix/modules/shared/ortie-release.nix`. **Upstream Rust source is not vendored on this machine** — UNVERIFIED at code level; my ortie claims rest on its own `--help`/subcommand help and on the config schema it consumes. Fetching the upstream crate would settle it.
- `command -v crumb` → `/home/eh/.nix-profile/bin/crumb` → `/nix/store/jzgj0svh2v9770p88la0b1diipl4kcaf-crumb-0.2.0/bin/crumb`. **Source IS present**: `/home/eh/projects/crumb/` (TypeScript, Bun), packaged by `/home/eh/nix/modules/shared/crumb.nix`. All crumb claims above are quoted from that source with file:line.

## 5. State on disk

| tool | path | permissions | format | encrypted? |
|---|---|---|---|---|
| ortie (config) | `/home/eh/.config/ortie/config.toml` → nix store | `-r--r--r-- root root` | TOML, plaintext | no — but it holds no secret; the Google client secret is read via `client-secret.command` precisely because "inlining it here would put a live OAuth secret in the nix store, which is world-readable" (config.toml:68-70) |
| ortie (tokens) | `/home/eh/.local/state/ortie/{msgraph,flow,google}.token` | `-rw------- eh eh` (0600) | JSON with `access_token` / refresh token fields | **plaintext**, protected by file mode only. Mode is set by the config's own writer: `install -D -m600 /dev/stdin …` (config.toml:18, 47, 118) |
| crumb (jar) | `/home/eh/.local/share/crumb/jar/` | `drwx------` (0700), enforced and re-asserted on every open — `src/jar.ts:57-77` chmods to `0o700` and reads it back | a **Chrome user-data-dir**; cookies in `jar/Default/Cookies`, a SQLite DB, mode `-rw-------`, plus `Local State` (`-rw-------`) | cookie *values* are encrypted by Chrome's `os_crypt`, keyed from `Local State` — which sits beside it. Treat as **effectively plaintext to anyone with the user's UID.** |

No token, cookie, or secret value is reproduced here.

## 6. Which tool is the right shape for Westlaw? — Neither, in practice

**`ortie`: no, categorically.** Westlaw at UVA authenticates through the university IdP (SAML/Shibboleth-style institutional SSO, commonly with MFA), producing a **browser session**, not an OAuth token issued to a client the user controls. ortie's registration surface (§1) demands a client id, an authorization/token endpoint pair, and scopes. There is no OAuth client to register, no token endpoint to point at, and nothing for `token refresh` to do; and ortie has no way to hold a credential it did not obtain via a grant (§2). The CLAUDE.md line — "a NotebookLM or Scholar auth failure is crumb's, never ortie's" — puts Westlaw on the crumb side of the line by construction.

**`crumb`: right shape, wrong problem.** Westlaw is exactly the class crumb was built for: cookie-authed, browser-established, no OAuth. It is extensible; `crumb cookies https://1.next.westlaw.com/...` would work off a synced jar with no code change, and a `westlaw` profile with a `signedInMarker` would be a normal ADR-0001 record.

But **the skill does not need it.** The skill's stated design is:

> The user's own logged-in Chromium on CDP port 9222 … there is no credential handling and nothing to store. (`SKILL.md:17-19`)

A browser already holding the session does not benefit from a broker whose whole job is to extract that session for *browserless* HTTP consumers. crumb pays off when the consumer is a CLI (`nlm`, `consensus`, `morgen-cli`) that cannot drive a browser. The Westlaw skill *is* the browser. Adding crumb would convert a zero-credential design into a stored-credential design in exchange for nothing the skill currently does.

The one scenario that would change this: if the skill ever needs **unattended / headless** Westlaw retrieval (a cron job, a farm-out agent with no GUI session), then crumb — not ortie — is the tool, and the work is one profile record plus a decision about the MFA re-auth cadence. That is a future-conditional, not a present gap. UNVERIFIED whether Westlaw's session survives long enough to make an unattended path viable at all; measuring the session cookie's `expire_at` on a live jar would settle it, and that was out of scope here (read-only, no sync, no login).

## 7. Risks to weigh before brokering Westlaw credentials at all

**What a leaked Westlaw session cookie grants.** A Westlaw session is a full-privilege bearer credential for the user's institutional account: search, retrieve, download, KeyCite, and — importantly — it is *attributable to the named UVA user* and metered against the law school's subscription. Unlike an OAuth token, it carries **no scope narrowing**: there is no read-only variant, no per-API restriction. If institutional SSO is shared across services (common with a single university IdP), the risk of the *IdP* session is broader still, though what Westlaw's own cookie reaches is Westlaw. Storage would be plaintext-to-the-UID (§5): the crumb jar is 0700 with OS-crypt-keyed values whose key sits in the same directory, so any process running as `eh` — including any agent with Bash — could read it. Today no such credential exists on disk at all.

**What the current zero-credential design gives up: essentially nothing.** The skill drives a browser the user has already authenticated interactively. It gets the same access a broker would, without persisting anything, and it fails visibly (a sign-in page) rather than silently with a stale credential. The only capabilities forgone are the unattended/headless ones in §6.

**Licensing/ToS: open and unverified.** I found no copy of a Westlaw subscriber agreement, UVA license, or acceptable-use document on this machine, and I did not search the web. Automated retrieval and credential storage are plausibly restricted by such terms, but **I cannot state what the terms say.** Locating the actual UVA Law Westlaw license or the Thomson Reuters subscriber agreement would settle it; until then, treat the licensing question as open — and note that this weighs *toward* the current design, since a browser the user drives is harder to characterize as automated harvesting than a stored-credential headless pipeline.

## Recommendation

Leave `SKILL.md` as written. Neither broker should be wired in now: ortie is structurally incapable, and crumb is capable but redundant against a design that already has an authenticated browser in hand. Revisit only if an unattended Westlaw path is actually required — and then it is crumb, one profile record, plus the licensing question answered first.

---

### What I did not do

- Did not run `ortie auth`, `ortie token show/refresh/inspect`, `crumb login`, `crumb sync`, or `crumb state` — all mutate a store, perform a login, or print a secret.
- Did not read ortie's Rust source (not vendored locally); ortie findings rest on help text + config schema.
- Did not inspect the crumb jar's cookie contents or any Westlaw session.
- Did not check Westlaw ToS or session lifetime.
- Did not edit `SKILL.md`.
