package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// TestDispatchPath drives whole dissemination files through the binary, the way
// the grid does. Every other test calls a parser directly, so the switch that
// decides which parser a filing gets is otherwise unexercised.
func TestDispatchPath(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "archives")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}

	files := map[string]string{
		"xml.txt":        npxSGMLHead + npxPrimaryDoc + npxVoteDoc,
		"iss.txt":        issNPXFixture,
		"vanguard.txt":   vanguardFixture,
		"noactivity.txt": "Some Trust\n\nThere is no proxy voting activity for the fund\n",
		"garbage.txt":    "COMPLETELY UNRECOGNIZED PROXY FORMAT\nline one\nline two\n",
		// A modern filing whose PROXY VOTING RECORD document is absent. It must
		// NOT ship as ok-with-zero-rows: that is the manifest's encoding for a
		// fund that genuinely had nothing to vote, and the two must stay apart.
		"xmlnovotes.txt": npxSGMLHead + npxPrimaryDoc,
	}
	var names []string
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}

	listPath := filepath.Join(base, "files.txt")
	if err := os.WriteFile(listPath, []byte(strings.Join(names, "\n")+"\n"), 0o644); err != nil {
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

	t.Run("each filing is routed to the right era", func(t *testing.T) {
		want := []struct{ name, mode, status, layout string }{
			{"xml.txt", "xml", "ok", ""},
			{"iss.txt", "text", "ok", "issnpx"},
			{"vanguard.txt", "text", "ok", "vanguard"},
			{"noactivity.txt", "text", "ok", ""},
			{"garbage.txt", "", "skip", ""},
			{"xmlnovotes.txt", "xml", "error", ""},
		}
		for _, w := range want {
			row := manifestRow(t, manifest, w.name)
			if got := manifestField(t, row, "parse_status"); got != w.status {
				t.Errorf("%s: parse_status = %q, want %q (%s)", w.name, got, w.status,
					manifestField(t, row, "error_msg"))
			}
			if w.mode != "" {
				if got := manifestField(t, row, "parse_mode"); got != w.mode {
					t.Errorf("%s: parse_mode = %q, want %q", w.name, got, w.mode)
				}
			}
			if w.layout != "" {
				if got := manifestField(t, row, "layout"); got != w.layout {
					t.Errorf("%s: layout = %q, want %q", w.name, got, w.layout)
				}
			}
			if w.status == "error" {
				if got := manifestField(t, row, "error_msg"); strings.TrimSpace(got) == "" {
					t.Errorf("%s: parse_status=error with an empty error_msg", w.name)
				}
				if got := manifestField(t, row, "n_rows"); got != "0" {
					t.Errorf("%s: n_rows = %q, want 0", w.name, got)
				}
			}
		}
	})

	t.Run("parse_mode vocabulary is closed", func(t *testing.T) {
		for _, ln := range strings.Split(strings.TrimRight(manifest, "\n"), "\n") {
			f := strings.Split(ln, "\t")
			mode := manifestField(t, f, "parse_mode")
			switch mode {
			case "xml", "text", "none":
			default:
				t.Errorf("manifest row %q carries parse_mode %q, outside {xml,text,none}", f[0], mode)
			}
			st := manifestField(t, f, "parse_status")
			switch st {
			case "ok", "error", "skip":
			default:
				t.Errorf("manifest row %q carries parse_status %q, outside {ok,error,skip}", f[0], st)
			}
		}
	})

	t.Run("n_rows sums to the votes file line count", func(t *testing.T) {
		total := 0
		for _, ln := range strings.Split(strings.TrimRight(manifest, "\n"), "\n") {
			f := strings.Split(ln, "\t")
			n := manifestField(t, f, "n_rows")
			var v int
			if _, err := fmt.Sscan(n, &v); err != nil {
				t.Fatalf("n_rows %q is not an integer: %v", n, err)
			}
			total += v
		}
		lines := 0
		for _, ln := range strings.Split(strings.TrimRight(votes, "\n"), "\n") {
			if ln != "" {
				lines++
			}
		}
		if total != lines {
			t.Fatalf("manifest n_rows sums to %d but votes.tsv.gz holds %d rows", total, lines)
		}
		if lines == 0 {
			t.Fatal("no vote rows were produced at all")
		}
	})

	t.Run("the xml era carries the series and class link keys", func(t *testing.T) {
		found := 0
		for _, ln := range strings.Split(strings.TrimRight(votes, "\n"), "\n") {
			f := strings.Split(ln, "\t")
			if len(f) != len(voteColumns) {
				t.Fatalf("vote row has %d columns, want %d", len(f), len(voteColumns))
			}
			if f[0] != "xml.txt" {
				continue
			}
			found++
			if got := f[idxOf(t, voteColumns, "series_id")]; got != "S000002841" {
				t.Errorf("xml row series_id = %q, want S000002841", got)
			}
			if got := f[idxOf(t, voteColumns, "class_ids")]; got != "C000007786" {
				t.Errorf("xml row class_ids = %q, want C000007786 — the link key the ISS reconciliation depends on", got)
			}
		}
		if found != 4 {
			t.Fatalf("got %d xml vote rows, want 4", found)
		}
	})
}

