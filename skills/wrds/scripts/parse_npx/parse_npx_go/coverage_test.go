package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// edgarEnvelope wraps a body in the SGML envelope every EDGAR full-submission
// file carries. The envelope is IDENTICAL across filings, which is exactly why a
// signature computed over the head of the normalized text fingerprints nothing.
func edgarEnvelope(cik, accession, body string) string {
	return "-----BEGIN PRIVACY-ENHANCED MESSAGE-----\n" +
		"<SEC-DOCUMENT>" + accession + ".txt : 20130104\n" +
		"<SEC-HEADER>" + accession + ".hdr.sgml : 20130104\n" +
		"ACCESSION NUMBER:\t\t" + accession + "\n" +
		"CONFORMED SUBMISSION TYPE:\tN-PX\n" +
		"CONFORMED PERIOD OF REPORT:\t20120630\n" +
		"FILED AS OF DATE:\t\t20130104\n" +
		"\tCOMPANY DATA:\n\t\tCENTRAL INDEX KEY:\t\t\t" + cik + "\n" +
		"</SEC-HEADER>\n" +
		"<DOCUMENT>\n<TYPE>N-PX\n<SEQUENCE>1\n<FILENAME>report.txt\n<TEXT>\n" +
		body +
		"\n</TEXT>\n</DOCUMENT>\n"
}

// ---------------------------------------------------------------------------
// 1. no-activity must not swallow a filing that plainly carries votes.
// ---------------------------------------------------------------------------

// A multi-fund legacy filing where SOME funds report nothing and others report
// real votes. Measured on the real corpus: 0001193125-13-007885 is 20.5 MB with
// 2,242 "Meeting Date" occurrences, 164 "Vote Cast" and 36 sentinel hits, and
// the parser reports parse_status=ok with n_rows=0 -- silent loss recorded as
// success, which is the one distinction the manifest exists to preserve.
func multiFundMixedActivity() string {
	var b strings.Builder
	b.WriteString("SOME UNRECOGNIZED PROXY VOTING FORMAT\n\n")
	b.WriteString("Fund: Money Market Portfolio\n")
	b.WriteString("There is no proxy voting activity for the fund\n\n")
	for i := 0; i < 40; i++ {
		b.WriteString("Fund: Equity Portfolio\n")
		b.WriteString("APPLE INC.\n")
		b.WriteString("CUSIP: 037833100\n")
		b.WriteString("Meeting Date: 02/28/2017\n")
		b.WriteString("Proposal: Elect Director Tim Cook\n")
		b.WriteString("Vote Cast: For        Mgmt Rec: For\n\n")
	}
	return b.String()
}

func TestTextParserCoverageNoActivity(t *testing.T) {
	meta := FilingMeta{FilePath: "edgar/data/914036/x.txt", FormType: "N-PX"}

	t.Run("a body carrying vote content is not nothing-to-report", func(t *testing.T) {
		withRegistry(t, nil) // no layout matches: this is the skip path
		res := parseText([]byte(multiFundMixedActivity()), meta)

		if res.Meta.ParseStatus == "ok" && res.Meta.NRows == 0 {
			t.Fatalf("a filing with 40 meetings and 40 vote casts was recorded as ok/0 rows because one fund said it had no activity; that is silent loss reported as success")
		}
		if res.Meta.ParseStatus != "skip" {
			t.Errorf("ParseStatus = %q, want skip -- we cannot parse this body, and saying so is the point of the manifest", res.Meta.ParseStatus)
		}
		if strings.TrimSpace(res.Meta.Layout) == "" {
			t.Errorf("a skipped body must still carry a layout signature")
		}
	})

	t.Run("a genuinely empty filing is still ok with zero rows", func(t *testing.T) {
		withRegistry(t, nil)
		body := "ANNUAL REPORT OF PROXY VOTING RECORD\n\n" +
			"Fund: Money Market Portfolio\n" +
			"There is no proxy voting activity for the fund\n"
		res := parseText([]byte(body), meta)
		if res.Meta.ParseStatus != "ok" || res.Meta.NRows != 0 {
			t.Fatalf("status = %q with %d rows, want ok with 0 -- a fund with nothing to report is a real and common outcome",
				res.Meta.ParseStatus, res.Meta.NRows)
		}
	})
}

