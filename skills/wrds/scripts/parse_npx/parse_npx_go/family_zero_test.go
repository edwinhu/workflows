package main

import (
	"path/filepath"
	"testing"
)

// familyZeroDispatch runs the real dispatch on a family ZERO fixture and hands
// back the rows and the manifest row, without asserting a precondition: the
// defect under test IS the empty result, so a precondition on it would turn
// every one of these into a fixture error rather than a failed assertion.
func familyZeroDispatch(t *testing.T, fixture string) ([]VoteRow, FilingMeta) {
	t.Helper()
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_zero", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	return rows, meta
}

// 000106/1064642/0000950135-04-004280.txt: 22-34, 53-59, 110-138, 166.
// streetTRACKS Series Trust 2004 (CIK 1064642, 2.9 MB) prints 1,096 ISS
// `VOTE SUMMARY REPORT` sections, one per fund per page, each opening with a
// fund banner carrying an internal account code and each wrapped in an EDGAR
// text `<TABLE>` block. Verbatim:
//
//	STREETTRACKS MORGAN STANLEY TECHNOLOGY INDEX FUND - J920
//
//	<TABLE>
//	<CAPTION>
//	Mtg               Company/                                   Mgmt         Vote        Record                      Shares
//	Date/Type         Ballot Issues                  Security    Rec          Cast        Date         Prpnent        Voted
//	- ------------------------------------------------------------------------------------------------------------------------
//	<S>               <C>                            <C>         <C>          <C>         <C>          <C>            <C>
//	02/05/04 - A      ACCENTURE LTD BERMUDA *ACN*    G1150G111                            12/08/03                    27,183
//
//	                  1       Appoint Dennis F. Hightower,       For          For                      Mgmt
//
// Three gates refuse it in turn, and the third is the one that makes the
// manifest lie.
//
//  1. The column header is STACKED over two physical lines -- `Mgmt`/`Rec`,
//     `Vote`/`Cast`, `Shares`/`Voted` -- so no line carries the contiguous
//     string `VOTE CAST` and hasISSColumnHeader (text_parser.go:285) never
//     fires. No other registry signature matches either, so no layout claims it.
//  2. For the same reason hasVoteTableVocabulary (text_parser.go:708) is false:
//     measured on the whole 2.9 MB filing, every strong needle -- `vote cast`,
//     `votes cast`, `how voted`, `shares voted`, `management recommendation`,
//     `mgt rec`, `mgmt rec` -- occurs 0 times, and so do all three weak ones
//     (`meeting date`, `security id`, `cusip`).
//  3. That clears the way to htmlPrintsNoVoteTable (layout_htmltable.go:781),
//     which answers "this body prints a <table> wrapper and not one cell tag,
//     so it is a cover page". The 1,096 `<TABLE>` tags here are EDGAR's
//     fixed-width TEXT convention -- `<TABLE>`/`<CAPTION>`/`<S>`/`<C>` with no
//     `<td>` anywhere in the corpus of that era -- so the predicate is asking
//     an HTML question of a body that contains no HTML. The filing lands
//     parse_status=ok, layout=cover-page, n_rows=0.
//
// Fix in layout_htmltable.go, in htmlPrintsNoVoteTable: an EDGAR text `<TABLE>`
// block is not evidence of a cell-less HTML table. Require real HTML table
// markup before the cover-page verdict -- a `<table` with attributes, or a
// `<tr>` -- and treat a bare `<TABLE>` followed by `<CAPTION>`/`<S>`/`<C>` as
// no table markup at all, which returns the filing to parse_status=skip with a
// body-derived signature. The durable repair is a layout for this grammar,
// keyed on the stacked `Mgmt`/`Vote`/`Shares` over `Rec`/`Cast`/`Voted` header
// pair; the gate fix is what stops the manifest from claiming the filing was
// read.
func TestFamilyZeroStreettracksVoteSummaryStackedHeader(t *testing.T) {
	rows, meta := familyZeroDispatch(t, "streettracks_vote_summary_stacked_header.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 3 proposals under ACCENTURE LTD BERMUDA (G1150G111, meeting 02/05/04) for STREETTRACKS MORGAN STANLEY TECHNOLOGY INDEX FUND - J920",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.CUSIP != "G1150G111" {
			continue
		}
		seen++
		if r.MeetingDate != "20040205" {
			t.Errorf("meeting date: got %q want %q (desc=%q)", r.MeetingDate, "20040205", r.VoteDescription)
		}
		if r.IssuerName != "ACCENTURE LTD BERMUDA *ACN*" {
			t.Errorf("issuer: got %q want %q", r.IssuerName, "ACCENTURE LTD BERMUDA *ACN*")
		}
		if r.FundName != "STREETTRACKS MORGAN STANLEY TECHNOLOGY INDEX FUND - J920" {
			t.Errorf("fund: got %q want %q", r.FundName, "STREETTRACKS MORGAN STANLEY TECHNOLOGY INDEX FUND - J920")
		}
		want := "For"
		if r.ItemSeq == "3" {
			want = "None"
		}
		if r.HowVoted != want {
			t.Errorf("item %q how_voted: got %q want %q", r.ItemSeq, r.HowVoted, want)
		}
	}
	if seen != 3 {
		t.Fatalf("found %d of the 3 ACCENTURE proposals in %d parsed", seen, len(rows))
	}
}

