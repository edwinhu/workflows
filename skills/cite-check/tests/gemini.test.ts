import { describe, expect, it, afterEach } from "bun:test";
import { join } from "node:path";
import {
  __setGeminiClientForTesting,
  __setReadwisePathForTesting,
  createStore,
  listDocuments,
  uploadPdf,
  uploadPdfs,
  uploadFromBib,
  uploadText,
  parseBibFile,
  resolveFromReadwise,
  searchReadwise,
  queryCitation,
  submitBatchCiteCheck,
  titleSimilarity,
  type StoreConfig,
  type StoreDocument,
  type GeminiQueryResult,
  type ClassifyResult,
  type Status,
  type BibEntry,
  type BatchRequest,
} from "../gemini";

afterEach(() => {
  __setGeminiClientForTesting(null);
  __setReadwisePathForTesting(null);
});

describe("gemini.ts module", () => {
  it("exports all required types and functions", () => {
    expect(typeof createStore).toBe("function");
    expect(typeof listDocuments).toBe("function");
    expect(typeof uploadPdf).toBe("function");
    expect(typeof uploadPdfs).toBe("function");
    expect(typeof queryCitation).toBe("function");
    expect(typeof __setGeminiClientForTesting).toBe("function");
  });

  it("queryCitation throws when client lacks models property", async () => {
    // Mock client without models to verify error propagation
    __setGeminiClientForTesting({} as any);

    await expect(
      queryCitation("stores/123", "test prompt"),
    ).rejects.toThrow();
  });
});

