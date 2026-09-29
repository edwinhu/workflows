package main

// Shared test helpers. Every fixture under testdata/ is a verbatim byte slice
// of a real filing (SGML header through the first <TEXT>, concatenated with the
// MANAGEMENT section) — see testdata/SOURCES.tsv for the source path, byte
// range and sha256 of each slice. check_full.sh re-derives those hashes from
// the full filings before it runs the binary, so a silently edited fixture
// fails the gate.

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
)

var (
	fixMu    sync.Mutex
	fixCache = map[string]Extraction{}
)

// fixtureBytes returns the fixture exactly as it sits on disk.
func fixtureBytes(t *testing.T, fixture string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", fixture))
	if err != nil {
		t.Fatalf("reading fixture %s: %v", fixture, err)
	}
	if len(b) == 0 {
		t.Fatalf("fixture %s is empty", fixture)
	}
	return b
}

// extractFixture runs the production extraction entry point on a fixture,
// memoised so the seven fixtures are parsed once per test binary.
func extractFixture(t *testing.T, fixture string) Extraction {
	t.Helper()
	fixMu.Lock()
	defer fixMu.Unlock()
	if e, ok := fixCache[fixture]; ok {
		return e
	}
	e := ExtractManagement(fixtureBytes(t, fixture))
	fixCache[fixture] = e
	return e
}

var reWS = regexp.MustCompile(`\s+`)

// squash collapses runs of whitespace (and the non-breaking spaces these
// filings are full of) to single spaces so an assertion can quote the filing's
// prose without pinning where the HTML happened to break the line.
func squash(s string) string {
	s = strings.ReplaceAll(s, "\u00a0", " ")
	return strings.TrimSpace(reWS.ReplaceAllString(s, " "))
}

// person returns the extracted row whose normalised Name equals want.
func person(t *testing.T, e Extraction, want string) Person {
	t.Helper()
	p, ok := findPerson(e, want)
	if !ok {
		t.Fatalf("no person named %q; extracted %d persons: %v", want, len(e.Persons), personNames(e))
	}
	return p
}

func findPerson(e Extraction, want string) (Person, bool) {
	w := squash(want)
	for _, p := range e.Persons {
		if squash(p.Name) == w {
			return p, true
		}
	}
	return Person{}, false
}

func personNames(e Extraction) []string {
	out := make([]string, 0, len(e.Persons))
	for _, p := range e.Persons {
		out = append(out, squash(p.Name))
	}
	return out
}

func countSection(e Extraction, section string) int {
	n := 0
	for _, p := range e.Persons {
		if p.Section == section {
			n++
		}
	}
	return n
}

func containsFold(hay, needle string) bool {
	return strings.Contains(strings.ToLower(squash(hay)), strings.ToLower(squash(needle)))
}
