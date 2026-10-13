package main

import (
	"path/filepath"
	"testing"
)

// familySkipDispatch runs the real dispatch on a family SKIP fixture and hands
// back the rows and the manifest row, without asserting a precondition: the
// defect under test IS the empty result, so a precondition on it would turn
// every one of these into a fixture error rather than a failed assertion.
//
// Family SKIP is the sibling of family ZERO. ZERO's members claim
// parse_status=ok and report n_rows=0, which is a lying manifest row; SKIP's
// members are honest -- parse_status=skip with a body-derived signature -- and
// the loss is the same. All five shapes below reach that skip the same way: no
// named registry layout matches the body, htmltable offers itself to everything
// (matchHTMLTable returns true unconditionally, text_parser.go:103), reads the
// body, emits no row and returns errLayoutDeclined (layout_htmltable.go:724).
// What differs between them is WHICH grammar the filing is written in, and that
// is what each test names.
func familySkipDispatch(t *testing.T, fixture string) ([]VoteRow, FilingMeta) {
	t.Helper()
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_skip", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	return rows, meta
}

// 000091/919160/0001144204-11-048251.txt: 12-15, 127-132, 297-304, 314-315,
// 320-330, 344-356, 403-446, 314-315, and the filing's own last three lines.
// Guinness Atkinson Funds 2011 (CIK 919160, 10.8 MB) is a Broadridge ProxyEdge
// ballot-detail export rendered by Vintage Filings' EDGARizerAgent. Every
// logical column is one <td> carrying a <div><font> wrapper, so after stripHTML
// the whole table arrives one cell per line:
//
//	Guinness Atkinson Alternative Energy Fund
//	ENERGY DEVELOPMENT (EDC) CORPORATION
//	Ticker:
//	Meeting Date:
//	29-Jul-2010
//	Item / Proposal / Recommendation / For / Against / Abstain / Take No Action
//	1 / Call to order / For / 16068000 / 0 / 0 / 0
//
// The identity is LABEL: VALUE pairs spread over their own rows (Security:,
// Meeting Type:, Ticker:, Meeting Date:, ISIN, Agenda, Total Ballot Shares:,
// Last Vote Date:), and the vote itself is not a word in a Vote Cast column:
// the fund's ballot is reported as a SHARE COUNT under whichever of the
// For/Against/Abstain/Take No Action columns it was cast in, 16,068,000 under
// For here, with the management recommendation carried separately in
// Recommendation.
//
// No named layout matches. labelvalue wants a single line whose first cell is
// `#` and which also carries `Proposal` and `Vote Cast`
// (lvColumnHeader, layout_labelvalue.go:55-69) -- this header is seven separate
// lines and names neither. htmltable then reads the raw cells and cannot map a
// header either, because htmlHeaderShape requires a cell mapping htmlFieldVote
// (layout_htmltable.go:1759-1761) and none of Item/Proposal/Recommendation/For/
// Against/Abstain/Take No Action is a vote synonym: `For` and `Against` name
// share-count columns here, not a vote value. parseHTMLTableRaw emits nothing
// and returns errLayoutDeclined.
//
// Fix in layout_htmltable.go, in htmlHeaderShape and the mapping it feeds: admit
// the ProxyEdge ballot header -- an Item/Proposal band followed by the ballot
// disposition columns -- and read the vote from WHICH disposition column carries
// the non-zero share count, filling how_voted with that column's label and
// shares_voted with the count. The identity for the block comes from the
// LABEL: VALUE rows above it, which htmlReadContext (layout_htmltable.go:676)
// already knows how to consume once the header is adopted.
func TestFamilySkipGuinnessAtkinsonProxyEdgeGrid(t *testing.T) {
	rows, meta := familySkipDispatch(t, "guinness_atkinson_proxyedge_grid.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 1 ENERGY DEVELOPMENT (EDC) CORPORATION proposal (meeting 29-Jul-2010, item 1 Call to order, 16068000 shares cast For) for Guinness Atkinson Alternative Energy Fund",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "ENERGY DEVELOPMENT (EDC) CORPORATION" {
			continue
		}
		seen++
		if r.FundName != "Guinness Atkinson Alternative Energy Fund" {
			t.Errorf("fund: got %q want %q", r.FundName, "Guinness Atkinson Alternative Energy Fund")
		}
		if r.MeetingDate != "20100729" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20100729")
		}
		if r.VoteDescription != "Call to order" {
			t.Errorf("description: got %q want %q", r.VoteDescription, "Call to order")
		}
		if r.HowVoted != "For" {
			t.Errorf("how_voted: got %q want %q -- 16068000 shares sit in the For column", r.HowVoted, "For")
		}
		if r.ManagementRecommendation != "For" {
			t.Errorf("management recommendation: got %q want %q", r.ManagementRecommendation, "For")
		}
	}
	if seen != 1 {
		t.Fatalf("found %d of the 1 ENERGY DEVELOPMENT proposal in %d parsed", seen, len(rows))
	}
}

