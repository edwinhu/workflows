package main

import (
	"path/filepath"
	"testing"
)

// familyEEE2Dispatch runs the real dispatch on a family EEE no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary.
func familyEEE2Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_eee2", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_eee2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000145/1452937/0001135428-21-000106.txt: 1-19, 53-74, 175-183, 349-350,
// 21711-21725. Exchange Traded Concepts Trust's 2021 N-PX declares twelve
// series in its SGML header (the fixture keeps two of them verbatim, enough to
// keep the single-series chassis stamp from firing), none of them the ROBO
// Global funds, so every ROBO section is attributed by the CIK dictionary
// alone. The equals-rule banner
// reads
//
//	========== ROBO Global Healthcare Technology and Innovation Index ETF ==========
//	1LIFE HEALTHCARE, INC.
//	Ticker:       ONEM           Security ID:  68269G107
//	Meeting Date: JUN 03, 2021   Meeting Type: Annual
//
// while cik_series.tsv carries, for this CIK,
//
//	S000065730  ROBO Global(R) Healthcare Technology and Innovation ETF
//
// The (R) mark already folds away, and the sibling banners resolve on that
// alone (`ROBO Global Robotics and Automation Index ETF` -> S000042659,
// `ROBO Global Artificial Intelligence ETF` -> S000065729). This banner adds
// one word the declared name does not carry, `Index`, before the type word, so
// the normalised keys differ and dictFallback.apply refuses it.
//
// 909 of the filing's 10,863 rows leave series_id blank under this banner.
//
// Fix in dictFallback.apply (cik_series.go), beside the trailing-parenthetical
// and leading-code retries: when a heading is one INSERTED word away from
// exactly one dictionary name of this CIK and from no other, take that series.
// The cover page of this same filing spells the declared name verbatim
// (`ROBO Global Healthcare Technology and Innovation ETF`, line 311), so the
// evidence that the two name one fund is inside the filing.
func TestFamilyEEE2ROBOHealthcareInsertedIndexWord(t *testing.T) {
	rows := familyEEE2Dispatch(t, "robo_healthcare_index_heading.txt", "etc_dict.tsv", "issnpx", 3)
	for _, r := range rows {
		if r.SeriesID != "S000065730" {
			t.Errorf("`ROBO Global Healthcare Technology and Innovation Index ETF` vs dictionary `ROBO Global(R) Healthcare Technology and Innovation ETF`: fund=%q issuer=%q item=%q series=%q want S000065730", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000145/1452937/0001135428-21-000106.txt: 1-19, 53-74, 175-183, 349-350,
// 27089-27103. The same filing's Vesper section banner spells the country
// abbreviation without its periods:
//
//	============= Vesper US Large Cap Short-Term Reversal Strategy ETF =============
//	ALPHABET INC.
//	Ticker:       GOOGL          Security ID:  02079K305
//	Meeting Date: JUN 02, 2021   Meeting Type: Annual
//
// while the dictionary carries the dotted spelling for the same fund,
//
//	S000063053  Vesper U.S. Large Cap Short-Term Reversal Strategy ETF
//
// normalizeSeriesName (header.go) makes punctuation a token separator, so
// `U.S.` folds to the two tokens `u s` and `US` to the single token `us`: the
// keys differ on nothing but the periods, and no other series of this CIK
// carries `Vesper`. This is the mirror of the dotted-U.S. shape already handled
// on the header side — there the HEADING was dotted, here it is the DECLARED
// name.
//
// 341 of the filing's 10,863 rows leave series_id blank under this banner.
//
// Fix in normalizeSeriesName (header.go), or in a retry beside it that
// dictFallback.apply and lookupSeriesEntry share: fold a dotted single-letter
// initialism onto its undotted spelling before keying, so `U.S.` and `US` key
// alike. The cover page of this same filing spells the dotted form (line 313).
func TestFamilyEEE2VesperUndottedUS(t *testing.T) {
	rows := familyEEE2Dispatch(t, "vesper_undotted_us_heading.txt", "etc_dict.tsv", "issnpx", 5)
	for _, r := range rows {
		if r.SeriesID != "S000063053" {
			t.Errorf("`Vesper US Large Cap Short-Term Reversal Strategy ETF` vs dictionary `Vesper U.S. Large Cap Short-Term Reversal Strategy ETF`: fund=%q issuer=%q item=%q series=%q want S000063053", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}
