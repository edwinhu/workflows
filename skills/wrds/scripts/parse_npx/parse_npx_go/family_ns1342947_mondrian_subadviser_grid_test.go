package main

import (
	"path/filepath"
	"testing"
)

const ns1342947MondrianDir = "family_ns1342947_mondrian_subadviser_grid"

// ns1342947MondrianDispatch runs the real dispatch on a fixture in this family's
// testdata dir with the named dictionary loaded, asserting the fixture's own
// preconditions -- status, layout, row count -- so a failure in the body of the
// test below is an assertion about the identity each ballot row carries and never
// a broken fixture or a layout that stopped claiming the document. Same mechanism
// as ns1131042AssetMarkDispatch, pointed at its own testdata dir.
func ns1342947MondrianDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", ns1342947MondrianDir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns1342947MondrianDir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	return rows
}

// ns1342947BootsAgenda is the Boots Group Plc EGM ballot this filing prints under
// the Mondrian masthead, item text verbatim off the fixture, in printed order.
// Every one of the eleven is unique in the fixture, so the set selects exactly
// the meeting's rows without depending on an output index.
var ns1342947BootsAgenda = []string{
	"Approve Merger Agreement with Alliance Unichem Plc; Increase Authorised Capital from GBP 299,999,279 to GBP 479,148,237; Issue Equity with Rights up to GBP 179,148,254 Pursuant with the Merger",
	"Elect Stefano Pessina as Director",
	"Elect George Fairweather as Director",
	"Elect Ornella Barra as Director",
	"Elect Steve Duncan as Director",
	"Elect Adrian Loader as Director",
	"Elect Patrick Ponsolle as Director",
	"Elect Manfred Stach as Director",
	"Elect Scott Wheway as Director",
	"Amend Articles of Association",
	"Change Company Name to Alliance Boots Plc",
}