func idxOf(t *testing.T, cols []string, name string) int {
	t.Helper()
	for i, c := range cols {
		if c == name {
			return i
		}
	}
	t.Fatalf("no column %q", name)
	return -1
}

// TestXMLParserErrorPaths covers the failure branches the happy-path fixture
// never reaches.
func TestXMLParserErrorPaths(t *testing.T) {
	doc := npxSGMLHead + npxPrimaryDoc + npxVoteDoc

	t.Run("an emit error stops the parse and propagates", func(t *testing.T) {
		sentinel := errors.New("sink closed")
		seen := 0
		meta := FilingMeta{FilePath: "x"}
		_, err := parseNPXXML(strings.NewReader(doc), &meta, func(VoteRow) error {
			seen++
			return sentinel
		})
		if err == nil {
			t.Fatalf("emit returned an error but parseNPXXML returned nil")
		}
		if !errors.Is(err, sentinel) && !strings.Contains(err.Error(), "sink closed") {
			t.Errorf("parseNPXXML error = %v, want it to carry the emit error", err)
		}
		if seen != 1 {
			t.Errorf("emit was called %d times after returning an error, want 1 — the parse must stop", seen)
		}
	})

	t.Run("a truncated vote table is an error", func(t *testing.T) {
		cut := doc[:strings.Index(doc, "<voteSeries>S000002841</voteSeries>")]
		meta := FilingMeta{FilePath: "x"}
		_, err := parseNPXXML(strings.NewReader(cut), &meta, func(VoteRow) error { return nil })
		if err == nil {
			t.Fatalf("a truncated document parsed without error; parse_status=error can never be reached")
		}
	})

	t.Run("a filing with no PROXY VOTING RECORD document is an error", func(t *testing.T) {
		meta := FilingMeta{FilePath: "x"}
		n, err := parseNPXXML(strings.NewReader(npxSGMLHead+npxPrimaryDoc), &meta, func(VoteRow) error { return nil })
		if err == nil {
			t.Fatalf("a filing carrying no vote table parsed without error, yielding %d rows", n)
		}
	})
}

// TestNoActivitySentinels pins every sentinel the registry recognises. A fund
// with nothing to vote is a real and common outcome, so each phrase must come
// back ok-with-zero-rows rather than as an unparsed family.
func TestNoActivitySentinels(t *testing.T) {
	meta := FilingMeta{FilePath: "x"}

	t.Run("every sentinel classifies as ok with zero rows", func(t *testing.T) {
		withRegistry(t, nil)
		for _, s := range noActivitySentinels {
			body := []byte("Some Trust\n\n" + s + "\n")
			res := parseText(body, meta)
			if res.Meta.ParseStatus != "ok" || len(res.Rows) != 0 {
				t.Errorf("sentinel %q: status = %q with %d rows, want ok with 0 rows",
					s, res.Meta.ParseStatus, len(res.Rows))
			}
		}
	})

	t.Run("a matched layout wins over an incidental mention", func(t *testing.T) {
		// The live registry, not a stub: a real ISS report that merely mentions
		// the phrase must still be parsed for its votes.
		body := []byte(issNPXFixture +
			"\nNote: no proxy voting activity is reported for terminated series.\n")
		res := parseText(body, meta)
		if len(res.Rows) == 0 {
			t.Fatalf("status = %q layout = %q with 0 rows; the ISS report carries votes and must not be read as nothing-to-report",
				res.Meta.ParseStatus, res.Meta.Layout)
		}
	})
}

