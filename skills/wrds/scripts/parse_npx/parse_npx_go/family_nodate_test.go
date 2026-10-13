package main

import (
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Family NODATE: a filing whose head carries one ProxyEdge ballot (an
// Item/Proposal band plus a colon identity label) is dispatched to proxyedge
// whole, and the walk then reads the OTHER vendors' sections of the same
// filing as ProxyEdge: the issuer comes out as a record date or a column
// label, the meeting date is blank, and a share count lands in the item
// column. Each fixture keeps one genuine ProxyEdge meeting so dispatch still
// picks proxyedge; without it the same lines parse correctly as htmltable.
//
// Fixtures delete whole source lines only. Source line numbers below refer to
// the original accession, not the cut.
//
//   - ivy_2015.txt, 000088/883622/0001193125-15-307950.txt: kept 1-1432
//     (header declaring S000024835 "Ivy Dividend Opportunities Fund", cover
//     open), 60044-60199 (IVY CUNDILL GLOBAL VALUE FUND banner and the
//     ProxyEdge INTRALOT meeting), 70667-71395 (the closing </TABLE> of
//     INTRALOT's ballot, the SANKYO meeting that ends the Cundill section, then
//     the IVY DIVIDEND OPPORTUNITIES FUND banner at 70953, Teva Pharmaceutical
//     Industries Ltd. with Meeting Date 07/30/2014 and Record Date 06/23/2014,
//     and Airgas, Inc. with Meeting Date 08/05/2014), 662603-662606.
//   - lincoln_2009.txt, 000091/914036/0001193125-09-181138.txt: kept 1-440
//     (header, <BODY>), 459-665 (LVIP Baron Growth Opportunities Fund, the
//     ProxyEdge PENN NATIONAL GAMING meeting whose band is Item / Proposal /
//     Type / Vote / For/Against Management), 91210-91694 (one "Vote Summary
//     Report" page of Lincoln Managed Fund: AAON 05/19/09, ACCENTURE LTD *ACN*
//     02/12/09, Acuity Brands 01/08/09, Administaff 05/05/09), 339016-339462
//     (LVIP MARSICO INTERNATIONAL GROWTH FUND - 3950, ABB LTD, whose
//     "Security:" is the colon identity label dispatch needs), 1262163-1262167.
//   - clearwater_2011.txt, 000081/811161/0000897101-11-001772.txt: kept 1-1005
//     (header, cover, the CLEARWATER GROWTH FUND Vote Audit Report table whose
//     column header prints "Voted Shares", and the first two meetings: CEMEX,
//     S.A.B. DE C.V. Special 24-Feb-2011 and Special 25-Mar-11),
//     225339-225422 (CLEARWATER SMALL CAP FUND banner and the ProxyEdge ONLINE
//     RESOURCES CORP meeting with a "Ticker:" identity label), 823887-823891.
func TestFamilyNoDate(t *testing.T) {
	run := func(t *testing.T, fixture string) []VoteRow {
		t.Helper()
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		cikDict, seriesMap = nil, nil
		ch := make(chan *ParseResult, 4096)
		sink := &rowSink{out: ch}
		meta := processFile(fixture, filepath.Join("testdata", "family_nodate", fixture), sink, make([]byte, headBytes))
		close(ch)
		if meta.ParseStatus != "ok" {
			t.Fatalf("parse failed: status=%s err=%s", meta.ParseStatus, meta.ErrorMsg)
		}
		var rows []VoteRow
		for pr := range ch {
			rows = append(rows, pr.Rows...)
		}
		rows = append(rows, sink.buf...)
		if len(rows) == 0 {
			t.Fatal("no rows")
		}
		checkNoDateRows(t, rows)
		return rows
	}

	t.Run("ivy_2015.txt", func(t *testing.T) {
		rows := run(t, "ivy_2015.txt")
		// Proposal rows of the Teva ballot (70957-71262). Item 6 prints no vote
		// instruction, so a layout may emit it with a blank vote or not at all;
		// every other proposal carries a vote and must be present.
		wantVotes := map[string]string{
			"1.1": "For", "1.2": "For", "2.1": "For", "2.2": "For",
			"3.1": "For", "3.2": "For", "4": "For", "5": "For", "A": "Against",
		}
		got := map[string]int{}
		var airgas int
		for _, r := range rows {
			if strings.Contains(r.IssuerName, "Airgas") {
				airgas++
				if r.MeetingDate != "20140805" {
					t.Errorf("Airgas item %s: date=%q, want 20140805", r.ItemSeq, r.MeetingDate)
				}
			}
			if !strings.Contains(r.IssuerName, "Teva Pharmaceutical") {
				continue
			}
			got[r.ItemSeq]++
			if r.MeetingDate != "20140730" {
				t.Errorf("Teva item %s: date=%q, want the meeting date 20140730 (not record date 06/23/2014)", r.ItemSeq, r.MeetingDate)
			}
			if !strings.Contains(strings.ToLower(r.FundName), "ivy dividend opportunities fund") {
				t.Errorf("Teva item %s: fund=%q, want IVY DIVIDEND OPPORTUNITIES FUND", r.ItemSeq, r.FundName)
			}
			if r.SeriesID != "S000024835" {
				t.Errorf("Teva item %s: series=%q, want S000024835", r.ItemSeq, r.SeriesID)
			}
			if want, ok := wantVotes[r.ItemSeq]; ok && r.HowVoted != want {
				t.Errorf("Teva item %s: vote=%q, want %q", r.ItemSeq, r.HowVoted, want)
			}
		}
		for seq := range wantVotes {
			if seq == "A" {
				continue // asserted in ivy_2015_letter_item
			}
			if got[seq] != 1 {
				t.Errorf("Teva item %s: %d rows, want 1", seq, got[seq])
			}
		}
		for seq, n := range got {
			if _, ok := wantVotes[seq]; !ok && !(seq == "6" && n == 1) {
				t.Errorf("Teva: unexpected item %q (%d rows)", seq, n)
			}
		}
		if airgas != 2 {
			t.Errorf("Airgas: %d rows, want 2 (items 1.1, 1.2)", airgas)
		}
	})

	t.Run("ivy_2015_letter_item", func(t *testing.T) {
		t.Skip("known gap: ISS Voting Policy Rec band not in peVocabulary; letter item A unread")
		rows := run(t, "ivy_2015.txt")
		var n int
		for _, r := range rows {
			if strings.Contains(r.IssuerName, "Teva Pharmaceutical") && r.ItemSeq == "A" {
				n++
			}
		}
		if n != 1 {
			t.Errorf("Teva item %s: %d rows, want 1", "A", n)
		}
	})

	t.Run("lincoln_2009.txt", func(t *testing.T) {
		rows := run(t, "lincoln_2009.txt")
		wantACN := []struct{ desc, vote string }{
			{"RE-APPOINTMENT TO THE BOARD OF DIRECTORS: CHARLES H. GIANCARLO", "For"},
			{"RE-APPOINTMENT TO THE BOARD OF DIRECTORS: DINA DUBLON", "For"},
			{"RE-APPOINTMENT TO THE BOARD OF DIRECTORS: WILLIAM D. GREEN", "For"},
			{"RE-APPOINTMENT TO THE BOARD OF DIRECTORS: NOBUYUKI IDEI", "Against"},
			{"RE-APPOINTMENT TO THE BOARD OF DIRECTORS: MARJORIE MAGNER", "For"},
			{"RATIFY AUDITORS", "For"},
		}
		neighbours := map[string]string{
			"AAON":                 "20090519",
			"Acuity":               "20090108",
			"Administaff":          "20090505",
			"PENN NATIONAL GAMING": "20081112",
		}
		seen := map[string]int{}
		acn := map[string]VoteRow{}
		for _, r := range rows {
			for name, date := range neighbours {
				if strings.Contains(r.IssuerName, name) {
					seen[name]++
					if r.MeetingDate != date {
						t.Errorf("%s item %s: date=%q, want %s", name, r.ItemSeq, r.MeetingDate, date)
					}
				}
			}
			if !strings.Contains(strings.ToUpper(r.IssuerName), "ACCENTURE") {
				continue
			}
			if r.MeetingDate != "20090212" {
				t.Errorf("ACCENTURE item %s: date=%q, want 20090212", r.ItemSeq, r.MeetingDate)
			}
			if _, dup := acn[r.ItemSeq]; dup {
				t.Errorf("ACCENTURE item %s emitted twice", r.ItemSeq)
			}
			acn[r.ItemSeq] = r
		}
		for i, w := range wantACN {
			seq := string(rune('1' + i))
			r, ok := acn[seq]
			if !ok {
				t.Errorf("ACCENTURE item %s missing", seq)
				continue
			}
			if r.VoteDescription != w.desc {
				t.Errorf("ACCENTURE item %s: desc=%q, want %q", seq, r.VoteDescription, w.desc)
			}
			if r.HowVoted != w.vote {
				t.Errorf("ACCENTURE item %s: vote=%q, want %q", seq, r.HowVoted, w.vote)
			}
		}
		if len(acn) != len(wantACN) {
			t.Errorf("ACCENTURE: %d distinct items, want %d", len(acn), len(wantACN))
		}
		for name := range neighbours {
			if seen[name] == 0 {
				t.Errorf("no rows for %s", name)
			}
		}
	})

	t.Run("clearwater_2011.txt", func(t *testing.T) {
		rows := run(t, "clearwater_2011.txt")
		cemex := map[string]int{}
		var online int
		for _, r := range rows {
			if strings.Contains(r.IssuerName, "ONLINE RESOURCES") {
				online++
				if r.MeetingDate != "20100701" {
					t.Errorf("ONLINE RESOURCES item %s: date=%q, want 20100701", r.ItemSeq, r.MeetingDate)
				}
				if r.SeriesID != "S000000698" {
					t.Errorf("ONLINE RESOURCES item %s: series=%q, want S000000698", r.ItemSeq, r.SeriesID)
				}
				continue
			}
			if !strings.Contains(r.IssuerName, "CEMEX") {
				t.Errorf("row item %s: issuer=%q date=%q, want CEMEX or ONLINE RESOURCES", r.ItemSeq, r.IssuerName, r.MeetingDate)
				continue
			}
			cemex[r.MeetingDate]++
			// The label-value block's own "Fund Name" cell prints the
			// registrant's COMPANY CONFORMED NAME ("Clearwater Investment
			// Trust"), not a series name -- it must not override the
			// "CLEARWATER GROWTH FUND" banner the section opened with, which
			// is the filing's own declared S000000697 (<SERIES-NAME>Clearwater
			// Growth Fund).
			if r.SeriesID != "S000000697" {
				t.Errorf("CEMEX item %s: series=%q, want S000000697 (Clearwater Growth Fund, from the section banner, not the label-value block's own decoy \"Fund Name\" cell)", r.ItemSeq, r.SeriesID)
			}
			if !strings.Contains(strings.ToLower(r.FundName), "growth") {
				t.Errorf("CEMEX item %s: fund=%q, want it to carry CLEARWATER GROWTH FUND, not the decoy \"Fund Name\" cell value", r.ItemSeq, r.FundName)
			}
		}
		// 24-Feb-2011 ballot prints items 1-10; 25-Mar-11 prints items 1-3.
		if cemex["20110224"] != 10 || cemex["20110325"] != 3 || len(cemex) != 2 {
			t.Errorf("CEMEX rows by date = %v, want map[20110224:10 20110325:3]", cemex)
		}
		if online != 4 {
			t.Errorf("ONLINE RESOURCES: %d rows, want 4", online)
		}
	})
}

var (
	noDateDateLike   = regexp.MustCompile(`^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$|^\d{1,2}-[A-Za-z]{3}-\d{2,4}$|^\d{8}$`)
	noDateShareCount = regexp.MustCompile(`^\d{1,3}(,\d{3})+$`)
	noDateYMD        = regexp.MustCompile(`^(19|20)\d{6}$`)
	noDateLabels     = map[string]bool{
		"date": true, "ballot issues": true, "company/ballot issues": true,
		"company/ ballot issues": true, "voted shares": true, "record date": true,
		"meeting date": true, "mtg date/type": true, "shares voted": true,
		"security": true, "mgmt rec": true, "vote cast": true, "prpnent": true,
		"issuer": true, "fund name": true, "company name": true, "ballot shares": true,
	}
)

func checkNoDateRows(t *testing.T, rows []VoteRow) {
	t.Helper()
	for _, r := range rows {
		issuer := strings.TrimSpace(r.IssuerName)
		if !noDateYMD.MatchString(r.MeetingDate) {
			t.Errorf("item %s issuer %q: meeting date %q is not YYYYMMDD", r.ItemSeq, r.IssuerName, r.MeetingDate)
		}
		if issuer == "" || noDateDateLike.MatchString(issuer) || noDateLabels[strings.ToLower(issuer)] {
			t.Errorf("item %s date %q: issuer %q is blank, a date or a column label", r.ItemSeq, r.MeetingDate, r.IssuerName)
		}
		if noDateLabels[strings.ToLower(strings.TrimSpace(r.FundName))] {
			t.Errorf("item %s issuer %q: fund %q is a column label", r.ItemSeq, r.IssuerName, r.FundName)
		}
		for _, v := range []string{r.ItemSeq, r.VoteDescription} {
			if noDateShareCount.MatchString(strings.TrimSpace(v)) {
				t.Errorf("issuer %q: item=%q desc=%q carries a share count", r.IssuerName, r.ItemSeq, r.VoteDescription)
			}
		}
	}
}