// 000155/1559109/0000891092-15-008049.txt: 12-25, 43-54, 92-100, 207-208,
// 214-224, 235-254, 505. ETFis Series Trust 2015 (CIK 1559109, 1.4 MB) prints
// the SEC's own Form N-PX Item 1 column wording as its table header, so the
// vote column's label is a full sentence:
//
//	Issuer of Portfolio Security | Exchange Ticker Symbol | CUSIP # |
//	Shareholder Meeting Date | Summary of Matter Voted On |
//	Who Proposed Matter: Issuer / Shareholder |
//	Whether Fund Cast Vote on Matter |
//	Fund's Vote For or Against Proposal, or Abstain; For or Withhold Regarding Election of Directors |
//	Whether Vote Was For or Against Management
//
// The eighth label is 96 bytes. htmlHeaderShape (layout_htmltable.go:1746)
// rejects a candidate header the moment one non-empty cell fails
// htmlLooksLikeValueLimit at htmlLabelMaxLen = 80 (layout_htmltable.go:91) and
// is not one of the known header words, so this row is read as DATA, no header
// is ever adopted, parseHTMLTableRaw returns errLayoutDeclined
// (layout_htmltable.go:724) and the filing is skip with n_rows=0. Every column
// beneath it is filled: `Atlas Pipeline Partners, L.P.`, `APL`, `49392103`,
// `2/20/2015`, `Approve Merger Agreement`, `Issuer`, `Yes`, `For`, `For`.
//
// Fix in layout_htmltable.go, in htmlHeaderShape: the length ceiling exists to
// stop a wrapped proposal description from being read as a label, but the SEC's
// prescribed column wording is longer than any of them. Recognise the
// prescribed sentences (the `Fund's Vote For or Against ...` and `Whether ...`
// forms) as header words in htmlIsHeaderWord, or raise the ceiling for a cell
// that htmlMapFields already maps to a field, so a header cell that names a
// known column is never demoted to a value on length alone.
func TestFamilyZeroInfracapSECSentenceVoteLabel(t *testing.T) {
	rows, meta := familyZeroDispatch(t, "infracap_mlp_etf_sec_sentence_vote_label.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 2 Atlas Pipeline Partners proposals (CUSIP 49392103, meeting 2/20/2015, voted For) under the INFRACAP MLP ETF heading",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "Atlas Pipeline Partners, L.P." {
			continue
		}
		seen++
		if r.CUSIP != "49392103" {
			t.Errorf("cusip: got %q want %q", r.CUSIP, "49392103")
		}
		if r.MeetingDate != "20150220" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20150220")
		}
		if r.HowVoted != "For" {
			t.Errorf("how_voted: got %q want %q (desc=%q)", r.HowVoted, "For", r.VoteDescription)
		}
	}
	if seen != 2 {
		t.Fatalf("found %d of the 2 Atlas Pipeline proposals in %d parsed", seen, len(rows))
	}
}

