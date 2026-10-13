package main

import (
	"path/filepath"
	"testing"
)

const ns806636LongleafDir = "family_ns806636_longleaf_registrant_typo"

// LONGLEAF PARTNERS FUNDS TRUST, CIK 806636, period 20200630, filing
// 000080/806636/0001193125-20-234605.txt (`htmltable`). The registrant declares
// exactly four series in its own SEC header (fixture lines 49-92):
//
//	S000009311  Longleaf Partners Fund              (fixture lines 51-60)
//	S000009312  Longleaf Partners Small-Cap Fund    (61-70)
//	S000009313  Longleaf Partners International Fund (71-80)
//	S000038187  Longleaf Partners Global Fund       (81-90)
//
// THE FILING'S SHAPE. Each fund section opens with a free-standing bold <P>
// carrying the fund name followed by the reporting period, then one <TABLE> of
// vote rows. The FIRST such banner, fixture line 106, is printed as
//
//	<P …><B>Longeaf Partners Fund&nbsp;…&nbsp;For the Period July&nbsp;1 2019 to
//	June&nbsp;30, 2020 </B></P>
//
// `Longeaf`, not `Longleaf` -- the filing agent dropped the second `l`. That one
// character is the whole defect. The declared name in this filing's own header
// (fixture line 54) and the corpus dictionary row for this CIK (S000009311,
// `Longleaf Partners Fund`, vintage 20060630) both spell it correctly.
//
// THE DEFECT. Every masthead rung in the htmltable layout resolves a banner by
// matching its text against the registrant's declared names -- exactly, or after
// normalisation that folds punctuation, case and known caption words. None of
// them tolerates a one-letter misspelling inside the fund name itself, so the
// banner at fixture line 106 resolves against nothing and opens no section at
// all. In the real accession that leaves all 251 rows under this banner with a
// blank series_id.
//
// MEASURED ON HEAD over this fixture, with the dictionary installed below:
// status=ok layout=htmltable rows=4, and every row carries
//
//	fund_name=""   series_id="S000009311;S000009312;S000009313;S000038187"
//
// -- the whole-registrant fan-out the dictionary fallback emits when a filing
// declares series and no masthead ever resolves. Same root failure as the corpus
// blank (no banner was read), surfacing differently because this trimmed fixture
// carries only the one section, so the fallback has nothing to narrow against.
// Either way the rows do not carry the one id the banner names, and fund_name is
// empty.
//
// Which id that is, is not a guess -- `Longeaf Partners Fund` is one edit away from
// exactly one of the four declared names and is not within one edit of any other
// (`Small-Cap`, `International` and `Global` each differ by whole words), so the
// correction is an elimination rather than a guess.
//
// FIXTURE PROVENANCE. longleaf_registrant_typo_2020.txt is real SEC EDGAR bytes,
// accession 0001193125-20-234605, CIK 0000806636, period 20200630, verbatim and
// in file order, trimmed to whole <P>/<TR>/<TABLE> units: the SEC-HEADER in full
// with all four series declarations unrenumbered, the <DOCUMENT>/<TEXT>/<HTML>
// preamble, the typo'd banner at line 106, the vote table's column-header rows,
// its first FOUR data rows (FedEx Corporation, CUSIP 31428X106, meeting
// 23-Sep-19, items `Elect Director John A. Edwardson`, `Elect Director Marvin R.
// Ellison`, `Elect Director Susan Patricia Griffith`, `Elect Director John C.
// (Chris) Inglis`), and the closing `</TABLE></BODY></HTML></TEXT></DOCUMENT>`.
// No row was fabricated, edited or reworded.
//
// The dictionary installed below is this CIK's real cik_series.tsv content, the
// same four rows the header declares, so the assertion does not depend on the
// filing header alone.
//
// No production code is changed here.
func TestFamilyNS806636LongleafRegistrantTypo(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0000806636": {
		{SeriesID: "S000009311", Name: "Longleaf Partners Fund", ClassIDs: []string{"C000025443"}, ClassNames: []string{"Longleaf Partners Fund"}, Tickers: []string{"llpfx"}},
		{SeriesID: "S000009312", Name: "Longleaf Partners Small-Cap Fund", ClassIDs: []string{"C000025444"}, ClassNames: []string{"Longleaf Partners Small-Cap Fund"}, Tickers: []string{"llscx"}},
		{SeriesID: "S000009313", Name: "Longleaf Partners International Fund", ClassIDs: []string{"C000025445"}, ClassNames: []string{"Longleaf Partners International Fund"}, Tickers: []string{"llinx"}},
		{SeriesID: "S000038187", Name: "Longleaf Partners Global Fund", ClassIDs: []string{"C000117771"}, ClassNames: []string{"Longleaf Partners Global Fund"}, Tickers: []string{"llglx"}},
	}}}
	seriesMap = nil

	const (
		fixture      = "longleaf_registrant_typo_2020.txt"
		partnersFund = "S000009311"
		declaredName = "Longleaf Partners Fund"
	)

	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", ns806636LongleafDir, fixture), sink, make([]byte, headBytes))
	rows := sink.buf
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || meta.CIK != "0000806636" {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s CIK=%s want status=ok layout=htmltable CIK=0000806636 error=%s", meta.ParseStatus, meta.Layout, meta.CIK, meta.ErrorMsg)
	}
	if len(rows) != 4 {
		t.Fatalf("fixture precondition: %d rows, want 4 (the four FedEx Corporation director-election rows under the typo'd banner at fixture line 106)", len(rows))
	}

	// Identity regression guard, checked FIRST: issuer, cusip, meeting date and
	// item description all read correctly on HEAD. Only fund_name and series_id
	// are wrong, and a fix that recovers the series by disturbing any of these
	// has traded one defect for another.
	wantItems := []string{
		"Elect Director John A. Edwardson",
		"Elect Director Marvin R. Ellison",
		"Elect Director Susan Patricia Griffith",
		"Elect Director John C. (Chris) Inglis",
	}
	for i, r := range rows {
		if r.IssuerName != "FedEx Corporation" || r.CUSIP != "31428X106" || r.MeetingDate != "20190923" {
			t.Errorf("row %d identity regressed: issuer=%q cusip=%q date=%q want issuer=%q cusip=31428X106 date=20190923", i, r.IssuerName, r.CUSIP, r.MeetingDate, "FedEx Corporation")
		}
		if r.VoteDescription != wantItems[i] {
			t.Errorf("row %d vote description regressed: %q want %q", i, r.VoteDescription, wantItems[i])
		}
	}

	// The claim. Every row under the banner at fixture line 106 belongs to
	// S000009311 and carries the fund's correctly spelled declared name. The
	// banner prints `Longeaf Partners Fund` -- one dropped `l` -- which no
	// existing masthead rung tolerates, so on HEAD these rows carry a blank
	// series_id and no section is opened at all.
	for i, r := range rows {
		if r.SeriesID != partnersFund {
			t.Errorf("row %d (%s item=%q cusip=%q date=%q): series=%q fund=%q want %s -- this row sits under the banner at fixture line 106, printed `Longeaf Partners Fund` with the second `l` dropped by the filing agent; the filing's own header (fixture line 54) and this CIK's dictionary row both declare `%s` = %s, and no other declared series of this registrant is within one edit of the printed text",
				i, r.IssuerName, r.ItemSeq, r.CUSIP, r.MeetingDate, r.SeriesID, r.FundName, partnersFund, declaredName, partnersFund)
		}
		if r.FundName != declaredName {
			t.Errorf("row %d (%s item=%q): fund_name=%q want %q -- the typo must be corrected to the registrant's declared spelling, not stored as printed and not left blank",
				i, r.IssuerName, r.ItemSeq, r.FundName, declaredName)
		}
	}
}
