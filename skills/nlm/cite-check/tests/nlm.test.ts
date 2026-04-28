import { describe, expect, it } from "bun:test";
import {
  __setNlmSpawnerForTesting,
  nlmGenerateChat,
  parseNlmSourcesTable,
  type NLMResult,
} from "../nlm";

const FIXTURE = `ID                                   TITLE                                                                                                                                             TYPE                      STATUS                    LAST UPDATED
bb47c4f5-410b-4355-b2c8-64edf9cf4792 /tmp/s1670.md                                                                                                                                     SOURCE_TYPE_SHARED_NOTE   SOURCE_STATUS_ENABLED     2026-04-17T18:56:44Z
b72a6322-c882-4f74-a9a3-f4cf5a09fc48 /tmp/s4241.md                                                                                                                                     SOURCE_TYPE_SHARED_NOTE   SOURCE_STATUS_ENABLED     2026-04-17T18:56:42Z
3cd186f2-aa5e-4a44-a744-bfd9904ae57f Appel2016-xn                                                                                                                                      SOURCE_TYPE_GOOGLE_SLIDES SOURCE_STATUS_ENABLED     2026-04-24T23:11:13Z
e085b61d-76ed-4a89-baa3-a34a06b5760e Applying A Retail Voting Program in Practice                                                                                                      SOURCE_TYPE_WEB_PAGE      SOURCE_STATUS_ENABLED     2026-04-17T19:18:40Z
6bb30f91-3761-4b58-805b-6092037729fc Bebchuk2017-mm                                                                                                                                    SOURCE_TYPE_GOOGLE_SLIDES SOURCE_STATUS_ENABLED     2026-04-17T19:09:50Z
`;

describe("parseNlmSourcesTable", () => {
  it("parses the column-aligned nlm sources output", () => {
    const rows = parseNlmSourcesTable(FIXTURE);
    expect(rows.length).toBe(5);
    expect(rows[0]).toEqual({
      id: "bb47c4f5-410b-4355-b2c8-64edf9cf4792",
      title: "/tmp/s1670.md",
    });
    expect(rows[2]).toEqual({
      id: "3cd186f2-aa5e-4a44-a744-bfd9904ae57f",
      title: "Appel2016-xn",
    });
    expect(rows[3].title).toBe("Applying A Retail Voting Program in Practice");
  });

  it("returns [] for empty / header-only input", () => {
    expect(parseNlmSourcesTable("")).toEqual([]);
    expect(
      parseNlmSourcesTable(
        "ID                                   TITLE   TYPE   STATUS   LAST UPDATED\n",
      ),
    ).toEqual([]);
  });
});

describe("nlmGenerateChat retry-on-empty", () => {
  it("retries after failures and returns success when a later attempt succeeds (attempts=3)", async () => {
    const calls: string[] = [];
    const responses: NLMResult[] = [
      { raw: "", ok: false, durationMs: 5 },
      { raw: "", ok: true, durationMs: 5 },
      { raw: "real answer", ok: true, durationMs: 7 },
    ];
    __setNlmSpawnerForTesting(async (args) => {
      calls.push(args.join(" "));
      return responses.shift()!;
    });
    try {
      const res = await nlmGenerateChat("nb1", "prompt", {
        // Use a tiny backoff override so the test runs fast.
        retryBackoffsMs: [0, 1, 1],
      });
      expect(calls.length).toBe(3);
      expect(res.attempts).toBe(3);
      expect(res.finalEmpty).toBe(false);
      expect(res.ok).toBe(true);
      expect(res.raw).toBe("real answer");
    } finally {
      __setNlmSpawnerForTesting(null);
    }
  });

  it("returns finalEmpty=true with attempts=3 when all 3 spawn attempts fail", async () => {
    const calls: string[] = [];
    const responses: NLMResult[] = [
      { raw: "", ok: false, durationMs: 5 },
      { raw: "   \n", ok: true, durationMs: 5 }, // ok but empty after trim
      { raw: "", ok: false, durationMs: 5 },
    ];
    __setNlmSpawnerForTesting(async (args) => {
      calls.push(args.join(" "));
      return responses.shift()!;
    });
    try {
      const res = await nlmGenerateChat("nb1", "prompt", {
        retryBackoffsMs: [0, 1, 1],
      });
      expect(calls.length).toBe(3);
      expect(res.attempts).toBe(3);
      expect(res.finalEmpty).toBe(true);
    } finally {
      __setNlmSpawnerForTesting(null);
    }
  });
});