// 000070/709364/0001206774-04-000931.txt: 22-35, 53-59, 119-133, and a closing
// </TABLE>. The Royce Fund 2004 (CIK 709364, 2.9 MB) is one of a large 2004
// cohort filed through agent 0001206774 whose proxy record is a run of blocks
// inside EDGAR's fixed-width text <TABLE>:
//
//	AAON, INC.                                    Agenda: 932150915
//	     CUSIP: 000360206           Meeting Type: Annual
//	    Ticker: AAON                Meeting Date: 5/25/2004       ISIN:
//	                                                        For/Against
//	Proposal                          Type        Vote        Management
//	- ------------------------------------------------------------------
//	01     THOMAS E. NAUGLE           Mgmt          For           For
//
// The identity is RIGHT-ALIGNED LABEL: VALUE pairs (`     CUSIP:`,
// `    Ticker:`) rather than a column table, and the proposal header is STACKED
// over two physical lines -- `For/Against` alone on the first, `Management` under
// it on the second -- so no single line carries a contiguous vote-column name.
//
// Nothing in the registry matches. icr wants six gap-separated columns with the
// proponent FIRST (layout_icr.go:36-47); here the proponent (`Mgmt`) is second
// of four and the last column is For/Against Management. labelvalue wants a `#`
// header line carrying `Proposal` and `Vote Cast` (layout_labelvalue.go:55-69);
// this header line reads `Proposal Type Vote Management`. pvtext wants
// `ISSUER NAME TICKER CUSIP MTG DATE` (layout_pvtext.go:424-429). The filing
// does print `Vote Cast` nowhere at all, which is exactly why the stacked
// header defeats every signature. htmltable then declines the body.
//
// Fix in layout_labelvalue.go, in lvColumnHeader and matchLabelValue: this IS
// the labelvalue grammar -- LABEL: VALUE identity over a proposal table whose
// roles come from the header line -- with a different header spelling and a
// wrapped last label. Admit a header line whose first cell is `Proposal` and
// which carries a `Vote` cell, joining it with the `For/Against` fragment on the
// line above the way the stacked ISS headers are joined elsewhere, and let
// lvPairs read the right-aligned `CUSIP:` / `Ticker:` / `Meeting Date:` cells
// that it already parses today.
func TestFamilySkipRoyceFundThomsonAgendaBlock(t *testing.T) {
	rows, meta := familySkipDispatch(t, "royce_fund_thomson_agenda_block.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 2 AAON, INC. proposals (CUSIP 000360206, ticker AAON, meeting 5/25/2004, both voted For) under the PENNSYLVANIA MUTUAL FUND heading",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "AAON, INC." {
			continue
		}
		seen++
		if r.CUSIP != "000360206" {
			t.Errorf("cusip: got %q want %q", r.CUSIP, "000360206")
		}
		if r.Ticker != "AAON" {
			t.Errorf("ticker: got %q want %q", r.Ticker, "AAON")
		}
		if r.MeetingDate != "20040525" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20040525")
		}
		if r.FundName != "PENNSYLVANIA MUTUAL FUND" {
			t.Errorf("fund: got %q want %q", r.FundName, "PENNSYLVANIA MUTUAL FUND")
		}
		if r.HowVoted != "For" {
			t.Errorf("how_voted: got %q want %q (desc=%q)", r.HowVoted, "For", r.VoteDescription)
		}
	}
	if seen != 2 {
		t.Fatalf("found %d of the 2 AAON proposals in %d parsed", seen, len(rows))
	}
}