describe("createStore", () => {
  it("calls fileSearchStores.create and returns parsed config", async () => {
    const mockClient = {
      fileSearchStores: {
        create: async (_opts: any) => ({
          name: "fileSearchStores/abc123",
        }),
        documents: { list: async () => [] },
        importFile: async () => ({ done: true }),
      },
      files: {
        upload: async () => ({ name: "files/abc123", state: "ACTIVE" }),
        get: async () => ({ state: "ACTIVE" }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const result = await createStore("my-project");
    expect(result.storeId).toBe("abc123");
    expect(result.storeName).toBe("fileSearchStores/abc123");
    expect(result.displayName).toBe("my-project");
  });
});

describe("listDocuments", () => {
  it("returns parsed documents from async iterator", async () => {
    const mockDocs = [
      { name: "fileSearchStores/s1/documents/d1", displayName: "Hirst2022-pq" },
      { name: "fileSearchStores/s1/documents/d2", displayName: "Bebchuk2017-mm" },
    ];
    const mockClient = {
      fileSearchStores: {
        documents: {
          list: async () => mockDocs, // array is iterable with for-await
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const docs = await listDocuments("fileSearchStores/s1");
    expect(docs.length).toBe(2);
    expect(docs[0].displayName).toBe("Hirst2022-pq");
    expect(docs[1].displayName).toBe("Bebchuk2017-mm");
  });
});

describe("uploadPdf", () => {
  it("uploads file, imports into store with bibkey metadata", async () => {
    const uploadCalls: any[] = [];
    const importCalls: any[] = [];
    const mockClient = {
      files: {
        upload: async (opts: any) => {
          uploadCalls.push(opts);
          return { name: "files/abc123", state: "ACTIVE" };
        },
        get: async () => ({ state: "ACTIVE" }),
      },
      fileSearchStores: {
        importFile: async (opts: any) => {
          importCalls.push(opts);
          return { done: true };
        },
        documents: { list: async () => [] },
      },
      operations: {
        get: async () => ({ done: true }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    await uploadPdf("fileSearchStores/s1", "/tmp/test.pdf", "Author2022-ab");
    expect(uploadCalls.length).toBe(1);
    expect(uploadCalls[0].config.displayName).toBe("Author2022-ab");
    expect(importCalls.length).toBe(1);
    expect(importCalls[0].fileSearchStoreName).toBe("fileSearchStores/s1");
    expect(importCalls[0].fileName).toBe("files/abc123");
    expect(importCalls[0].config.customMetadata).toEqual([
      { key: "bibkey", stringValue: "Author2022-ab" },
    ]);
  });

  it("polls until file is ACTIVE before importing", async () => {
    let getCalls = 0;
    const mockClient = {
      files: {
        upload: async () => ({ name: "files/abc456", state: "PROCESSING" }),
        get: async () => {
          getCalls++;
          // Return ACTIVE on the second call
          return { state: getCalls >= 2 ? "ACTIVE" : "PROCESSING" };
        },
      },
      fileSearchStores: {
        importFile: async () => ({ done: true }),
        documents: { list: async () => [] },
      },
      operations: {
        get: async () => ({ done: true }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    await uploadPdf("fileSearchStores/s1", "/tmp/test.pdf", "PollTest2024-xx", { _pollIntervalMs: 10 });
    // files.get should have been called at least twice (once PROCESSING, once ACTIVE)
    expect(getCalls).toBeGreaterThanOrEqual(2);
  });
});

describe("uploadPdfs", () => {
  it("skips already-uploaded PDFs", async () => {
    const uploadCalls: any[] = [];
    const mockClient = {
      files: {
        upload: async (opts: any) => {
          uploadCalls.push(opts);
          return { name: "files/newpaper123", state: "ACTIVE" };
        },
        get: async () => ({ state: "ACTIVE" }),
      },
      fileSearchStores: {
        documents: {
          list: async () => [
            { name: "d1", displayName: "Existing2020-xx" },
          ],
        },
        importFile: async () => ({ done: true }),
      },
      operations: { get: async () => ({ done: true }) },
    };
    __setGeminiClientForTesting(mockClient as any);

    // Create a temp dir with 2 PDFs: one that exists in store, one that doesn't
    const tmpDir = "/tmp/cite-check-test-pdfs";
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(join(tmpDir, "Existing2020-xx.pdf"), "fake-pdf");
      writeFileSync(join(tmpDir, "NewPaper2023-yy.pdf"), "fake-pdf");

      const result = await uploadPdfs("fileSearchStores/s1", tmpDir);
      expect(result.uploaded).toBe(1);
      expect(result.skipped).toBe(1);
      expect(uploadCalls.length).toBe(1);
      expect(uploadCalls[0].config.displayName).toBe("NewPaper2023-yy");  // files.upload config
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("queryCitation", () => {
  it("sends prompt with file search tool and parses structured SUPPORTED response", async () => {
    const generateCalls: any[] = [];
    const mockClient = {
      models: {
        generateContent: async (opts: any) => {
          generateCalls.push(opts);
          return {
            text: JSON.stringify({
              status: "SUPPORTED",
              supporting_passage: "The study found significant effects (p < 0.01)",
              explanation: "Source directly supports the claim with statistical evidence",
            }),
            candidates: [{
              groundingMetadata: {
                groundingChunks: [{
                  retrievedContext: {
                    text: "The study found significant effects (p < 0.01) on corporate governance outcomes.",
                    title: "Hirst2022-pq",
                    customMetadata: [{ key: "bibkey", stringValue: "Hirst2022-pq" }],
                  },
                }],
              },
            }],
          };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const result = await queryCitation(
      "fileSearchStores/s1",
      "Does Hirst2022-pq support this claim?",
      { metadataFilter: 'bibkey="Hirst2022-pq"' },
    );

    expect(result.classification.status).toBe("SUPPORTED");
    expect(result.classification.supporting_passage).toContain("significant effects");
    expect(result.groundingChunks.length).toBe(1);
    expect(result.groundingChunks[0].sourceTitle).toBe("Hirst2022-pq");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify the SDK call included file search config and structured output
    expect(generateCalls.length).toBe(1);
    expect(generateCalls[0].config.tools[0].fileSearch.fileSearchStoreNames).toEqual(["fileSearchStores/s1"]);
    expect(generateCalls[0].config.tools[0].fileSearch.metadataFilter).toBe('bibkey="Hirst2022-pq"');
    expect(generateCalls[0].config.responseMimeType).toBe("application/json");
    expect(generateCalls[0].config.responseJsonSchema).toBeDefined();
  });

  it("classifies UNSUPPORTED from structured output", async () => {
    const mockClient = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            status: "UNSUPPORTED",
            supporting_passage: "",
            explanation: "The source does not discuss this topic",
          }),
          candidates: [{ groundingMetadata: { groundingChunks: [] } }],
        }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const result = await queryCitation("fileSearchStores/s1", "test prompt");
    expect(result.classification.status).toBe("UNSUPPORTED");
    expect(result.classification.supporting_passage).toBe("");
  });

  it("returns ERROR when response is not JSON", async () => {
    const mockClient = {
      models: {
        generateContent: async () => ({
          text: "The source supports this claim but is not JSON.",
          candidates: [{}],
        }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const result = await queryCitation("fileSearchStores/s1", "test prompt");
    expect(result.classification.status).toBe("ERROR");
    expect(result.classification.explanation).toContain("Failed to parse");
  });

  it("returns ERROR for empty response", async () => {
    const mockClient = {
      models: {
        generateContent: async () => ({
          text: "",
          candidates: [{}],
        }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const result = await queryCitation("fileSearchStores/s1", "test prompt");
    expect(result.classification.status).toBe("ERROR");
  });

  it("uses default model gemini-3.1-flash-lite-preview", async () => {
    const calls: any[] = [];
    const mockClient = {
      models: {
        generateContent: async (opts: any) => {
          calls.push(opts);
          return {
            text: JSON.stringify({ status: "PARTIAL", supporting_passage: "", explanation: "" }),
            candidates: [{}],
          };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    await queryCitation("fileSearchStores/s1", "test");
    expect(calls[0].model).toBe("gemini-3.1-flash-lite-preview");
  });

  it("handles missing grounding metadata gracefully", async () => {
    const mockClient = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({ status: "SUPPORTED", supporting_passage: "quote", explanation: "ok" }),
          candidates: [{}],  // no groundingMetadata
        }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const result = await queryCitation("fileSearchStores/s1", "test");
    expect(result.classification.status).toBe("SUPPORTED");
    expect(result.groundingChunks).toEqual([]);
  });
});

describe("parseBibFile", () => {
  it("extracts bibkey-to-file mappings from .bib content", async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const tmpDir = "/tmp/cite-check-bib-test";
    const bibPath = join(tmpDir, "test.bib");
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        bibPath,
        `
@article{Hu2024-bm,
  author = {Edwin Hu},
  title = {{Custom proxy voting advice}},
  file = {All Papers/H/Hu et al. 2024 - Custom proxy voting advice.pdf},
  year = {2024}
}

@article{NoPdf2020-xx,
  author = {No File},
  title = {{No file field}},
  year = {2020}
}

@article{Bebchuk2017-mm,
  author = {Lucian Bebchuk},
  title = {{Agency Problems}},
  file = {All Papers/B/Bebchuk 2017 - Agency Problems.pdf},
  year = {2017}
}
`,
      );

      const map = parseBibFile(bibPath);

      // Now returns ALL entries (3), not just those with file fields (2)
      expect(map.size).toBe(3);
      expect(map.has("Hu2024-bm")).toBe(true);
      expect(map.has("NoPdf2020-xx")).toBe(true);
      expect(map.has("Bebchuk2017-mm")).toBe(true);

      const hu = map.get("Hu2024-bm")!;
      expect(hu.filePath).toBe(
        join(tmpDir, "All Papers/H/Hu et al. 2024 - Custom proxy voting advice.pdf"),
      );

      // Entry without file field should have no filePath but should have title
      const noPdf = map.get("NoPdf2020-xx")!;
      expect(noPdf.filePath).toBeUndefined();
      expect(noPdf.title).toBe("No file field");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("extracts title field with double braces", async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const tmpDir = "/tmp/cite-check-bib-title-test";
    const bibPath = join(tmpDir, "test.bib");
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        bibPath,
        `
@article{Hu2024-bm,
  author = {Edwin Hu},
  title = {{Custom proxy voting advice}},
  file = {All Papers/H/Hu 2024.pdf},
  year = {2024}
}
`,
      );

      const map = parseBibFile(bibPath);
      const entry = map.get("Hu2024-bm")!;
      expect(entry.title).toBe("Custom proxy voting advice");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("extracts title field with single braces", async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const tmpDir = "/tmp/cite-check-bib-title-single-test";
    const bibPath = join(tmpDir, "test.bib");
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        bibPath,
        `
@article{Smith2020-ab,
  author = {John Smith},
  title = {Single Brace Title},
  year = {2020}
}
`,
      );

      const map = parseBibFile(bibPath);
      const entry = map.get("Smith2020-ab")!;
      expect(entry.title).toBe("Single Brace Title");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("uploadFromBib", () => {
  it("uploads only cited bibkeys that have file mappings and aren't already in store", async () => {
    const uploadCalls: any[] = [];
    const mockClient = {
      files: {
        upload: async (opts: any) => {
          uploadCalls.push(opts);
          return { name: "files/haspdf123", state: "ACTIVE" };
        },
        get: async () => ({ state: "ACTIVE" }),
      },
      fileSearchStores: {
        documents: {
          list: async () => [
            { name: "d1", displayName: "AlreadyThere2020-xx" },
          ],
        },
        importFile: async () => ({ done: true }),
      },
      operations: { get: async () => ({ done: true }) },
    };
    __setGeminiClientForTesting(mockClient as any);

    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const tmpDir = "/tmp/cite-check-upload-bib-test";
    try {
      mkdirSync(join(tmpDir, "pdfs"), { recursive: true });
      writeFileSync(join(tmpDir, "pdfs/real.pdf"), "fake-pdf");

      const bibMap = new Map<string, BibEntry>([
        [
          "HasPdf2024-aa",
          {
            bibkey: "HasPdf2024-aa",
            filePath: join(tmpDir, "pdfs/real.pdf"),
          },
        ],
        [
          "NoPdf2024-bb",
          {
            bibkey: "NoPdf2024-bb",
            filePath: join(tmpDir, "pdfs/nonexistent.pdf"),
          },
        ],
        [
          "AlreadyThere2020-xx",
          {
            bibkey: "AlreadyThere2020-xx",
            filePath: join(tmpDir, "pdfs/real.pdf"),
          },
        ],
      ]);

      const result = await uploadFromBib(
        "fileSearchStores/s1",
        bibMap,
        [
          "HasPdf2024-aa",
          "NoPdf2024-bb",
          "AlreadyThere2020-xx",
          "NotInBib2024-cc",
        ],
      );

      expect(result.uploaded).toBe(1); // HasPdf2024-aa
      expect(result.skipped).toBe(1); // AlreadyThere2020-xx
      expect(result.missing).toBe(2); // NoPdf2024-bb (file not found) + NotInBib2024-cc (not in map)
      expect(result.fromReadwise).toBe(0); // no readwise fallback in mock test
      expect(uploadCalls.length).toBe(1);
      expect(uploadCalls[0].config.displayName).toBe("HasPdf2024-aa");  // files.upload config
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("resolveFromReadwise", () => {
  it("exports resolveFromReadwise as a function", () => {
    expect(typeof resolveFromReadwise).toBe("function");
  });
});

describe("uploadText", () => {
  it("exports uploadText as a function", () => {
    expect(typeof uploadText).toBe("function");
  });

  it("writes temp file, uploads via uploadPdf, and cleans up", async () => {
    const uploadCalls: any[] = [];
    const mockClient = {
      files: {
        upload: async (opts: any) => {
          uploadCalls.push(opts);
          return { name: "files/textdoc123", state: "ACTIVE" };
        },
        get: async () => ({ state: "ACTIVE" }),
      },
      fileSearchStores: {
        importFile: async () => ({ done: true }),
      },
      operations: { get: async () => ({ done: true }) },
    };
    __setGeminiClientForTesting(mockClient as any);

    await uploadText(
      "fileSearchStores/s1",
      "# Some Markdown Content\n\nThis is a test document.",
      "TestDoc2024-ab",
    );

    expect(uploadCalls.length).toBe(1);
    expect(uploadCalls[0].config.displayName).toBe("TestDoc2024-ab");
    // The temp file should have been cleaned up (best effort)
    const { existsSync } = await import("node:fs");
    const tmpFile = uploadCalls[0].file as string;
    expect(existsSync(tmpFile)).toBe(false);
  });
});

describe("titleSimilarity", () => {
  it("returns high score for matching titles", () => {
    expect(titleSimilarity(
      "Custom proxy voting advice",
      "Custom proxy voting advice"
    )).toBeGreaterThan(0.9);
  });

  it("returns low score for unrelated titles", () => {
    expect(titleSimilarity(
      "Imputed Proxy Advisor Recommendations for ISS Voting Analytics",
      "Form ADV Part 2 Brochures"
    )).toBeLessThan(0.3);
  });

  it("handles partial matches", () => {
    expect(titleSimilarity(
      "In re Toews Corporation",
      "Toews Corporation"
    )).toBeGreaterThan(0.3);
  });
});

describe("submitBatchCiteCheck", () => {
  it("submits batch job and parses inline responses", async () => {
    const createCalls: any[] = [];
    const mockClient = {
      batches: {
        create: async (opts: any) => {
          createCalls.push(opts);
          return {
            name: "batches/test-batch-123",
            state: "JOB_STATE_SUCCEEDED",
            dest: {
              inlinedResponses: [
                {
                  response: {
                    text: JSON.stringify({
                      status: "SUPPORTED",
                      supporting_passage: "Evidence here",
                      explanation: "Source supports claim",
                    }),
                  },
                },
                {
                  response: {
                    text: JSON.stringify({
                      status: "UNSUPPORTED",
                      supporting_passage: "",
                      explanation: "Not discussed",
                    }),
                  },
                },
              ],
            },
          };
        },
        get: async () => ({ state: "JOB_STATE_SUCCEEDED" }),
      },
      // Include fileSearchStores for any transitive calls
      fileSearchStores: { documents: { list: async () => [] } },
    };
    __setGeminiClientForTesting(mockClient as any);

    const results = await submitBatchCiteCheck(
      "fileSearchStores/s1",
      [
        { key: "g1", prompt: "Does source support claim 1?" },
        { key: "g2", prompt: "Does source support claim 2?", metadataFilter: 'bibkey="X"' },
      ],
    );

    expect(results.length).toBe(2);
    expect(results[0].key).toBe("g1");
    expect(results[0].classification.status).toBe("SUPPORTED");
    expect(results[1].key).toBe("g2");
    expect(results[1].classification.status).toBe("UNSUPPORTED");

    // Verify batch was created with correct model and inline requests
    expect(createCalls.length).toBe(1);
    expect(createCalls[0].src.length).toBe(2);
    expect(createCalls[0].src[0].key).toBe("g1");
    expect(createCalls[0].src[1].config.tools[0].fileSearch.metadataFilter).toBe('bibkey="X"');
  });

  it("handles batch errors gracefully", async () => {
    const mockClient = {
      batches: {
        create: async () => ({
          name: "batches/err-batch",
          state: "JOB_STATE_SUCCEEDED",
          dest: {
            inlinedResponses: [
              { error: { message: "Rate limited" } },
            ],
          },
        }),
        get: async () => ({ state: "JOB_STATE_SUCCEEDED" }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const results = await submitBatchCiteCheck(
      "fileSearchStores/s1",
      [{ key: "g1", prompt: "test" }],
    );

    expect(results.length).toBe(1);
    expect(results[0].classification.status).toBe("ERROR");
    expect(results[0].error).toBeDefined();
  });
});

describe("searchReadwise", () => {
  it("exports searchReadwise as a function", () => {
    expect(typeof searchReadwise).toBe("function");
  });

  it("returns null when readwise binary does not exist", async () => {
    // Point to a nonexistent binary so we don't make real network calls
    __setReadwisePathForTesting("/tmp/nonexistent-readwise-binary");
    const result = await searchReadwise("Some Title That Won't Match");
    // Should gracefully return null, not throw
    expect(result).toBeNull();
  });
});

// Type-level checks: ensure exported types are usable
const _status: Status = "SUPPORTED";
const _classify: ClassifyResult = {
  status: "PARTIAL",
  supporting_passage: "p",
  explanation: "e",
};
const _queryResult: GeminiQueryResult = {
  classification: _classify,
  groundingChunks: [],
  durationMs: 0,
};
const _storeDoc: StoreDocument = { name: "n", displayName: "d" };
const _storeCfg: StoreConfig = {
  storeId: "id",
  storeName: "name",
  displayName: "d",
};

// BibEntry now has optional filePath and title
const _bibEntry: BibEntry = { bibkey: "k" };
const _bibEntryFull: BibEntry = { bibkey: "k", filePath: "/p", title: "T" };

// BatchRequest type check
const _batchReq: BatchRequest = { key: "k", prompt: "p" };
const _batchReqFull: BatchRequest = { key: "k", prompt: "p", metadataFilter: "f" };

// Suppress unused-variable warnings -- these are compile-time type checks
void _status;
void _classify;
void _queryResult;
void _storeDoc;
void _storeCfg;
void _bibEntry;
void _bibEntryFull;
void _batchReq;
void _batchReqFull;
