package main

import (
	"strings"
	"testing"
)

// Two issuers in the Vanguard block grammar; the second issuer's proposal text
// wraps onto a continuation line before the trailing columns.
const vanguardFixture = `FUND: VANGUARD 500 INDEX FUND

--------------------------------------------------------------------------------
ISSUER: ABBOTT LABORATORIES
TICKER: ABT          CUSIP: 002824100
MEETING DATE: 4/25/2014
PROPOSAL:                              PROPOSED BY  VOTED?  VOTE CAST      MGMT
PROPOSAL #1.1: ELECT DIRECTOR ROBERT J. ALPERN     Management   Yes    FOR       FOR
--------------------------------------------------------------------------------
ISSUER: ADOBE SYSTEMS INCORPORATED
TICKER: ADBE         CUSIP: 00724F101
MEETING DATE: 4/9/2014
PROPOSAL:                              PROPOSED BY  VOTED?  VOTE CAST      MGMT
PROPOSAL #2.1: APPROVE THE AMENDED AND RESTATED 2003
EQUITY INCENTIVE PLAN                              Management   Yes    AGAINST   FOR
--------------------------------------------------------------------------------
`

func TestLayoutVanguard(t *testing.T) {
	meta := FilingMeta{FilePath: "edgar/data/36405/y.txt", FormType: "N-PX", CIK: "0000036405"}
	res := parseText([]byte(vanguardFixture), meta)

	if res.Meta.ParseStatus != "ok" {
		t.Fatalf("ParseStatus = %q (%s), want ok", res.Meta.ParseStatus, res.Meta.ErrorMsg)
	}
	if res.Meta.Layout != "vanguard" {
		t.Fatalf("Meta.Layout = %q, want vanguard", res.Meta.Layout)
	}
	if res.Meta.NRows != len(res.Rows) {
		t.Fatalf("Meta.NRows = %d but %d rows were emitted", res.Meta.NRows, len(res.Rows))
	}
	if len(res.Rows) != 2 {
		t.Fatalf("got %d rows, want 2 — one per proposal, with the wrapped proposal rejoined into a single row",
			len(res.Rows))
	}

	want := []struct {
		issuer, ticker, cusip, meeting, seq, desc, cast, mgmt string
	}{
		{"ABBOTT LABORATORIES", "ABT", "002824100", "20140425", "1.1",
			"ELECT DIRECTOR ROBERT J. ALPERN", "FOR", "FOR"},
		{"ADOBE SYSTEMS INCORPORATED", "ADBE", "00724F101", "20140409", "2.1",
			"APPROVE THE AMENDED AND RESTATED 2003 EQUITY INCENTIVE PLAN", "AGAINST", "FOR"},
	}
	for i, w := range want {
		r := res.Rows[i]
		if r.IssuerName != w.issuer {
			t.Errorf("row %d IssuerName = %q, want %q", i, r.IssuerName, w.issuer)
		}
		if r.Ticker != w.ticker {
			t.Errorf("row %d Ticker = %q, want %q", i, r.Ticker, w.ticker)
		}
		if r.CUSIP != w.cusip {
			t.Errorf("row %d CUSIP = %q, want %q", i, r.CUSIP, w.cusip)
		}
		if r.MeetingDate != w.meeting {
			t.Errorf("row %d MeetingDate = %q, want %q", i, r.MeetingDate, w.meeting)
		}
		if r.ItemSeq != w.seq {
			t.Errorf("row %d ItemSeq = %q, want %q", i, r.ItemSeq, w.seq)
		}
		if got := strings.Join(strings.Fields(r.VoteDescription), " "); got != w.desc {
			t.Errorf("row %d VoteDescription = %q, want %q (continuation line rejoined)", i, got, w.desc)
		}
		if r.HowVoted != w.cast {
			t.Errorf("row %d HowVoted = %q, want %q", i, r.HowVoted, w.cast)
		}
		if r.ManagementRecommendation != w.mgmt {
			t.Errorf("row %d ManagementRecommendation = %q, want %q", i, r.ManagementRecommendation, w.mgmt)
		}
		if r.FundName != "VANGUARD 500 INDEX FUND" {
			t.Errorf("row %d FundName = %q, want VANGUARD 500 INDEX FUND", i, r.FundName)
		}
		if r.Layout != "vanguard" {
			t.Errorf("row %d Layout = %q, want vanguard", i, r.Layout)
		}
		if r.ParseMode != "text" {
			t.Errorf("row %d ParseMode = %q, want text", i, r.ParseMode)
		}
	}
}
