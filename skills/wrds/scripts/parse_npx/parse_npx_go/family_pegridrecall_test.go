package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// Fixtures delete whole lines only. Source line numbers below refer to the
// original accession, not the cut. Each cut retains both a ballot header band
// and a standalone colon-suffixed identity label: without those, dispatch falls
// through to htmltable and does not exercise the mixed ProxyEdge reader.
func TestFamilyPEGridRecall(t *testing.T) {
	parse := func(t *testing.T, fixture string) []VoteRow {
		t.Helper()
		ch := make(chan *ParseResult, 4096)
		sink := &rowSink{out: ch}
		meta := processFile(fixture, filepath.Join("testdata", "family_pegridrecall", fixture), sink, make([]byte, headBytes))
		close(ch)
		if meta.Layout != "proxyedge" {
			t.Fatalf("invalid fixture: layout=%q, want proxyedge", meta.Layout)
		}
		if meta.ParseStatus != "ok" {
			t.Fatalf("parse failed: status=%s err=%s", meta.ParseStatus, meta.ErrorMsg)
		}
		var rows []VoteRow
		for pr := range ch {
			rows = append(rows, pr.Rows...)
		}
		return append(rows, sink.buf...)
	}
	realDated := func(t *testing.T, r VoteRow) {
		t.Helper()
		if r.MeetingDate == "" {
			t.Errorf("missing date: fund=%q issuer=%q item=%q", r.FundName, r.IssuerName, r.ItemSeq)
		}
		switch strings.ToLower(strings.TrimSpace(r.IssuerName)) {
		case "", "issuer", "issuer name", "company", "company name", "name", "meeting id", "country", "shares voted", "primary security id", "meeting country", "ticker", "security id":
			t.Errorf("missing or label issuer: fund=%q issuer=%q item=%q", r.FundName, r.IssuerName, r.ItemSeq)
		}
	}

	t.Run("811161_aqr", func(t *testing.T) {
		rows := parse(t, "811161_aqr.txt")
		count, exact := 0, false
		for _, r := range rows {
			if !strings.Contains(r.FundName, "AQR Capital Management") {
				continue
			}
			count++
			realDated(t, r)
			// 0000897101-16-002855: banner 227722; numberless header
			// 227728-227767; first data row 227768-227792.
			if r.IssuerName == "Bed Bath & Beyond Inc." && r.MeetingDate == "20150702" &&
				(r.CUSIP == "075896100" || r.Ticker == "BBBY") &&
				r.VoteDescription == "Elect Director Warren Eisenberg" && r.HowVoted == "For" {
				exact = true
			}
		}
		if count == 0 {
			t.Error("no rows under AQR Capital Management")
		}
		if !exact {
			t.Error("missing AQR Bed Bath & Beyond / 20150702 / 075896100 or BBBY / Elect Director Warren Eisenberg / For")
		}
	})

	t.Run("898745_pfi", func(t *testing.T) {
		rows := parse(t, "898745_pfi.txt")
		const fundI = "Principal Funds, Inc. – LargeCap Value Fund I"
		const fundIII = "Institutional Account(s): PFI LARGECAP VALUE FUND III - PMC"
		countI, countIII := 0, 0
		merck, continuation, citigroup := false, false, false
		for _, r := range rows {
			switch r.FundName {
			case fundI:
				countI++
				realDated(t, r)
				// 0000898745-10-000427: first table's first row, 307141-307152.
				if r.IssuerName == "Merck & Co., Inc." && r.MeetingDate == "20090807" &&
					r.CUSIP == "589331107" && r.ItemSeq == "1" &&
					r.VoteDescription == "Approve Acquisition" && r.HowVoted == "For" {
					merck = true
				}
				// Headerless second table's first row, 307973-307984.
				if r.IssuerName == "Covidien plc" && r.MeetingDate == "20100316" &&
					r.CUSIP == "G2554F105" && r.ItemSeq == "2f" &&
					r.VoteDescription == "Elect Kathy J. Herbert as Director" && r.HowVoted == "For" {
					continuation = true
				}
			case fundIII:
				countIII++
				realDated(t, r)
				// Banner 430454; stacked identity 430464-430497;
				// first proposal and vote 430525-430531.
				if r.IssuerName == "Citigroup Inc." && r.MeetingDate == "20090902" &&
					r.CUSIP == "172967101" && r.ItemSeq == "1" &&
					r.VoteDescription == "Increase Authorized Common Stock" && r.HowVoted == "For" {
					citigroup = true
				}
			}
		}
		// Independently counted 11-cell dated source TRs: 66 in 307075-307956,
		// plus 67 in 307960-308822 (no repeated header), including non-voting rows.
		if countI != 133 {
			t.Errorf("LargeCap Value Fund I rows=%d, want 133 (66 + 67)", countI)
		}
		if !merck || !continuation {
			t.Errorf("missing exact Fund I rows: Merck=%v, headerless Covidien=%v", merck, continuation)
		}
		if countIII == 0 || !citigroup {
			t.Errorf("Fund III rows=%d, exact Citigroup=%v", countIII, citigroup)
		}
	})

	t.Run("897101_clearwater", func(t *testing.T) {
		rows := parse(t, "897101_clearwater.txt")
		// 0000897101-12-001459: five Knightsbridge rows (277-326), then
		// eleven Osterweis rows (147469-147721), twelve Heartland rows
		// (157122-157433), and two AXA rows (249818-249865). Assert source-order
		// boundaries, not merely the first row that happens to have the right name.
		if len(rows) != 30 {
			t.Errorf("rows=%d, want 30 (5 + 11 + 12 + 2)", len(rows))
		}
		for _, want := range []struct {
			first, count                 int
			fund, issuer, date, proposal string
		}{
			// Banner 147405-147407; first row 147469-147491.
			{5, 11, "CLEARWATER CORE EQUITY (Osterweis)", "CA, Inc.", "20110803", "Elect Director Raymond J. Bromark"},
			// Banner wraps inside its colspan cell, 157062-157065; first row 157122-157147.
			{16, 12, "CLEARWATER CORE EQUITY (Heartland)", "ABB Ltd.", "20120426", "Accounts and Reports"},
			// Banner 249779-249780; first (non-voting) row 249818-249841.
			{28, 2, "CLEARWATER INTERNATIONAL (AXA)", "Voestalpine AG", "20110706", "Receive Financial Statements and Statutory Reports (Non-Voting)"},
		} {
			t.Run(want.fund, func(t *testing.T) {
				if len(rows) <= want.first {
					t.Fatalf("no first row after banner: index %d, total %d", want.first, len(rows))
				}
				first := rows[want.first]
				if first.FundName != want.fund || first.IssuerName != want.issuer ||
					first.MeetingDate != want.date || first.ItemSeq != "1" || first.VoteDescription != want.proposal {
					t.Errorf("first row after banner %q: %+v", want.fund, first)
				}
				for i := want.first; i < want.first+want.count && i < len(rows); i++ {
					if rows[i].FundName != want.fund {
						t.Errorf("row %d fund=%q, want %q", i, rows[i].FundName, want.fund)
					}
					realDated(t, rows[i])
				}
			})
		}
	})
}
