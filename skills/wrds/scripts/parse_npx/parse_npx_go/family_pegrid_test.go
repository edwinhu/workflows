package main

import (
	"path/filepath"
	"testing"
)

func TestFamilyPEGRID(t *testing.T) {
	fixture := "clearwater_2022.txt"

	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_pegrid", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.ParseStatus != "ok" {
		t.Fatalf("parse failed: status=%s err=%s", meta.ParseStatus, meta.ErrorMsg)
	}

	// (e) assert layout is proxyedge
	if meta.Layout != "proxyedge" {
		t.Errorf("expected layout proxyedge, got %s", meta.Layout)
	}

	var gridRows, proxyEdgeRows int
	var foundLiveRamp1a, foundLiveRamp4 bool

	expectedABBVotes := map[string]string{
		"1": "For", "2": "For", "3": "For", "4": "For", "5": "For",
		"6.1": "For", "6.2": "For",
		"7.1": "For", "7.2": "For", "7.3": "For", "7.4": "For", "7.5": "For",
		"7.6": "For", "7.7": "For", "7.8": "For", "7.9": "For", "7.10": "For",
		"8.1": "For", "8.2": "For", "8.3": "For",
		"9": "For", "10": "For", "11": "Against",
	}
	actualABBVotes := make(map[string]string)

	for _, r := range rows {
		// Identify EDGAR grid rows by looking at what proxyedge does wrong:
		// The real proxy edge rows (Artisan Partners -> ABB LTD.) have issuer ABB LTD.
		if r.IssuerName == "ABB LTD." {
			proxyEdgeRows++
			if r.CUSIP != "H0010V101" {
				t.Errorf("ABB row has wrong CUSIP: %q", r.CUSIP)
			}
			if r.MeetingDate != "20220324" {
				t.Errorf("ABB row has wrong MeetingDate: %q", r.MeetingDate)
			}
			actualABBVotes[r.ItemSeq] = r.HowVoted
			continue
		}

		// The 1A. row from the first table
		if r.ItemSeq == "1A." || r.ItemSeq == "1B." {
			continue
		}

		gridRows++

		// a. no row's issuer is a column label
		issuer := r.IssuerName
		if issuer == "Issuer Name" || issuer == "Shares Voted" || issuer == "Company Name" || issuer == "Name" || issuer == "Issuer" || issuer == "Company" {
			t.Errorf("grid row has column label as issuer: %q (item %s)", issuer, r.ItemSeq)
		}

		// b. every row from the grid section has non-empty meeting date and cusip
		if r.MeetingDate == "" {
			t.Errorf("grid row missing meeting date: item %s (issuer %s)", r.ItemSeq, r.IssuerName)
		}
		if r.CUSIP == "" {
			t.Errorf("grid row missing cusip: item %s (issuer %s)", r.ItemSeq, r.IssuerName)
		}

		// (ii) assert all 6 grid rows have IssuerName "LiveRamp Holdings, Inc."
		if r.IssuerName != "LiveRamp Holdings, Inc." {
			t.Errorf("grid row has unexpected issuer: %q", r.IssuerName)
		}

		// (b) 2+ specific grid rows match fixture values
		// 1a check
		if r.ItemSeq == "1a" {
			foundLiveRamp1a = true
			if r.MeetingDate != "20210810" {
				t.Errorf("LiveRamp row 1a date wrong: %q", r.MeetingDate)
			}
			if r.CUSIP != "53815P108" {
				t.Errorf("LiveRamp row 1a cusip wrong: %q", r.CUSIP)
			}
			if r.VoteDescription != "Elect Director John L. Battelle" {
				t.Errorf("LiveRamp row 1a proposal wrong: %q", r.VoteDescription)
			}
			if r.HowVoted != "For" {
				t.Errorf("LiveRamp row 1a vote wrong: %q", r.HowVoted)
			}
		}

		// (i) add a second exact grid-row check on the same LiveRamp table: item 4
		if r.ItemSeq == "4" {
			foundLiveRamp4 = true
			if r.MeetingDate != "20210810" {
				t.Errorf("LiveRamp row 4 date wrong: %q", r.MeetingDate)
			}
			if r.CUSIP != "53815P108" {
				t.Errorf("LiveRamp row 4 cusip wrong: %q", r.CUSIP)
			}
			if r.VoteDescription != "Ratify KPMG LLP as Auditors" {
				t.Errorf("LiveRamp row 4 proposal wrong: %q", r.VoteDescription)
			}
			if r.HowVoted != "For" {
				t.Errorf("LiveRamp row 4 vote wrong: %q", r.HowVoted)
			}
		}
	}

	if !foundLiveRamp1a {
		t.Errorf("did not find correctly parsed LiveRamp row 1a")
	}
	if !foundLiveRamp4 {
		t.Errorf("did not find correctly parsed LiveRamp row 4")
	}

	// c. the number of grid rows emitted equals the number of data rows in the fixture's grid tables
	if gridRows != 6 {
		t.Errorf("expected 6 grid rows, got %d", gridRows)
	}

	// d. MUST-HOLD: ProxyEdge ballot section's rows are unchanged from today
	if proxyEdgeRows != 23 {
		t.Errorf("expected 23 ProxyEdge rows (ABB LTD.), got %d", proxyEdgeRows)
	}

	for seq, expectedVote := range expectedABBVotes {
		if actualVote, ok := actualABBVotes[seq]; !ok {
			t.Errorf("ABB row missing item seq: %q", seq)
		} else if actualVote != expectedVote {
			t.Errorf("ABB row item %q vote expected %q got %q", seq, expectedVote, actualVote)
		}
	}
	for seq := range actualABBVotes {
		if _, ok := expectedABBVotes[seq]; !ok {
			t.Errorf("ABB row has unexpected item seq: %q", seq)
		}
	}
}