// BBH TRUST, CIK 1342947, period 20070630, filing
// 000134/1342947/0001318148-07-001391.txt (`proxyedge`, 1811 rows). The
// top-ranked open, non-floored, non-exhausted CIK in the N-PX residue ranking.
//
// MEASURED on the real filing entire, through the real dispatch on HEAD (all
// 70801 lines, this CIK's 7 declared series loaded as the dictionary):
//
//	status=ok layout=proxyedge rows=1811
//	800 of those rows carry NO cusip and NO meeting date
//	24 of them carry the share count `271,297` in the ISSUER column
//
// The 800 undated, un-CUSIPed rows are why this filing's residual meetings can
// never link: build_matched.py's JOIN_AUDIT reports candidate_rows=0 at every
// meeting_rule stage for them, and it does so because npx_meetings.cusip9 and
// npx_meetings.meetingdate are blank, not because of anything in the join.
//
// THE SHAPE, and it is not the shape the rest of the filing uses. The filing
// prints BBH International Equity Fund's votes TWICE, under two different
// sub-advisers and in two different grammars:
//
//   - The `Selected Accounts` / ProxyEdge grid (Account Number / Custodian /
//     Ballot Shares / Unavailable Shares / Vote Date / Date Confirmed), which
//     stacks the ballot's identity one LABEL PER LINE above the grid --
//     `Security:`, `Ticker:`, `Meeting Date:` each alone in its own cell. This is
//     the grammar `parseProxyEdge` was written for, it is what claims the document
//     for this layout (matchProxyEdge requires a colon-suffixed identity label,
//     and the only ones in the filing are in these sections, from source line
//     39771), and its rows come out right.
//
//   - A second, distinct sub-adviser section opening at source line 12089 with a
//     bold three-line banner -- `Mondrian Investment Partners Limited` / `BBH
//     International Equity Fund` / `Proxy Voting Detail - 01/07/06 - 30/0/6/07`
//     -- whose ballots are laid out TWO ROWS PER MEETING in LABELLED CELLS
//     SIDEWAYS, not stacked:
//
//     row 1:  <bold issuer, no label>  | `Shares Voted` -> 271,297 | `Security` -> G12517119
//     row 2:  `Meeting Date` -> 07/04/2006 | `Shares` -> 271,297 | `Meeting Type` -> EGM | `Record Date` -> N/A
//
//     Nothing in this shape is a stacked `Label:` cell, and the label sits in the
//     cell BESIDE its value rather than above it.
//
// THE DEFECT. parseProxyEdge reads the second shape positionally, as though the
// cell after the bold heading were the identity block it stacks. So the issuer
// heading `Boots Group Plc` is discarded and the row's THIRD filled cell -- the
// repeated share count -- lands in the issuer column, while `Security` ->
// G12517119 and `Meeting Date` -> 07/04/2006 are never read as label/value pairs
// at all. Measured on this fixture on HEAD, all eleven ballots of the Boots EGM
// come out:
//
//	series="S000015105" fund="BBH INTERNATIONAL EQUITY FUND" issuer="271,297" cusip="" date=""
//
// The fund attribution is ALREADY RIGHT and is asserted below only as a
// regression guard: `BBH INTERNATIONAL EQUITY FUND` is the name the filing's own
// header declares at source lines 62-63 (`<SERIES-ID>S000015105` /
// `<SERIES-NAME>BBH International Equity Fund`). Nothing in a fix for this family
// may touch series or fund resolution.
//
// ON THE MEETING DATE, which is genuinely ambiguous in the bytes. The value is
// `07/04/2006`, and this section's own header frames its period day-first --
// `Proxy Voting Detail - 01/07/06 - 30/0/6/07`, the filing's 1 July 2006 - 30
// June 2007 reporting year spelt DD/MM/YY, where the sibling Walter Scott section
// spells the same period `7/1/2006 - 6/30/2007`. Read day-first the value is 7
// April 2006, which falls OUTSIDE the period this very header states; read
// month-first it is 4 July 2006, which falls inside it. The codebase settles it
// the same way: `brDate` (layout_broadridge.go:2810) is the only slash-date
// reader any layout uses, and it reads a slash form as mm/dd/yy(yy)
// unconditionally -- there is no day-first slash rung anywhere to route this
// value through. So the assertion is 20060704, which is both the codebase's
// established precedent and the only reading consistent with the block's own
// stated period. A future decision to read this vendor's slash dates day-first
// would be a separate change and would have to move this constant deliberately.
//
// FIXTURE PROVENANCE. mondrian_boots_grid.txt is four verbatim line-range cuts of
// the real filing, concatenated in source order with nothing synthesised and
// nothing edited (1213 lines, md5 1ca799fbd01577245361402349c8357d):
//
//	1-143         the PRIVACY-ENHANCED MESSAGE opener, the whole SEC-HEADER
//	              (including the SERIES-AND-CLASSES-CONTRACTS-DATA block declaring
//	              all 7 series, S000015105 at lines 62-63), the document preamble,
//	              <TEXT>, <html>, <head>, <body>
//	219-568       the head of the FIRST ProxyEdge section -- the `BBH CORE SELECT
//	              FUND` banner, the `Vote Summary` table, MICROSOFT CORPORATION's
//	              stacked identity block (`Security` 594918104, `Meeting Date`
//	              14-Nov-2006), the `Item | Proposal | Type | Vote | For/Against
//	              Management` header band and ballots 1A-1D. This is the grammar
//	              that reads correctly, and it is here because it is half of what
//	              the layout match needs.
//	12088-12519   the Mondrian section: the standalone `BBH INTERNATIONAL EQUITY
//	              FUND` div (12088-12089), the three-line Mondrian masthead
//	              (12096-12113), the spacer row, Boots Group Plc's two-row labelled
//	              identity block (12124-12169), the `Ballot Issues | Proponent |
//	              Mgmt Rec | ISS Rec | Vote Cast` band, all eleven ballots, the
//	              meeting's own `Fund / Shares Voted / Shares` + `Total:` recap,
//	              and the FIRST CELL of the NEXT meeting's banner (12515-12519,
//	              a second `Boots Group Plc` masthead) -- enough to prove the
//	              parser stops at this block's end and does not run on, with none
//	              of that meeting's own items included
//	39729-40001   the third section's Walter Scott & Partners masthead and
//	              INDUSTRIA DE DISENO TEXTIL INDITEX SA's ballot. This carries the
//	              filing's colon-suffixed identity labels (`Security:` 39771,
//	              `Ticker:` 39788) -- the other half of matchProxyEdge, and the
//	              reason the real filing dispatches to `proxyedge` rather than to
//	              `htmltable`. THIS SLICE IS LOAD-BEARING: cut down to the Mondrian
//	              block alone, the fixture dispatches to `htmltable`, which reads
//	              this labelled-cell shape CORRECTLY (issuer `Boots Group Plc`,
//	              cusip G12517119, date 20060704). The defect is proxyedge's, and
//	              only a fixture the proxyedge match claims can show it.
//
// The only added bytes are the container closers between and after the cuts
// (`</table>`, `</div>`, `</tr>`, `</body>`, `</html>`, `</TEXT>`, `</DOCUMENT>`,
// `</SEC-DOCUMENT>` and the END PRIVACY-ENHANCED MESSAGE line), each closing
// markup a cut opened.
//
// dict.tsv is all 7 series this filing's own header declares, verbatim, one row
// each at the filing's own period -- nothing is made unambiguous by hiding a name.
//
// No production code is changed here. Fix location: parseProxyEdge's identity
// reading -- the labelled-cell shape it does not recognise, not the vocabulary it
// recognises with.
func TestFamilyNS1342947MondrianSubadviserLabelledCellGrid(t *testing.T) {
	rows := ns1342947MondrianDispatch(t, "mondrian_boots_grid.txt", "dict.tsv", "proxyedge", 19)

	// Fixture guards, BOTH shapes that already read correctly. If either of these
	// fails the cut is broken or the layout match has moved, and the asymmetry
	// this test is about has gone with it -- so they are fatal, not errors.
	//
	// (a) The first ProxyEdge section's stacked identity block.
	msft := 0
	for _, r := range rows {
		if r.IssuerName != "MICROSOFT CORPORATION" {
			continue
		}
		msft++
		if r.CUSIP != "594918104" || r.MeetingDate != "20061114" {
			t.Fatalf("fixture guard: the stacked ProxyEdge identity block stopped being read: issuer=%q cusip=%q date=%q", r.IssuerName, r.CUSIP, r.MeetingDate)
		}
	}
	if msft != 4 {
		t.Fatalf("fixture guard: the first section's ballots have moved: found %d MICROSOFT rows, want 4", msft)
	}
	// (b) The Walter Scott section, whose colon-suffixed labels are what claim
	// this document for proxyedge in the first place.
	inditex := 0
	for _, r := range rows {
		if r.IssuerName != "INDUSTRIA DE DISENO TEXTIL INDITEX SA" {
			continue
		}
		inditex++
		if r.CUSIP != "E6282J109" || r.MeetingDate != "20060718" {
			t.Fatalf("fixture guard: the Walter Scott identity block stopped being read: issuer=%q cusip=%q date=%q", r.IssuerName, r.CUSIP, r.MeetingDate)
		}
	}
	if inditex != 4 {
		t.Fatalf("fixture guard: the Walter Scott ballot has moved: found %d INDITEX rows, want 4", inditex)
	}

	// The claim. Every ballot of the Boots Group Plc EGM printed under the
	// Mondrian masthead in the labelled-cell shape must carry the identity the
	// filing prints for it, in the cells beside the labels `Security` and
	// `Meeting Date`, and must NOT carry the repeated share count as its issuer.
	const (
		series = "S000015105"
		issuer = "Boots Group Plc"
		cusip  = "G12517119"
		date   = "20060704"
	)
	seen := map[string]int{}
	for i, r := range rows {
		if !ns1342947BootsAgendaItem(r.VoteDescription) {
			continue
		}
		seen[r.VoteDescription]++
		if r.SeriesID != series {
			t.Errorf("row %d (item %q): series/fund attribution regressed -- it is already correct on HEAD and nothing in this family's fix may touch it: series=%q fund=%q want %q",
				i+1, r.ItemSeq, r.SeriesID, r.FundName, series)
		}
		if r.IssuerName != issuer {
			t.Errorf("row %d (item %q): the bold issuer heading of a labelled-cell meeting block was discarded and a repeated SHARE COUNT put in the issuer column: issuer=%q want %q, the cell this filing prints at source lines 12126-12127",
				i+1, r.ItemSeq, r.IssuerName, issuer)
		}
		if r.CUSIP != cusip {
			t.Errorf("row %d (item %q): the `Security` label's value cell was never read, so the row carries no security id and can never link to a meeting: cusip=%q want %q, the cell this filing prints at source line 12140 beside the `Security` label at 12137",
				i+1, r.ItemSeq, r.CUSIP, cusip)
		}
		if r.MeetingDate != date {
			t.Errorf("row %d (item %q): the `Meeting Date` label's value cell was never read, so the row carries no meeting date and can never link to a meeting: date=%q want %q, brDate's mm/dd/yyyy reading of the `07/04/2006` this filing prints at source line 12151 beside the `Meeting Date` label at 12147-12148",
				i+1, r.ItemSeq, r.MeetingDate, date)
		}
	}
	for _, item := range ns1342947BootsAgenda {
		if seen[item] != 1 {
			t.Errorf("the fixture's own Boots EGM block has moved: item %q emitted %d rows, want exactly 1", item, seen[item])
		}
	}
	if len(seen) != len(ns1342947BootsAgenda) {
		t.Errorf("the fixture's own Boots EGM block has moved: %d of the meeting's %d printed items emitted a row", len(seen), len(ns1342947BootsAgenda))
	}
}

// ns1342947BootsAgendaItem reports an item text the Boots EGM block prints.
func ns1342947BootsAgendaItem(desc string) bool {
	for _, item := range ns1342947BootsAgenda {
		if desc == item {
			return true
		}
	}
	return false
}
