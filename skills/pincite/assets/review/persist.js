// Debounced persistence for the pincite review page.
//
// localStorage is primary and synchronous: it is written first and
// unconditionally, so a dead or absent write server never costs the sitting's
// work. The disk write is an additional POST of the whole decision set to
// pincites.json; its outcome is reported honestly — a status that begins with
// "saved" is only ever emitted when the server confirmed a 2xx.
//
// Collaborators (fetch, storage, status sink) are injected so the module runs
// under a test runner without a browser.

const DEFAULT_URL = "pincites.json";
const DEFAULT_DELAY_MS = 400; // the pincite field is typed into, not clicked
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_KEY = "pincite-review";

const S_SAVING = "saving…";
const S_SAVED = "saved to disk ✓";
const S_LOCAL_ONLY = "NOT SAVED to disk — browser copy only";

function num(v, fallback) {
  return typeof v === "number" && isFinite(v) && v >= 0 ? v : fallback;
}

function isOk(res) {
  if (!res) return false;
  if (typeof res.ok === "boolean") return res.ok;
  return res.status >= 200 && res.status < 300;
}

export function createPersister(opts) {
  const o = opts || {};
  const doFetch = typeof o.fetch === "function" ? o.fetch : null;
  const storage = o.storage || null;
  const onStatus = typeof o.onStatus === "function" ? o.onStatus : function () {};
  const url = o.url || DEFAULT_URL;
  const key = o.key || DEFAULT_KEY;
  const delayMs = num(o.delayMs, DEFAULT_DELAY_MS);
  const timeoutMs = num(o.timeoutMs, DEFAULT_TIMEOUT_MS);

  let timer = null;
  let pending = null;
  let hasPending = false;
  let inFlight = null;

  function post(payload) {
    if (!doFetch) {
      onStatus(S_LOCAL_ONLY);
      return Promise.resolve(false);
    }
    let controller = null;
    let timeoutId = null;
    const init = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    };
    if (typeof AbortController === "function") {
      controller = new AbortController();
      init.signal = controller.signal;
    }
    const attempt = new Promise(function (resolve) {
      timeoutId = setTimeout(function () {
        timeoutId = null;
        if (controller) {
          try {
            controller.abort();
          } catch (e) {
            /* abort is best effort */
          }
        }
        resolve({ timedOut: true });
      }, timeoutMs);
      Promise.resolve()
        .then(function () {
          return doFetch(url, init);
        })
        .then(
          function (res) {
            resolve({ res: res });
          },
          function (err) {
            resolve({ err: err || new Error("fetch failed") });
          },
        );
    });
    return attempt.then(function (outcome) {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (outcome.timedOut) {
        onStatus(S_LOCAL_ONLY + " (server timed out)");
        return false;
      }
      if (outcome.err) {
        onStatus(S_LOCAL_ONLY + " (server unreachable)");
        return false;
      }
      if (!isOk(outcome.res)) {
        const code = outcome.res && outcome.res.status ? outcome.res.status : "?";
        // 404 is the ordinary case: the page served by plain http.server, where
        // Export is the only path to disk.
        onStatus(S_LOCAL_ONLY + " (server error " + code + ")");
        return false;
      }
      onStatus(S_SAVED);
      return true;
    });
  }

  function writeNow() {
    const snapshot = pending;
    pending = null;
    hasPending = false;
    const payload = JSON.stringify(snapshot === undefined ? null : snapshot);
    // localStorage first and unconditionally — before anything that can throw
    // or hang, so the browser copy survives a dead server.
    if (storage && typeof storage.setItem === "function") {
      try {
        storage.setItem(key, payload);
      } catch (e) {
        /* quota or private mode: the disk write is still worth attempting */
      }
    }
    inFlight = post(payload);
    return inFlight;
  }

  function save(store) {
    pending = store;
    hasPending = true;
    onStatus(S_SAVING);
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      writeNow();
    }, delayMs);
  }

  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (hasPending) writeNow();
    return Promise.resolve(inFlight).then(function () {});
  }

  return { save: save, flush: flush, key: key, url: url };
}

export default createPersister;

if (typeof globalThis !== "undefined") {
  globalThis.createPersister = createPersister;
}
