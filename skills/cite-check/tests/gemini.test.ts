import { describe, expect, it, afterEach } from "bun:test";
import { join } from "node:path";
import {
  __setGeminiClientForTesting,
  uploadFile,
  uploadCitedFiles,
  parseBibFile,
  resolveFileAcrossDirs,
  queryCitation,
  queryCitationFileSearch,
  buildMetadataFilter,
  submitBatchFileSearch,
  extractResponseText,
  loadManifest,
  saveManifest,
  restoreFromManifest,
  updateManifest,
  computeSourceHash,
  loadStoreState,
  saveStoreState,
  createOrReuseStore,
  deleteStore,
  importToStore,
  type ClassifyResult,
  type Status,
  type BibEntry,
  type FileSearchBatchRequest,
  type FileSearchBatchResult,
  type FileRef,
  type Manifest,
  type ManifestEntry,
  type StoreState,
} from "../gemini";

afterEach(() => {
  __setGeminiClientForTesting(null);
});

describe("gemini.ts module", () => {
  it("exports all required types and functions", () => {
    expect(typeof uploadFile).toBe("function");
    expect(typeof uploadCitedFiles).toBe("function");
    expect(typeof queryCitation).toBe("function");
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

  it("sanitizes non-ASCII characters in displayName before upload", async () => {
    const uploadCalls: any[] = [];
    const mockClient = {
      files: {
        upload: async (opts: any) => {
          uploadCalls.push(opts);
          return {
            name: "files/xyz",
            uri: "https://generativelanguage.googleapis.com/v1beta/files/xyz",
            mimeType: "application/pdf",
            state: "ACTIVE",
          };
        },
        get: async () => ({ state: "ACTIVE" }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    // Unicode hyphen U+2010 in display name (common in Paperpile filenames)
    const unicodeName = "Author 2024 \u2010 Title Fragment";
    const ref = await uploadFile("/tmp/test.pdf", { displayName: unicodeName });
    expect(ref.name).toBe("files/xyz");
    // The displayName passed to the API should have non-ASCII replaced with "-"
    const sentName = uploadCalls[0].config.displayName;
    expect(sentName).not.toContain("\u2010");
    expect(sentName).toBe("Author 2024 - Title Fragment");
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

  it("resolves file via cross-directory fallback when primary path fails", async () => {
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
    // Simulate: sources.bib in /tmp/project/references/
    //           paperpile.bib in /tmp/paperpile/
    //           PDF at /tmp/paperpile/All Papers/Author.pdf
    const projectDir = "/tmp/cite-check-crossdir-test/project/references";
    const paperpileDir = "/tmp/cite-check-crossdir-test/paperpile";
    try {
      mkdirSync(join(paperpileDir, "All Papers"), { recursive: true });
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(paperpileDir, "All Papers/Author.pdf"), "fake-pdf");

      // Entry from sources.bib: filePath resolves to project/references/All Papers/Author.pdf (wrong)
      // fileRelPath is the raw relative path from the bib
      const bibMap = new Map<string, BibEntry>([
        ["Author2024-aa", {
          bibkey: "Author2024-aa",
          filePath: join(projectDir, "All Papers/Author.pdf"), // wrong dir
          fileRelPath: "All Papers/Author.pdf",
        }],
      ]);

      const cache = new Map<string, FileRef>();
      const result = await uploadCitedFiles(
        bibMap,
        ["Author2024-aa"],
        cache,
        { bibDirs: [projectDir, paperpileDir] },
      );

      expect(result.uploaded).toBe(1);
      expect(result.missing).toBe(0);
      expect(cache.has("Author2024-aa")).toBe(true);
      // Should have uploaded from the paperpile dir
      expect(uploadCalls.length).toBe(1);
    } finally {
      rmSync("/tmp/cite-check-crossdir-test", { recursive: true, force: true });
    }
  });
});

describe("resolveFileAcrossDirs", () => {
  it("returns primary path when it exists", async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const tmpDir = "/tmp/cite-check-resolve-primary";
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(join(tmpDir, "test.pdf"), "fake");
      const entry: BibEntry = {
        bibkey: "k",
        filePath: join(tmpDir, "test.pdf"),
        fileRelPath: "test.pdf",
      };
      expect(resolveFileAcrossDirs(entry, [])).toBe(join(tmpDir, "test.pdf"));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns null when no path resolves", () => {
    const entry: BibEntry = {
      bibkey: "k",
      filePath: "/nonexistent/path.pdf",
      fileRelPath: "path.pdf",
    };
    expect(resolveFileAcrossDirs(entry, ["/also/nonexistent"])).toBeNull();
  });

  it("falls back to alternative bib dir when primary fails", async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const altDir = "/tmp/cite-check-resolve-fallback";
    try {
      mkdirSync(join(altDir, "Papers"), { recursive: true });
      writeFileSync(join(altDir, "Papers/doc.pdf"), "fake");

      const entry: BibEntry = {
        bibkey: "k",
        filePath: "/wrong/dir/Papers/doc.pdf", // doesn't exist
        fileRelPath: "Papers/doc.pdf",
      };
      expect(resolveFileAcrossDirs(entry, [altDir])).toBe(
        join(altDir, "Papers/doc.pdf"),
      );
    } finally {
      rmSync(altDir, { recursive: true, force: true });
    }
  });

  it("tries alternate paths from semicolon-separated file fields", async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const bibDir = "/tmp/cite-check-resolve-alt-paths";
    try {
      mkdirSync(join(bibDir, "Papers"), { recursive: true });
      // Only the second (alt) path exists on disk
      writeFileSync(join(bibDir, "Papers/readable-name.pdf"), "fake");

      const entry: BibEntry = {
        bibkey: "k",
        filePath: join(bibDir, "Papers/1-s2.0-hash.pdf"), // doesn't exist
        fileRelPath: "Papers/1-s2.0-hash.pdf",
        fileAltRelPaths: ["Papers/readable-name.pdf"],
      };
      expect(resolveFileAcrossDirs(entry, [bibDir])).toBe(
        join(bibDir, "Papers/readable-name.pdf"),
      );
    } finally {
      rmSync(bibDir, { recursive: true, force: true });
    }
  });
});

describe("parseBibFile stores fileRelPath", () => {
  it("preserves raw relative path alongside resolved absolute path", async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const tmpDir = "/tmp/cite-check-relpath-test";
    const bibPath = join(tmpDir, "test.bib");
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(bibPath, `
@article{Hu2024-bm,
  title = {{Custom proxy voting advice}},
  file = {All Papers/H/Hu 2024.pdf},
  year = {2024}
}
`);
      const map = parseBibFile(bibPath);
      const entry = map.get("Hu2024-bm")!;
      expect(entry.fileRelPath).toBe("All Papers/H/Hu 2024.pdf");
      expect(entry.filePath).toBe(join(tmpDir, "All Papers/H/Hu 2024.pdf"));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("splits semicolon-separated file fields and stores alt paths", async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const tmpDir = "/tmp/cite-check-semicolon-test";
    const bibPath = join(tmpDir, "test.bib");
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(bibPath, `
@article{Brav2022-aa,
  title = {{Retail shareholder participation in the proxy process}},
  file = {All Papers/B/Brav et al. 2022 - 1-s2.0-main.pdf;All Papers/B/Brav et al. 2022 - Retail shareholder.pdf},
  year = {2022}
}
`);
      const map = parseBibFile(bibPath);
      const entry = map.get("Brav2022-aa")!;
      // Primary path is the first one
      expect(entry.fileRelPath).toBe("All Papers/B/Brav et al. 2022 - 1-s2.0-main.pdf");
      expect(entry.filePath).toBe(join(tmpDir, "All Papers/B/Brav et al. 2022 - 1-s2.0-main.pdf"));
      // Alt paths stored separately
      expect(entry.fileAltRelPaths).toEqual([
        "All Papers/B/Brav et al. 2022 - Retail shareholder.pdf",
      ]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles single file field without semicolons (no alt paths)", async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const tmpDir = "/tmp/cite-check-nosemicolon-test";
    const bibPath = join(tmpDir, "test.bib");
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(bibPath, `
@article{Hu2024-bm,
  file = {All Papers/H/Hu 2024.pdf},
  year = {2024}
}
`);
      const map = parseBibFile(bibPath);
      const entry = map.get("Hu2024-bm")!;
      expect(entry.fileRelPath).toBe("All Papers/H/Hu 2024.pdf");
      expect(entry.fileAltRelPaths).toBeUndefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("manifest persistence", () => {
  const tmpDir = "/tmp/cite-check-manifest-test";

  afterEach(async () => {
    const { rmSync } = await import("node:fs");
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("loadManifest returns empty object for missing file", () => {
    expect(loadManifest("/tmp/nonexistent-manifest.json")).toEqual({});
  });

  it("loadManifest returns empty object for invalid JSON", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(tmpDir, { recursive: true });
    const p = join(tmpDir, "bad.json");
    writeFileSync(p, "not json!");
    expect(loadManifest(p)).toEqual({});
  });

  it("saveManifest + loadManifest round-trips", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(tmpDir, { recursive: true });
    const p = join(tmpDir, "store.json");

    const manifest: Manifest = {
      "Key2024-aa": {
        name: "files/abc",
        uri: "https://example.com/abc",
        mimeType: "application/pdf",
        uploadedAt: Date.now(),
      },
    };
    saveManifest(p, manifest);
    const loaded = loadManifest(p);
    expect(loaded["Key2024-aa"].name).toBe("files/abc");
    expect(loaded["Key2024-aa"].uri).toBe("https://example.com/abc");
  });

  it("restoreFromManifest restores entries within TTL", () => {
    const now = Date.now();
    const manifest: Manifest = {
      "Fresh2024-aa": {
        name: "files/fresh",
        uri: "https://example.com/fresh",
        mimeType: "application/pdf",
        uploadedAt: now - 1000, // 1 second ago
      },
      "Expired2024-bb": {
        name: "files/old",
        uri: "https://example.com/old",
        mimeType: "application/pdf",
        uploadedAt: now - 49 * 60 * 60 * 1000, // 49 hours ago (expired)
      },
    };

    const cache = new Map<string, FileRef>();
    const restored = restoreFromManifest(manifest, cache, [
      "Fresh2024-aa",
      "Expired2024-bb",
      "Missing2024-cc",
    ]);

    expect(restored).toBe(1);
    expect(cache.has("Fresh2024-aa")).toBe(true);
    expect(cache.has("Expired2024-bb")).toBe(false);
    expect(cache.has("Missing2024-cc")).toBe(false);
  });

  it("restoreFromManifest skips keys already in cache", () => {
    const manifest: Manifest = {
      "Key2024-aa": {
        name: "files/manifest-ver",
        uri: "https://example.com/manifest-ver",
        mimeType: "application/pdf",
        uploadedAt: Date.now(),
      },
    };

    const cache = new Map<string, FileRef>([
      ["Key2024-aa", { name: "files/already", uri: "https://example.com/already", mimeType: "application/pdf" }],
    ]);
    const restored = restoreFromManifest(manifest, cache, ["Key2024-aa"]);

    expect(restored).toBe(0);
    // Cache should keep the original value, not the manifest value
    expect(cache.get("Key2024-aa")!.name).toBe("files/already");
  });

  it("updateManifest adds new entries and prunes expired", () => {
    const now = Date.now();
    const manifest: Manifest = {
      "Fresh2024-aa": {
        name: "files/fresh",
        uri: "https://example.com/fresh",
        mimeType: "application/pdf",
        uploadedAt: now - 1000,
      },
      "Expired2024-bb": {
        name: "files/old",
        uri: "https://example.com/old",
        mimeType: "application/pdf",
        uploadedAt: now - 49 * 60 * 60 * 1000,
      },
    };

    const cache = new Map<string, FileRef>([
      ["New2024-cc", { name: "files/new", uri: "https://example.com/new", mimeType: "application/pdf" }],
    ]);

    const updated = updateManifest(manifest, cache);

    expect(updated["Fresh2024-aa"]).toBeDefined();
    expect(updated["Expired2024-bb"]).toBeUndefined(); // pruned
    expect(updated["New2024-cc"]).toBeDefined();
    expect(updated["New2024-cc"].uploadedAt).toBeGreaterThan(0);
  });

  it("updateManifest does not overwrite existing manifest entries from cache", () => {
    const earlier = Date.now() - 60_000;
    const manifest: Manifest = {
      "Key2024-aa": {
        name: "files/original",
        uri: "https://example.com/original",
        mimeType: "application/pdf",
        uploadedAt: earlier,
      },
    };

    // Cache has the same key (restored from manifest earlier)
    const cache = new Map<string, FileRef>([
      ["Key2024-aa", { name: "files/original", uri: "https://example.com/original", mimeType: "application/pdf" }],
    ]);

    const updated = updateManifest(manifest, cache);
    // Should keep the original uploadedAt, not create a new timestamp
    expect(updated["Key2024-aa"].uploadedAt).toBe(earlier);
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

  it("does not set temperature (Gemini 3 optimized for default=1.0)", async () => {
    const calls: any[] = [];
    const mockClient = {
      models: {
        generateContent: async (opts: any) => {
          calls.push(opts);
          return {
            text: JSON.stringify({ status: "SUPPORTED", supporting_passage: "", explanation: "" }),
          };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    await queryCitation([], "test");
    expect(calls[0].config.temperature).toBeUndefined();
  });

  it("retries UNSUPPORTED with retryModel and overturns on SUPPORTED", async () => {
    let callIdx = 0;
    const calls: any[] = [];
    const mockClient = {
      models: {
        generateContent: async (opts: any) => {
          calls.push(opts);
          callIdx++;
          if (callIdx === 1) {
            // Primary model says UNSUPPORTED
            return {
              text: JSON.stringify({ status: "UNSUPPORTED", supporting_passage: "", explanation: "not found" }),
            };
          }
          // Retry model finds support
          return {
            text: JSON.stringify({ status: "SUPPORTED", supporting_passage: "found it", explanation: "ok" }),
          };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const result = await queryCitation([], "test", { retryModel: "gemini-2.5-flash" });

    expect(calls.length).toBe(2);
    expect(calls[0].model).toBe("gemini-3.1-flash-lite-preview"); // primary
    expect(calls[1].model).toBe("gemini-2.5-flash"); // retry
    expect(result.classification.status).toBe("SUPPORTED");
    expect(result.classification.supporting_passage).toBe("found it");
  });

  it("confirms UNSUPPORTED when retry also returns UNSUPPORTED", async () => {
    const mockClient = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({ status: "UNSUPPORTED", supporting_passage: "", explanation: "not found" }),
        }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const result = await queryCitation([], "test", { retryModel: "gemini-2.5-flash" });
    expect(result.classification.status).toBe("UNSUPPORTED");
  });

  it("does not retry when retryModel is not set", async () => {
    let callCount = 0;
    const mockClient = {
      models: {
        generateContent: async () => {
          callCount++;
          return {
            text: JSON.stringify({ status: "UNSUPPORTED", supporting_passage: "", explanation: "nope" }),
          };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    await queryCitation([], "test"); // no retryModel
    expect(callCount).toBe(1); // no retry
  });

  it("does not retry SUPPORTED results even with retryModel set", async () => {
    let callCount = 0;
    const mockClient = {
      models: {
        generateContent: async () => {
          callCount++;
          return {
            text: JSON.stringify({ status: "SUPPORTED", supporting_passage: "quote", explanation: "ok" }),
          };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const result = await queryCitation([], "test", { retryModel: "gemini-2.5-flash" });
    expect(callCount).toBe(1); // no retry for SUPPORTED
    expect(result.classification.status).toBe("SUPPORTED");
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

describe("parseBibFile url field", () => {
  it("extracts url field from bib entries", async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const tmpDir = "/tmp/cite-check-url-parse-test";
    const bibPath = join(tmpDir, "test.bib");
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(bibPath, `
@misc{Daly2026-sc,
  title = {{Remarks at the N.Y.C. Bar}},
  url = {https://www.sec.gov/news/speech/daly-remarks-2026},
  year = {2026}
}

@article{NoUrl2024-aa,
  title = {{No URL here}},
  year = {2024}
}
`);
      const map = parseBibFile(bibPath);
      expect(map.get("Daly2026-sc")!.url).toBe("https://www.sec.gov/news/speech/daly-remarks-2026");
      expect(map.get("NoUrl2024-aa")!.url).toBeUndefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("extracts author and year fields", async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const tmpDir = "/tmp/cite-check-author-parse-test";
    const bibPath = join(tmpDir, "test.bib");
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(bibPath, `
@article{Hu2024-bm,
  author = {Hu, Edwin and Smith, John},
  title = {{Custom proxy voting advice}},
  year = {2024}
}

@misc{Copland2024-mi,
  author = {Copland, James R.},
  title = {{Index Funds Have Too Much Voting Power}},
  date = {2024-03-15}
}

@article{NoAuthor2024-aa,
  title = {{No author}},
  year = {2024}
}
`);
      const map = parseBibFile(bibPath);
      expect(map.get("Hu2024-bm")!.author).toBe("Hu");
      expect(map.get("Hu2024-bm")!.year).toBe("2024");
      expect(map.get("Copland2024-mi")!.author).toBe("Copland");
      expect(map.get("Copland2024-mi")!.year).toBe("2024"); // from date field
      expect(map.get("NoAuthor2024-aa")!.author).toBeUndefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("File Search Store CRUD", () => {
  const tmpDir = "/tmp/cite-check-store-crud-test";

  afterEach(async () => {
    const { rmSync } = await import("node:fs");
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("computeSourceHash is deterministic for same inputs", () => {
    const bibMap = new Map<string, BibEntry>([
      ["Alpha2024-aa", { bibkey: "Alpha2024-aa", filePath: "/path/a.pdf" }],
      ["Beta2024-bb", { bibkey: "Beta2024-bb", filePath: "/path/b.pdf" }],
    ]);
    const bibkeys = ["Beta2024-bb", "Alpha2024-aa"];

    const hash1 = computeSourceHash(bibMap, bibkeys);
    const hash2 = computeSourceHash(bibMap, bibkeys);

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // SHA-256 hex
  });

  it("computeSourceHash changes when a bibkey is added or removed", () => {
    const bibMap = new Map<string, BibEntry>([
      ["Alpha2024-aa", { bibkey: "Alpha2024-aa", filePath: "/path/a.pdf" }],
      ["Beta2024-bb", { bibkey: "Beta2024-bb", filePath: "/path/b.pdf" }],
      ["Gamma2024-cc", { bibkey: "Gamma2024-cc", filePath: "/path/c.pdf" }],
    ]);

    const hash2keys = computeSourceHash(bibMap, ["Alpha2024-aa", "Beta2024-bb"]);
    const hash3keys = computeSourceHash(bibMap, ["Alpha2024-aa", "Beta2024-bb", "Gamma2024-cc"]);
    const hashDiffOrder = computeSourceHash(bibMap, ["Beta2024-bb", "Alpha2024-aa"]);

    expect(hash2keys).not.toBe(hash3keys); // different bibkeys
    expect(hash2keys).toBe(hashDiffOrder); // order-independent (sorted)
  });

  it("loadStoreState returns null for missing file", () => {
    const result = loadStoreState("/tmp/nonexistent-store-state.json");
    expect(result).toBeNull();
  });

  it("saveStoreState and loadStoreState round-trip", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(tmpDir, { recursive: true });
    const statePath = join(tmpDir, "store-state.json");

    const state: StoreState = {
      storeName: "fileSearchStores/abc-123",
      sourceHash: "deadbeef".repeat(8),
      importedBibkeys: ["Alpha2024-aa", "Beta2024-bb"],
      createdAt: Date.now(),
    };

    saveStoreState(statePath, state);
    const loaded = loadStoreState(statePath);

    expect(loaded).not.toBeNull();
    expect(loaded!.storeName).toBe("fileSearchStores/abc-123");
    expect(loaded!.sourceHash).toBe("deadbeef".repeat(8));
    expect(loaded!.importedBibkeys).toEqual(["Alpha2024-aa", "Beta2024-bb"]);
    expect(loaded!.createdAt).toBe(state.createdAt);
  });

  it("createOrReuseStore creates new store when no state exists", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(tmpDir, { recursive: true });
    const statePath = join(tmpDir, "store-state.json");

    const createCalls: any[] = [];
    const mockClient = {
      fileSearchStores: {
        create: async (opts: any) => {
          createCalls.push(opts);
          return { name: "fileSearchStores/new-store-456" };
        },
        delete: async () => {},
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const bibMap = new Map<string, BibEntry>([
      ["Alpha2024-aa", { bibkey: "Alpha2024-aa", filePath: "/path/a.pdf" }],
    ]);

    const result = await createOrReuseStore({
      statePath,
      bibMap,
      citedBibkeys: ["Alpha2024-aa"],
    });

    expect(result.isNew).toBe(true);
    expect(result.storeName).toBe("fileSearchStores/new-store-456");
    expect(createCalls.length).toBe(1);

    // Should have saved state to disk
    const saved = loadStoreState(statePath);
    expect(saved).not.toBeNull();
    expect(saved!.storeName).toBe("fileSearchStores/new-store-456");
  });

  it("createOrReuseStore reuses store when hash matches", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(tmpDir, { recursive: true });
    const statePath = join(tmpDir, "store-state.json");

    const bibMap = new Map<string, BibEntry>([
      ["Alpha2024-aa", { bibkey: "Alpha2024-aa", filePath: "/path/a.pdf" }],
    ]);
    const citedBibkeys = ["Alpha2024-aa"];

    // Pre-save state with matching hash
    const hash = computeSourceHash(bibMap, citedBibkeys);
    const existingState: StoreState = {
      storeName: "fileSearchStores/existing-789",
      sourceHash: hash,
      importedBibkeys: ["Alpha2024-aa"],
      createdAt: Date.now() - 60000,
    };
    saveStoreState(statePath, existingState);

    const createCalls: any[] = [];
    const mockClient = {
      fileSearchStores: {
        create: async (opts: any) => {
          createCalls.push(opts);
          return { name: "fileSearchStores/should-not-be-created" };
        },
        delete: async () => {},
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const result = await createOrReuseStore({
      statePath,
      bibMap,
      citedBibkeys,
    });

    expect(result.isNew).toBe(false);
    expect(result.storeName).toBe("fileSearchStores/existing-789");
    expect(createCalls.length).toBe(0); // should NOT have called create
  });

  it("createOrReuseStore recreates store when hash differs", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(tmpDir, { recursive: true });
    const statePath = join(tmpDir, "store-state.json");

    // Pre-save state with old hash
    const existingState: StoreState = {
      storeName: "fileSearchStores/old-store-111",
      sourceHash: "oldhash".repeat(9).slice(0, 64),
      importedBibkeys: ["Old2024-aa"],
      createdAt: Date.now() - 120000,
    };
    saveStoreState(statePath, existingState);

    const createCalls: any[] = [];
    const deleteCalls: any[] = [];
    const mockClient = {
      fileSearchStores: {
        create: async (opts: any) => {
          createCalls.push(opts);
          return { name: "fileSearchStores/new-store-222" };
        },
        delete: async (opts: any) => {
          deleteCalls.push(opts);
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const bibMap = new Map<string, BibEntry>([
      ["Alpha2024-aa", { bibkey: "Alpha2024-aa", filePath: "/path/a.pdf" }],
      ["Beta2024-bb", { bibkey: "Beta2024-bb", filePath: "/path/b.pdf" }],
    ]);

    const result = await createOrReuseStore({
      statePath,
      bibMap,
      citedBibkeys: ["Alpha2024-aa", "Beta2024-bb"],
    });

    expect(result.isNew).toBe(true);
    expect(result.storeName).toBe("fileSearchStores/new-store-222");
    // Should have deleted old store
    expect(deleteCalls.length).toBe(1);
    expect(deleteCalls[0].name).toBe("fileSearchStores/old-store-111");
    // Should have created new store
    expect(createCalls.length).toBe(1);
  });

  it("deleteStore swallows errors when store is already gone", async () => {
    const mockClient = {
      fileSearchStores: {
        create: async () => ({ name: "fileSearchStores/x" }),
        delete: async () => {
          throw new Error("NOT_FOUND: store already deleted");
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    // Should NOT throw
    await expect(deleteStore("fileSearchStores/gone-store")).resolves.toBeUndefined();
  });
});

describe("File Search Store Import", () => {
  const tmpDir = "/tmp/cite-check-store-import-test";

  afterEach(async () => {
    const { rmSync } = await import("node:fs");
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("uploads files with correct metadata", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "paper.pdf"), "fake-pdf-content");

    const uploadCalls: any[] = [];
    const mockClient = {
      fileSearchStores: {
        uploadToFileSearchStore: async (opts: any) => {
          uploadCalls.push(opts);
          return { done: true };
        },
      },
      operations: {
        get: async () => ({ done: true }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const bibMap = new Map<string, BibEntry>([
      ["Author2024-aa", {
        bibkey: "Author2024-aa",
        filePath: join(tmpDir, "paper.pdf"),
        author: "Author",
        year: "2024",
      }],
    ]);

    const result = await importToStore({
      storeName: "fileSearchStores/test-store",
      bibMap,
      citedBibkeys: ["Author2024-aa"],
    });

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.missing).toBe(0);
    expect(uploadCalls.length).toBe(1);
    expect(uploadCalls[0].fileSearchStoreName).toBe("fileSearchStores/test-store");
    expect(uploadCalls[0].config.displayName).toBe("Author2024-aa");
    expect(uploadCalls[0].config.mimeType).toBe("application/pdf");
    expect(uploadCalls[0].config.customMetadata).toEqual([
      { key: "bibkey", stringValue: "Author2024-aa" },
      { key: "author", stringValue: "Author" },
      { key: "year", numericValue: 2024 },
    ]);
  });

  it("skips already imported bibkeys", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "paper.pdf"), "fake-pdf-content");

    const uploadCalls: any[] = [];
    const mockClient = {
      fileSearchStores: {
        uploadToFileSearchStore: async (opts: any) => {
          uploadCalls.push(opts);
          return { done: true };
        },
      },
      operations: {
        get: async () => ({ done: true }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const bibMap = new Map<string, BibEntry>([
      ["Already2024-aa", {
        bibkey: "Already2024-aa",
        filePath: join(tmpDir, "paper.pdf"),
        author: "Already",
        year: "2024",
      }],
      ["New2024-bb", {
        bibkey: "New2024-bb",
        filePath: join(tmpDir, "paper.pdf"),
        author: "New",
        year: "2024",
      }],
    ]);

    const result = await importToStore({
      storeName: "fileSearchStores/test-store",
      bibMap,
      citedBibkeys: ["Already2024-aa", "New2024-bb"],
      alreadyImported: ["Already2024-aa"],
    });

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.missing).toBe(0);
    expect(uploadCalls.length).toBe(1);
    expect(uploadCalls[0].config.displayName).toBe("New2024-bb");
  });

  it("counts missing files (no path resolves)", async () => {
    const uploadCalls: any[] = [];
    const mockClient = {
      fileSearchStores: {
        uploadToFileSearchStore: async (opts: any) => {
          uploadCalls.push(opts);
          return { done: true };
        },
      },
      operations: {
        get: async () => ({ done: true }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const bibMap = new Map<string, BibEntry>([
      ["Missing2024-aa", {
        bibkey: "Missing2024-aa",
        filePath: "/nonexistent/path/paper.pdf",
        fileRelPath: "path/paper.pdf",
        author: "Missing",
        year: "2024",
      }],
    ]);

    const result = await importToStore({
      storeName: "fileSearchStores/test-store",
      bibMap,
      citedBibkeys: ["Missing2024-aa"],
    });

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.missing).toBe(1);
    expect(uploadCalls.length).toBe(0);
  });

  it("detects MIME type from file extension", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "doc.md"), "# Markdown content");
    writeFileSync(join(tmpDir, "paper.pdf"), "fake-pdf");

    const uploadCalls: any[] = [];
    const mockClient = {
      fileSearchStores: {
        uploadToFileSearchStore: async (opts: any) => {
          uploadCalls.push(opts);
          return { done: true };
        },
      },
      operations: {
        get: async () => ({ done: true }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const bibMap = new Map<string, BibEntry>([
      ["MdSource2024-aa", {
        bibkey: "MdSource2024-aa",
        filePath: join(tmpDir, "doc.md"),
        author: "Md",
        year: "2024",
      }],
      ["PdfSource2024-bb", {
        bibkey: "PdfSource2024-bb",
        filePath: join(tmpDir, "paper.pdf"),
        author: "Pdf",
        year: "2024",
      }],
    ]);

    const result = await importToStore({
      storeName: "fileSearchStores/test-store",
      bibMap,
      citedBibkeys: ["MdSource2024-aa", "PdfSource2024-bb"],
    });

    expect(result.imported).toBe(2);
    // Find the md upload
    const mdCall = uploadCalls.find((c: any) => c.config.displayName === "MdSource2024-aa");
    const pdfCall = uploadCalls.find((c: any) => c.config.displayName === "PdfSource2024-bb");
    expect(mdCall.config.mimeType).toBe("text/markdown");
    expect(pdfCall.config.mimeType).toBe("application/pdf");
  });

  it("waits for operation to complete when not immediately done", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "paper.pdf"), "fake-pdf");

    let opGetCalls = 0;
    const mockClient = {
      fileSearchStores: {
        uploadToFileSearchStore: async () => {
          return { done: false, name: "operations/op-123" };
        },
      },
      operations: {
        get: async () => {
          opGetCalls++;
          if (opGetCalls >= 2) {
            return { done: true };
          }
          return { done: false, name: "operations/op-123" };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const bibMap = new Map<string, BibEntry>([
      ["Slow2024-aa", {
        bibkey: "Slow2024-aa",
        filePath: join(tmpDir, "paper.pdf"),
        author: "Slow",
        year: "2024",
      }],
    ]);

    const result = await importToStore({
      storeName: "fileSearchStores/test-store",
      bibMap,
      citedBibkeys: ["Slow2024-aa"],
      _pollIntervalMs: 10, // speed up test
    });

    expect(result.imported).toBe(1);
    expect(opGetCalls).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// queryCitationFileSearch tests
// ---------------------------------------------------------------------------

describe("buildMetadataFilter", () => {
  it("builds single bibkey filter", () => {
    const filter = buildMetadataFilter(["Hu2024-bm"]);
    expect(filter).toBe('bibkey="Hu2024-bm"');
  });

  it("builds compound bibkey filter with OR", () => {
    const filter = buildMetadataFilter(["AuthorA2020-xx", "AuthorB2021-yy"]);
    expect(filter).toBe('bibkey="AuthorA2020-xx" OR bibkey="AuthorB2021-yy"');
  });

  it("builds three bibkey filter with OR", () => {
    const filter = buildMetadataFilter(["A", "B", "C"]);
    expect(filter).toBe('bibkey="A" OR bibkey="B" OR bibkey="C"');
  });
});

describe("queryCitationFileSearch", () => {
  it("sends fileSearch tool config with storeName and metadataFilter", async () => {
    const generateCalls: any[] = [];
    const mockClient = {
      models: {
        generateContent: async (opts: any) => {
          generateCalls.push(opts);
          return {
            text: JSON.stringify({ status: "SUPPORTED", supporting_passage: "quote", explanation: "ok" }),
            candidates: [{
              groundingMetadata: {
                groundingChunks: [],
              },
            }],
          };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    await queryCitationFileSearch({
      storeName: "fileSearchStores/my-store-123",
      bibkeys: ["Hu2024-bm"],
      prompt: "Does this source support the claim?",
    });

    expect(generateCalls.length).toBe(1);
    const call = generateCalls[0];
    expect(call.config.tools[0].fileSearch.fileSearchStoreNames).toEqual(["fileSearchStores/my-store-123"]);
    expect(call.config.tools[0].fileSearch.metadataFilter).toBe('bibkey="Hu2024-bm"');
  });

  it("sends compound metadata filter for multiple bibkeys", async () => {
    const generateCalls: any[] = [];
    const mockClient = {
      models: {
        generateContent: async (opts: any) => {
          generateCalls.push(opts);
          return {
            text: JSON.stringify({ status: "SUPPORTED", supporting_passage: "both sources", explanation: "confirmed" }),
            candidates: [{ groundingMetadata: { groundingChunks: [] } }],
          };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    await queryCitationFileSearch({
      storeName: "fileSearchStores/store-456",
      bibkeys: ["AuthorA2020-xx", "AuthorB2021-yy"],
      prompt: "Do both support this?",
    });

    expect(generateCalls.length).toBe(1);
    const call = generateCalls[0];
    expect(call.config.tools[0].fileSearch.metadataFilter).toBe('bibkey="AuthorA2020-xx" OR bibkey="AuthorB2021-yy"');
  });

  it("parses structured JSON response", async () => {
    const mockClient = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            status: "SUPPORTED",
            supporting_passage: "The data shows p < 0.01",
            explanation: "Statistical evidence supports the claim",
          }),
          candidates: [{ groundingMetadata: { groundingChunks: [] } }],
        }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const result = await queryCitationFileSearch({
      storeName: "fileSearchStores/store-789",
      bibkeys: ["Hu2024-bm"],
      prompt: "test prompt",
    });

    expect(result.classification.status).toBe("SUPPORTED");
    expect(result.classification.supporting_passage).toBe("The data shows p < 0.01");
    expect(result.classification.explanation).toBe("Statistical evidence supports the claim");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("extracts grounding chunks from response", async () => {
    const mockChunks = [
      {
        retrievedContext: {
          text: "retrieved chunk text about proxy voting",
          title: "Hu2024.pdf",
          customMetadata: [{ key: "bibkey", stringValue: "Hu2024-bm" }],
        },
      },
    ];
    const mockClient = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({ status: "SUPPORTED", supporting_passage: "quote", explanation: "ok" }),
          candidates: [{
            groundingMetadata: {
              groundingChunks: mockChunks,
            },
          }],
        }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const result = await queryCitationFileSearch({
      storeName: "fileSearchStores/store-abc",
      bibkeys: ["Hu2024-bm"],
      prompt: "test prompt",
    });

    expect(result.groundingChunks).toEqual(mockChunks);
  });

  it("retries UNSUPPORTED with retryModel and overturns", async () => {
    let callIdx = 0;
    const calls: any[] = [];
    const mockClient = {
      models: {
        generateContent: async (opts: any) => {
          calls.push(opts);
          callIdx++;
          if (callIdx === 1) {
            return {
              text: JSON.stringify({ status: "UNSUPPORTED", supporting_passage: "", explanation: "not found" }),
              candidates: [{ groundingMetadata: { groundingChunks: [] } }],
            };
          }
          return {
            text: JSON.stringify({ status: "SUPPORTED", supporting_passage: "found it", explanation: "retry found" }),
            candidates: [{
              groundingMetadata: {
                groundingChunks: [{ retrievedContext: { text: "chunk", title: "source.pdf" } }],
              },
            }],
          };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const result = await queryCitationFileSearch({
      storeName: "fileSearchStores/store-retry",
      bibkeys: ["Hu2024-bm"],
      prompt: "test prompt",
      retryModel: "gemini-2.5-flash",
    });

    expect(calls.length).toBe(2);
    expect(calls[0].model).toBe("gemini-3.1-flash-lite-preview"); // primary default
    expect(calls[1].model).toBe("gemini-2.5-flash"); // retry model
    expect(result.classification.status).toBe("SUPPORTED");
    expect(result.classification.supporting_passage).toBe("found it");
    expect(result.groundingChunks).toHaveLength(1);
  });

  it("uses responseJsonSchema in config", async () => {
    const generateCalls: any[] = [];
    const mockClient = {
      models: {
        generateContent: async (opts: any) => {
          generateCalls.push(opts);
          return {
            text: JSON.stringify({ status: "SUPPORTED", supporting_passage: "q", explanation: "e" }),
            candidates: [{ groundingMetadata: { groundingChunks: [] } }],
          };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    await queryCitationFileSearch({
      storeName: "fileSearchStores/store-schema",
      bibkeys: ["Hu2024-bm"],
      prompt: "test",
    });

    expect(generateCalls.length).toBe(1);
    const call = generateCalls[0];
    expect(call.config.responseJsonSchema).toBeDefined();
    expect(call.config.responseJsonSchema.properties.status).toBeDefined();
    expect(call.config.responseJsonSchema.properties.supporting_passage).toBeDefined();
    expect(call.config.responseJsonSchema.properties.explanation).toBeDefined();
    expect(call.config.responseMimeType).toBe("application/json");
  });

  it("only sends text part (no fileData parts)", async () => {
    const generateCalls: any[] = [];
    const mockClient = {
      models: {
        generateContent: async (opts: any) => {
          generateCalls.push(opts);
          return {
            text: JSON.stringify({ status: "SUPPORTED", supporting_passage: "q", explanation: "e" }),
            candidates: [{ groundingMetadata: { groundingChunks: [] } }],
          };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    await queryCitationFileSearch({
      storeName: "fileSearchStores/store-text-only",
      bibkeys: ["Hu2024-bm"],
      prompt: "check this claim",
    });

    const call = generateCalls[0];
    // Only one part: the text prompt (no fileData)
    expect(call.contents[0].parts.length).toBe(1);
    expect(call.contents[0].parts[0].text).toBe("check this claim");
    expect(call.contents[0].parts[0].fileData).toBeUndefined();
  });
});

describe("submitBatchFileSearch", () => {
  it("submits batch with fileSearch tool config per request", async () => {
    const createCalls: any[] = [];
    const mockClient = {
      batches: {
        create: async (opts: any) => {
          createCalls.push(opts);
          return {
            name: "batches/test-123",
            state: "JOB_STATE_SUCCEEDED",
            dest: {
              inlinedResponses: [
                {
                  metadata: { key: "q1" },
                  response: {
                    candidates: [{
                      content: { parts: [{ text: JSON.stringify({ status: "SUPPORTED", supporting_passage: "p1", explanation: "e1" }) }] },
                      groundingMetadata: { groundingChunks: [] },
                    }],
                  },
                },
              ],
            },
          };
        },
        get: async () => ({ state: "JOB_STATE_SUCCEEDED" }),
      },
      models: { generateContent: async () => ({}) },
    };
    __setGeminiClientForTesting(mockClient as any);

    await submitBatchFileSearch(
      [{ key: "q1", bibkeys: ["Hu2024-bm"], prompt: "check claim" }],
      { storeName: "fileSearchStores/store-1" },
    );

    expect(createCalls.length).toBe(1);
    const src = createCalls[0].src;
    expect(src.length).toBe(1);
    expect(src[0].config.tools[0].fileSearch.fileSearchStoreNames).toEqual(["fileSearchStores/store-1"]);
    expect(src[0].config.tools[0].fileSearch.metadataFilter).toBe('bibkey="Hu2024-bm"');
    expect(src[0].contents[0].parts[0].text).toBe("check claim");
  });

  it("passes responseJsonSchema and responseMimeType in per-request config", async () => {
    const createCalls: any[] = [];
    const mockClient = {
      batches: {
        create: async (opts: any) => {
          createCalls.push(opts);
          return {
            name: "batches/test-schema",
            state: "JOB_STATE_SUCCEEDED",
            dest: {
              inlinedResponses: [
                {
                  metadata: { key: "q1" },
                  response: {
                    candidates: [{
                      content: { parts: [{ text: JSON.stringify({ status: "SUPPORTED", supporting_passage: "p", explanation: "e" }) }] },
                      groundingMetadata: { groundingChunks: [] },
                    }],
                  },
                },
              ],
            },
          };
        },
        get: async () => ({ state: "JOB_STATE_SUCCEEDED" }),
      },
      models: { generateContent: async () => ({}) },
    };
    __setGeminiClientForTesting(mockClient as any);

    await submitBatchFileSearch(
      [{ key: "q1", bibkeys: ["Hu2024-bm"], prompt: "check claim" }],
      { storeName: "fileSearchStores/store-schema-check" },
    );

    expect(createCalls.length).toBe(1);
    const src = createCalls[0].src;
    expect(src.length).toBe(1);
    // Schema enforcement must be on the per-request config (not just the top-level batch config)
    // so Gemini enforces structured output on each individual request.
    expect(src[0].config.responseMimeType).toBe("application/json");
    expect(src[0].config.responseJsonSchema).toBeDefined();
    expect(src[0].config.responseJsonSchema.properties.status).toBeDefined();
    expect(src[0].config.responseJsonSchema.properties.supporting_passage).toBeDefined();
    expect(src[0].config.responseJsonSchema.properties.explanation).toBeDefined();
    expect(src[0].config.responseJsonSchema.required).toContain("status");
    expect(src[0].config.responseJsonSchema.required).toContain("supporting_passage");
    expect(src[0].config.responseJsonSchema.required).toContain("explanation");
    // Must NOT use responseSchema (Type-enum form) — batch path must use responseJsonSchema
    expect(src[0].config.responseSchema).toBeUndefined();
  });

  it("uses different metadataFilter per request", async () => {
    const createCalls: any[] = [];
    const mockClient = {
      batches: {
        create: async (opts: any) => {
          createCalls.push(opts);
          return {
            name: "batches/test-456",
            state: "JOB_STATE_SUCCEEDED",
            dest: {
              inlinedResponses: [
                {
                  metadata: { key: "q1" },
                  response: {
                    candidates: [{
                      content: { parts: [{ text: JSON.stringify({ status: "SUPPORTED", supporting_passage: "p1", explanation: "e1" }) }] },
                      groundingMetadata: { groundingChunks: [] },
                    }],
                  },
                },
                {
                  metadata: { key: "q2" },
                  response: {
                    candidates: [{
                      content: { parts: [{ text: JSON.stringify({ status: "PARTIAL", supporting_passage: "p2", explanation: "e2" }) }] },
                      groundingMetadata: { groundingChunks: [] },
                    }],
                  },
                },
              ],
            },
          };
        },
        get: async () => ({ state: "JOB_STATE_SUCCEEDED" }),
      },
      models: { generateContent: async () => ({}) },
    };
    __setGeminiClientForTesting(mockClient as any);

    await submitBatchFileSearch(
      [
        { key: "q1", bibkeys: ["Hu2024-bm"], prompt: "claim 1" },
        { key: "q2", bibkeys: ["Smith2020-ab", "Jones2021-cd"], prompt: "claim 2" },
      ],
      { storeName: "fileSearchStores/store-2" },
    );

    const src = createCalls[0].src;
    expect(src[0].config.tools[0].fileSearch.metadataFilter).toBe('bibkey="Hu2024-bm"');
    expect(src[1].config.tools[0].fileSearch.metadataFilter).toBe('bibkey="Smith2020-ab" OR bibkey="Jones2021-cd"');
  });

  it("parses successful batch responses into ClassifyResult", async () => {
    const mockClient = {
      batches: {
        create: async () => ({
          name: "batches/test-parse",
          state: "JOB_STATE_SUCCEEDED",
          dest: {
            inlinedResponses: [
              {
                metadata: { key: "q1" },
                response: {
                  candidates: [{
                    content: { parts: [{ text: JSON.stringify({ status: "SUPPORTED", supporting_passage: "found it", explanation: "matches" }) }] },
                    groundingMetadata: { groundingChunks: [] },
                  }],
                },
              },
              {
                metadata: { key: "q2" },
                response: {
                  candidates: [{
                    content: { parts: [{ text: JSON.stringify({ status: "UNSUPPORTED", supporting_passage: "", explanation: "not found" }) }] },
                    groundingMetadata: { groundingChunks: [] },
                  }],
                },
              },
            ],
          },
        }),
        get: async () => ({ state: "JOB_STATE_SUCCEEDED" }),
      },
      models: { generateContent: async () => ({}) },
    };
    __setGeminiClientForTesting(mockClient as any);

    const results = await submitBatchFileSearch(
      [
        { key: "q1", bibkeys: ["A"], prompt: "p1" },
        { key: "q2", bibkeys: ["B"], prompt: "p2" },
      ],
      { storeName: "fileSearchStores/store-3" },
    );

    expect(results.length).toBe(2);
    expect(results[0].key).toBe("q1");
    expect(results[0].classification.status).toBe("SUPPORTED");
    expect(results[0].classification.supporting_passage).toBe("found it");
    expect(results[0].classification.explanation).toBe("matches");
    expect(results[1].key).toBe("q2");
    expect(results[1].classification.status).toBe("UNSUPPORTED");
    expect(results[1].classification.explanation).toBe("not found");
  });

  it("extracts grounding chunks from batch responses", async () => {
    const mockClient = {
      batches: {
        create: async () => ({
          name: "batches/test-grounding",
          state: "JOB_STATE_SUCCEEDED",
          dest: {
            inlinedResponses: [
              {
                metadata: { key: "q1" },
                response: {
                  candidates: [{
                    content: { parts: [{ text: JSON.stringify({ status: "SUPPORTED", supporting_passage: "p", explanation: "e" }) }] },
                    groundingMetadata: {
                      groundingChunks: [
                        { retrievedContext: { text: "chunk1", title: "source1.pdf" } },
                        { retrievedContext: { text: "chunk2", title: "source2.pdf" } },
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
      models: { generateContent: async () => ({}) },
    };
    __setGeminiClientForTesting(mockClient as any);

    const results = await submitBatchFileSearch(
      [{ key: "q1", bibkeys: ["A"], prompt: "p" }],
      { storeName: "fileSearchStores/store-4" },
    );

    expect(results[0].groundingChunks).toBeDefined();
    expect(results[0].groundingChunks).toHaveLength(2);
    expect(results[0].groundingChunks![0]).toEqual({ retrievedContext: { text: "chunk1", title: "source1.pdf" } });
  });

  it("retries parse failures via concurrent queryCitationFileSearch", async () => {
    const generateCalls: any[] = [];
    const mockClient = {
      batches: {
        create: async () => ({
          name: "batches/test-retry",
          state: "JOB_STATE_SUCCEEDED",
          dest: {
            inlinedResponses: [
              {
                metadata: { key: "q1" },
                response: {
                  candidates: [{
                    content: { parts: [{ text: JSON.stringify({ status: "SUPPORTED", supporting_passage: "ok", explanation: "good" }) }] },
                    groundingMetadata: { groundingChunks: [] },
                  }],
                },
              },
              {
                metadata: { key: "q2" },
                response: {
                  candidates: [{
                    content: { parts: [{ text: "not valid json at all {{" }] },
                    groundingMetadata: { groundingChunks: [] },
                  }],
                },
              },
            ],
          },
        }),
        get: async () => ({ state: "JOB_STATE_SUCCEEDED" }),
      },
      models: {
        generateContent: async (opts: any) => {
          generateCalls.push(opts);
          return {
            text: JSON.stringify({ status: "PARTIAL", supporting_passage: "retry-p", explanation: "retry-e" }),
            candidates: [{ groundingMetadata: { groundingChunks: [{ retrievedContext: { text: "retry-chunk" } }] } }],
          };
        },
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const results = await submitBatchFileSearch(
      [
        { key: "q1", bibkeys: ["A"], prompt: "claim 1" },
        { key: "q2", bibkeys: ["B", "C"], prompt: "claim 2" },
      ],
      { storeName: "fileSearchStores/store-5" },
    );

    // q1 should succeed from batch
    expect(results[0].key).toBe("q1");
    expect(results[0].classification.status).toBe("SUPPORTED");

    // q2 should have been retried via queryCitationFileSearch
    expect(generateCalls.length).toBe(1);
    expect(results[1].key).toBe("q2");
    expect(results[1].classification.status).toBe("PARTIAL");
    expect(results[1].classification.supporting_passage).toBe("retry-p");
  });

  it("handles batch errors gracefully", async () => {
    const mockClient = {
      batches: {
        create: async () => ({
          name: "batches/test-errors",
          state: "JOB_STATE_SUCCEEDED",
          dest: {
            inlinedResponses: [
              {
                metadata: { key: "q1" },
                error: { code: 500, message: "Internal error" },
              },
            ],
          },
        }),
        get: async () => ({ state: "JOB_STATE_SUCCEEDED" }),
      },
      models: { generateContent: async () => ({}) },
    };
    __setGeminiClientForTesting(mockClient as any);

    const results = await submitBatchFileSearch(
      [{ key: "q1", bibkeys: ["A"], prompt: "p" }],
      { storeName: "fileSearchStores/store-6" },
    );

    expect(results.length).toBe(1);
    expect(results[0].key).toBe("q1");
    expect(results[0].classification.status).toBe("ERROR");
    expect(results[0].error).toBeDefined();
  });
});

// Type-level checks: ensure exported types are usable
const _storeState: StoreState = {
  storeName: "fileSearchStores/x",
  sourceHash: "abc",
  importedBibkeys: ["k"],
  createdAt: 0,
};
void _storeState;

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
const _bibEntryFull: BibEntry = { bibkey: "k", filePath: "/p", title: "T", url: "https://example.com" };

// FileSearchBatchRequest / FileSearchBatchResult type checks
const _fsBatchReq: FileSearchBatchRequest = { key: "k", bibkeys: ["A"], prompt: "p" };
const _fsBatchResult: FileSearchBatchResult = {
  key: "k",
  classification: { status: "SUPPORTED", supporting_passage: "p", explanation: "e" },
  groundingChunks: [{ retrievedContext: { text: "chunk" } }],
};

// Suppress unused-variable warnings -- these are compile-time type checks
void _status;
void _classify;
void _fileRef;
void _bibEntry;
void _bibEntryFull;
void _fsBatchReq;
void _fsBatchResult;
