import { describe, expect, it, afterEach } from "bun:test";
import { join } from "node:path";
import {
  __setGeminiClientForTesting,
  __setReadwisePathForTesting,
  uploadFile,
  uploadTextFile,
  uploadCitedFiles,
  parseBibFile,
  resolveFromReadwise,
  searchReadwise,
  queryCitation,
  submitBatchCiteCheck,
  extractResponseText,
  titleSimilarity,
  type ClassifyResult,
  type Status,
  type BibEntry,
  type BatchRequest,
  type FileRef,
} from "../gemini";

afterEach(() => {
  __setGeminiClientForTesting(null);
  __setReadwisePathForTesting(null);
});

describe("gemini.ts module", () => {
  it("exports all required types and functions", () => {
    expect(typeof uploadFile).toBe("function");
    expect(typeof uploadTextFile).toBe("function");
    expect(typeof uploadCitedFiles).toBe("function");
    expect(typeof queryCitation).toBe("function");
    expect(typeof submitBatchCiteCheck).toBe("function");
    expect(typeof extractResponseText).toBe("function");
    expect(typeof __setGeminiClientForTesting).toBe("function");
  });

  it("queryCitation throws when client lacks models property", async () => {
    // Mock client without models to verify error propagation
    __setGeminiClientForTesting({} as any);

    await expect(
      queryCitation([], "test prompt"),
    ).rejects.toThrow();
  });
});

