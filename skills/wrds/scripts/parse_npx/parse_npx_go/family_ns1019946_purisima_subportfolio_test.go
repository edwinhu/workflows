package main

import (
	"path/filepath"
	"testing"
)

const ns1019946PurisimaDir = "family_ns1019946"

// ns1019946PurisimaDispatch runs the real dispatch on this family's fixture
// under PRODUCTION resolution -- the corpus dictionary and the series overlay
// are left exactly as the binary holds them, not nilled out, so the series id
// asserted below is whatever production would emit for this file. The filing's
// own <SERIES-AND-CLASSES-CONTRACTS-DATA> header dictionary is read by
// processFile regardless and is separate from either overlay. Same mechanism as
// ns1261788MicroCapDispatch, pointed at its own testdata dir.
//
// Neither overlay can change this filing's answer in any case. The corpus
// dictionary holds EXACTLY the two rows this CIK's own header declares --
// measured on the real corpus file, `awk -F'\t' '$1==1019946' cik_series.tsv`
// returns S000005935 `The Purisima Total Return Fund` and S000005936
// `The Purisima All-Purpose Fund`, both at vintage 20060630 and both sourced
// from this very accession, and no other series at any vintage -- and
// series_map_applied.tsv carries no row mentioning 1019946 at all.
func ns1019946PurisimaDispatch(t *testing.T, fixture, layout string) (FilingMeta, []VoteRow) {
	t.Helper()
	ch := make(chan *ParseResult, 8192)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns1019946PurisimaDir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s want status=ok layout=%s error=%s", meta.ParseStatus, meta.Layout, layout, meta.ErrorMsg)
	}
	return meta, rows
}

