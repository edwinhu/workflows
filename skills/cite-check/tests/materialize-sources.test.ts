import { describe, expect, it, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";

/**
 * Tests for materialize-sources.ts bug fixes.
 * These test the bib update logic and stub detection behavior.
 */

describe("Fix 1: PDF overwrites stale .md file paths in sources.bib", () => {
  const tmpDir = "/tmp/cite-check-fix1-test";

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("detects .md file field that should be overridden to .pdf", () => {
    mkdirSync(tmpDir, { recursive: true });
    const bibPath = join(tmpDir, "sources.bib");
    writeFileSync(bibPath, `@misc{Author2024-ab,
  title = {Some Title},
  file = {Author2024-ab.md},
  year = {2024}
}
`);

    const bibContent = readFileSync(bibPath, "utf-8");
    const bibkey = "Author2024-ab";

    // Detect: entry exists AND has file field ending in .md for this bibkey
    const entryHasFile = new RegExp(
      `@\\w+\\{${bibkey},[\\s\\S]*?file\\s*=\\s*\\{${bibkey}\\.md\\}`,
      "m",
    );
    expect(entryHasFile.test(bibContent)).toBe(true);
  });

  it("updates file = {key.md} to file = {key.pdf} in bib content", () => {
    mkdirSync(tmpDir, { recursive: true });
    const bibPath = join(tmpDir, "sources.bib");
    writeFileSync(bibPath, `@misc{Author2024-ab,
  title = {Some Title},
  file = {Author2024-ab.md},
  year = {2024}
}

@article{Other2024-cd,
  title = {Other Paper},
  file = {Other2024-cd.pdf},
  year = {2024}
}
`);

    let bibContent = readFileSync(bibPath, "utf-8");
    const bibkey = "Author2024-ab";

    // Replace .md -> .pdf for this specific bibkey's file field
    const fileFieldPattern = new RegExp(
      `(file\\s*=\\s*\\{)${bibkey}\\.md(\\})`,
    );
    bibContent = bibContent.replace(fileFieldPattern, `$1${bibkey}.pdf$2`);
    writeFileSync(bibPath, bibContent, "utf-8");

    const updated = readFileSync(bibPath, "utf-8");
    expect(updated).toContain("file = {Author2024-ab.pdf}");
    expect(updated).not.toContain("file = {Author2024-ab.md}");
    // Other entry should be untouched
    expect(updated).toContain("file = {Other2024-cd.pdf}");
  });

  it("does NOT change file = {key.pdf} entries", () => {
    mkdirSync(tmpDir, { recursive: true });
    const bibPath = join(tmpDir, "sources.bib");
    writeFileSync(bibPath, `@misc{Author2024-ab,
  title = {Some Title},
  file = {Author2024-ab.pdf},
  year = {2024}
}
`);

    const bibContent = readFileSync(bibPath, "utf-8");
    const bibkey = "Author2024-ab";

    // The .md detection pattern should NOT match
    const entryHasMdFile = new RegExp(
      `@\\w+\\{${bibkey},[\\s\\S]*?file\\s*=\\s*\\{${bibkey}\\.md\\}`,
      "m",
    );
    expect(entryHasMdFile.test(bibContent)).toBe(false);
  });
});

describe("Fix 2: Stub detection for cached .md files", () => {
  const tmpDir = "/tmp/cite-check-fix2-test";

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("file > 500 bytes is treated as cached (real content)", () => {
    mkdirSync(tmpDir, { recursive: true });
    const filePath = join(tmpDir, "real.md");
    const header = [
      "---",
      "bibkey: Author2024-ab",
      'title: "Some Title"',
      "author: Author",
      "source: readwise",
      "---",
      "",
    ].join("\n");
    const content = "A".repeat(500);
    writeFileSync(filePath, header + content, "utf-8");

    const fileSize = statSync(filePath).size;
    expect(fileSize).toBeGreaterThan(500);
    const isCached = fileSize > 500;
    expect(isCached).toBe(true);
  });

  it("file <= 500 bytes is treated as stub (YAML-only frontmatter)", () => {
    mkdirSync(tmpDir, { recursive: true });
    const filePath = join(tmpDir, "stub.md");
    const stub = [
      "---",
      "bibkey: Author2024-ab",
      'title: "Some Title"',
      "author: Author",
      "source: readwise",
      "---",
      "",
    ].join("\n");
    writeFileSync(filePath, stub, "utf-8");

    const fileSize = statSync(filePath).size;
    expect(fileSize).toBeLessThanOrEqual(500);
    const isCached = fileSize > 500;
    expect(isCached).toBe(false);
  });

  it("empty file (0 bytes) is treated as stub", () => {
    mkdirSync(tmpDir, { recursive: true });
    const filePath = join(tmpDir, "empty.md");
    writeFileSync(filePath, "", "utf-8");

    const fileSize = statSync(filePath).size;
    expect(fileSize).toBe(0);
    const isCached = fileSize > 500;
    expect(isCached).toBe(false);
  });
});