// 000138/1383496/0001445546-13-003732.txt: 12-18, 252-258, 325-353, 7668, and
// the filing's own last three lines. First Trust Exchange-Traded AlphaDEX Fund
// 2013 (CIK 1383496, 7.0 MB) prints its record as ALTERNATING header bands
// inside an EDGAR text <TABLE>, one pair per meeting:
//
//	MEETING DATE       COMPANY                 TICKER        SECURITY ID
//	07/10/12           The Coca-Cola Company   KO            191216100
//
//	ITEM NUMBER        AGENDA ITEM             MGMT REC      VOTE CAST     PROPONENT
//	1                  Approve Stock Split     For           For           Mgmt
//
// The meeting header and the item header are two DIFFERENT column headers, each
// reprinted before every block, and the meeting's own row sits between them.
//
// pvtext is the layout for exactly this two-band shape, but its first band is
// pinned to one spelling: pvTextHeaderLinesAt requires the line to equal
// `ISSUER NAME TICKER CUSIP MTG DATE` or its longer form
// (layout_pvtext.go:423-429), and this filer writes the same four columns as
// `MEETING DATE COMPANY TICKER SECURITY ID` with the date first. The prefix
// test fails on the first token, so matchPVText never fires, and every other
// signature misses too. htmltable declines the body.
//
// Fix in layout_pvtext.go, in pvTextHeaderLinesAt and pvTextHeaderWords: accept
// the meeting band by its column SET rather than by one exact string -- a line
// naming a meeting date, an issuer/company, a ticker and a security id, in any
// order -- and add MEETING, COMPANY, SECURITY, ID, ITEM, NUMBER, AGENDA, REC
// and PROPONENT to the header vocabulary so the item band is recognised as a
// header rather than read as data.
func TestFamilySkipFirstTrustAlphaDEXTwoBandHeaders(t *testing.T) {
	rows, meta := familySkipDispatch(t, "first_trust_alphadex_two_band_bands.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 1 Coca-Cola proposal (ticker KO, security id 191216100, meeting 07/10/12, Approve Stock Split, VOTE CAST For) for First Trust Large Cap Core AlphaDEX(R) Fund",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "The Coca-Cola Company" {
			continue
		}
		seen++
		if r.Ticker != "KO" {
			t.Errorf("ticker: got %q want %q", r.Ticker, "KO")
		}
		if r.CUSIP != "191216100" {
			t.Errorf("cusip: got %q want %q", r.CUSIP, "191216100")
		}
		if r.MeetingDate != "20120710" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20120710")
		}
		if r.FundName != "First Trust Large Cap Core AlphaDEX(R) Fund" {
			t.Errorf("fund: got %q want %q", r.FundName, "First Trust Large Cap Core AlphaDEX(R) Fund")
		}
		if r.VoteDescription != "Approve Stock Split" {
			t.Errorf("description: got %q want %q", r.VoteDescription, "Approve Stock Split")
		}
		if r.HowVoted != "For" {
			t.Errorf("how_voted: got %q want %q", r.HowVoted, "For")
		}
	}
	if seen != 1 {
		t.Fatalf("found %d of the 1 Coca-Cola proposal in %d parsed", seen, len(rows))
	}
}

// 000116/1168164/0000950123-10-081782.txt: 22-28, 444-450, 483-510, 533, and
// the filing's own last three lines. SPDR Index Shares Funds 2010 (CIK 1168164,
// 15.3 MB) files the ISS institutional-account report: a VOTE SUMMARY REPORT
// banner, a per-fund section, and per-meeting blocks whose identity is
// LABEL: VALUE and whose item table carries a STACKED two-line column header:
//
//	Institutional Account Name: SPDR STOXX Europe 50 ETF
//
//	Ticker:                        Security ID on Ballot: G87621101
//	Meeting Date: 7/3/2009         Shares Available to Vote: 147369
//
//	Item                                        Management       Vote
//	Number  Proposal            Proponet        Recommendation   Instruction
//	- ------  ----------------  --------------  --------------   -----------
//	1       Accept Financial Statements and Statutory Reports  Management  For  For
//
// `Item`/`Number`, `Management`/`Recommendation` and `Vote`/`Instruction` are
// each split across two physical lines, and the filer misspells `Proponent` as
// `Proponet`. splittable DOES match this body on its signature and then declines
// it (layout_splittable.go:118,134): its rule-span reader keys on the dashed rule
// line to cut columns, and the header above that rule is two lines, so the labels
// it recovers (spLabels, layout_splittable.go:444) do not name a vote column.
// htmltable declines it too, and the filing lands in skip.
//
// Fix in layout_splittable.go, in spLabels: join the header lines ABOVE the
// dashed rule column-wise before normalising, so a label stacked over two
// physical lines (`Vote` over `Instruction`) is read as one label in the span
// the rule defines. The rule line already gives the exact spans, so the join is
// positional and needs no vocabulary; the misspelling is then irrelevant, since
// Proponet lands in its own span whatever it is called.
func TestFamilySkipSPDRInstitutionalAccountStackedHeader(t *testing.T) {
	rows, meta := familySkipDispatch(t, "spdr_index_shares_institutional_account.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 5 TESCO PLC proposals (security id G87621101, meeting 7/3/2009, all voted For) for SPDR STOXX Europe 50 ETF",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "TESCO PLC" {
			continue
		}
		seen++
		if r.MeetingDate != "20090703" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20090703")
		}
		if r.CUSIP != "G87621101" {
			t.Errorf("security id: got %q want %q", r.CUSIP, "G87621101")
		}
		if r.FundName != "SPDR STOXX Europe 50 ETF" {
			t.Errorf("fund: got %q want %q", r.FundName, "SPDR STOXX Europe 50 ETF")
		}
		if r.HowVoted != "For" {
			t.Errorf("item %q how_voted: got %q want %q (desc=%q)", r.ItemSeq, r.HowVoted, "For", r.VoteDescription)
		}
	}
	if seen != 5 {
		t.Fatalf("found %d of the 5 TESCO proposals in %d parsed", seen, len(rows))
	}
}