// TestCharsetFailureIsAnError pins parseText's charset branch: an undecodable
// filing must be a visible error, never an unparsed family.
func TestCharsetFailureIsAnError(t *testing.T) {
	withRegistry(t, nil)
	body := []byte("<?xml version=\"1.0\" encoding=\"shift_jis\"?>\nFORM N-Px REPORT\n")
	res := parseText(body, FilingMeta{FilePath: "x"})
	if res.Meta.ParseStatus != "error" {
		t.Fatalf("ParseStatus = %q, want error for an undecodable encoding", res.Meta.ParseStatus)
	}
	if strings.TrimSpace(res.Meta.ErrorMsg) == "" {
		t.Fatal("ErrorMsg is empty; the charset failure must say what it was")
	}
}

// bigVoteDoc builds a PROXY VOTING RECORD document with n proxyTable records.
func bigVoteDoc(n int) string {
	var b strings.Builder
	b.WriteString("<DOCUMENT>\n<TYPE>PROXY VOTING RECORD\n<SEQUENCE>2\n<FILENAME>vote.xml\n<TEXT>\n<XML>\n")
	b.WriteString("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<proxyVoteTable>\n")
	for i := 0; i < n; i++ {
		b.WriteString("<proxyTable>\n<issuerName>ISSUER NUMBER ")
		fmt.Fprintf(&b, "%d", i)
		b.WriteString(" WITH A REASONABLY LONG CORPORATE NAME INC.</issuerName>\n")
		b.WriteString("<cusip>037833100</cusip>\n<meetingDate>02/28/2025</meetingDate>\n")
		b.WriteString("<voteDescription>Elect Director Number ")
		fmt.Fprintf(&b, "%d", i)
		b.WriteString(" to serve until the next annual meeting of shareholders</voteDescription>\n")
		b.WriteString("<voteCategories><voteCategory><categoryType>DIRECTOR_ELECTION</categoryType></voteCategory></voteCategories>\n")
		b.WriteString("<sharesVoted>1000</sharesVoted>\n<sharesOnLoan>25</sharesOnLoan>\n<vote>\n")
		b.WriteString("<voteRecord><howVoted>FOR</howVoted><sharesVoted>600</sharesVoted><managementRecommendation>FOR</managementRecommendation></voteRecord>\n")
		b.WriteString("<voteRecord><howVoted>AGAINST</howVoted><sharesVoted>400</sharesVoted><managementRecommendation>FOR</managementRecommendation></voteRecord>\n")
		b.WriteString("</vote>\n<voteSeries>S000002841</voteSeries>\n</proxyTable>\n")
	}
	b.WriteString("</proxyVoteTable>\n</XML>\n</TEXT>\n</DOCUMENT>\n")
	return b.String()
}

// TestXMLStreamingCost is the assertion that makes "streaming" mean something.
// A real N-PX filing runs 10-200 MB with tens of thousands of nested records and
// the worker pool multiplies whatever one worker holds by the concurrency, so an
// implementation that read the whole document or unmarshalled the whole table
// into a slice would OOM the grid node. Nothing else in the suite would notice:
// the happy-path fixture is 2 KB and only compares the collected rows.
func TestXMLStreamingCost(t *testing.T) {
	doc := npxSGMLHead + npxPrimaryDoc + bigVoteDoc(4000)
	n := uint64(len(doc))
	if n < 2<<20 {
		t.Fatalf("fixture is only %d bytes; it must be large enough for buffering to show", n)
	}

	var rows int
	meta := FilingMeta{FilePath: "big.txt"}
	got := allocBytes(func() {
		var err error
		rows, err = parseNPXXML(strings.NewReader(doc), &meta, func(VoteRow) error { return nil })
		if err != nil {
			t.Errorf("parseNPXXML: %v", err)
		}
	})
	if t.Failed() {
		return
	}
	if rows != 8000 {
		t.Fatalf("got %d rows, want 8000", rows)
	}

	// Decoding allocates per token; what must NOT happen is retaining the
	// document or the row set. 12x the input is ample for a token-at-a-time
	// decode and far below a whole-document buffer plus an unmarshalled table.
	const budget = 12
	if got > budget*n {
		t.Fatalf("parseNPXXML allocated %d bytes for a %d-byte document (%.1fx); it must decode incrementally, not buffer the table",
			got, n, float64(got)/float64(n))
	}

	// The emitted rows must not be retained by the parser: peak heap after the
	// parse must not carry them.
	var ms runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&ms)
	if ms.HeapAlloc > n {
		t.Errorf("heap holds %d bytes after parsing a %d-byte document; the parser is retaining the table",
			ms.HeapAlloc, n)
	}
}
