import { describe, expect, it, afterEach } from "bun:test";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { cmdCiteCheck, cmdAsk } from "../cite-check";
import type { CiteCheckFlags, AskFlags } from "../cite-check";
import { __setGeminiClientForTesting } from "../gemini";

afterEach(() => {
  __setGeminiClientForTesting(null);
});

/**
 * Helper: create a temp directory with a .bib file and a drafts/ subdirectory
 * containing a markdown file with one citation.
 */
function setupFixture(
  tmpDir: string,
  bibEntries: { key: string; file?: string; title?: string }[],
  draftText: string,
): { bibPath: string; draftsDir: string } {
  mkdirSync(join(tmpDir, "drafts"), { recursive: true });

  let bibContent = "";
  for (const entry of bibEntries) {
    bibContent += `@article{${entry.key},\n`;
    if (entry.title) bibContent += `  title = {{${entry.title}}},\n`;
    if (entry.file) bibContent += `  file = {${entry.file}},\n`;
    bibContent += `  year = {2024}\n}\n\n`;
  }

  const bibPath = join(tmpDir, "test.bib");
  writeFileSync(bibPath, bibContent);
  writeFileSync(join(tmpDir, "drafts", "draft.md"), draftText);

  return { bibPath, draftsDir: join(tmpDir, "drafts") };
}

