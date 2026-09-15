/**
 * Tests for the pincite review page's persistence module
 * (skills/pincite/assets/review/persist.js).
 *
 * The module takes injected collaborators (fetch, storage, a status callback) so
 * the debounce, the POST shape and the failure reporting are exercisable without
 * a browser. The reviewer works 155 citation sites in one sitting; the path that
 * decides whether a decision reaches disk is the one that loses that sitting when
 * it breaks silently, so it is tested rather than eyeballed.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

const MODULE = join(
  import.meta.dir,
  "..",
  "skills",
  "pincite",
  "assets",
  "review",
  "persist.js",
);

// createPersister(opts) -> { save(store), flush() }
// opts: { fetch, storage, onStatus, url?, key?, delayMs?, timeoutMs? }
async function loadFactory(): Promise<any> {
  const mod = await import(MODULE);
  const factory = mod.createPersister ?? mod.default;
  if (typeof factory !== "function") {
    throw new Error("persist.js must export createPersister (or a default factory)");
  }
  return factory;
}

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

// Decisions keyed as the page keys them: footnote|citekey|occurrence. The pin is
// free text — the manuscript already contains "1279--81", "55,086" and
// "(manuscript at 66)" — so nothing here is a well-formed page number.
const STORE = {
  "12|Easterbrook1983|1": { action: "set", pin: "1279--81", note: "" },
  "44|SECRelease2020|2": { action: "set", pin: "55,086", note: "FR page" },
  "91|Bebchuk2019|1": { action: "set", pin: "(manuscript at 66)", note: "" },
};

describe("persist.js", () => {
  let factory: any;
  beforeEach(async () => {
    factory = await loadFactory();
  });

  test("coalesces rapid saves into a single POST", async () => {
    const calls: any[] = [];
    const p = factory({
      fetch: async (url: string, init: any) => {
        calls.push({ url, init });
        return { ok: true, status: 200 };
      },
      storage: fakeStorage(),
      onStatus: () => {},
      delayMs: 20,
    });
    // A reviewer typing "1279--81" fires one save per keystroke.
    p.save(STORE);
    p.save(STORE);
    p.save(STORE);
    p.save(STORE);
    await p.flush();
    expect(calls.length).toBe(1);
  });

  test("POST declares application/json and carries the whole store", async () => {
    let seen: any = null;
    const p = factory({
      fetch: async (_url: string, init: any) => {
        seen = init;
        return { ok: true, status: 200 };
      },
      storage: fakeStorage(),
      onStatus: () => {},
      delayMs: 5,
    });
    p.save(STORE);
    await p.flush();

    expect(seen).not.toBeNull();
    expect(String(seen.method).toUpperCase()).toBe("POST");
    const ct = new Headers(seen.headers ?? {}).get("content-type") ?? "";
    // Not merely cosmetic: application/json forces a CORS preflight, which is
    // what stops a foreign page POSTing over the review decisions.
    expect(ct.toLowerCase()).toContain("application/json");
    expect(JSON.parse(seen.body)).toEqual(STORE);
  });

  test("defaults to pincites.json and the pincite-review storage key", async () => {
    let seenUrl: string | null = null;
    const storage = fakeStorage();
    const p = factory({
      fetch: async (url: string) => {
        seenUrl = url;
        return { ok: true, status: 200 };
      },
      storage,
      onStatus: () => {},
      delayMs: 5,
    });
    p.save(STORE);
    await p.flush();
    expect(seenUrl).toBe("pincites.json");
    expect([...storage.map.keys()]).toEqual(["pincite-review"]);
  });

  test("writes localStorage even when the disk write fails", async () => {
    const storage = fakeStorage();
    const p = factory({
      fetch: async () => {
        throw new Error("connection refused");
      },
      storage,
      onStatus: () => {},
      delayMs: 5,
    });
    p.save(STORE);
    await p.flush();
    // The crash layer for the sitting must survive a dead server.
    expect(storage.map.size).toBeGreaterThan(0);
    const persisted = JSON.parse([...storage.map.values()][0]);
    expect(persisted).toEqual(STORE);
  });

  test("writes localStorage even when fetch hangs past the timeout", async () => {
    const storage = fakeStorage();
    const p = factory({
      fetch: () => new Promise(() => {}), // never settles
      storage,
      onStatus: () => {},
      delayMs: 5,
      timeoutMs: 20,
    });
    p.save(STORE);
    await p.flush();
    expect(JSON.parse([...storage.map.values()][0])).toEqual(STORE);
  });

  test("a rejected fetch reports failure, not success", async () => {
    const statuses: string[] = [];
    const p = factory({
      fetch: async () => {
        throw new Error("connection refused");
      },
      storage: fakeStorage(),
      onStatus: (s: string) => statuses.push(String(s)),
      delayMs: 5,
    });
    p.save(STORE);
    await p.flush();

    const last = statuses[statuses.length - 1] ?? "";
    expect(last).toMatch(/fail|error|offline|not saved|unsaved|unreachable/i);
    expect(last).not.toMatch(/^saved/i);
  });

  test("a non-2xx response reports failure, not success", async () => {
    const statuses: string[] = [];
    const p = factory({
      // 404 is the live case: the page served by plain http.server, where the
      // POST endpoint does not exist and Export is the only path to disk.
      fetch: async () => ({ ok: false, status: 404 }),
      storage: fakeStorage(),
      onStatus: (s: string) => statuses.push(String(s)),
      delayMs: 5,
    });
    p.save(STORE);
    await p.flush();

    const last = statuses[statuses.length - 1] ?? "";
    expect(last).toMatch(/fail|error|offline|not saved|unsaved/i);
    expect(last).not.toMatch(/^saved/i);
    expect(last).toContain("404");
  });

  test("a timed-out fetch reports failure, not success", async () => {
    const statuses: string[] = [];
    const p = factory({
      fetch: () => new Promise(() => {}),
      storage: fakeStorage(),
      onStatus: (s: string) => statuses.push(String(s)),
      delayMs: 5,
      timeoutMs: 20,
    });
    p.save(STORE);
    await p.flush();

    const last = statuses[statuses.length - 1] ?? "";
    expect(last).not.toMatch(/^saved/i);
    expect(last).toMatch(/timed out/i);
  });

  test("a successful write reports success", async () => {
    const statuses: string[] = [];
    const p = factory({
      fetch: async () => ({ ok: true, status: 200 }),
      storage: fakeStorage(),
      onStatus: (s: string) => statuses.push(String(s)),
      delayMs: 5,
    });
    p.save(STORE);
    await p.flush();
    const last = statuses[statuses.length - 1] ?? "";
    expect(last).toMatch(/^saved/i);
  });

  test("no status beginning 'saved' is ever emitted without a 2xx", async () => {
    const statuses: string[] = [];
    const p = factory({
      fetch: async () => ({ ok: false, status: 500 }),
      storage: fakeStorage(),
      onStatus: (s: string) => statuses.push(String(s)),
      delayMs: 5,
    });
    p.save(STORE);
    await p.flush();
    // Including the optimistic "saving…"-then-tick pattern: the indicator carries
    // this module's string verbatim, so an unauthorised tick cannot appear.
    for (const s of statuses) expect(s).not.toMatch(/^saved/i);
  });
});
