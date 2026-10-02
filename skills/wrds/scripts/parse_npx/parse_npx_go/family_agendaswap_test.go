package main

import (
	"path/filepath"
	"regexp"
	"testing"
)

func TestFamilyAgendaSwap(t *testing.T) {
	fixture := "century_casinos_2022.txt"

	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_agendaswap", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.ParseStatus != "ok" {
		t.Fatalf("parse failed: status=%s err=%s", meta.ParseStatus, meta.ErrorMsg)
	}

	// (a) at least 3 rows
	if len(rows) < 3 {
		t.Fatalf("expected at least 3 rows, got %d", len(rows))
	}

	numericDesc := regexp.MustCompile(`^[0-9.]+$`)
	var foundItem2 bool

	for _, r := range rows {
		// (b) NO row has a VoteDescription matching ^[0-9.]+$
		if numericDesc.MatchString(r.VoteDescription) {
			t.Errorf("VoteDescription is purely numeric (swapped?): %q for item %q", r.VoteDescription, r.ItemSeq)
		}

		// (c) NO row has an ItemSeq longer than 10 characters
		if len(r.ItemSeq) > 10 {
			t.Errorf("ItemSeq is suspiciously long (swapped?): %q", r.ItemSeq)
		}

		// (d) the Century Casinos item 2 row has exactly ItemSeq "2", VoteDescription "Elect Eduard Berger", MeetingDate "20220609", CUSIP "156492100", HowVoted "For"
		if r.IssuerName == "Century Casinos, Inc." && (r.ItemSeq == "2" || r.VoteDescription == "2" || r.ItemSeq == "Elect Eduard Berger") {
			foundItem2 = true
			if r.ItemSeq != "2" {
				t.Errorf("ItemSeq expected '2', got %q", r.ItemSeq)
			}
			if r.VoteDescription != "Elect Eduard Berger" {
				t.Errorf("VoteDescription expected 'Elect Eduard Berger', got %q", r.VoteDescription)
			}
			if r.MeetingDate != "20220609" {
				t.Errorf("MeetingDate expected '20220609', got %q", r.MeetingDate)
			}
			if r.CUSIP != "156492100" {
				t.Errorf("CUSIP expected '156492100', got %q", r.CUSIP)
			}
			if r.HowVoted != "For" {
				t.Errorf("HowVoted expected 'For', got %q", r.HowVoted)
			}
		}
	}

	if !foundItem2 {
		t.Errorf("did not find Century Casinos item 2")
	}
}
