package main

import (
	"path/filepath"
	"testing"
)

const ns882748SignalDir = "family_ns882748_signal_brand_prefix_fund_suffix"

// ns882748SignalDispatch runs the fixture through the same top-level entry
// point production uses -- processFile, which sniffs the layout itself -- with
// the CIK's real cik_series.tsv rows loaded and no overlay, so nothing below
// depends on a hand-built FilingMeta or a hand-picked reader.
func ns882748SignalDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", ns882748SignalDir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns882748SignalDir, fixture), sink, make([]byte, headBytes))
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

// 000088/882748/0000950152-06-007295.txt (THE COVENTRY GROUP, CIK 882748,
// period 20060630, manifest layout `issnpx`): 634 of the filing's 6,941 rows
// carry no series_id, and every one of them is stamped with the same fund_name,
// the banner text `SIGNAL LARGE CAP GROWTH FUND`. That one banner is the whole
// of this CIK's known-registrant no_series residue -- ns_lost_report.py --rank
// puts CIK 882748 at 634 rows across 1 filing, and a count of ballot rows
// between the banner at source line 15421 and the `========== END NPX REPORT`
// marker at source line 16895 returns exactly 634.
//
// ELEVEN OF TWELVE BANNERS ALREADY RESOLVE. The body prints twelve fund
// banners, each a rule of `=` with the fund name centred inside it. Run with
// -cik-series and -series-map, the other eleven all resolve:
//
//	MONOGRAM LONG/SHORT           S000009920   504 rows
//	MONOGRAM DIVERSIFIED EQUITY   S000009915   685 rows
//	MONOGRAM INCOME EQUITY        S000009916   872 rows
//	MONOGRAM SPECIAL EQUITY       S000009917   617 rows
//	BOSTON TRUST BALANACED FUND   S000009921   697 rows  (the filing's own typo)
//	BOSTON TRUST EQUITY FUND      S000009922   698 rows
//	BOSTON TRUST SMALL CAP        S000009927   422 rows
//	WALDEN SOCIAL BALANCED FUND   S000009923   712 rows
//	WALDEN SOCIAL EQUITY FUND     S000009926   684 rows
//	SHELBY FUND                   S000008178   106 rows
//	SHELBY LARGE CAP FUND         S000009928   310 rows
//	SIGNAL LARGE CAP GROWTH FUND  (blank)      634 rows
//
// So this is not a layout that fails to read banners. It is one banner whose
// spelling no rung of the issnpx resolution chain reaches.
//
// AND THE FILING'S OWN HEADER NAMES IT. The SGML
// <SERIES-AND-CLASSES-CONTRACTS-DATA> block declares 17 series for this
// registrant (fixture source lines 50-250), one of which is spelled, verbatim:
//
//	<SERIES-ID>S000008177
//	<SERIES-NAME>Large Cap Growth
//
// THE BANNER IS THAT DECLARED NAME WITH A BRAND WORD IN FRONT AND A GENERIC
// NOUN BEHIND IT:
//
//	banner    SIGNAL | LARGE CAP GROWTH | FUND
//	declared           LARGE CAP GROWTH
//
// The registrant registered four of its series under bare, unbranded names --
// `Income`, `Tax Exempt Income`, `Large Cap Growth`, `Shelby` -- while the
// vendor's plain-text section banner prints the retail product name, which
// carries the Signal brand and the type noun. (`SHELBY FUND` at source line
// 14508 is the same registrant habit one token smaller, and it resolves,
// because the existing suffix-only reach covers `Shelby` + `FUND`.)
//
// NO COLLISION IS AVAILABLE. Of the 17 series the filing's header declares,
// exactly one name contains `Large Cap Growth` -- S000008177. The nearest
// sibling, S000009928 `SHELBY LARGE CAP FUND`, has no `Growth` and is already
// claimed by its own banner at source line 14756. Nothing else this registrant
// declares, and nothing in its corpus-wide cik_series.tsv rows (43 rows across
// 2006-2021, checked), would answer the stem `LARGE CAP GROWTH` after the same
// cut. The one other declared series carrying the Signal brand,
// S000009929 `SIGNAL MONEY MARKET FUND`, is spelled in full and prints no
// banner in this filing at all.
//
// WHY THE MATCH FAILS. Two existing reaches each cover half of this shape and
// neither covers both halves:
//
//   - tbGenericTypeNounSeries (layout_twoband.go) folds a TRAILING generic
//     noun against the filing's own declarations, but only within the twoband
//     layout, and only when the rest of the banner is already the declared
//     stem. Here the banner also carries a LEADING token the declaration never
//     prints, so even in twoband the stem would not meet.
//   - issHeadingWithinDecl (layout_issnpx.go:2939) requires every word of the
//     banner to be a word the declaration already says. `SIGNAL` is not, so the
//     test refuses.
//   - issBrandCutStem / issCutGluedBrand (layout_issnpx.go:319, 2458) cut a
//     leading brand, but only the registrant's OWN conformed name or one of its
//     former conformed names. The registrant is `COVENTRY GROUP`; `SIGNAL` is a
//     product brand this registrant never conformed under, so no prefix cut
//     fires.
//
// The banner therefore resolves to nothing, issnpx falls through, and the 634
// rows are emitted with a blank series_id and the printed banner text as
// fund_name.
//
// THE FIX A LATER CHANGE SHOULD IMPLEMENT: issBrandPrefixGenericSuffixSeries.
// A banner that resolves to nothing, and that after cutting BOTH a single
// leading non-declared brand token AND a single trailing generic type noun
// (fund/trust/portfolio/etf) is spelled exactly as one series the filing's OWN
// header declares, is that series -- provided the residual stem is two tokens
// or more, and provided no second declared series answers the same stem.
// Collision withdraws the claim. The evidence must come from the filing's own
// <SERIES-AND-CLASSES-CONTRACTS-DATA> block, never the corpus dictionary and
// never a sibling CIK, for the same reason tbGenericTypeNounSeries is scoped
// that way: folding a type noun globally would merge genuinely distinct
// registered series elsewhere in the corpus.
//
// THE ASSERTION BELOW IS FIX-DIRECTION-AGNOSTIC. It reads only series_id, never
// fund_name -- keeping the printed banner text as the emitted fund_name while
// stamping S000008177 is a perfectly good fix, and so is rewriting it to the
// declared name.
func TestFamilyNS882748SignalBrandPrefixFundSuffix(t *testing.T) {
	const (
		fixture = "coventry_signal_large_cap_growth_2006.txt"
		// The banner, verbatim from fixture source line 273 (full-filing source
		// line 15421), inner text only.
		banner = "SIGNAL LARGE CAP GROWTH FUND"
		// The one series of the 17 declared that it names.
		wantID = "S000008177"
		// MEASURED on the fixture, not derived. The cut keeps the SIGNAL section's
		// first two meetings -- ADOBE SYSTEMS (2 items) and the AUG 11 2005
		// AMERICAN INTERNATIONAL GROUP annual (1.1-1.15 plus Ratify Auditors, 16
		// items) -- for 18 rows. The guard is a fixture tripwire only: it says the
		// cut still sniffs as issnpx and still yields the rows the assertion below
		// is about.
		wantRows = 18
	)

	rows := ns882748SignalDispatch(t, fixture, "dict.tsv", "issnpx", wantRows)

	// THE DEFECT. One banner owns every row of this section, and the filing's
	// own header declares exactly one series it can name, so every row resolves
	// or none does.
	bad := 0
	var first VoteRow
	for _, r := range rows {
		if r.SeriesID == wantID {
			continue
		}
		if bad == 0 {
			first = r
		}
		bad++
	}
	if bad > 0 {
		t.Errorf("%d of %d rows do not carry series_id %q; the first is issuer=%q cusip=%q meeting=%q item=%q series_id=%q fund=%q.\n"+
			"  The section banner is %q (fixture source line 273) and the filing's own SGML header declares %s as %q -- the only one of its 17 declared series naming Large Cap Growth.\n"+
			"  The banner is that declared name with a leading brand token (SIGNAL) and a trailing generic noun (FUND) wrapped around it: issHeadingWithinDecl refuses because SIGNAL is not a declared word, issBrandCutStem refuses because SIGNAL is not the registrant's own or a former conformed name, and tbGenericTypeNounSeries is twoband-only and suffix-only. issBrandPrefixGenericSuffixSeries is the reach this filing calls for.",
			bad, len(rows), wantID, first.IssuerName, first.CUSIP, first.MeetingDate, first.ItemSeq, first.SeriesID, first.FundName, banner, wantID, "Large Cap Growth")
	}
}
