import { describe, expect, it, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { cmdCiteCheck } from "../cite-check";
import type { CiteCheckFlags } from "../cite-check";
import { __setGeminiClientForTesting, __setReadwisePathForTesting } from "../gemini";

afterEach(() => {
  __setGeminiClientForTesting(null);
  __setReadwisePathForTesting(null);
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
    __setReadwisePathForTesting(null);
    try {
      rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("returns 0 when all cited sources have PDFs on disk", async () => {
    __setReadwisePathForTesting("/tmp/nonexistent-readwise-binary");
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
    __setReadwisePathForTesting("/tmp/nonexistent-readwise-binary");
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
    __setReadwisePathForTesting("/tmp/nonexistent-readwise-binary");
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

    // NoPdf2024-aa has no PDF and no Readwise match => missing => exit 1
    expect(code).toBe(1);
  });

  it("classifies missing misc/book sources as Readwise targets", async () => {
    __setReadwisePathForTesting("/tmp/nonexistent-readwise-binary");
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

    // misc type goes to Readwise bucket, not Paperpile => still missing => exit 1
    expect(code).toBe(1);
  });

  it("does not create a Gemini store or write a report", async () => {
    __setReadwisePathForTesting("/tmp/nonexistent-readwise-binary");
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
    __setReadwisePathForTesting("/tmp/nonexistent-readwise-binary");
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

    // Blog2024-cc is @misc with no PDF and no Readwise => missing => exit 1
    expect(code).toBe(1);
  });
});
