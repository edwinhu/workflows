package main

import (
	"errors"
	"strings"
	"testing"
)

func withRegistry(t *testing.T, entries []layoutEntry) {
	t.Helper()
	saved := layoutRegistry
	layoutRegistry = entries
	t.Cleanup(func() { layoutRegistry = saved })
}

func TestLayoutRegistry(t *testing.T) {
	meta := FilingMeta{FilePath: "edgar/data/1/x.txt", FormType: "N-PX"}

	t.Run("registered signature dispatches and stamps the layout", func(t *testing.T) {
		called := 0
		withRegistry(t, []layoutEntry{{
			Name:  "zztest",
			Match: func(head string) bool { return strings.Contains(head, "ZZ TEST BANNER") },
			Parse: func(text string, m FilingMeta) ([]VoteRow, error) {
				called++
				return []VoteRow{
					{IssuerName: "ACME CORP", ItemSeq: "1"},
					{IssuerName: "ACME CORP", ItemSeq: "2"},
				}, nil
			},
		}})

		res := parseText([]byte("ZZ TEST BANNER\nACME CORP\n"), meta)
		if called != 1 {
			t.Fatalf("registered parser called %d times, want 1", called)
		}
		if len(res.Rows) != 2 {
			t.Fatalf("got %d rows, want 2", len(res.Rows))
		}
		if res.Meta.ParseStatus != "ok" {
			t.Errorf("ParseStatus = %q, want ok", res.Meta.ParseStatus)
		}
		if res.Meta.Layout != "zztest" {
			t.Errorf("Meta.Layout = %q, want zztest", res.Meta.Layout)
		}
		if res.Meta.NRows != 2 {
			t.Errorf("Meta.NRows = %d, want 2", res.Meta.NRows)
		}
		for i, r := range res.Rows {
			if r.Layout != "zztest" {
				t.Errorf("row %d Layout = %q, want zztest stamped on every row", i, r.Layout)
			}
			if r.FilePath != meta.FilePath {
				t.Errorf("row %d FilePath = %q, want %q", i, r.FilePath, meta.FilePath)
			}
		}
	})

	t.Run("unmatched body skips with a non-empty signature", func(t *testing.T) {
		withRegistry(t, []layoutEntry{{
			Name:  "zztest",
			Match: func(head string) bool { return strings.Contains(head, "ZZ TEST BANNER") },
			Parse: func(string, FilingMeta) ([]VoteRow, error) { return nil, nil },
		}})

		res := parseText([]byte("SOME UNRECOGNIZED PROXY VOTING FORMAT\nrow one\nrow two\n"), meta)
		if len(res.Rows) != 0 {
			t.Fatalf("unmatched body produced %d rows, want 0", len(res.Rows))
		}
		if res.Meta.ParseStatus != "skip" {
			t.Fatalf("ParseStatus = %q, want skip", res.Meta.ParseStatus)
		}
		if strings.TrimSpace(res.Meta.Layout) == "" {
			t.Fatalf("unmatched body must record a non-empty layout signature so the family is countable")
		}
		if res.Meta.NRows != 0 {
			t.Errorf("Meta.NRows = %d, want 0", res.Meta.NRows)
		}
	})

	t.Run("distinct unmatched families get distinct signatures", func(t *testing.T) {
		withRegistry(t, nil)
		a := parseText([]byte("PROXY VOTING RECORD FORMAT ALPHA\nalpha body\n"), meta)
		b := parseText([]byte("SOMETHING ENTIRELY DIFFERENT BETA\nbeta body\n"), meta)
		if a.Meta.Layout == b.Meta.Layout {
			t.Fatalf("two unrelated unmatched bodies got the same signature %q; the manifest cannot count families", a.Meta.Layout)
		}
	})

	t.Run("no proxy voting activity is ok with zero rows", func(t *testing.T) {
		withRegistry(t, nil)
		body := []byte("Fund Name Trust\n\nThere is no proxy voting activity for the fund\n")
		res := parseText(body, meta)
		if len(res.Rows) != 0 {
			t.Fatalf("no-activity body produced %d rows, want 0", len(res.Rows))
		}
		if res.Meta.ParseStatus != "ok" {
			t.Fatalf("ParseStatus = %q, want ok — a fund with nothing to report is a real outcome, not a parser failure", res.Meta.ParseStatus)
		}
		if res.Meta.NRows != 0 {
			t.Errorf("Meta.NRows = %d, want 0", res.Meta.NRows)
		}
	})

	t.Run("a failing layout parser becomes parse_status error", func(t *testing.T) {
		withRegistry(t, []layoutEntry{{
			Name:  "boom",
			Match: func(head string) bool { return strings.Contains(head, "BOOM BANNER") },
			Parse: func(string, FilingMeta) ([]VoteRow, error) { return nil, errors.New("synthetic parse failure") },
		}})
		res := parseText([]byte("BOOM BANNER\nbody\n"), meta)
		if res.Meta.ParseStatus != "error" {
			t.Fatalf("ParseStatus = %q, want error", res.Meta.ParseStatus)
		}
		if !strings.Contains(res.Meta.ErrorMsg, "synthetic parse failure") {
			t.Errorf("ErrorMsg = %q, want it to carry the parser's message", res.Meta.ErrorMsg)
		}
	})

	t.Run("a panicking layout parser is contained", func(t *testing.T) {
		withRegistry(t, []layoutEntry{{
			Name:  "panicky",
			Match: func(head string) bool { return strings.Contains(head, "PANIC BANNER") },
			Parse: func(string, FilingMeta) ([]VoteRow, error) { panic("synthetic panic") },
		}})
		res := parseText([]byte("PANIC BANNER\nbody\n"), meta)
		if res.Meta.ParseStatus != "error" {
			t.Fatalf("ParseStatus = %q, want error — a panicking parser must not take the worker down", res.Meta.ParseStatus)
		}
		if strings.TrimSpace(res.Meta.ErrorMsg) == "" {
			t.Errorf("ErrorMsg is empty; the recovered panic must be recorded")
		}
	})

	t.Run("markup is normalized before matching", func(t *testing.T) {
		withRegistry(t, []layoutEntry{{
			Name:  "zztest",
			Match: func(head string) bool { return strings.Contains(head, "ZZ TEST BANNER") },
			Parse: func(text string, m FilingMeta) ([]VoteRow, error) {
				if strings.Contains(text, "<FONT") {
					return nil, errors.New("layout parser was handed raw markup")
				}
				return []VoteRow{{IssuerName: "ACME CORP"}}, nil
			},
		}})
		res := parseText([]byte("<HTML><BODY><FONT SIZE=\"2\">ZZ TEST BANNER</FONT><BR>ACME CORP</BODY></HTML>"), meta)
		if res.Meta.ParseStatus != "ok" {
			t.Fatalf("ParseStatus = %q (%s), want ok — the body must be normalized before the registry sees it",
				res.Meta.ParseStatus, res.Meta.ErrorMsg)
		}
		if len(res.Rows) != 1 {
			t.Fatalf("got %d rows, want 1", len(res.Rows))
		}
	})
}