// ---------------------------------------------------------------------------
// 2. The skip signature must fingerprint the BODY, not the SGML envelope.
// ---------------------------------------------------------------------------

// Measured on the real corpus: 684 skipped filings collapsed onto exactly THREE
// signature labels, because the first six non-blank lines of the normalized text
// are the SGML envelope, which is identical across every EDGAR submission.
func TestTextParserCoverageSignature(t *testing.T) {
	meta := FilingMeta{FilePath: "x", FormType: "N-PX"}
	withRegistry(t, nil)

	families := map[string]string{
		"broadridge": "Ticker: MMM\nMeeting Date: 09-May-2023\n" +
			"Prop.#  Proposal  Vote  For/Against\n1  Elect Director  For  For\n",
		"label_block": "ITEM  PROPOSAL  TYPE  VOTE  FOR/AGAINST MANAGEMENT\n" +
			"02  PROPOSAL TO APPROVE THE 2005 EMPLOYEE STOCK  Mgmt  Against  Against\n",
		"cover_only": "Item 1 - Proxy Voting Record\nRegistrant: Some Trust\n" +
			"Signature page follows.\n",
	}

	seen := map[string]string{}
	for name, body := range families {
		res := parseText([]byte(edgarEnvelope("0000914036", "0001193125-13-0078", body)), meta)
		if res.Meta.ParseStatus != "skip" {
			t.Fatalf("%s: ParseStatus = %q, want skip", name, res.Meta.ParseStatus)
		}
		sig := res.Meta.Layout
		if strings.TrimSpace(sig) == "" {
			t.Fatalf("%s: empty signature", name)
		}
		if prev, dup := seen[sig]; dup {
			t.Errorf("families %q and %q share signature %q -- the fingerprint is reading the SGML envelope, which is identical across every EDGAR filing, so unparsed families are NOT countable in the manifest",
				prev, name, sig)
		}
		seen[sig] = name
	}
	if len(seen) != len(families) {
		t.Fatalf("got %d distinct signatures for %d distinct families", len(seen), len(families))
	}
}

// ---------------------------------------------------------------------------
// 3. The ISS grammar without its banner. 23.5% of all skips.
// ---------------------------------------------------------------------------

// Verified shape from /wrds/sec/archives/000010/104410/0000950134-04-010322.txt:
// ISS-generated column vocabulary (Mgmt / ShrHoldr) with no FORM N-Px REPORT
// banner, so matchISSNPX misses it. Confirmed not a head-window problem: zero
// skipped filings contain the banner anywhere in the first 400 KB of body.
const issNoBannerFixture = `ANNUAL REPORT OF PROXY VOTING RECORD

Investment Company Report

CONAGRA FOODS INC

Ticker: CAG           Security ID: 205887102
Meeting Date: SEP 24, 2004      Meeting Type: Annual
Record Date: JUL 30, 2004

#     Proposal                                  Mgt Rec   Vote Cast   Sponsor
1.2   Elect Director Robert A. Krane            ---       For         Mgmt
1.4   Elect Director Bruce Rohde                ---       For         Mgmt
2     Ratify Auditors                           For       For         Mgmt
4     Genetically Modified Organisms (GMO)      Against   Against     ShrHoldr
`

func TestLayoutISSNPXWithoutBanner(t *testing.T) {
	meta := FilingMeta{FilePath: "edgar/data/104410/x.txt", FormType: "N-PX"}
	res := parseText([]byte(edgarEnvelope("0000104410", "0000950134-04-010322", issNoBannerFixture)), meta)

	if res.Meta.ParseStatus != "ok" {
		t.Fatalf("ParseStatus = %q layout = %q (%s), want ok -- this is ISS-generated grammar and is 23.5%% of all skipped filings",
			res.Meta.ParseStatus, res.Meta.Layout, res.Meta.ErrorMsg)
	}
	if res.Meta.Layout != "issnpx" {
		t.Fatalf("Layout = %q, want issnpx -- the grammar is the ISS one, the banner is merely absent", res.Meta.Layout)
	}
	if len(res.Rows) != 4 {
		t.Fatalf("got %d rows, want 4", len(res.Rows))
	}
	for i, w := range []struct{ seq, mgmt, cast, sponsor string }{
		{"1.2", "---", "For", "Mgmt"},
		{"1.4", "---", "For", "Mgmt"},
		{"2", "For", "For", "Mgmt"},
		{"4", "Against", "Against", "ShrHoldr"},
	} {
		r := res.Rows[i]
		if r.ItemSeq != w.seq {
			t.Errorf("row %d ItemSeq = %q, want %q", i, r.ItemSeq, w.seq)
		}
		if r.ManagementRecommendation != w.mgmt {
			t.Errorf("row %d mgmt rec = %q, want %q", i, r.ManagementRecommendation, w.mgmt)
		}
		if r.HowVoted != w.cast {
			t.Errorf("row %d how_voted = %q, want %q", i, r.HowVoted, w.cast)
		}
		if r.VoteSource != w.sponsor {
			t.Errorf("row %d sponsor = %q, want %q", i, r.VoteSource, w.sponsor)
		}
		if r.CUSIP != "205887102" {
			t.Errorf("row %d cusip = %q, want 205887102", i, r.CUSIP)
		}
		if r.MeetingDate != "20040924" {
			t.Errorf("row %d meeting_date = %q, want 20040924", i, r.MeetingDate)
		}
	}
}

