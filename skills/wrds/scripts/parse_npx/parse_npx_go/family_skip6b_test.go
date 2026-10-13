package main

import (
	"path/filepath"
	"testing"
)

// familySkip6bDispatch runs the real dispatch on a family SKIP6b fixture and
// returns the rows with the manifest row. Like familySkip6Dispatch it asserts no
// precondition: the defect under test IS the missing rows, so a precondition on
// them would turn this into a fixture error rather than a failed assertion.
func familySkip6bDispatch(t *testing.T, fixture string) ([]VoteRow, FilingMeta) {
	t.Helper()
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_skip6b", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	return rows, meta
}

// 000091/914036/0001193125-23-221492.txt: verbatim lines 1-8, 12-16, 51-52,
// 917-920, 929, 930-933, 942, 1529-1537, 1741-1762, 1769-1789, 1796 and the
// filing's own last three lines. Lincoln Variable Insurance Products Trust 2023
// (CIK 914036, 53,525,259 bytes) emits ZERO rows on the current tree -- measured
// on the WHOLE filing, not just this cut:
// `n_rows=0 parse_mode=text layout=unknown:registrant:e56bc97a parse_status=skip`.
//
// This is the sibling family SKIP6 did not reach. SKIP6 taught matchSplitTable a
// fourth signature, spIsSECFormPre, and the 2021 filing now emits 199,247 rows --
// but the four siblings still skip, because the signature's only text probe is
//
//	containsAnyFolded(text, []string{"issuer of portfolio security"})
//
// and 2022, 2023 and both 2021 amendments never print that token on one line.
// They SPLIT the label across two physical lines, and it is `Portfolio Security`,
// not `Issuer of`, that sits directly over the dashed rule:
//
//	                          Exchange                                                           Matter:
//	Issuer of                 Ticker               Shareholder     Summary of Matter Voted      Issuer /        Whether Fund
//	Portfolio Security        Symbol     CUSIP #   Meeting Date               On               Shareholder   Cast Vote on Matter
//	------------------        --------  ---------- ------------  ----------------------------- ------------  -------------------
//
// Measured over the whole filings: `grep -c 'Issuer of Portfolio Security'` is 0
// in all four, while `grep -c 'Issuer of'` is 92 (2022) and 93 (2023). The 2021
// filing spells it `Issuer of Portfolio Security Symbol     CUSIP#` on ONE line
// with no space in `CUSIP#`; these spell `CUSIP #`. So the signature's second
// clause -- the HasPrefix(line, spSECFormLabel) walk for a label line with four
// runs over a four-span rule -- is never even reached: the containsAnyFolded
// guard returns false first.
//
// Nothing else about the template defeats a head scan. The cover is the same
// length, the first block sits at line 1741 of 767,425, the rule is drawn with
// the same '-' runs, and 2023 even wraps each table in <TABLE>/<CAPTION> with the
// <S>/<C> stub row -- the same delimiters the institutional branch of this layout
// already keys on. What is missing is only the one-line spelling of the label.
//
// The shape itself is this layout's own core grammar: ONE logical vote SPLIT
// ACROSS PARALLEL TABLES and joined by LINE POSITION. Table one carries issuer /
// ticker / CUSIP / meeting date / description / proponent / whether a vote was
// cast; table two carries the Fund's Vote and Vote Against Management for the
// SAME body lines in the SAME order, with wrapped cells printed on the lines
// above their keyed row and the sibling table left blank there.
//
// Rows reached: 129,698 ballot lines in this filing; 226,024 across 2022 and
// 2023; 229,745 across all four siblings, all currently zero.
//
// Fix in layout_splittable.go, spIsSECFormPre: the signature must admit the label
// spelled across two lines -- probe for `portfolio security` (or for the pair
// `issuer of` then `portfolio security` on consecutive lines) rather than only
// for the joined token, and run the existing four-runs-over-a-four-span-rule walk
// against the `Portfolio Security ...` line, which is the one the rule actually
// underlines. spSECFormLabel's HasPrefix must then match `Portfolio Security` as
// well as `Issuer of Portfolio Security`.
func TestFamilySkip6bLincoln2023SplitLabelHeader(t *testing.T) {
	rows, meta := familySkip6bDispatch(t, "lincoln_2023_split_label_header.txt")
	if len(rows) == 0 {
		t.Fatalf("vote table never read: status=%s layout=%s rows=0 error=%q; the fixture prints 7 Chewy, Inc. ballots (CHWY, 16679L109, 14-Jul-22) for LVIP American Century Select Mid Cap Managed Volatility Fund (S000042336) across two parallel tables joined by line position -- two of them with the description wrapped over two and three physical lines",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}
	want := map[string]string{
		"Elect Director James Kim":                                       "Withhold",
		"Elect Director David Leland":                                    "Withhold",
		"Elect Director Lisa Sibenac":                                    "Withhold",
		"Elect Director Sumit Singh":                                     "Withhold",
		"Ratify Deloitte & Touche LLP as Auditors":                       "For",
		"Advisory Vote to Ratify Named Executive Officers' Compensation": "For",
		"Approve Omnibus Stock Plan":                                     "For",
	}
	seen := make(map[string]bool)
	for _, r := range rows {
		vote, ok := want[r.VoteDescription]
		if !ok {
			continue
		}
		seen[r.VoteDescription] = true
		if r.IssuerName != "Chewy, Inc." {
			t.Errorf("%q: issuer: got %q want %q", r.VoteDescription, r.IssuerName, "Chewy, Inc.")
		}
		if r.Ticker != "CHWY" {
			t.Errorf("%q: ticker: got %q want %q", r.VoteDescription, r.Ticker, "CHWY")
		}
		if r.CUSIP != "16679L109" {
			t.Errorf("%q: cusip: got %q want %q", r.VoteDescription, r.CUSIP, "16679L109")
		}
		if r.MeetingDate != "20220714" {
			t.Errorf("%q: meeting date: got %q want %q", r.VoteDescription, r.MeetingDate, "20220714")
		}
		if r.HowVoted != vote {
			t.Errorf("%q: how_voted: got %q want %q -- the second table's Fund's Vote column, joined by line position", r.VoteDescription, r.HowVoted, vote)
		}
		if r.SeriesID != "S000042336" {
			t.Errorf("%q: series: got %q want %q -- the fund named in the per-page banner", r.VoteDescription, r.SeriesID, "S000042336")
		}
	}
	for desc := range want {
		if !seen[desc] {
			t.Errorf("ballot not read: %q", desc)
		}
	}
}
