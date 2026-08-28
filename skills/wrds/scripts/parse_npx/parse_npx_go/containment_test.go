package main

import (
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func readGz(t *testing.T, path string) string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		t.Fatalf("gzip %s: %v", path, err)
	}
	defer zr.Close()
	b, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(b)
}

func manifestRow(t *testing.T, manifest, relPath string) []string {
	t.Helper()
	for _, ln := range strings.Split(manifest, "\n") {
		if ln == "" {
			continue
		}
		f := strings.Split(ln, "\t")
		if len(f) != len(manifestColumns) {
			t.Fatalf("manifest row has %d columns, want %d: %q", len(f), len(manifestColumns), ln)
		}
		if f[0] == relPath {
			return f
		}
	}
	t.Fatalf("no manifest row for %q in:\n%s", relPath, manifest)
	return nil
}

func manifestField(t *testing.T, row []string, col string) string {
	t.Helper()
	for i, name := range manifestColumns {
		if name == col {
			return row[i]
		}
	}
	t.Fatalf("no manifest column %q", col)
	return ""
}

// A filelist entry is attacker-influenced input: on the grid the list is
// machine-generated from EDGAR index metadata and handed straight to
// -files-from, with no human auditing the path strings.
func TestPathContainment(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "archives")
	if err := os.MkdirAll(filepath.Join(root, "edgar", "data", "1"), 0o755); err != nil {
		t.Fatal(err)
	}
	// A file the archive root must not reach.
	secret := filepath.Join(base, "outside_secret.txt")
	if err := os.WriteFile(secret, []byte("BEGIN RSA PRIVATE KEY SENTINELVALUE9137\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	// One ordinary filing so the run has real work too.
	good := "edgar/data/1/good.txt"
	if err := os.WriteFile(filepath.Join(root, good), []byte(issNPXFixture), 0o644); err != nil {
		t.Fatal(err)
	}

	escapes := []string{
		"../outside_secret.txt",
		"edgar/data/1/../../../outside_secret.txt",
		"edgar/./data/1/../../../../archives/../outside_secret.txt",
	}

	listPath := filepath.Join(base, "files.txt")
	lines := append([]string{good}, escapes...)
	if err := os.WriteFile(listPath, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	bin := buildBinary(t)
	votesPath := filepath.Join(base, "votes.tsv.gz")
	manPath := filepath.Join(base, "manifest.tsv.gz")
	_, stderr, code := runBinary(t, bin,
		"-files-from", listPath, "-archive-root", root,
		"-out", votesPath, "-manifest", manPath)
	if code != 0 {
		t.Fatalf("run exited %d: %s", code, stderr)
	}

	votes := readGz(t, votesPath)
	manifest := readGz(t, manPath)

	if strings.Contains(votes, "SENTINELVALUE9137") || strings.Contains(manifest, "SENTINELVALUE9137") {
		t.Errorf("content of a file outside the archive root leaked into the output artifacts")
	}

	for _, e := range escapes {
		row := manifestRow(t, manifest, e)
		if got := manifestField(t, row, "parse_status"); got != "error" {
			t.Errorf("filelist entry %q: parse_status = %q, want error — a path escaping the archive root must be refused, and visibly", e, got)
		}
		if got := manifestField(t, row, "n_rows"); got != "0" {
			t.Errorf("filelist entry %q: n_rows = %q, want 0", e, got)
		}
		if got := manifestField(t, row, "error_msg"); strings.TrimSpace(got) == "" {
			t.Errorf("filelist entry %q: error_msg is empty; the refusal must say why", e)
		}
	}

	// The legitimate relative path must still work.
	row := manifestRow(t, manifest, good)
	if got := manifestField(t, row, "parse_status"); got != "ok" {
		t.Errorf("ordinary relative path %q: parse_status = %q, want ok (%s)",
			good, got, manifestField(t, row, "error_msg"))
	}
}

// TestContainmentAcceptsLegitimateRoots pins the other half of containment: a
// root that Cleans to "." (from `-archive-root .`, or any root that Cleans to
// it) must still accept ordinary relative entries. Refusing them turns a
// containment fix into a total outage for that invocation.
func TestContainmentAcceptsLegitimateRoots(t *testing.T) {
	for _, root := range []string{".", "./", "some/..", "archives/"} {
		entry := "edgar/data/1/good.txt"
		got, err := resolvePath(root, entry)
		if err != nil {
			t.Errorf("resolvePath(%q, %q) refused a legitimate relative entry: %v", root, entry, err)
			continue
		}
		if got == "" {
			t.Errorf("resolvePath(%q, %q) returned an empty path", root, entry)
		}
	}

	// And the refusal must still hold for those same roots.
	for _, root := range []string{".", "./", "some/..", "archives/"} {
		if _, err := resolvePath(root, "../escape.txt"); err == nil {
			t.Errorf("resolvePath(%q, %q) allowed an escape", root, "../escape.txt")
		}
	}
}

// TestContainmentFollowsSymlinks pins the branch filepath.Join cannot reach: a
// symlink INSIDE the archive root pointing outside it. Lexical cleaning cannot
// see through it, so this is the one traversal the physical-path check exists
// for, and nothing else in the suite makes it the deciding branch.
func TestContainmentFollowsSymlinks(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "archives")
	if err := os.MkdirAll(filepath.Join(root, "edgar"), 0o755); err != nil {
		t.Fatal(err)
	}
	secret := filepath.Join(base, "outside_secret.txt")
	if err := os.WriteFile(secret, []byte("SENTINELVALUE9137\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "edgar", "escape.txt")
	if err := os.Symlink(secret, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	if _, err := resolvePath(root, "edgar/escape.txt"); err == nil {
		t.Fatalf("a symlink inside the archive root pointing outside it was accepted; filepath.Join cannot clean this, so the physical-path check is the only thing standing between a hostile filelist and an arbitrary read")
	}

	// A symlink that stays inside the root is fine and must not be refused.
	inner := filepath.Join(root, "edgar", "real.txt")
	if err := os.WriteFile(inner, []byte("ok\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	okLink := filepath.Join(root, "edgar", "alias.txt")
	if err := os.Symlink(inner, okLink); err != nil {
		t.Fatal(err)
	}
	if _, err := resolvePath(root, "edgar/alias.txt"); err != nil {
		t.Errorf("a symlink resolving inside the root was refused: %v", err)
	}
}