describe("uploadFile", () => {
  it("uploads file and returns FileRef with name, uri, mimeType", async () => {
    const uploadCalls: any[] = [];
    const mockClient = {
      files: {
        upload: async (opts: any) => {
          uploadCalls.push(opts);
          return {
            name: "files/abc123",
            uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
            mimeType: "application/pdf",
            state: "ACTIVE",
          };
        },
        get: async () => ({ state: "ACTIVE" }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const ref = await uploadFile("/tmp/test.pdf", { displayName: "Author2022-ab" });
    expect(ref.name).toBe("files/abc123");
    expect(ref.uri).toBe("https://generativelanguage.googleapis.com/v1beta/files/abc123");
    expect(ref.mimeType).toBe("application/pdf");
    expect(uploadCalls.length).toBe(1);
    expect(uploadCalls[0].config.displayName).toBe("Author2022-ab");
  });

  it("polls until file is ACTIVE before returning", async () => {
    let getCalls = 0;
    const mockClient = {
      files: {
        upload: async () => ({
          name: "files/abc456",
          uri: "https://example.com/files/abc456",
          mimeType: "application/pdf",
          state: "PROCESSING",
        }),
        get: async () => {
          getCalls++;
          return {
            state: getCalls >= 2 ? "ACTIVE" : "PROCESSING",
            uri: "https://example.com/files/abc456",
            mimeType: "application/pdf",
          };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const ref = await uploadFile("/tmp/test.pdf", { _pollIntervalMs: 10 });
    expect(ref.name).toBe("files/abc456");
    expect(getCalls).toBeGreaterThanOrEqual(2);
  });

  it("throws when upload returns no name", async () => {
    const mockClient = {
      files: {
        upload: async () => ({ state: "ACTIVE" }),
        get: async () => ({ state: "ACTIVE" }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    await expect(uploadFile("/tmp/test.pdf")).rejects.toThrow("Upload returned no name");
  });

  it("throws when file processing fails", async () => {
    const mockClient = {
      files: {
        upload: async () => ({
          name: "files/fail123",
          state: "FAILED",
          error: { message: "corrupt file" },
        }),
        get: async () => ({ state: "FAILED" }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    await expect(uploadFile("/tmp/test.pdf")).rejects.toThrow("File processing failed");
  });
});

describe("uploadTextFile", () => {
  it("writes temp file, uploads, and returns FileRef", async () => {
    const uploadCalls: any[] = [];
    const mockClient = {
      files: {
        upload: async (opts: any) => {
          uploadCalls.push(opts);
          return {
            name: "files/textdoc123",
            uri: "https://example.com/files/textdoc123",
            mimeType: "text/markdown",
            state: "ACTIVE",
          };
        },
        get: async () => ({ state: "ACTIVE" }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const ref = await uploadTextFile(
      "# Some Markdown Content\n\nThis is a test document.",
      "TestDoc2024-ab",
    );

    expect(ref.name).toBe("files/textdoc123");
    expect(ref.mimeType).toBe("text/markdown");
    expect(uploadCalls.length).toBe(1);
    expect(uploadCalls[0].config.displayName).toBe("TestDoc2024-ab");
    expect(uploadCalls[0].config.mimeType).toBe("text/markdown");
    // The temp file should have been cleaned up (best effort)
    const { existsSync } = await import("node:fs");
    const tmpFile = uploadCalls[0].file as string;
    expect(existsSync(tmpFile)).toBe(false);
  });
});

describe("uploadCitedFiles", () => {
  it("uploads PDFs, skips cached, tracks missing", async () => {
    const uploadCalls: any[] = [];
    const mockClient = {
      files: {
        upload: async (opts: any) => {
          uploadCalls.push(opts);
          return {
            name: `files/${opts.config.displayName}`,
            uri: `https://example.com/files/${opts.config.displayName}`,
            mimeType: "application/pdf",
            state: "ACTIVE",
          };
        },
        get: async () => ({ state: "ACTIVE" }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const tmpDir = "/tmp/cite-check-upload-cited-test";
    try {
      mkdirSync(join(tmpDir, "pdfs"), { recursive: true });
      writeFileSync(join(tmpDir, "pdfs/real.pdf"), "fake-pdf");

      const bibMap = new Map<string, BibEntry>([
        ["HasPdf2024-aa", { bibkey: "HasPdf2024-aa", filePath: join(tmpDir, "pdfs/real.pdf") }],
        ["NoPdf2024-bb", { bibkey: "NoPdf2024-bb", filePath: join(tmpDir, "pdfs/nonexistent.pdf") }],
        ["AlreadyCached2020-xx", { bibkey: "AlreadyCached2020-xx", filePath: join(tmpDir, "pdfs/real.pdf") }],
      ]);

      // Pre-populate cache with one entry
      const cache = new Map<string, FileRef>([
        ["AlreadyCached2020-xx", { name: "files/cached", uri: "https://example.com/cached", mimeType: "application/pdf" }],
      ]);

      const result = await uploadCitedFiles(
        bibMap,
        ["HasPdf2024-aa", "NoPdf2024-bb", "AlreadyCached2020-xx", "NotInBib2024-cc"],
        cache,
      );

      expect(result.uploaded).toBe(1);  // HasPdf2024-aa
      expect(result.skipped).toBe(1);   // AlreadyCached2020-xx
      expect(result.missing).toBe(2);   // NoPdf2024-bb (file not found) + NotInBib2024-cc (not in map)
      expect(result.fromReadwise).toBe(0);
      expect(uploadCalls.length).toBe(1);
      expect(uploadCalls[0].config.displayName).toBe("HasPdf2024-aa");

      // Cache should now have both entries
      expect(cache.has("HasPdf2024-aa")).toBe(true);
      expect(cache.has("AlreadyCached2020-xx")).toBe(true);
      expect(cache.size).toBe(2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("queryCitation", () => {
  it("sends prompt with inline file refs and parses structured SUPPORTED response", async () => {
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
          };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const fileRefs: FileRef[] = [
      { name: "files/abc123", uri: "https://example.com/files/abc123", mimeType: "application/pdf" },
    ];

    const result = await queryCitation(
      fileRefs,
      "Does Hirst2022-pq support this claim?",
    );

    expect(result.classification.status).toBe("SUPPORTED");
    expect(result.classification.supporting_passage).toContain("significant effects");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify the SDK call included file data parts and structured output
    expect(generateCalls.length).toBe(1);
    const call = generateCalls[0];
    expect(call.contents[0].parts.length).toBe(2); // 1 file + 1 text
    expect(call.contents[0].parts[0].fileData.fileUri).toBe("https://example.com/files/abc123");
    expect(call.contents[0].parts[0].fileData.mimeType).toBe("application/pdf");
    expect(call.contents[0].parts[1].text).toBe("Does Hirst2022-pq support this claim?");
    expect(call.config.responseMimeType).toBe("application/json");
    expect(call.config.responseJsonSchema).toBeDefined();
    // No tools (no fileSearch)
    expect(call.config.tools).toBeUndefined();
  });

  it("sends multiple file refs for compound citations", async () => {
    const generateCalls: any[] = [];
    const mockClient = {
      models: {
        generateContent: async (opts: any) => {
          generateCalls.push(opts);
          return {
            text: JSON.stringify({
              status: "SUPPORTED",
              supporting_passage: "Evidence from both sources",
              explanation: "Both sources support the claim",
            }),
          };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const fileRefs: FileRef[] = [
      { name: "files/a", uri: "https://example.com/files/a", mimeType: "application/pdf" },
      { name: "files/b", uri: "https://example.com/files/b", mimeType: "text/markdown" },
    ];

    const result = await queryCitation(fileRefs, "Do both support this?");
    expect(result.classification.status).toBe("SUPPORTED");

    // Should have 3 parts: 2 files + 1 text
    expect(generateCalls[0].contents[0].parts.length).toBe(3);
    expect(generateCalls[0].contents[0].parts[0].fileData.fileUri).toBe("https://example.com/files/a");
    expect(generateCalls[0].contents[0].parts[1].fileData.fileUri).toBe("https://example.com/files/b");
    expect(generateCalls[0].contents[0].parts[2].text).toBe("Do both support this?");
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
        }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const result = await queryCitation([], "test prompt");
    expect(result.classification.status).toBe("UNSUPPORTED");
    expect(result.classification.supporting_passage).toBe("");
  });

  it("returns ERROR when response is not JSON", async () => {
    const mockClient = {
      models: {
        generateContent: async () => ({
          text: "The source supports this claim but is not JSON.",
        }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const result = await queryCitation([], "test prompt");
    expect(result.classification.status).toBe("ERROR");
    expect(result.classification.explanation).toContain("Failed to parse");
  });

  it("returns ERROR for empty response", async () => {
    const mockClient = {
      models: {
        generateContent: async () => ({
          text: "",
        }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const result = await queryCitation([], "test prompt");
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
          };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    await queryCitation([], "test");
    expect(calls[0].model).toBe("gemini-3.1-flash-lite-preview");
  });

  it("works with empty fileRefs array", async () => {
    const generateCalls: any[] = [];
    const mockClient = {
      models: {
        generateContent: async (opts: any) => {
          generateCalls.push(opts);
          return {
            text: JSON.stringify({ status: "SUPPORTED", supporting_passage: "quote", explanation: "ok" }),
          };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const result = await queryCitation([], "test");
    expect(result.classification.status).toBe("SUPPORTED");
    // Should have only 1 part (the text prompt)
    expect(generateCalls[0].contents[0].parts.length).toBe(1);
    expect(generateCalls[0].contents[0].parts[0].text).toBe("test");
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

describe("extractResponseText", () => {
  it("extracts text from hydrated response with .text string", () => {
    const result = extractResponseText({ text: '{"status":"SUPPORTED"}' });
    expect(result).toBe('{"status":"SUPPORTED"}');
  });

  it("extracts text from raw candidates array", () => {
    const result = extractResponseText({
      candidates: [{
        content: {
          parts: [{ text: '{"status":"PARTIAL"}' }],
        },
      }],
    });
    expect(result).toBe('{"status":"PARTIAL"}');
  });

  it("joins multiple text parts", () => {
    const result = extractResponseText({
      candidates: [{
        content: {
          parts: [
            { text: '{"status":' },
            { text: '"SUPPORTED"}' },
          ],
        },
      }],
    });
    expect(result).toBe('{"status":"SUPPORTED"}');
  });

  it("returns empty string for null/undefined", () => {
    expect(extractResponseText(null)).toBe("");
    expect(extractResponseText(undefined)).toBe("");
    expect(extractResponseText({})).toBe("");
  });

  it("returns empty string for empty candidates", () => {
    expect(extractResponseText({ candidates: [] })).toBe("");
    expect(extractResponseText({ candidates: [{ content: { parts: [] } }] })).toBe("");
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
  it("submits batch with inline fileData parts and responseSchema", async () => {
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
                    candidates: [{
                      content: {
                        parts: [{ text: JSON.stringify({
                          status: "SUPPORTED",
                          supporting_passage: "Evidence here",
                          explanation: "Source supports claim",
                        }) }],
                      },
                    }],
                  },
                },
                {
                  response: {
                    candidates: [{
                      content: {
                        parts: [{ text: JSON.stringify({
                          status: "UNSUPPORTED",
                          supporting_passage: "",
                          explanation: "Not discussed",
                        }) }],
                      },
                    }],
                  },
                },
              ],
            },
          };
        },
        get: async () => ({ state: "JOB_STATE_SUCCEEDED" }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const fileRef1: FileRef = { name: "files/a", uri: "https://example.com/a", mimeType: "application/pdf" };
    const fileRef2: FileRef = { name: "files/b", uri: "https://example.com/b", mimeType: "application/pdf" };

    const results = await submitBatchCiteCheck([
      { key: "g1", prompt: "Does source support claim 1?", fileRefs: [fileRef1] },
      { key: "g2", prompt: "Does source support claim 2?", fileRefs: [fileRef2] },
    ]);

    // Single batch call
    expect(createCalls.length).toBe(1);
    expect(createCalls[0].src.length).toBe(2);

    // Batch requests should have fileData parts (not fileSearch tools)
    const req1 = createCalls[0].src[0];
    expect(req1.contents[0].parts[0].fileData.fileUri).toBe("https://example.com/a");
    expect(req1.contents[0].parts[0].fileData.mimeType).toBe("application/pdf");
    expect(req1.contents[0].parts[1].text).toBe("Does source support claim 1?");

    // Should have responseMimeType and responseSchema (no tools = structured output works)
    expect(req1.config.responseMimeType).toBe("application/json");
    expect(req1.config.responseSchema).toBeDefined();
    expect(req1.config.responseSchema.type).toBeDefined();
    // No tools
    expect(req1.config.tools).toBeUndefined();

    // Results should be properly parsed from JSON
    expect(results.length).toBe(2);
    expect(results[0].key).toBe("g1");
    expect(results[0].classification.status).toBe("SUPPORTED");
    expect(results[0].classification.supporting_passage).toBe("Evidence here");
    expect(results[1].key).toBe("g2");
    expect(results[1].classification.status).toBe("UNSUPPORTED");
  });

  it("handles multiple file refs in a single batch request", async () => {
    const createCalls: any[] = [];
    const mockClient = {
      batches: {
        create: async (opts: any) => {
          createCalls.push(opts);
          return {
            name: "batches/compound-batch",
            state: "JOB_STATE_SUCCEEDED",
            dest: {
              inlinedResponses: [{
                response: {
                  text: JSON.stringify({
                    status: "SUPPORTED",
                    supporting_passage: "combined evidence",
                    explanation: "both sources agree",
                  }),
                },
              }],
            },
          };
        },
        get: async () => ({ state: "JOB_STATE_SUCCEEDED" }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const refs: FileRef[] = [
      { name: "files/a", uri: "https://example.com/a", mimeType: "application/pdf" },
      { name: "files/b", uri: "https://example.com/b", mimeType: "text/markdown" },
    ];

    const results = await submitBatchCiteCheck([
      { key: "compound", prompt: "Do both support this?", fileRefs: refs },
    ]);

    // Should have 3 parts: 2 file refs + 1 text prompt
    const parts = createCalls[0].src[0].contents[0].parts;
    expect(parts.length).toBe(3);
    expect(parts[0].fileData.fileUri).toBe("https://example.com/a");
    expect(parts[1].fileData.fileUri).toBe("https://example.com/b");
    expect(parts[2].text).toBe("Do both support this?");

    expect(results[0].classification.status).toBe("SUPPORTED");
  });

  it("parses hydrated class responses with .text string property", async () => {
    const mockClient = {
      batches: {
        create: async () => ({
          name: "batches/hydrated-batch",
          state: "JOB_STATE_SUCCEEDED",
          dest: {
            inlinedResponses: [
              {
                response: {
                  text: JSON.stringify({
                    status: "SUPPORTED",
                    supporting_passage: "quote from source",
                    explanation: "directly supports",
                  }),
                },
              },
            ],
          },
        }),
        get: async () => ({ state: "JOB_STATE_SUCCEEDED" }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const results = await submitBatchCiteCheck([
      { key: "g1", prompt: "test", fileRefs: [] },
    ]);

    expect(results.length).toBe(1);
    expect(results[0].classification.status).toBe("SUPPORTED");
    expect(results[0].classification.supporting_passage).toBe("quote from source");
  });

  it("parses multi-part responses by joining all text parts", async () => {
    const mockClient = {
      batches: {
        create: async () => ({
          name: "batches/multipart-batch",
          state: "JOB_STATE_SUCCEEDED",
          dest: {
            inlinedResponses: [
              {
                response: {
                  candidates: [{
                    content: {
                      parts: [
                        { text: '{"status":"PARTIAL",' },
                        { text: '"supporting_passage":"p","explanation":"e"}' },
                      ],
                    },
                  }],
                },
              },
            ],
          },
        }),
        get: async () => ({ state: "JOB_STATE_SUCCEEDED" }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const results = await submitBatchCiteCheck([
      { key: "g1", prompt: "test", fileRefs: [] },
    ]);

    expect(results.length).toBe(1);
    expect(results[0].classification.status).toBe("PARTIAL");
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

    const results = await submitBatchCiteCheck([
      { key: "g1", prompt: "test", fileRefs: [] },
    ]);

    expect(results.length).toBe(1);
    expect(results[0].classification.status).toBe("ERROR");
    expect(results[0].error).toBeDefined();
  });

  it("returns ERROR for non-JSON response text", async () => {
    const mockClient = {
      batches: {
        create: async () => ({
          name: "batches/nonjson-batch",
          state: "JOB_STATE_SUCCEEDED",
          dest: {
            inlinedResponses: [{
              response: {
                text: "This is not JSON at all",
              },
            }],
          },
        }),
        get: async () => ({ state: "JOB_STATE_SUCCEEDED" }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const results = await submitBatchCiteCheck([
      { key: "g1", prompt: "test", fileRefs: [] },
    ]);

    expect(results.length).toBe(1);
    expect(results[0].classification.status).toBe("ERROR");
    expect(results[0].classification.explanation).toContain("Failed to parse JSON");
  });

  it("returns ERROR for empty/malformed response", async () => {
    const mockClient = {
      batches: {
        create: async () => ({
          name: "batches/empty-batch",
          state: "JOB_STATE_SUCCEEDED",
          dest: {
            inlinedResponses: [
              { response: {} },
              { response: null },
              { response: { candidates: [] } },
              { response: { candidates: [{ content: { parts: [] } }] } },
            ],
          },
        }),
        get: async () => ({ state: "JOB_STATE_SUCCEEDED" }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const results = await submitBatchCiteCheck([
      { key: "g1", prompt: "test1", fileRefs: [] },
      { key: "g2", prompt: "test2", fileRefs: [] },
      { key: "g3", prompt: "test3", fileRefs: [] },
      { key: "g4", prompt: "test4", fileRefs: [] },
    ]);

    expect(results.length).toBe(4);
    // All should return ERROR status since there's no valid text
    for (const r of results) {
      expect(r.classification.status).toBe("ERROR");
    }
  });

  it("throws for failed batch job", async () => {
    const mockClient = {
      batches: {
        create: async () => ({
          name: "batches/failed",
          state: "JOB_STATE_FAILED",
        }),
        get: async () => ({ state: "JOB_STATE_FAILED" }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    await expect(
      submitBatchCiteCheck([{ key: "g1", prompt: "test", fileRefs: [] }]),
    ).rejects.toThrow("Batch job failed");
  });
});

describe("resolveFromReadwise", () => {
  it("exports resolveFromReadwise as a function", () => {
    expect(typeof resolveFromReadwise).toBe("function");
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
const _fileRef: FileRef = { name: "files/x", uri: "https://example.com/x", mimeType: "application/pdf" };

// BibEntry now has optional filePath and title
const _bibEntry: BibEntry = { bibkey: "k" };
const _bibEntryFull: BibEntry = { bibkey: "k", filePath: "/p", title: "T" };

// BatchRequest type check -- now uses fileRefs instead of metadataFilter
const _batchReq: BatchRequest = { key: "k", prompt: "p", fileRefs: [] };
const _batchReqFull: BatchRequest = { key: "k", prompt: "p", fileRefs: [_fileRef] };

// Suppress unused-variable warnings -- these are compile-time type checks
void _status;
void _classify;
void _fileRef;
void _bibEntry;
void _bibEntryFull;
void _batchReq;
void _batchReqFull;