// ---------------------------------------------------------------------------
// 4. The sentinel list is too narrow. Over half of the no-vocabulary skips
//    carry a nothing-to-report sentence phrased outside the six known ones.
// ---------------------------------------------------------------------------

func TestTextParserCoverageSentinels(t *testing.T) {
	meta := FilingMeta{FilePath: "x", FormType: "N-PX"}

	// Verbatim from /wrds/sec/archives/000102/1026144/0000900092-04-000097.txt
	// (Merrill Lynch Index Funds) and siblings. The existing list carries
	// "did not hold any voting securities", which does not match "held no
	// voting securities" -- one phrasing away from a whole family.
	phrases := []string{
		"The Fund held no voting securities during the period covered by this report. No records are attached.",
		"The Registrant held no voting securities during the reporting period.",
		"The Fund did not hold any voting securities during the period.",
		"No proxies were voted during the period covered by this report.",
		"The Fund was not required to vote any proxies during the reporting period.",
		"Not applicable. The Fund held no equity securities during the period.",
	}
	for _, p := range phrases {
		withRegistry(t, nil)
		body := "ANNUAL REPORT OF PROXY VOTING RECORD\n\nItem 1 - Proxy Voting Record\n\n" + p + "\n"
		res := parseText([]byte(edgarEnvelope("0001026144", "0000900092-04-000097", body)), meta)
		if res.Meta.ParseStatus != "ok" || res.Meta.NRows != 0 {
			t.Errorf("phrase %q: status = %q with %d rows, want ok with 0 -- this filing is legitimately empty, not unparseable",
				p, res.Meta.ParseStatus, res.Meta.NRows)
		}
	}
}

// ---------------------------------------------------------------------------
// 5. The Broadridge / ProxyEdge label-block family. 13.9% of all skips,
//    43 of 95 sampled filings naming Broadridge or ProxyEdge explicitly.
// ---------------------------------------------------------------------------

// Three real sub-shapes, from the paths quoted in the corpus profile.
const broadridgeA = `Ticker: MMM
Meeting Date: 09-May-2023
CUSIP: 88579Y101
Prop.#  Proposal                                Vote      For/Against
1       Elect Director Thomas Anderson          For       For
2       Ratify Auditors                         For       For
`

const broadridgeB = `Ticker ADVS   Meeting Date 18-May-05
CUSIP 007383103
ITEM  PROPOSAL                                        TYPE  VOTE     FOR/AGAINST MANAGEMENT
02    PROPOSAL TO APPROVE THE 2005 EMPLOYEE STOCK     Mgmt  Against  Against
04    PROPOSAL TO RATIFY THE APPOINTMENT OF           Mgmt  For      For
`