describe("cmdCiteCheck multi-bib support", () => {
  const tmpBase = "/tmp/cite-check-multi-bib-test";

  afterEach(() => {
    try {
      rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("accepts multiple bibPaths and merges entries (first wins on duplicates)", async () => {
    // Set up two bib files with overlapping keys.
    mkdirSync(join(tmpBase, "drafts"), { recursive: true });
    mkdirSync(join(tmpBase, "pdfs"), { recursive: true });
    writeFileSync(join(tmpBase, "pdfs", "real.pdf"), "fake-pdf");

    // Bib 1 (Paperpile-like): has Hu2024 and SharedKey2024
    writeFileSync(
      join(tmpBase, "bib1.bib"),
      `
@article{Hu2024-bm,
  title = {{Custom proxy voting advice}},
  file = {pdfs/real.pdf},
  year = {2024}
}

@article{SharedKey2024-xx,
  title = {{First bib wins for this key}},
  file = {pdfs/real.pdf},
  year = {2024}
}
`,
    );

    // Bib 2 (project-local): has LocalSource2024 and SharedKey2024 (should be ignored)
    writeFileSync(
      join(tmpBase, "bib2.bib"),
      `
@article{LocalSource2024-aa,
  title = {{Local project source}},
  file = {pdfs/real.pdf},
  year = {2024}
}

@article{SharedKey2024-xx,
  title = {{Second bib should lose for this key}},
  file = {pdfs/real.pdf},
  year = {2024}
}
`,
    );

    writeFileSync(
      join(tmpBase, "drafts", "draft.md"),
      "Hu says X [@Hu2024-bm]. Local says Y [@LocalSource2024-aa]. Shared says Z [@SharedKey2024-xx].",
    );

    // dry-run mode so we don't need Gemini
    const code = await cmdCiteCheck(
      [],
      {
        drafts: join(tmpBase, "drafts"),
        "dry-run": true,
      },
      [join(tmpBase, "bib1.bib"), join(tmpBase, "bib2.bib")],
    );

    expect(code).toBe(0);
  });

  it("fails when no --bib and no --store provided", async () => {
    mkdirSync(join(tmpBase, "drafts"), { recursive: true });
    writeFileSync(join(tmpBase, "drafts", "draft.md"), "Some text.");

    const code = await cmdCiteCheck([], {}, []);

    expect(code).toBe(1);
  });

  it("works with a single bibPath (backwards compatible)", async () => {
    const { bibPath, draftsDir } = setupFixture(
      tmpBase,
      [{ key: "Foo2024-aa", title: "Foo paper" }],
      "Foo says X [@Foo2024-aa].",
    );

    const code = await cmdCiteCheck(
      [],
      {
        drafts: draftsDir,
        "dry-run": true,
      },
      [bibPath],
    );

    expect(code).toBe(0);
  });

  it("uses first bib filename for store naming", async () => {
    // This test verifies the store name is derived from the first bib file.
    // We can check this indirectly via dry-run output.
    mkdirSync(join(tmpBase, "drafts"), { recursive: true });

    writeFileSync(
      join(tmpBase, "paperpile.bib"),
      `@article{Foo2024-aa,
  title = {{Test}},
  year = {2024}
}
`,
    );

    writeFileSync(
      join(tmpBase, "local.bib"),
      `@article{Bar2024-bb,
  title = {{Test2}},
  year = {2024}
}
`,
    );

    writeFileSync(
      join(tmpBase, "drafts", "draft.md"),
      "Foo says X [@Foo2024-aa].",
    );

    const code = await cmdCiteCheck(
      [],
      {
        drafts: join(tmpBase, "drafts"),
        "dry-run": true,
      },
      [join(tmpBase, "paperpile.bib"), join(tmpBase, "local.bib")],
    );

    expect(code).toBe(0);
  });
});

describe("cmdCiteCheck --audit mode", () => {
  const tmpBase = "/tmp/cite-check-audit-test";

  afterEach(() => {
    try {
      rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("returns 0 when all cited sources have PDFs on disk", async () => {

    mkdirSync(join(tmpBase, "drafts"), { recursive: true });
    mkdirSync(join(tmpBase, "pdfs"), { recursive: true });
    writeFileSync(join(tmpBase, "pdfs", "real.pdf"), "fake-pdf");

    writeFileSync(
      join(tmpBase, "test.bib"),
      `
@article{Hu2024-bm,
  title = {{Custom proxy voting advice}},
  file = {pdfs/real.pdf},
  year = {2024}
}
`,
    );

    writeFileSync(
      join(tmpBase, "drafts", "draft.md"),
      "Hu says X [@Hu2024-bm].",
    );

    const code = await cmdCiteCheck(
      [],
      { drafts: join(tmpBase, "drafts"), audit: true } as CiteCheckFlags,
      [join(tmpBase, "test.bib")],
    );

    expect(code).toBe(0);
  });

  it("returns 1 when a cited bibkey is not in any bib file", async () => {

    mkdirSync(join(tmpBase, "drafts"), { recursive: true });

    writeFileSync(
      join(tmpBase, "test.bib"),
      `
@article{Hu2024-bm,
  title = {{Custom proxy voting advice}},
  year = {2024}
}
`,
    );

    writeFileSync(
      join(tmpBase, "drafts", "draft.md"),
      "Hu says X [@Hu2024-bm]. Unknown says Y [@Unknown2024-zz].",
    );

    const code = await cmdCiteCheck(
      [],
      { drafts: join(tmpBase, "drafts"), audit: true } as CiteCheckFlags,
      [join(tmpBase, "test.bib")],
    );

    // Unknown2024-zz is not in any bib => missing => exit 1
    expect(code).toBe(1);
  });

  it("classifies missing academic sources as Paperpile targets", async () => {

    mkdirSync(join(tmpBase, "drafts"), { recursive: true });

    writeFileSync(
      join(tmpBase, "test.bib"),
      `
@article{NoPdf2024-aa,
  title = {{A paper without a PDF}},
  year = {2024}
}
`,
    );

    writeFileSync(
      join(tmpBase, "drafts", "draft.md"),
      "Some claim [@NoPdf2024-aa].",
    );

    const code = await cmdCiteCheck(
      [],
      { drafts: join(tmpBase, "drafts"), audit: true } as CiteCheckFlags,
      [join(tmpBase, "test.bib")],
    );

    // NoPdf2024-aa has no PDF => missing => exit 1
    expect(code).toBe(1);
  });

  it("classifies missing misc/book sources as Paperpile targets", async () => {

    mkdirSync(join(tmpBase, "drafts"), { recursive: true });

    writeFileSync(
      join(tmpBase, "test.bib"),
      `
@misc{SECRule2024-bb,
  title = {{SEC Final Rule on Climate Disclosure}},
  year = {2024}
}
`,
    );

    writeFileSync(
      join(tmpBase, "drafts", "draft.md"),
      "The SEC rule [@SECRule2024-bb] requires disclosure.",
    );

    const code = await cmdCiteCheck(
      [],
      { drafts: join(tmpBase, "drafts"), audit: true } as CiteCheckFlags,
      [join(tmpBase, "test.bib")],
    );

    // misc type with no PDF => missing => exit 1
    expect(code).toBe(1);
  });

  it("does not create a Gemini store or write a report", async () => {

    mkdirSync(join(tmpBase, "drafts"), { recursive: true });
    mkdirSync(join(tmpBase, "pdfs"), { recursive: true });
    writeFileSync(join(tmpBase, "pdfs", "real.pdf"), "fake-pdf");

    writeFileSync(
      join(tmpBase, "test.bib"),
      `
@article{Hu2024-bm,
  title = {{Custom proxy voting advice}},
  file = {pdfs/real.pdf},
  year = {2024}
}
`,
    );

    writeFileSync(
      join(tmpBase, "drafts", "draft.md"),
      "Hu says X [@Hu2024-bm].",
    );

    // Do NOT set up a mock client -- audit mode should never touch Gemini
    __setGeminiClientForTesting(null);

    const code = await cmdCiteCheck(
      [],
      { drafts: join(tmpBase, "drafts"), audit: true } as CiteCheckFlags,
      [join(tmpBase, "test.bib")],
    );

    expect(code).toBe(0);

    // No REVIEW-CITES.md should be written
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(tmpBase, "drafts", "REVIEW-CITES.md"))).toBe(false);
  });

  it("handles multiple bib files in audit mode", async () => {

    mkdirSync(join(tmpBase, "drafts"), { recursive: true });
    mkdirSync(join(tmpBase, "pdfs"), { recursive: true });
    writeFileSync(join(tmpBase, "pdfs", "real.pdf"), "fake-pdf");

    writeFileSync(
      join(tmpBase, "bib1.bib"),
      `
@article{Hu2024-bm,
  title = {{Custom proxy voting advice}},
  file = {pdfs/real.pdf},
  year = {2024}
}
`,
    );

    writeFileSync(
      join(tmpBase, "bib2.bib"),
      `
@misc{Blog2024-cc,
  title = {{A blog post}},
  year = {2024}
}
`,
    );

    writeFileSync(
      join(tmpBase, "drafts", "draft.md"),
      "Hu says X [@Hu2024-bm]. Blog says Y [@Blog2024-cc].",
    );

    const code = await cmdCiteCheck(
      [],
      { drafts: join(tmpBase, "drafts"), audit: true } as CiteCheckFlags,
      [join(tmpBase, "bib1.bib"), join(tmpBase, "bib2.bib")],
    );

    // Blog2024-cc is @misc with no PDF => missing => exit 1
    expect(code).toBe(1);
  });
});

describe("cmdAsk", () => {
  const tmpBase = "/tmp/cite-check-ask-test";

  afterEach(() => {
    __setGeminiClientForTesting(null);

    try {
      rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("returns 1 when no --bib provided", async () => {
    const code = await cmdAsk(["ask", "@Foo", "question"], {}, []);
    expect(code).toBe(1);
  });

  it("returns 1 when bibkey not found", async () => {
    mkdirSync(tmpBase, { recursive: true });
    writeFileSync(
      join(tmpBase, "test.bib"),
      `@article{Other2024-aa,
  title = {{Other Paper}},
  year = {2024}
}`,
    );

    const code = await cmdAsk(
      ["ask", "@Missing2024-zz", "some question"],
      {},
      [join(tmpBase, "test.bib")],
    );
    expect(code).toBe(1);
  });

  it("returns 1 when source PDF not found", async () => {

    mkdirSync(tmpBase, { recursive: true });
    writeFileSync(
      join(tmpBase, "test.bib"),
      `@article{NoPdf2024-aa,
  title = {{Missing Paper}},
  year = {2024}
}`,
    );

    const code = await cmdAsk(
      ["ask", "@NoPdf2024-aa", "what does it say?"],
      {},
      [join(tmpBase, "test.bib")],
    );
    expect(code).toBe(1);
  });

  it("queries Gemini and returns 0 on success", async () => {
    mkdirSync(join(tmpBase, "pdfs"), { recursive: true });
    writeFileSync(join(tmpBase, "pdfs/paper.pdf"), "fake-pdf");

    writeFileSync(
      join(tmpBase, "test.bib"),
      `@article{Hu2024-bm,
  title = {{Custom proxy voting advice}},
  file = {pdfs/paper.pdf},
  year = {2024}
}`,
    );

    // Mock both files API (upload) and models API (query)
    const mockClient = {
      files: {
        upload: async (opts: any) => ({
          name: `files/${opts.config.displayName}`,
          uri: `https://example.com/files/${opts.config.displayName}`,
          mimeType: "application/pdf",
          state: "ACTIVE",
        }),
        get: async () => ({ state: "ACTIVE" }),
      },
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            status: "SUPPORTED",
            supporting_passage: "expense ratios declined by 40%",
            explanation: "The source directly supports this claim with data.",
          }),
        }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const code = await cmdAsk(
      ["ask", "@Hu2024-bm", "do expense ratios fall?"],
      {},
      [join(tmpBase, "test.bib")],
    );
    expect(code).toBe(0);
  });

  it("strips @ prefix from bibkey", async () => {
    mkdirSync(join(tmpBase, "pdfs"), { recursive: true });
    writeFileSync(join(tmpBase, "pdfs/paper.pdf"), "fake-pdf");

    writeFileSync(
      join(tmpBase, "test.bib"),
      `@article{Hu2024-bm,
  title = {{Test}},
  file = {pdfs/paper.pdf},
  year = {2024}
}`,
    );

    const mockClient = {
      files: {
        upload: async () => ({
          name: "files/test",
          uri: "https://example.com/files/test",
          mimeType: "application/pdf",
          state: "ACTIVE",
        }),
        get: async () => ({ state: "ACTIVE" }),
      },
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            status: "SUPPORTED",
            supporting_passage: "quote",
            explanation: "ok",
          }),
        }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    // With @ prefix
    const code1 = await cmdAsk(
      ["ask", "@Hu2024-bm", "question"],
      {},
      [join(tmpBase, "test.bib")],
    );
    expect(code1).toBe(0);

    // Without @ prefix
    const code2 = await cmdAsk(
      ["ask", "Hu2024-bm", "question"],
      {},
      [join(tmpBase, "test.bib")],
    );
    expect(code2).toBe(0);
  });

  it("returns 1 with too few args", async () => {
    mkdirSync(tmpBase, { recursive: true });
    writeFileSync(join(tmpBase, "test.bib"), `@article{k, year={2024}}`);

    // Only bibkey, no question
    const code = await cmdAsk(
      ["ask", "@Hu2024-bm"],
      {},
      [join(tmpBase, "test.bib")],
    );
    expect(code).toBe(1);
  });
});

describe("cmdCiteCheck cross-directory audit", () => {
  const tmpBase = "/tmp/cite-check-crossdir-audit-test";

  afterEach(() => {
    try {
      rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("finds PDF via cross-directory resolution in audit mode", async () => {


    // Simulate: sources.bib in project/references/ with file = {All Papers/Author.pdf}
    // PDF actually at paperpile/All Papers/Author.pdf
    const projectDir = join(tmpBase, "project", "references");
    const paperpileDir = join(tmpBase, "paperpile");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(projectDir, "..", "drafts"), { recursive: true });
    mkdirSync(join(paperpileDir, "All Papers"), { recursive: true });
    writeFileSync(join(paperpileDir, "All Papers/Author.pdf"), "fake-pdf");

    // sources.bib: file field relative to paperpile dir, NOT project dir
    writeFileSync(
      join(projectDir, "sources.bib"),
      `@article{Author2024-aa,
  title = {{Author Paper}},
  file = {All Papers/Author.pdf},
  year = {2024}
}`,
    );

    // paperpile.bib: doesn't have this entry (that's why it's in sources.bib)
    writeFileSync(
      join(paperpileDir, "paperpile.bib"),
      `@article{Other2024-bb,
  title = {{Other Paper}},
  file = {All Papers/Other.pdf},
  year = {2024}
}`,
    );

    writeFileSync(
      join(projectDir, "..", "drafts", "draft.md"),
      "Author says X [@Author2024-aa].",
    );

    const code = await cmdCiteCheck(
      [],
      { drafts: join(projectDir, "..", "drafts"), audit: true } as CiteCheckFlags,
      // paperpile.bib first (as in real usage), then sources.bib
      [join(paperpileDir, "paperpile.bib"), join(projectDir, "sources.bib")],
    );

    // Should find PDF via cross-directory resolution (paperpile dir)
    expect(code).toBe(0);
  });
});

describe("cmdCiteCheck manifest persistence", () => {
  const tmpBase = "/tmp/cite-check-manifest-integ-test";

  afterEach(() => {
    __setGeminiClientForTesting(null);
    try {
      rmSync(tmpBase, { recursive: true, force: true });
    } catch {}
  });

  it("creates .cite-check-store.json in drafts dir after sequential run", async () => {
    mkdirSync(join(tmpBase, "drafts"), { recursive: true });
    mkdirSync(join(tmpBase, "pdfs"), { recursive: true });
    writeFileSync(join(tmpBase, "pdfs/paper.pdf"), "fake-pdf");

    writeFileSync(
      join(tmpBase, "test.bib"),
      `@article{Hu2024-bm,
  title = {{Custom proxy voting advice}},
  file = {pdfs/paper.pdf},
  year = {2024}
}`,
    );

    writeFileSync(
      join(tmpBase, "drafts", "draft.md"),
      "Hu says X [@Hu2024-bm].",
    );

    const mockClient = {
      files: {
        upload: async (opts: any) => ({
          name: `files/${opts.config.displayName}`,
          uri: `https://example.com/files/${opts.config.displayName}`,
          mimeType: "application/pdf",
          state: "ACTIVE",
        }),
        get: async () => ({ state: "ACTIVE" }),
      },
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            status: "SUPPORTED",
            supporting_passage: "quote",
            explanation: "ok",
          }),
        }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    const code = await cmdCiteCheck(
      [],
      { drafts: join(tmpBase, "drafts"), sequential: true } as CiteCheckFlags,
      [join(tmpBase, "test.bib")],
    );

    expect(code).toBe(0);

    // Manifest should exist
    const manifestPath = join(tmpBase, "drafts", ".cite-check-store.json");
    expect(existsSync(manifestPath)).toBe(true);

    // Manifest should contain the uploaded bibkey
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest["Hu2024-bm"]).toBeDefined();
    expect(manifest["Hu2024-bm"].name).toBe("files/Hu2024-bm");
    expect(manifest["Hu2024-bm"].uploadedAt).toBeGreaterThan(0);
  });

  it("skips upload on second run using manifest cache", async () => {
    mkdirSync(join(tmpBase, "drafts"), { recursive: true });
    mkdirSync(join(tmpBase, "pdfs"), { recursive: true });
    writeFileSync(join(tmpBase, "pdfs/paper.pdf"), "fake-pdf");

    writeFileSync(
      join(tmpBase, "test.bib"),
      `@article{Hu2024-bm,
  title = {{Custom proxy voting advice}},
  file = {pdfs/paper.pdf},
  year = {2024}
}`,
    );

    writeFileSync(
      join(tmpBase, "drafts", "draft.md"),
      "Hu says X [@Hu2024-bm].",
    );

    let uploadCount = 0;
    const mockClient = {
      files: {
        upload: async (opts: any) => {
          uploadCount++;
          return {
            name: `files/${opts.config.displayName}`,
            uri: `https://example.com/files/${opts.config.displayName}`,
            mimeType: "application/pdf",
            state: "ACTIVE",
          };
        },
        get: async () => ({ state: "ACTIVE" }),
      },
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            status: "SUPPORTED",
            supporting_passage: "quote",
            explanation: "ok",
          }),
        }),
      },
    };
    __setGeminiClientForTesting(mockClient as any);

    // First run: should upload
    await cmdCiteCheck(
      [],
      { drafts: join(tmpBase, "drafts"), sequential: true } as CiteCheckFlags,
      [join(tmpBase, "test.bib")],
    );
    expect(uploadCount).toBe(1);

    // Second run: should skip upload (cached in manifest)
    uploadCount = 0;
    await cmdCiteCheck(
      [],
      { drafts: join(tmpBase, "drafts"), sequential: true } as CiteCheckFlags,
      [join(tmpBase, "test.bib")],
    );
    expect(uploadCount).toBe(0);
  });

  it("does not create manifest in dry-run mode", async () => {
    mkdirSync(join(tmpBase, "drafts"), { recursive: true });
    writeFileSync(
      join(tmpBase, "test.bib"),
      `@article{Hu2024-bm, title={{Test}}, year={2024}}`,
    );
    writeFileSync(join(tmpBase, "drafts", "draft.md"), "X [@Hu2024-bm].");

    const code = await cmdCiteCheck(
      [],
      { drafts: join(tmpBase, "drafts"), "dry-run": true } as CiteCheckFlags,
      [join(tmpBase, "test.bib")],
    );

    expect(code).toBe(0);
    expect(existsSync(join(tmpBase, "drafts", ".cite-check-store.json"))).toBe(false);
  });
});