// 000089/897111/0000894189-16-011099.txt: 12-25, 248-256, 320-326, 459-500,
// 48004. Eagle Series Trust 2016 (CIK 897111, 4.8 MB) prints 3,900 item-level
// vote records across five per-fund HTML tables whose header is:
//
//	Name (Eagle Fund Name) | Cusip | Symbol | Description (Company Name) |
//	Meeting Date | Issue (What Issue was voted on?)
//
// -- and, in four of the five tables, a seventh column
// `Was this a Shareholder, Management, or Issuer Proposal?`. There is no vote
// column in any of them: `how voted`, `vote cast` and `vote` as a column label
// occur nowhere in the 4.8 MB.
//
// htmlHeaderShape refuses a header with no htmlFieldVote outright
// (layout_htmltable.go:1759-1761), so no header is adopted, parseHTMLTableRaw
// returns errLayoutDeclined and all 3,900 records are lost -- including the
// fund name, issuer, CUSIP, ticker, meeting date and proposal text, every one
// of which the filing does print and every one of which the ISS item join needs.
//
// The how_voted value is a FLOOR for this family: the filing prints it nowhere,
// so no parse can recover it and none should invent one. The remaining columns
// are not. family CORN already established that a row whose vote cell is blank
// is kept rather than dropped, so a blank how_voted is the shape the rest of
// this parser expects.
//
// Fix in layout_htmltable.go, in htmlHeaderShape: make the htmlFieldVote
// requirement conditional rather than absolute. A header that maps an issuer,
// a CUSIP, a meeting date AND a description is an item table whether or not it
// names a vote column; admit it and let the rows carry an empty how_voted,
// exactly as the blank-vote-cell rows of family CORN do.
func TestFamilyZeroEagleSeriesTrustNoVoteColumn(t *testing.T) {
	rows, meta := familyZeroDispatch(t, "eagle_series_trust_no_vote_column.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 1 Ypsomed Holding AG record (CUSIP H9725B102, ticker YPSN, meeting 7/1/2015) for Eagle International Stock Fund",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "Ypsomed Holding AG" {
			continue
		}
		seen++
		if r.FundName != "Eagle International Stock Fund" {
			t.Errorf("fund: got %q want %q", r.FundName, "Eagle International Stock Fund")
		}
		if r.CUSIP != "H9725B102" {
			t.Errorf("cusip: got %q want %q", r.CUSIP, "H9725B102")
		}
		if r.MeetingDate != "20150701" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20150701")
		}
		if r.VoteDescription != "Accept Financial Statements and Statutory Reports" {
			t.Errorf("description: got %q want %q", r.VoteDescription, "Accept Financial Statements and Statutory Reports")
		}
		if r.HowVoted != "" {
			t.Errorf("how_voted: got %q want %q -- the filing prints no vote column", r.HowVoted, "")
		}
	}
	if seen != 1 {
		t.Fatalf("found %d of the 1 Ypsomed record in %d parsed", seen, len(rows))
	}
}

// 000176/1767306/0001420506-24-001631.txt: 11-25, 45, 117-138, 41895-41899.
// Vanguard
// Personalized Indexing Management 2024 (CIK 1767306, 3.2 MB) is a modern-era
// filing whose second document is named FormN-PX_ProxyVoteTable.xml and
// declares <TYPE>PROXY VOTING RECORD -- but its payload is a SECOND
// edgarSubmission, and the 3,095 proxyTable records are carried inside it
// base64-encoded in a <com:contents> element:
//
//	<com:document><com:conformedName>ProxyVotingTable.xml</com:conformedName>
//	<com:conformedDocumentType>PROXY VOTING RECORD</com:conformedDocumentType>
//	<com:contents>PD94bWwgdmVyc2lvbj0iMS4wIiA/PjxpbmY6cHJveHlWb3RlVGFibGUgeG1sbnM6aW5mPSJodHRw
//	Oi8vd3d3LnNlYy5nb3YvZWRnYXIvZG9jdW1lbnQvbnB4cHJveHkvaW5mb3JtYXRpb250YWJsZSI+
//
// Decoded, those bytes open
// `<?xml version="1.0" ?><inf:proxyVoteTable ...><inf:proxyTable>` and the first
// record is Snowflake Inc., CUSIP 833445109, meeting 07/05/2023, howVoted FOR.
// detectMode returns "xml" on the filename, parseNPXXML walks the document and
// finds no proxyVoteTable element anywhere -- the only one in the file is inside
// the base64 -- and the filing is recorded parse_status=ok with n_rows=0.
//
// The fixture carries the first 15 lines of the <com:contents> payload -- where
// exactly one proxyTable record closes -- and then the filing's own last five
// lines, which close <com:contents>, the submission and the SGML envelope. The
// base64 run is cut on line boundaries, so it decodes cleanly to that prefix,
// and the fixture reproduces the real filing's manifest row exactly:
// parse_mode=xml, parse_status=ok, n_rows=0.
//
// Fix in xml_parser.go, in parseNPXXML: when the walk finds no proxyVoteTable
// but the submission carries a <com:document> whose conformedDocumentType is
// PROXY VOTING RECORD and a non-empty <com:contents>, base64-decode that element
// and run the same proxyVoteTable walk over the decoded bytes.
func TestFamilyZeroVanguardPIMBase64Contents(t *testing.T) {
	rows, meta := familyZeroDispatch(t, "vanguard_pim_base64_contents.txt")
	if len(rows) == 0 {
		t.Fatalf("base64 vote table never read: mode=%s status=%s layout=%s rows=0 error=%q; the fixture's <com:contents> decodes to a proxyVoteTable whose first record is Snowflake Inc. (CUSIP 833445109, meeting 07/05/2023, FOR)",
			meta.ParseMode, meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "Snowflake Inc." {
			continue
		}
		seen++
		if r.CUSIP != "833445109" {
			t.Errorf("cusip: got %q want %q", r.CUSIP, "833445109")
		}
		if r.MeetingDate != "20230705" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20230705")
		}
		if r.HowVoted != "FOR" {
			t.Errorf("how_voted: got %q want %q", r.HowVoted, "FOR")
		}
	}
	if seen != 1 {
		t.Fatalf("found %d of the 1 Snowflake record in %d parsed", seen, len(rows))
	}
}