func TestLayoutBroadridge(t *testing.T) {
	meta := FilingMeta{FilePath: "edgar/data/1415726/x.txt", FormType: "N-PX"}

	for name, fixture := range map[string]string{"prop_hash": broadridgeA, "item_type": broadridgeB} {
		res := parseText([]byte(edgarEnvelope("0001415726", "0000894189-24-001264", fixture)), meta)
		if res.Meta.ParseStatus != "ok" {
			t.Fatalf("%s: ParseStatus = %q layout = %q (%s), want ok",
				name, res.Meta.ParseStatus, res.Meta.Layout, res.Meta.ErrorMsg)
		}
		if res.Meta.Layout != "broadridge" {
			t.Fatalf("%s: Layout = %q, want broadridge", name, res.Meta.Layout)
		}
		if len(res.Rows) != 2 {
			t.Fatalf("%s: got %d rows, want 2", name, len(res.Rows))
		}
		for i, r := range res.Rows {
			if r.Ticker == "" {
				t.Errorf("%s row %d: ticker empty", name, i)
			}
			if r.MeetingDate == "" || len(r.MeetingDate) != 8 {
				t.Errorf("%s row %d: meeting_date = %q, want YYYYMMDD", name, i, r.MeetingDate)
			}
			if r.ItemSeq == "" {
				t.Errorf("%s row %d: item_seq empty", name, i)
			}
			if r.HowVoted == "" {
				t.Errorf("%s row %d: how_voted empty", name, i)
			}
			if r.VoteDescription == "" {
				t.Errorf("%s row %d: vote_description empty", name, i)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// 6. A proxyTable with no voteRecord must still produce a row.
//
// Measured on 150 filings across 150 distinct CIKs: 40,626 of 541,599 agenda
// items (7.50% pooled, 2.50% excluding one dominant filer) carry no voteRecord
// and therefore vanish. 14 of 142 filings lose EVERY item. The loss correlates
// with the filing agent -- 0.00% for five agents, 7.07% for another -- which is
// the worst kind of missingness for a panel. And 124 of them carry sharesVoted
// above zero, up to 4,755,664 shares, so they are not uniformly the benign case.
// ---------------------------------------------------------------------------

const zeroVoteDoc = `<DOCUMENT>
<TYPE>PROXY VOTING RECORD
<SEQUENCE>2
<FILENAME>vote.xml
<TEXT>
<XML>
<?xml version="1.0" encoding="UTF-8"?>
<proxyVoteTable>
<proxyTable>
<issuerName>Stratasys Ltd.</issuerName>
<cusip>M85548101</cusip>
<isin>IL0011267213</isin>
<meetingDate>08/08/2023</meetingDate>
<voteDescription>Reelect S. Scott Crump as Director</voteDescription>
<voteCategories><voteCategory><categoryType>DIRECTOR ELECTIONS</categoryType></voteCategory></voteCategories>
<voteSource>ISSUER</voteSource>
<sharesVoted>0.000000</sharesVoted>
<sharesOnLoan>0</sharesOnLoan>
<voteSeries>S000000948</voteSeries>
</proxyTable>
<proxyTable>
<issuerName>APA GROUP</issuerName>
<cusip>Q0437B100</cusip>
<meetingDate>10/26/2023</meetingDate>
<voteDescription>VOTING EXCLUSIONS APPLY TO THIS MEETING</voteDescription>
<voteCategories><voteCategory><categoryType>OTHER</categoryType></voteCategory></voteCategories>
<otherVoteDescription>Other Voting Matters</otherVoteDescription>
<voteSource>ISSUER</voteSource>
<sharesVoted>442606</sharesVoted>
<sharesOnLoan>0</sharesOnLoan>
<voteSeries>S000000949</voteSeries>
</proxyTable>
<proxyTable>
<issuerName>APPLE INC.</issuerName>
<cusip>037833100</cusip>
<meetingDate>02/28/2025</meetingDate>
<voteDescription>Elect Director Tim Cook</voteDescription>
<voteCategories><voteCategory><categoryType>DIRECTOR ELECTIONS</categoryType></voteCategory></voteCategories>
<sharesVoted>1000</sharesVoted>
<sharesOnLoan>0</sharesOnLoan>
<vote><voteRecord><howVoted>FOR</howVoted><sharesVoted>1000</sharesVoted><managementRecommendation>FOR</managementRecommendation></voteRecord></vote>
<voteSeries>S000000950</voteSeries>
</proxyTable>
</proxyVoteTable>
</XML>
</TEXT>
</DOCUMENT>
`

func TestZeroVoteProxyTableEmitsRow(t *testing.T) {
	var rows []VoteRow
	meta := FilingMeta{FilePath: "edgar/data/355437/x.txt"}
	n, err := parseNPXXML(strings.NewReader(npxSGMLHead+npxPrimaryDoc+zeroVoteDoc), &meta,
		func(r VoteRow) error { rows = append(rows, r); return nil })
	if err != nil {
		t.Fatalf("parseNPXXML: %v", err)
	}
	if n != len(rows) {
		t.Fatalf("returned %d but emitted %d", n, len(rows))
	}
	if len(rows) != 3 {
		t.Fatalf("got %d rows, want 3 -- an agenda item with no voteRecord must still produce a row, or it is indistinguishable from an item the fund never held", len(rows))
	}

	// Row 0: the common shape. Zero shares, no vote breakdown.
	if rows[0].IssuerName != "Stratasys Ltd." {
		t.Errorf("row 0 issuer = %q", rows[0].IssuerName)
	}
	if rows[0].HowVoted != "" {
		t.Errorf("row 0 how_voted = %q, want empty -- no vote was reported", rows[0].HowVoted)
	}
	if rows[0].SharesVoted != "" {
		t.Errorf("row 0 shares_voted = %q, want empty -- that is the voteRecord-level field and there is no voteRecord", rows[0].SharesVoted)
	}
	if rows[0].SharesVotedTotal != "0.000000" {
		t.Errorf("row 0 shares_voted_total = %q, want the record-level 0.000000", rows[0].SharesVotedTotal)
	}
	if rows[0].CUSIP != "M85548101" || rows[0].MeetingDate != "20230808" {
		t.Errorf("row 0 lost its agenda-item identity: cusip=%q meeting_date=%q", rows[0].CUSIP, rows[0].MeetingDate)
	}
	if rows[0].SeriesID != "S000000948" {
		t.Errorf("row 0 series_id = %q", rows[0].SeriesID)
	}

	// Row 1: the shape that is NOT benign -- a real 442,606-share position with
	// no vote breakdown reported. 124 blocks like this in a 150-filing sample.
	if rows[1].SharesVotedTotal != "442606" {
		t.Errorf("row 1 shares_voted_total = %q, want 442606 -- these carry real share counts and must not be dropped", rows[1].SharesVotedTotal)
	}
	if rows[1].HowVoted != "" {
		t.Errorf("row 1 how_voted = %q, want empty", rows[1].HowVoted)
	}
	if rows[1].OtherVoteDescription != "Other Voting Matters" {
		t.Errorf("row 1 other_vote_description = %q", rows[1].OtherVoteDescription)
	}

	// Row 2: an ordinary item is unaffected.
	if rows[2].HowVoted != "FOR" || rows[2].SharesVoted != "1000" {
		t.Errorf("row 2 how_voted = %q shares_voted = %q, want FOR/1000", rows[2].HowVoted, rows[2].SharesVoted)
	}
}

// ---------------------------------------------------------------------------
// Round 2: the assertions the first pass should have carried.
// ---------------------------------------------------------------------------

// A signature that is unique PER FILING fails the goal exactly as badly as three
// labels for 684 filings. Defect 2 is "unparsed families are not countable", and
// countability needs both directions: different families differ, same family
// agrees. The first pass only asserted the former.
func TestTextParserCoverageSignatureIsStablePerFamily(t *testing.T) {
	meta := FilingMeta{FilePath: "x", FormType: "N-PX"}
	withRegistry(t, nil)

	// Same Broadridge label-block family, different issuers, tickers, CUSIPs,
	// dates and proposal text -- everything a real corpus varies.
	// The agendas deliberately use words that appear in the structural
	// vocabulary -- SHARES, PROXY, RECORD, DATE, MANAGEMENT, ISSUER -- because a
	// signature that whitelists tokens ANYWHERE, including inside proposal text,
	// diverges on agenda content. Fixtures whose proposals avoid those words
	// cannot detect the defect they are written to guard.
	a := "Ticker: MMM\nMeeting Date: 09-May-2023\nCUSIP: 88579Y101\n" +
		"Prop.#  Proposal  Vote  For/Against\n" +
		"1  Elect Director Thomas Anderson  For  For\n"
	b := "Ticker: KO\nMeeting Date: 21-Apr-2021\nCUSIP: 191216100\n" +
		"Prop.#  Proposal  Vote  For/Against\n" +
		"1  Approve Issuance of Shares to Management  For  For\n" +
		"2  Amend Proxy Access Bylaw  For  For\n"
	c := "Ticker: XOM\nMeeting Date: 26-May-2020\nCUSIP: 30231G102\n" +
		"Prop.#  Proposal  Vote  For/Against\n" +
		"3  Ratify Auditors  Against  For\n" +
		"4  Approve Change of Record Date Proposed by the Issuer  For  For\n"

	sigs := map[string]string{}
	for name, body := range map[string]string{"mmm": a, "ko": b, "xom": c} {
		res := parseText([]byte(edgarEnvelope("0000000001", "0000000000-00-0000", body)), meta)
		if res.Meta.ParseStatus != "skip" {
			t.Skipf("%s no longer skips (layout coverage grew); this test guards the skip signature only", name)
		}
		sigs[name] = res.Meta.Layout
	}
	if len(sigs) < 3 {
		return
	}
	if sigs["mmm"] != sigs["ko"] || sigs["ko"] != sigs["xom"] {
		t.Fatalf("three filings of ONE family got %d distinct signatures (%q, %q, %q); a per-filing fingerprint leaves families as uncountable as the three-label collapse it replaced",
			len(map[string]bool{sigs["mmm"]: true, sigs["ko"]: true, sigs["xom"]: true}),
			sigs["mmm"], sigs["ko"], sigs["xom"])
	}
}

// The plan names the century rule explicitly: "the two-digit year needs a
// century rule and N-PX filings start in 2003". len(date)==8 does not test it --
// 19050518 and 20051805 both satisfy it, and either would put every Broadridge
// row a century or a season off in a panel keyed on meeting date.
func TestLayoutBroadridgeValues(t *testing.T) {
	meta := FilingMeta{FilePath: "edgar/data/1093439/x.txt", FormType: "N-PX"}

	t.Run("shape B values including the century rule", func(t *testing.T) {
		res := parseText([]byte(edgarEnvelope("0001093439", "0000891804-06-000067", broadridgeB)), meta)
		if res.Meta.ParseStatus != "ok" || len(res.Rows) != 2 {
			t.Fatalf("status=%q rows=%d (%s)", res.Meta.ParseStatus, len(res.Rows), res.Meta.ErrorMsg)
		}
		for i, w := range []struct{ seq, date, cast, mgmt, desc string }{
			{"02", "20050518", "Against", "Against", "PROPOSAL TO APPROVE THE 2005 EMPLOYEE STOCK"},
			{"04", "20050518", "For", "For", "PROPOSAL TO RATIFY THE APPOINTMENT OF"},
		} {
			r := res.Rows[i]
			if r.MeetingDate != w.date {
				t.Errorf("row %d meeting_date = %q, want %q -- '18-May-05' is 2005, not 1905, and not 20051805", i, r.MeetingDate, w.date)
			}
			if r.ItemSeq != w.seq {
				t.Errorf("row %d item_seq = %q, want %q", i, r.ItemSeq, w.seq)
			}
			if r.HowVoted != w.cast {
				t.Errorf("row %d how_voted = %q, want %q (the VOTE column)", i, r.HowVoted, w.cast)
			}
			if r.ManagementRecommendation != w.mgmt {
				t.Errorf("row %d mgmt rec = %q, want %q (the FOR/AGAINST MANAGEMENT column)", i, r.ManagementRecommendation, w.mgmt)
			}
			if !strings.Contains(r.VoteDescription, w.desc) {
				t.Errorf("row %d vote_description = %q, want it to contain %q", i, r.VoteDescription, w.desc)
			}
		}
	})

	t.Run("shape A values", func(t *testing.T) {
		res := parseText([]byte(edgarEnvelope("0001415726", "0000894189-24-001264", broadridgeA)), meta)
		if len(res.Rows) != 2 {
			t.Fatalf("rows=%d, want 2", len(res.Rows))
		}
		if res.Rows[0].MeetingDate != "20230509" {
			t.Errorf("meeting_date = %q, want 20230509", res.Rows[0].MeetingDate)
		}
		if res.Rows[0].Ticker != "MMM" || res.Rows[0].CUSIP != "88579Y101" {
			t.Errorf("ticker=%q cusip=%q, want MMM/88579Y101", res.Rows[0].Ticker, res.Rows[0].CUSIP)
		}
	})
}

// A proposal row must never be discarded in silence. The whole point of this run
// is that a filing reported ok while its rows vanished.
func TestLayoutBroadridgeDoesNotSilentlyDropRows(t *testing.T) {
	meta := FilingMeta{FilePath: "x", FormType: "N-PX"}

	t.Run("a blank management column still yields a row", func(t *testing.T) {
		// Routine when the vote is Abstain/Withhold or the item is a
		// shareholder proposal: only ONE trailing vote cell is present.
		body := "Ticker: MMM\nMeeting Date: 09-May-2023\nCUSIP: 88579Y101\n" +
			"Prop.#  Proposal                       Vote      For/Against\n" +
			"1       Elect Director Thomas Anderson  For       For\n" +
			"2       Ratify Auditors                 Abstain\n" +
			"3       Report on Political Spending    Against\n"
		res := parseText([]byte(edgarEnvelope("0001415726", "0000894189-24-001264", body)), meta)
		if res.Meta.ParseStatus != "ok" {
			t.Fatalf("status=%q (%s)", res.Meta.ParseStatus, res.Meta.ErrorMsg)
		}
		if len(res.Rows) != 3 {
			t.Fatalf("got %d rows, want 3 -- a proposal whose management column is blank must still be emitted, not discarded while the filing reports ok", len(res.Rows))
		}
		if res.Rows[1].HowVoted != "Abstain" {
			t.Errorf("row 1 how_voted = %q, want Abstain", res.Rows[1].HowVoted)
		}
		if res.Rows[2].HowVoted != "Against" {
			t.Errorf("row 2 how_voted = %q, want Against", res.Rows[2].HowVoted)
		}
	})

	t.Run("a proposal naming a label word does not terminate the table", func(t *testing.T) {
		body := "Ticker: MMM\nMeeting Date: 09-May-2023\nCUSIP: 88579Y101\n" +
			"Prop.#  Proposal                                     Vote     For/Against\n" +
			"1       Elect Director Thomas Anderson               For      For\n" +
			"5       Approve Change of Record Date for Meeting    Against  Against\n" +
			"6       Ratify Auditors                              For      For\n"
		res := parseText([]byte(edgarEnvelope("0001415726", "0000894189-24-001264", body)), meta)
		if len(res.Rows) != 3 {
			t.Fatalf("got %d rows, want 3 -- a proposal whose TEXT contains 'Record Date' must not be read as a block header and drop every proposal after it", len(res.Rows))
		}
		for i, r := range res.Rows {
			if r.MeetingDate != "20230509" {
				t.Errorf("row %d meeting_date = %q, want 20230509 (a label word inside proposal text must not blank the meeting date)", i, r.MeetingDate)
			}
		}
	})

	t.Run("a block with no ticker does not inherit the previous one", func(t *testing.T) {
		body := "Ticker: MMM\nMeeting Date: 09-May-2023\nCUSIP: 88579Y101\n" +
			"Prop.#  Proposal                       Vote   For/Against\n" +
			"1       Elect Director Thomas Anderson  For    For\n" +
			"\nCUSIP: 007383103\nMeeting Date: 18-May-2005\n" +
			"Prop.#  Proposal              Vote   For/Against\n" +
			"1       Approve Stock Plan     For    For\n"
		res := parseText([]byte(edgarEnvelope("0001415726", "0000894189-24-001264", body)), meta)
		if len(res.Rows) != 2 {
			t.Fatalf("got %d rows, want 2", len(res.Rows))
		}
		if res.Rows[1].Ticker == "MMM" {
			t.Fatalf("the second block carries no Ticker label but inherited %q from the first; fabricated attribution is worse than a dropped row", res.Rows[1].Ticker)
		}
		if res.Rows[1].CUSIP != "007383103" {
			t.Errorf("row 1 cusip = %q, want 007383103", res.Rows[1].CUSIP)
		}
	})
}

// A genuinely BLANK Mgt Rec column, from the real filing in
// testdata/broadridge/E9.txt. Earlier ISS fixtures used the literal token "---",
// which peels like any other value; an empty column does not, and the shipped
// parser swallows the remaining cells into the proposal text:
//
//	[0] seq="1" how="" mgmt="" src="" desc="Receive Financial Statements and None Ma..."
//
// This is the same defect class as the Broadridge blank-management column: a
// right-peeling parser that requires every trailing cell to be present.
func TestLayoutISSNPXBlankMgtRec(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "broadridge", "E9.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	res := parseText([]byte(edgarEnvelope("0001084380", "0000930413-04-004118", string(b))),
		FilingMeta{FilePath: "edgar/x.txt", FormType: "N-PX"})

	if res.Meta.Layout != "issnpx" {
		t.Fatalf("layout = %q, want issnpx", res.Meta.Layout)
	}
	if len(res.Rows) < 6 {
		t.Fatalf("got %d rows, want at least 6", len(res.Rows))
	}

	r := res.Rows[0]
	if r.ItemSeq != "1" {
		t.Fatalf("row 0 item_seq = %q, want 1", r.ItemSeq)
	}
	if r.HowVoted != "None" {
		t.Errorf("row 0 how_voted = %q, want None -- the Vote Cast cell is present even though Mgt Rec is blank", r.HowVoted)
	}
	if r.ManagementRecommendation != "" {
		t.Errorf("row 0 mgmt rec = %q, want empty -- the column is blank in the filing and must not be invented", r.ManagementRecommendation)
	}
	if r.VoteSource != "Management" {
		t.Errorf("row 0 sponsor = %q, want Management", r.VoteSource)
	}
	if strings.Contains(r.VoteDescription, "None") || strings.Contains(r.VoteDescription, "Management") {
		t.Errorf("row 0 vote_description = %q -- the trailing cells were swallowed into the proposal text", r.VoteDescription)
	}

	// The fully-populated rows must be unaffected.
	if res.Rows[1].HowVoted != "For" || res.Rows[1].ManagementRecommendation != "For" {
		t.Errorf("row 1 = %q/%q, want For/For", res.Rows[1].HowVoted, res.Rows[1].ManagementRecommendation)
	}
}

// Wrapped proposal text where the vote cells lead the row. Measured at 96.7% of
// real rows; every earlier ISS fixture put the vote cells on the LAST line, so
// the row closed after the continuation and nothing exercised this shape.
// Verbatim from testdata/broadridge/E9.txt.
//
// Row 3's continuation line is the single word "Management" -- a sponsor token
// standing alone -- so a parser that peels vocabulary words off a continuation
// will both truncate the text AND invent a sponsor. Row 5 wraps across four lines.
func TestLayoutISSNPXWrappedTextWithLeadingVote(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "broadridge", "E9.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	res := parseText([]byte(edgarEnvelope("0001084380", "0000930413-04-004118", string(b))),
		FilingMeta{FilePath: "edgar/x.txt", FormType: "N-PX"})

	if res.Meta.Layout != "issnpx" {
		t.Fatalf("layout = %q, want issnpx", res.Meta.Layout)
	}
	if len(res.Rows) < 6 {
		t.Fatalf("got %d rows, want at least 6", len(res.Rows))
	}

	want := []struct{ seq, desc, cast, mgmt string }{
		{"1", "Receive Financial Statements and Statutory Reports", "None", ""},
		{"2", "Accept Financial Statements and Statutory Reports", "For", "For"},
		{"3", "Approve Discharge of Board and Senior Management", "For", "For"},
		{"4", "Approve Allocation of Income and Omission of Dividends", "For", "For"},
		{"5", "Reelect Roger Agnelli, Juergen Dormann, Louis Hughes, Hans Maerki, " +
			"Michel de Rosen, Michael Treschow, Bernd Voss, and Jacob Wallenberg as Directors", "For", "For"},
		{"6", "Ratify Ernst & Young AG as Auditors", "For", "For"},
	}
	for i, w := range want {
		r := res.Rows[i]
		if r.ItemSeq != w.seq {
			t.Errorf("row %d item_seq = %q, want %q", i, r.ItemSeq, w.seq)
			continue
		}
		if got := strings.Join(strings.Fields(r.VoteDescription), " "); got != w.desc {
			t.Errorf("row %d vote_description:\n got %q\nwant %q", i, got, w.desc)
		}
		if r.HowVoted != w.cast {
			t.Errorf("row %d how_voted = %q, want %q", i, r.HowVoted, w.cast)
		}
		if r.ManagementRecommendation != w.mgmt {
			t.Errorf("row %d mgmt rec = %q, want %q", i, r.ManagementRecommendation, w.mgmt)
		}
		if r.VoteSource != "Management" {
			t.Errorf("row %d sponsor = %q, want Management", i, r.VoteSource)
		}
	}
}
