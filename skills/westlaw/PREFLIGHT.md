# Step 0 preflight — what was added, and what is verified

All measured values below were **supplied by the user**, who probed the live signed-in session. I did
not observe them: this task had no browser tools and no Westlaw session, and I ran no probe.

Only `SKILL.md` was changed: a new "Step 0 — SESSION PREFLIGHT" before "Step 1 — find the case", and
one new row at the top of the "Red flags — STOP" table. The Prerequisite section's "no credential
handling and nothing to store" line was left alone — Step 0 forbids credential handling, so it still
reads correctly.

## Step 0 text as added

> ## Step 0 — session preflight
>
> Confirm the browser session is still signed in before driving it; an expired login presents as a
> missing selector or a stalled delivery queue several steps later. On any Westlaw tab, evaluate:
>
> ```js
> const r = await fetch('/V1/Delivery/Details?timeZoneId=Eastern%20Standard%20Time',
>                       {credentials:'same-origin', redirect:'follow'});
> const ct = r.headers.get('content-type') || '';
> const body = await r.text();
> JSON.stringify({status:r.status, host:new URL(r.url).host, ct, ok:(()=>{try{JSON.parse(body);return true}catch{return false}})()});
> ```
>
> **PASS only on:** `status` 200 AND `ct` contains `application/json` AND the body parses as JSON AND
> `host` is `1.next.westlaw.com`. Measured on a signed-in session: 200, `application/json;
> charset=utf-8`, body begins `{"PollingIntervalInMilliseconds":0,"DeliveryQueueItems":[{"F`. This is
> the same endpoint Step 5 polls, so it tests the capability the run needs.
>
> Anything else — non-200, non-JSON content type, unparseable body, another final host, or a thrown
> fetch — is NOT SIGNED IN. **STOP and tell the user to sign in to Westlaw in his own browser and
> re-run.** Never attempt a login, fill a credential field, or touch a saved password; this skill
> handles no credentials and Step 0 is not the exception.
>
> **There is no DOM fallback: the API probe is the only session check.** Measured on one live
> signed-in session, same browser, same moment: on `/Document/…/View/FullText.html` (case viewer)
> `#coid_website_signOffRegion` → 1 and `#co_signOffContainer` → 1; on `/Advantage/Home` both → 0,
> while the API probe passed on that same page (200, `application/json; charset=utf-8`, parseable,
> `redirected:false`) and its visible text read "… Client: HU EDWIN Help Profile Sign out …". Those
> IDs therefore indicate **which page is loaded**, not whether the session is live, and using them
> yields a false "not signed in" — the same false-negative class already noted for
> `#coid_website_userMenu`, `#co_signOffLink`, `a[href*="SignOff"]`, `#coid_headerLinks` and
> `.co_user` (all measured absent while signed in). The only signal present on both tabs was the
> page's own visible text containing "Sign out"; it is not carried here, because user-visible copy
> Thomson Reuters can reword is too weak to sit beside the probe and must never override it.

**Call made on the text-match fallback: deleted, not demoted.** A "Sign out" substring match is
user-visible copy the vendor can reword at any time, and a check that may only corroborate a
passing probe and never override a failing one changes no decision — so carrying it would add a
weak selector for symmetry alone.
>
> The signed-out response shape is UNVERIFIED (never observed, since testing it means signing the user
> out) — hence the fail-closed condition above; observing it once would allow a more specific message.

## Red-flag row as added

| About to | Do instead |
|---|---|
| Debug a missing selector or a stalled delivery queue | Run Step 0 first — an expired session presents as a broken page |

## Verified vs UNVERIFIED

**Verified (measured on the live signed-in session by the user, reported verbatim):**

- `GET /V1/Delivery/Details?timeZoneId=Eastern%20Standard%20Time` → status 200; final host
  `1.next.westlaw.com`; content-type `application/json; charset=utf-8`; body parses as JSON and
  begins `{"PollingIntervalInMilliseconds":0,"DeliveryQueueItems":[{"F`.
- **Verified page-dependent, unusable as a session check** (corrected; previously listed here as a
  "verified signed-in marker"): `#coid_website_signOffRegion` and `#co_signOffContainer`. Measured
  on one live signed-in session across two tabs — on
  `/Document/I700de97dbe3e11d9bdd1cfdd544ca3a4/View/FullText.html` both → 1; on `/Advantage/Home`
  both → 0. On that same `/Advantage/Home` tab the API probe passed (200,
  `application/json; charset=utf-8`, parseable, `redirected:false`) and the page's visible text read
  "Switch products Thomson ReutersTM Westlaw Advantage … Client: HU EDWIN Help Profile Sign out Col".
  They indicate which page is loaded, not whether the session is live.
- Absent while signed in (so unusable as markers): `#coid_website_userMenu`, `#co_signOffLink`,
  `a[href*="SignOff"]`, `#coid_headerLinks`, `.co_user` — all zero matches.
- The endpoint is the same one Step 5 already polls (from SKILL.md's existing Step 5).

**UNVERIFIED:**

- The entire signed-out branch — **still never observed.** The user believed he had been
  auto-logged-out; the probe was re-run on both tabs and he was still signed in, so no signed-out
  response has yet been seen. Whether it is a 401, a 302 to a sign-on host, or an HTML login page
  returned with status 200 was never observed, because observing it means signing the user out.
  Step 0 therefore fails closed on the positive condition and asserts no specific signed-out status
  code. Observing that response once is what would let the failure message get more specific.
- Any behavior of a guessed alternate endpoint or selector — none were invented, per the skill's own
  record that six guessed delivery URLs all 404'd.
- I did not execute the snippet, so its exact runtime output in this environment is unconfirmed.
