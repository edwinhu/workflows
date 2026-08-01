/**
 * `sessionFlagKey` must be injective over session IDS — as a property, not as a handful of examples.
 *
 * The golden files pin what a few specific ids happen to produce today, which is exactly the kind of
 * evidence that keeps passing while the property it is standing in for quietly breaks: every one of
 * the ids that used to COLLIDE under the old sanitize-only key still produces a stable, distinct
 * golden value, so nothing in those files would notice a regression to deletion-based keying.
 *
 * Run: bun test tests/session-flag-key.test.ts
 */
import { describe, expect, test } from "bun:test";
import { sessionFlagKey } from "../hooks/_gate_common.ts";

const withEnv = <T>(value: string | undefined, body: () => T): T => {
  const previous = process.env.CLAUDE_CODE_SESSION_ID;
  if (value === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
  else process.env.CLAUDE_CODE_SESSION_ID = value;
  try { return body(); } finally {
    if (previous === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = previous;
  }
};

const keyFor = (session: unknown) => withEnv(undefined, () => sessionFlagKey({ session_id: session }));

describe("sessionFlagKey", () => {
  /**
   * The measured collision set. Under the first implementation — delete everything outside
   * [A-Za-z0-9._-] — all four of these produced the single key "sessone", so a returning subagent in
   * one session armed the Read block in the other three.
   */
  test("ids that differ only in a stripped character get distinct keys", () => {
    const collided = ["sess/one", "sess#one", "sess one", "sessone"];
    const keys = collided.map(keyFor);
    expect(new Set(keys).size).toBe(collided.length);
    // The pairwise form, so a failure names the pair rather than a set size.
    for (let i = 0; i < collided.length; i += 1) for (let j = i + 1; j < collided.length; j += 1) {
      expect(keys[i], `${collided[i]} vs ${collided[j]}`).not.toBe(keys[j]);
    }
    // And the classic two-token forgery shape.
    expect(keyFor("a#b")).not.toBe(keyFor("ab"));
  });

  test("an id whose every character is stripped still yields a usable, distinct key", () => {
    const allStripped = ["###", "///", "   ", "#/ #"];
    const keys = allStripped.map(keyFor);
    expect(new Set(keys).size).toBe(allStripped.length);
    for (const key of keys) {
      expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
      // It must never become a path component that escapes, and never the shared fallback.
      expect(key).not.toBe(".");
      expect(key).not.toBe("..");
      expect(key).not.toBe("default");
    }
  });

  test("keys are filename-safe and stable for every id shape", () => {
    for (const id of ["plain", "sess/one", "../../etc/passwd", "a".repeat(300), "s#p:a c e", "..", "."]) {
      const key = keyFor(id);
      expect(key, id).toMatch(/^[A-Za-z0-9._-]*-?[0-9a-f]{32}$/);
      expect(key, id).not.toBe("..");
      expect(keyFor(id), id).toBe(key);
    }
  });

  test("falls back to the session-tree env id, and only then to the shared default", () => {
    const envKey = withEnv("env-session", () => sessionFlagKey({}));
    expect(envKey).toBe(keyFor("env-session"));
    // A payload identity always wins over the environment.
    expect(withEnv("env-session", () => sessionFlagKey({ session_id: "payload-session" }))).toBe(keyFor("payload-session"));
    // Non-string and empty payload ids are not identities; the environment is used instead.
    for (const absent of [undefined, null, "", 17, {}]) {
      expect(withEnv("env-session", () => sessionFlagKey({ session_id: absent })), String(absent)).toBe(envKey);
    }
    expect(withEnv("", () => sessionFlagKey({}))).toBe("default");
  });

  /**
   * THE REMAINING COLLISION, PINNED SO IT CANNOT BE FORGOTTEN.
   *
   * With no identity from either source there is nothing to hash, so every such call shares one key.
   * This test asserts the limitation rather than papering over it: it is what the module's comment
   * must keep saying, and it is bounded only by "default" being unreachable from any real id.
   */
  test("identity-less calls still share one key, and no real id can reach it", () => {
    expect(withEnv(undefined, () => sessionFlagKey({}))).toBe("default");
    expect(withEnv(undefined, () => sessionFlagKey(undefined))).toBe("default");
    expect(withEnv(undefined, () => sessionFlagKey("not-an-object"))).toBe("default");
    expect(withEnv(undefined, () => sessionFlagKey(["array"]))).toBe("default");
    // THE PROPERTY, not a tautology. The previous form was
    //   expect(keyFor(id) === "default" && id !== "").toBe(false)
    // over ["default", "", "###"] — and for `id === ""` the left conjunct is TRUE (`keyFor("")` IS
    // "default"), so the `&& id !== ""` term existed solely to cancel it and make the row pass. It
    // asserted nothing about "" and nothing a bug could break. State both halves directly instead:
    // no real id reaches the fallback, and the empty string is not a real id.
    for (const id of ["default", "###", "d e f a u l t", "   ", "..", "/"]) {
      expect(keyFor(id), id).not.toBe("default");
    }
    // "" is not an identity at all — it is skipped as a candidate — so with no env id it legitimately
    // lands on the shared key. That is the collision this test pins, not an exception to it.
    expect(keyFor("")).toBe("default");
  });
});