// PURISIMA FUNDS, CIK 1019946, period 20060630, filing
// 000101/1019946/0000909012-06-000924.txt (`issnpx`). The registrant declares
// EXACTLY TWO series in its own SEC header -- S000005935 `The Purisima Total
// Return Fund` (real source lines 55-56, fixture lines 55-56) and S000005936
// `The Purisima All-Purpose Fund` (real 65-66, fixture 65-66) -- and prints
// FOUR `=`-ruled banners.
//
// MEASURED ON HEAD over the whole real accession, with the real corpus
// dictionary and the real overlay loaded: status=ok layout=issnpx rows=1281,
//
//	1042 rows  series="S000005935"  fund="PURISIMA TOTAL RETURN"
//	 157 rows  series=""            fund="PURISIMA PURE AMERICAN"
//	  82 rows  series=""            fund="PURISIMA PURE FOREIGN"
//
// 239 of 1281 rows, 19% of the filing, carry no series at all.
//
// THE FILING'S SHAPE, by real source line (`grep -n '===' ` on the real file
// returns exactly these five, and nothing else in the file matches):
//
//	real 142   ========================== PURISIMA ALL PURPOSE FUND ===========================
//	real 143-146   four lines, each empty -- NO vote row, no issuer, no rule
//	real 147   ============================ PURISIMA PURE AMERICAN ============================
//	real 148-479   157 rows
//	real 480   ============================ PURISIMA PURE FOREIGN =============================
//	real 481-716   82 rows
//	real 717   ============================ PURISIMA TOTAL RETURN =============================
//	real 718-3111  1042 rows
//	real 3112  =========================== END NPX REPORT======================================
//
// WHY THE ATTRIBUTION IS PROVABLE, not guessed. It is pure elimination over a
// closed header, the same accounting issResidualEliminate already keeps:
//
//   - the header declares two series and no more, and the corpus dictionary
//     names no third for this CIK at any vintage;
//   - S000005935 is FULLY accounted for elsewhere. `PURISIMA TOTAL RETURN`
//     resolves to it on HEAD and carries all 1042 of its rows;
//   - S000005936 is the only series left, and its own banner -- which DOES
//     resolve, measured directly: issResolveFund(ix, `purisima all purpose
//     fund`) returns declaration `The Purisima All-Purpose Fund` -- carries
//     ZERO rows of its own;
//   - the two undeclared headings that follow it resolve to nothing (measured:
//     issResolveFund returns a nil declaration for `purisima pure american` and
//     for `purisima pure foreign`), sit immediately beneath it with no other
//     banner intervening, and are the only unresolved headings in the file.
//
// `Pure American` and `Pure Foreign` are therefore sub-portfolios reported under
// the All-Purpose Fund's own banner: an empty banner followed by its own
// sleeves. There is no other series they could belong to.
//
// WHY THE EXISTING RUNG MISSES. issResidualEliminate (layout_issnpx.go:1317)
// would settle this -- byFund is {PURISIMA TOTAL RETURN: S000005935}, claimed is
// {S000005935}, and exactly one declared series, S000005936, is left unclaimed.
// It refuses at layout_issnpx.go:1329-1333: it allows exactly ONE distinct
// unresolved fund name and returns the moment a second appears. Here there are
// two, `PURISIMA PURE AMERICAN` and `PURISIMA PURE FOREIGN`. That guard is
// correct in general -- two unresolved headings against one leftover series is
// normally a guess between them -- but it is not a guess here, because the two
// headings are not competing for the seat: they are sub-portfolios of the one
// banner that already holds it, printed under it and reporting no rows of their
// own. A fix must recognise that shape without loosening the general rung.
//
// SECTION POSITION ALONE IS NOT THE EVIDENCE. What settles it is the closed
// two-series header plus S000005935's complete accounting plus the All-Purpose
// banner's zero rows; the adjacency only identifies WHICH heading the empty
// banner owns.
//
// FIXTURE PROVENANCE. purisima_pure_american_foreign_subportfolio_2006.txt is
// real SEC EDGAR bytes, accession 0000909012-06-000924, CIK 1019946, period
// 20060630, verbatim and in file order, trimmed to whole issuer blocks. The
// ranges kept, by real source line: 1-174 (SEC-HEADER including both series
// declarations at 53-71, the cover page, the FORM N-Px REPORT banner, the
// ALL PURPOSE FUND banner at 142, its four empty lines, the PURE AMERICAN
// banner at 147 and the whole AMERICAN INTERNATIONAL GROUP block, 16 rows),
// 476-499 (the PURE AMERICAN section's blank tail, the PURE FOREIGN banner at
// 480 and the whole ABN AMRO HOLDING NV block, 4 rows), 713-735 (the PURE
// FOREIGN section's blank tail, the TOTAL RETURN banner at 717 and the whole
// ALEXANDRIA REAL ESTATE EQUITIES block, 9 rows), and 3111-3140 (the
// END NPX REPORT marker, the signature page and the accession's closing tags).
// No row was fabricated or edited; the concatenation of those four ranges is
// byte-identical to the fixture.
//
// The fixture reproduces the real accession's behaviour proportionally --
// status=ok layout=issnpx rows=29, of which 16 carry fund="PURISIMA PURE
// AMERICAN" series="", 4 carry fund="PURISIMA PURE FOREIGN" series="", and 9
// carry fund="PURISIMA TOTAL RETURN" series="S000005935" -- exactly as the real
// file does at scale.
//
// No production code is changed here.
func TestFamilyNS1019946PurisimaSubPortfolioElimination(t *testing.T) {
	_, rows := ns1019946PurisimaDispatch(t, "purisima_pure_american_foreign_subportfolio_2006.txt", "issnpx")

	const (
		totalReturn  = "S000005935" // The Purisima Total Return Fund
		allPurpose   = "S000005936" // The Purisima All-Purpose Fund
		allPurposeCl = "C000016366" // its sole declared class contract, fixture line 68
		pureAmerican = "AMERICAN INTERNATIONAL GROUP, INC."
		pureForeign  = "ABN AMRO HOLDING NV"
		totalRetIss  = "ALEXANDRIA REAL ESTATE EQUITIES, INC."
	)

	if len(rows) != 29 {
		t.Fatalf("fixture precondition: %d rows, want 29 (16 AMERICAN INTERNATIONAL GROUP rows under PURISIMA PURE AMERICAN, 4 ABN AMRO rows under PURISIMA PURE FOREIGN, 9 ALEXANDRIA rows under PURISIMA TOTAL RETURN)", len(rows))
	}

	var american, foreign, total int
	for i, r := range rows {
		switch r.IssuerName {
		case pureAmerican:
			american++
			if r.FundName != "PURISIMA PURE AMERICAN" {
				t.Errorf("row %d: fixture precondition broken: fund_name=%q, want PURISIMA PURE AMERICAN -- this block stands under the banner at fixture line 147", i, r.FundName)
			}
			// The claim. The sub-portfolio banner at fixture line 147 (real
			// source line 147) names no declared series, but the only series it
			// can belong to is S000005936: the header declares two, S000005935
			// is fully accounted for by the 9 TOTAL RETURN rows below, and the
			// ALL-PURPOSE banner four lines above (fixture 142, real 142) opens
			// and closes without a single row of its own.
			if r.SeriesID != allPurpose {
				t.Errorf("row %d (%s item=%q cusip=%q date=%q): series=%q fund=%q want %s -- `PURISIMA PURE AMERICAN` is a sub-portfolio reported under the `PURISIMA ALL PURPOSE FUND` banner at fixture line 142, which resolves to %s and carries ZERO rows (fixture lines 143-146 are empty); with only %s and %s declared (fixture 55-56, 65-66) and the former fully accounted for by this filing's TOTAL RETURN section, these 157 real rows are provably the All-Purpose Fund's. issResidualEliminate refuses only because a SECOND unresolved heading, PURISIMA PURE FOREIGN, is also present",
					i, r.IssuerName, r.ItemSeq, r.CUSIP, r.MeetingDate, r.SeriesID, r.FundName, allPurpose, allPurpose, totalReturn, allPurpose)
			}
			if r.SeriesID == totalReturn {
				t.Errorf("row %d (%s item=%q): series=%q is the WRONG series -- S000005935's own banner is `PURISIMA TOTAL RETURN` at fixture line 203 and it carries its rows there; a row stamped with the other declared series is worse than a blank one",
					i, r.IssuerName, r.ItemSeq, r.SeriesID)
			}
			if r.ClassIDs != allPurposeCl {
				t.Errorf("row %d (%s item=%q): class_ids=%q want %q -- the header declares exactly one class contract under %s (fixture lines 67-70), and the resolved TOTAL RETURN rows carry their own C000016365, so the attribution must stamp the class the same way",
					i, r.IssuerName, r.ItemSeq, r.ClassIDs, allPurposeCl, allPurpose)
			}
		case pureForeign:
			foreign++
			if r.FundName != "PURISIMA PURE FOREIGN" {
				t.Errorf("row %d: fixture precondition broken: fund_name=%q, want PURISIMA PURE FOREIGN -- this block stands under the banner at fixture line 179 (real source line 480)", i, r.FundName)
			}
			// Same claim, second sleeve. Nothing distinguishes it from the
			// first: both stand under the same empty ALL-PURPOSE banner with no
			// other banner intervening.
			if r.SeriesID != allPurpose {
				t.Errorf("row %d (%s item=%q cusip=%q date=%q): series=%q fund=%q want %s -- `PURISIMA PURE FOREIGN` (banner at fixture line 179, real 480) is the second sub-portfolio under the same empty `PURISIMA ALL PURPOSE FUND` banner, with no other banner between them; these 82 real rows are the All-Purpose Fund's by the same elimination",
					i, r.IssuerName, r.ItemSeq, r.CUSIP, r.MeetingDate, r.SeriesID, r.FundName, allPurpose)
			}
			if r.SeriesID == totalReturn {
				t.Errorf("row %d (%s item=%q): series=%q is the WRONG series -- see the PURE AMERICAN case above", i, r.IssuerName, r.ItemSeq, r.SeriesID)
			}
			if r.ClassIDs != allPurposeCl {
				t.Errorf("row %d (%s item=%q): class_ids=%q want %q", i, r.IssuerName, r.ItemSeq, r.ClassIDs, allPurposeCl)
			}
		case totalRetIss:
			total++
			// Regression guard. This section already resolves correctly on HEAD
			// and must keep doing so: a fix that reaches the sub-portfolios by
			// disturbing the one section that works has traded one defect for
			// another.
			if r.FundName != "PURISIMA TOTAL RETURN" || r.SeriesID != totalReturn {
				t.Errorf("row %d (%s item=%q): fund=%q series=%q want fund=PURISIMA TOTAL RETURN series=%s -- this section resolves correctly on HEAD (1042 of 1042 real rows) and must not regress",
					i, r.IssuerName, r.ItemSeq, r.FundName, r.SeriesID, totalReturn)
			}
		default:
			t.Errorf("row %d: unexpected issuer %q -- this fixture carries only the %s, %s and %s blocks", i, r.IssuerName, pureAmerican, pureForeign, totalRetIss)
		}
	}
	if american != 16 || foreign != 4 || total != 9 {
		t.Errorf("fixture precondition: PURE AMERICAN emitted %d rows, PURE FOREIGN %d, TOTAL RETURN %d, want 16, 4 and 9", american, foreign, total)
	}

	// No row may be credited to a series this registrant never declared, and no
	// fourth fund name may appear: `PURISIMA ALL PURPOSE FUND` prints as a
	// banner but heads no rows, so it must never surface as a row's fund_name.
	for i, r := range rows {
		if r.SeriesID != allPurpose && r.SeriesID != totalReturn {
			t.Errorf("row %d (%s item=%q): series=%q is neither declared id; this registrant's header declares only %s and %s", i, r.IssuerName, r.ItemSeq, r.SeriesID, totalReturn, allPurpose)
		}
		if r.FundName == "PURISIMA ALL PURPOSE FUND" {
			t.Errorf("row %d (%s item=%q): fund_name is the ALL PURPOSE banner itself; that banner heads no rows (fixture lines 143-146 are empty), so a row carrying it means a section boundary moved",
				i, r.IssuerName, r.ItemSeq)
		}
	}

	// Identity regression guard. Every identity field already reads correctly on
	// HEAD -- only series_id and class_ids are wrong. A fix that recovers the
	// series by disturbing issuer, cusip, meeting date or item numbering has
	// traded one defect for another.
	want := []struct {
		issuer, cusip, date, item string
	}{
		{pureAmerican, "026874107", "20050811", "1.1"},
		{pureAmerican, "026874107", "20050811", "1.2"},
		{pureAmerican, "026874107", "20050811", "1.3"},
	}
	for i, w := range want {
		r := rows[i]
		if r.IssuerName != w.issuer || r.CUSIP != w.cusip || r.MeetingDate != w.date || r.ItemSeq != w.item {
			t.Errorf("row %d regressed: issuer=%q cusip=%q date=%q item=%q want issuer=%q cusip=%s date=%s item=%s",
				i, r.IssuerName, r.CUSIP, r.MeetingDate, r.ItemSeq, w.issuer, w.cusip, w.date, w.item)
		}
	}
	if r := rows[16]; r.IssuerName != pureForeign || r.CUSIP != "000937102" || r.MeetingDate != "20051124" || r.ItemSeq != "1" {
		t.Errorf("row 16 regressed: issuer=%q cusip=%q date=%q item=%q want %q 000937102 20051124 1", r.IssuerName, r.CUSIP, r.MeetingDate, r.ItemSeq, pureForeign)
	}
	if r := rows[20]; r.IssuerName != totalRetIss || r.CUSIP != "015271109" || r.MeetingDate != "20060518" || r.ItemSeq != "1.1" {
		t.Errorf("row 20 regressed: issuer=%q cusip=%q date=%q item=%q want %q 015271109 20060518 1.1", r.IssuerName, r.CUSIP, r.MeetingDate, r.ItemSeq, totalRetIss)
	}
}