// 000152/1524968/0001398344-13-004223.txt: 12-18, 54-59, 168-177, 192-203,
// 244-259, 274-291, 45129, and the filing's own last four lines. Vericimetry
// Funds 2013 (CIK 1524968, 23.2 MB) prints the labelvalue grammar -- the one
// layout_labelvalue.go was written for -- but inside an HTML <table> rather than
// a fixed-width block, so every cell is its own line after stripHTML:
//
//	1-800-FLOWERS.COM, INC.
//	MEETING DATE:
//	12/10/2012
//	#PROPOSAL
//	BOARD REC
//	VOTE CAST
//	SPONSOR
//	1)
//	GERALYN BREIG
//	FOR
//	FOR
//	MANAGEMENT
//
// matchLabelValue asks whether any ONE LINE, split into gap-separated cells, is
// a `#` cell followed by cells naming Proposal and Vote Cast
// (layout_labelvalue.go:55-78). Here the four header cells are four lines and
// the `#` is glued to its neighbour as `#PROPOSAL`, so the predicate can never
// fire however the line is split. htmltable sees the real <td> markup, but the
// header row's first two cells are empty spacers and the first mapped cell is
// `#PROPOSAL`, which htmlMapFields does not canonicalise to a proposal column,
// so no mapping is adopted and parseHTMLTableRaw returns errLayoutDeclined.
//
// Fix in layout_htmltable.go, in the label canonicalisation htmlHeaderShape
// feeds (htmlCanonLabel and htmlMapFields): strip a leading `#` from a header
// cell before the synonym test, so `#PROPOSAL` maps the same column `Proposal`
// does. The rest of this header -- BOARD REC, VOTE CAST, SPONSOR -- already
// maps, so that one canonicalisation is what stands between the filing and its
// rows.
func TestFamilySkipVericimetryLabelValueHTMLCells(t *testing.T) {
	rows, meta := familySkipDispatch(t, "vericimetry_labelvalue_html_cells.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 1 1-800-FLOWERS.COM, INC. proposal (meeting 12/10/2012, GERALYN BREIG, VOTE CAST FOR)",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	var seen int
	for _, r := range rows {
		if r.IssuerName != "1-800-FLOWERS.COM, INC." {
			continue
		}
		seen++
		if r.MeetingDate != "20121210" {
			t.Errorf("meeting date: got %q want %q", r.MeetingDate, "20121210")
		}
		if r.VoteDescription != "GERALYN BREIG" {
			t.Errorf("description: got %q want %q", r.VoteDescription, "GERALYN BREIG")
		}
		if r.HowVoted != "FOR" {
			t.Errorf("how_voted: got %q want %q", r.HowVoted, "FOR")
		}
		if r.ManagementRecommendation != "FOR" {
			t.Errorf("management recommendation: got %q want %q", r.ManagementRecommendation, "FOR")
		}
	}
	if seen != 1 {
		t.Fatalf("found %d of the 1 1-800-FLOWERS proposal in %d parsed", seen, len(rows))
	}
}
