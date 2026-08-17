# Lens: security

Judges only the security of the changed code. Not performance, not test quality — another lens owns
each of those.

## What counts as a finding

An exploitable defect **introduced by these changes**, stated with the concrete attack vector: the
input an attacker controls, the path it travels, and what it reaches. A finding names a file and
line.

## Finding classes

**Injection — attacker-controlled input reaching an interpreter sink**

- string-concatenated SQL, or a query builder escaped into raw SQL
- shell execution built from a request/CLI/env value (`exec`, `system`, `sh -c`, `shell=True`)
- HTML/DOM sinks fed unescaped input (`innerHTML`, `dangerouslySetInnerHTML`, template autoescape
  disabled)
- deserialization of untrusted bytes (`pickle`, `yaml.load`, `eval`, `Function`)

**Path handling**

- a user-supplied segment joined into a filesystem path without normalizing and re-checking
  containment in the intended root (`../` traversal, absolute-path override, symlink escape)
- archive extraction writing entries outside the destination directory
- upload handlers trusting the client-supplied filename, content type, or size

**Authentication and authorization**

- a state-changing or data-returning operation with no auth check on the server path — a check that
  exists only in UI/routing/middleware the request can bypass is a finding
- authorization checked against a client-supplied identifier instead of the session subject (IDOR:
  object id from the request used without an ownership check)
- session cookies missing `HttpOnly` / `Secure` / `SameSite`; tokens with no expiry, no revocation,
  or accepted from a query string
- a check that is scoped to the wrong subject (role checked, tenant/owner not)
- "internal-only" or "behind the VPN" asserted as the control. Internality is not a control.

**Data exposure**

- secrets, tokens, passwords, session ids, or PII written to logs, traces, analytics, or error
  telemetry
- error responses returning stack traces, SQL text, internal hostnames, or file paths to the client
- an API/serializer returning more fields than the caller is entitled to (whole ORM object
  serialized, `SELECT *` into a response)

**Crypto and randomness**

- MD5/SHA-1 for signatures or password hashing; a fast digest where a KDF (bcrypt/scrypt/argon2) is
  required; ECB mode; a static or reused IV/nonce
- keys, salts, JWT secrets, or API tokens hardcoded in source or committed config
- `Math.random`, `random`, or a time-seeded PRNG generating a token, session id, password reset
  value, or nonce
- signature or MAC compared with `==` rather than a constant-time compare
- TLS verification disabled (`verify=False`, `rejectUnauthorized: false`,
  `InsecureSkipVerify: true`)

**TOCTOU and race conditions in a security decision**

- permission or quota checked, then the resource re-resolved before use
- an `exists`/`access` check followed by an unguarded open or write

**Dependencies**

- a newly added or bumped dependency with a known CVE affecting the code path being used

## Not a finding

- a theoretical vector you cannot trace end to end from an attacker-reachable input to the sink
- a pre-existing issue the changes did not introduce or worsen
- "I would have validated this differently" where the existing validation actually holds
- defense-in-depth hardening on a path that is not exploitable as written

If a hunk you must judge is cut off, say what you would need to see rather than guessing a verdict
in either direction.
