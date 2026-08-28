package main

import (
	"strings"
	"testing"
)

// Two funds from an ISS-generated report: the first has nothing to report, the
// second holds one meeting whose first proposal wraps onto a continuation line.
const issNPXFixture = `                        ******* FORM N-Px REPORT *******

ICA File Number: 811-09102
Reporting Period: 07/01/2016 - 06/30/2017
iShares Trust

=================== ISHARES CORE S&P 500 ETF ===================

There is no proxy voting activity for the fund

=================== ISHARES MSCI ACWI ETF ===================

APPLE INC.

Ticker: AAPL           Security ID: 037833100
Meeting Date: FEB 28, 2017         Meeting Type: Annual
Record Date: DEC 30, 2016

#     Proposal                                    Mgt Rec     Vote Cast   Sponsor
1.1   Elect Director James A. Bell to serve
      until the next annual meeting               For         For         Management
1.2   Elect Director Tim Cook                     For         Against     Management
6     Report on Human Rights Risk Assessment      Against     For         Shareholder
`

func issRows(t *testing.T) []VoteRow {
	t.Helper()
	meta := FilingMeta{FilePath: "edgar/data/1100663/x.txt", FormType: "N-PX", CIK: "0001100663"}
	res := parseText([]byte(issNPXFixture), meta)
	if res.Meta.ParseStatus != "ok" {
		t.Fatalf("ParseStatus = %q (%s), want ok", res.Meta.ParseStatus, res.Meta.ErrorMsg)
	}
	if res.Meta.Layout != "issnpx" {
		t.Fatalf("Meta.Layout = %q, want issnpx", res.Meta.Layout)
	}
	if res.Meta.NRows != len(res.Rows) {
		t.Fatalf("Meta.NRows = %d but %d rows were emitted", res.Meta.NRows, len(res.Rows))
	}
	return res.Rows
}

func TestLayoutISSNPX(t *testing.T) {
	rows := issRows(t)

	if len(rows) != 3 {
		t.Fatalf("got %d rows, want 3 — only the fund with activity contributes rows", len(rows))
	}

	for i, r := range rows {
		if !strings.Contains(r.FundName, "ISHARES MSCI ACWI ETF") {
			t.Errorf("row %d FundName = %q, want the second fund section; the no-activity fund must contribute nothing",
				i, r.FundName)
		}
		if r.IssuerName != "APPLE INC." {
			t.Errorf("row %d IssuerName = %q, want APPLE INC.", i, r.IssuerName)
		}
		if r.CUSIP != "037833100" {
			t.Errorf("row %d CUSIP = %q, want the Security ID 037833100", i, r.CUSIP)
		}
		if r.Ticker != "AAPL" {
			t.Errorf("row %d Ticker = %q, want AAPL", i, r.Ticker)
		}
		if r.MeetingDate != "20170228" {
			t.Errorf("row %d MeetingDate = %q, want 20170228", i, r.MeetingDate)
		}
		if r.RecordDate != "20161230" {
			t.Errorf("row %d RecordDate = %q, want 20161230", i, r.RecordDate)
		}
		if r.MeetingType != "Annual" {
			t.Errorf("row %d MeetingType = %q, want Annual", i, r.MeetingType)
		}
		if r.Layout != "issnpx" {
			t.Errorf("row %d Layout = %q, want issnpx", i, r.Layout)
		}
		if r.ParseMode != "text" {
			t.Errorf("row %d ParseMode = %q, want text", i, r.ParseMode)
		}
	}

	want := []struct {
		seq, desc, mgmt, cast, sponsor string
	}{
		{"1.1", "Elect Director James A. Bell to serve until the next annual meeting", "For", "For", "Management"},
		{"1.2", "Elect Director Tim Cook", "For", "Against", "Management"},
		{"6", "Report on Human Rights Risk Assessment", "Against", "For", "Shareholder"},
	}
	for i, w := range want {
		r := rows[i]
		if r.ItemSeq != w.seq {
			t.Errorf("row %d ItemSeq = %q, want %q", i, r.ItemSeq, w.seq)
		}
		if got := strings.Join(strings.Fields(r.VoteDescription), " "); got != w.desc {
			t.Errorf("row %d VoteDescription = %q, want %q (continuation lines rejoined)", i, got, w.desc)
		}
		if r.ManagementRecommendation != w.mgmt {
			t.Errorf("row %d ManagementRecommendation = %q, want %q", i, r.ManagementRecommendation, w.mgmt)
		}
		if r.HowVoted != w.cast {
			t.Errorf("row %d HowVoted = %q, want %q", i, r.HowVoted, w.cast)
		}
		if r.VoteSource != w.sponsor {
			t.Errorf("row %d VoteSource = %q, want the sponsor %q", i, r.VoteSource, w.sponsor)
		}
	}
}
