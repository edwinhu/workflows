package main

import (
	"bytes"
	"regexp"
	"strings"
	"unicode"
)

// Header parsing for the EDGAR dissemination SGML header.
//
// The header of an N-PX filing is not small: a registrant files for dozens of
// series at once, each carrying several class contracts, so the
// <SERIES-AND-CLASSES-CONTRACTS-DATA> block routinely runs past the 4 KB head
// that a 13F header parser can get away with. Everything here is bounded by the
// </SEC-HEADER> marker instead, searched within headerScanLimit bytes so a
// 200 MB filing never has its whole body scanned.

const (
	// headerScanLimit caps the search for </SEC-HEADER>.
	headerScanLimit = 1 << 20
	// headerFallback is how much of the file is treated as header when the
	// </SEC-HEADER> marker is absent or truncated away.
	headerFallback = 64 << 10
)

var (
	rePeriod = regexp.MustCompile(`CONFORMED PERIOD OF REPORT:\s*(\d{8})`)
	// The ISS report's own preamble line, `Reporting Period: 07/01/2004 -
	// 06/30/2005`; the END date is captured.
	reReportingPeriod = regexp.MustCompile(`(?i)Reporting Period:\s*\d{2}/\d{2}/\d{4}\s*(?:-|to|through)\s*(\d{2})/(\d{2})/(\d{4})`)
	reFiledDate       = regexp.MustCompile(`FILED AS OF DATE:\s*(\d{8})`)
	reSubType         = regexp.MustCompile(`CONFORMED SUBMISSION TYPE:\s*([^\r\n]+)`)
	reCompanyName     = regexp.MustCompile(`COMPANY CONFORMED NAME:\s*([^\r\n]+)`)
	reFormerName      = regexp.MustCompile(`FORMER CONFORMED NAME:\s*([^\r\n]+)`)
	reCIK             = regexp.MustCompile(`CENTRAL INDEX KEY:\s*(\d+)`)
	reAccession       = regexp.MustCompile(`ACCESSION NUMBER:\s*([^\r\n]+)`)

	// One pattern for all four series tags: the records are recovered by a
	// state machine over the matches in document order, never by a first-match
	// lookup, which would report one series for a filing that carries dozens.
	reSeriesTag = regexp.MustCompile(
		`<(SERIES-ID|SERIES-NAME|CLASS-CONTRACT-ID|CLASS-CONTRACT-NAME|CLASS-CONTRACT-TICKER-SYMBOL)>([^<\r\n]*)`)
)

// headerRegion returns the slice of buf holding the SGML header.
func headerRegion(buf []byte) []byte {
	limit := buf
	if len(limit) > headerScanLimit {
		limit = limit[:headerScanLimit]
	}
	if i := bytes.Index(limit, []byte("</SEC-HEADER>")); i >= 0 {
		return limit[:i]
	}
	if len(limit) > headerFallback {
		return limit[:headerFallback]
	}
	return limit
}

// parseHeader reads the SGML header fields of a dissemination file.
func parseHeader(buf []byte) FilingMeta {
	head := headerRegion(buf)

	var meta FilingMeta
	if m := reAccession.FindSubmatch(head); m != nil {
		meta.Accession = strings.TrimSpace(string(m[1]))
	}
	if m := reSubType.FindSubmatch(head); m != nil {
		meta.FormType = strings.TrimSpace(string(m[1]))
	}
	if m := rePeriod.FindSubmatch(head); m != nil {
		meta.PeriodOfReport = string(m[1])
	}
	if m := reReportingPeriod.FindSubmatch(buf); m != nil {
		meta.ReportPeriodEnd = string(m[3]) + string(m[1]) + string(m[2])
	}
	if m := reFiledDate.FindSubmatch(head); m != nil {
		meta.FiledDate = string(m[1])
	}
	if m := reCompanyName.FindSubmatch(head); m != nil {
		meta.CompanyName = strings.TrimSpace(string(m[1]))
	}
	if m := reCIK.FindSubmatch(head); m != nil {
		meta.CIK = string(m[1])
	}
	for _, m := range reFormerName.FindAllSubmatch(head, -1) {
		meta.FormerNames = append(meta.FormerNames, strings.TrimSpace(string(m[1])))
	}
	// The series declarations travel with the manifest row so a layout parser can
	// attribute a vote to the series its fund heading names. They are not a
	// manifest column and never reach FilingMeta.TSV.
	_, meta.SeriesDecls = parseSeriesDecls(buf)
	return meta
}

var (
	// The attached document's own <FILENAME>, and the body's own statement of
	// whose report it is. Both live after </SEC-HEADER>, never inside it.
	reDocFilename    = regexp.MustCompile(`(?m)^<FILENAME>([^\r\n]*)`)
	reBodyRegistrant = regexp.MustCompile(`(?i)NAME OF REGISTRANT:[ \t]*([^\r\n]*)`)
	reDigitRun       = regexp.MustCompile(`[0-9]+`)
)

// swappedDocumentOwner reports the CIK an attached document names as its OWN
// owner when that is not the filer's: a Broadridge-prepared filer attached a
// sibling registrant's document by mistake, so every banner the body prints
// belongs to that registrant and none of them is in the filer's pool. John
// Hancock Investment Trust II (CIK 0000743861) filed
// `<FILENAME>BRD031_0000022370_2020.txt`, a body byte-identical to the one
// John Hancock Investment Trust (CIK 0000022370) filed the same day.
//
// The evidence must be the document's own, twice over, or nothing happens. The
// filename must carry EXACTLY ONE zero-padded 10-digit token -- an unpadded or
// over-long digit run is some other number of the filer's (`brd006000879947`,
// the filer's own CIK written without padding), and two such tokens name no
// single owner -- and the body's `NAME OF REGISTRANT` must be a name the filer
// is NOT: the filer's own name there is the ordinary case, where the filename
// digits mean nothing. A body that states no registrant at all refuses.
//
// Measured across the 6,539 Broadridge filings in the corpus: 3,553 embed a
// zero-padded CIK, 3,550 of them the filer's own, and exactly 3 another's.
func swappedDocumentOwner(head []byte, filerCIK, filerName string) (cik, registrant string, ok bool) {
	body := head
	if i := bytes.Index(head, []byte("</SEC-HEADER>")); i >= 0 {
		body = head[i:]
	}
	m := reDocFilename.FindSubmatch(body)
	if m == nil {
		return "", "", false
	}
	for _, run := range reDigitRun.FindAll(m[1], -1) {
		if len(run) != 10 || run[0] != '0' {
			continue
		}
		if cik != "" {
			return "", "", false
		}
		cik = string(run)
	}
	if cik == "" || strings.TrimLeft(cik, "0") == strings.TrimLeft(filerCIK, "0") {
		return "", "", false
	}
	n := reBodyRegistrant.FindSubmatch(body)
	if n == nil {
		return "", "", false
	}
	registrant = strings.TrimSpace(string(n[1]))
	key := normalizeSeriesName(registrant)
	if key == "" || key == normalizeSeriesName(filerName) {
		return "", "", false
	}
	return cik, registrant, true
}

// parseSeriesClasses returns every series/class/ticker triple in the SGML
// header, in document order. A class contract with no ticker still yields a
// triple, with an empty Ticker.
func parseSeriesClasses(buf []byte) []SeriesClass {
	sc, _ := parseSeriesDecls(buf)
	return sc
}

// parseSeriesDecls walks the header's series tags once and returns both views of
// them, because they are not the same set.
//
// The triples exist one per <CLASS-CONTRACT-ID>, so a series declaring NO class
// contract has no triple at all — its id and name vanish together. The decls are
// one per <SERIES-ID>, so that series survives and stays available for
// attribution. <SERIES-NAME> sits between <SERIES-ID> and the first
// <CLASS-CONTRACT>, and is carried onto the decl the series opened.
//
// The triples' shape is left exactly as it was: it is the chassis's input, and
// widening it would change what a single-series filing stamps.
func parseSeriesDecls(buf []byte) ([]SeriesClass, []SeriesDecl) {
	head := headerRegion(buf)

	var (
		classes []SeriesClass
		decls   []SeriesDecl
	)
	series := ""
	open := false

	for _, m := range reSeriesTag.FindAllSubmatch(head, -1) {
		val := strings.TrimSpace(string(m[2]))
		switch string(m[1]) {
		case "SERIES-ID":
			series = val
			open = true
			decls = append(decls, SeriesDecl{SeriesID: val})
		case "SERIES-NAME":
			// Belongs to the series block it sits inside. A name arriving before
			// any <SERIES-ID> belongs to no declared series and is dropped.
			if open {
				decls[len(decls)-1].Name = val
			}
		case "CLASS-CONTRACT-ID":
			classes = append(classes, SeriesClass{SeriesID: series, ClassID: val})
			if open {
				d := &decls[len(decls)-1]
				d.ClassIDs = append(d.ClassIDs, val)
			}
		case "CLASS-CONTRACT-NAME":
			// The class name is the fund's own word for a share class, which a
			// section heading may print behind the series name.
			if open {
				d := &decls[len(decls)-1]
				d.ClassNames = append(d.ClassNames, val)
			}
		case "CLASS-CONTRACT-TICKER-SYMBOL":
			// The ticker follows its class-contract id inside the same
			// <CLASS-CONTRACT> block, so it belongs to the last triple opened.
			if n := len(classes); n > 0 && classes[n-1].Ticker == "" {
				classes[n-1].Ticker = val
				if open {
					d := &decls[len(decls)-1]
					d.Tickers = append(d.Tickers, val)
				}
			}
		}
	}
	return classes, decls
}

// seriesIDs returns the distinct series ids of the triples, in first-seen order.
func seriesIDs(sc []SeriesClass) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range sc {
		if s.SeriesID != "" && !seen[s.SeriesID] {
			seen[s.SeriesID] = true
			out = append(out, s.SeriesID)
		}
	}
	return out
}

// normalizeSeriesName folds a fund name onto the form used to match a legacy
// body heading against a declared <SERIES-NAME>. The corpus shows three
// differences and only three: the body heading is uppercased, the header spells
// the registered and trademark marks the body drops, and the surrounding
// punctuation and whitespace differ ("SPDR(R) S&P(R) China ETF" against
// "SPDR S&P CHINA ETF").
//
// It therefore folds case, deletes the mark glyphs, and treats every other
// non-alphanumeric rune as a separator. Letters and DIGITS are kept: dropping
// either would collapse "Growth Fund II" onto "Growth Fund" and silently move one
// fund's votes onto another. Nothing is stemmed, abbreviated or truncated.
//
// Three punctuation-only widenings sit on top of that, and only three. The body
// heading spells an ampersand where the header spells the word ("MML Growth &
// Income Fund"); a '/' in a registered name reaches this corpus mojibaked to '?'
// ("Claymore?Sabrient Stealth Portfolio"); and a leading article is dropped by
// one side or the other. Each is a difference in how the SAME name was printed,
// never a difference between names, which is why they are folded here and why
// nothing else is: measured across all 106,719 declared series, the three
// together merge ZERO pairs of distinct series that the folding above separates.
// Anything that stems, drops a stopword, strips a suffix noun or measures an edit
// distance does merge such pairs — "PIMCO Low Duration Fund" and "PIMCO Low
// Duration Portfolio" are different registered series — and must not be added.
func normalizeSeriesName(s string) string {
	s = strings.ToLower(s)
	// An SGML header can carry an ampersand encoded once or twice
	// (`S&amp;amp;P 500`); decode until stable so it folds like the body's `&`.
	for strings.Contains(s, "&amp;") {
		s = strings.ReplaceAll(s, "&amp;", "&")
	}
	// Columbia Funds Variable Insurance Trust abbreviates the `, Variable
	// Series` sleeve that every one of its declared series spells out
	// (`Columbia International Fund, VS` for `Columbia International Fund,
	// Variable Series`, S000012559; 9,934 rows with no series). This is the
	// comparison key only -- the stored FundName keeps the printed spelling.
	// Only a WHOLE trailing `, VS` folds, so a class-bearing sleeve such as
	// `, VS-LCG` is left unmatched rather than merged onto the base series.
	if rest, ok := strings.CutSuffix(strings.TrimRight(s, " \t."), ", vs"); ok {
		s = rest + ", variable series"
	}
	s = seriesMarkReplacer.Replace(s)
	s = seriesPunctReplacer.Replace(s)

	var b strings.Builder
	b.Grow(len(s))
	space := false
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if space && b.Len() > 0 {
				b.WriteByte(' ')
			}
			space = false
			b.WriteRune(r)
			continue
		}
		space = true
	}
	// A leading article is dropped after folding, not before, so it is only ever
	// removed as a whole token: "The Growth Fund" folds onto "growth fund" while
	// "Theta Fund" is untouched. Never applied to a heading that is nothing but
	// the article, which would key an empty string.
	if rest, ok := strings.CutPrefix(b.String(), "the "); ok {
		return rest
	}
	return b.String()
}

// seriesMarkReplacer deletes the registered/trademark marks. The ASCII spellings
// must go before punctuation folding, because "(r)" would otherwise leave a bare
// "r" token that the body heading does not carry.
var seriesMarkReplacer = strings.NewReplacer(
	"(r)", "", "/r/", "", "(tm)", "", "(sm)", "", "(c)", "",
	"®", "", "™", "", "℠", "", "©", "",
)

// seriesPunctReplacer runs after the marks and before punctuation folding, which
// is the only point at which these two characters are still distinguishable from
// the separators everything else becomes. '&' must expand to the WORD, since
// folding alone would delete it and glue "s" to "p"; '?' must become a separator
// rather than expand to anything, because the character it stands in for is '/'.
// An apostrophe is DELETED rather than made a separator, so an abbreviation that
// spells it stays one token: `GE INT'L EQUITY FUND` folds to `int l` otherwise
// and is no longer an abbreviation of the declared `International` (S000001619,
// 1,549 rows). Both the ASCII and the typographic spelling.
// seriesDottedInitialism matches a run of two or more single letters each
// followed by a period. normalizeUndottedSeriesName deletes its dots BEFORE
// folding, so a dotted initialism keys the same as its undotted spelling: the
// heading `Vesper US Large Cap Short-Term Reversal Strategy ETF` and the
// dictionary's `Vesper U.S. Large Cap ...` (S000063053, 341 rows) name one fund
// and differ only in the periods. The run must be single letters throughout, so
// no word of a name is ever shortened.
//
// This is a RETRY key, never the primary one: `AIM V.I. Total Return Fund` and
// the brand strips built on its `v i` tokens are the registrant's own spelling,
// and folding it globally would take that reading away.
var seriesDottedInitialism = regexp.MustCompile(`(?:\b[a-z]\.){2,}`)

// normalizeUndottedSeriesName is normalizeSeriesName with dotted initialisms
// collapsed first. It returns "" when the name carries none, so a caller keys
// only the names for which the two spellings actually differ.
func normalizeUndottedSeriesName(s string) string {
	l := strings.ToLower(s)
	u := seriesDottedInitialism.ReplaceAllStringFunc(l, func(m string) string {
		return strings.ReplaceAll(m, ".", "")
	})
	if u == l {
		return ""
	}
	return normalizeSeriesName(u)
}

// seriesOrdinalWord maps the two spellings of an ordinal onto one token. Both
// directions are covered by folding BOTH sides onto the spelled-out word, so it
// does not matter which spelling the filing prints and which the dictionary
// carries: Dow Target Variable Fund LLC (CIK 1071056) declares `Dow Target 10 -
// First Quarter Portfolio` (S000007939) and prints `Dow Target 10 - 1st Quarter
// Portfolio` in every one of its eight vote-table banners.
//
// An ordinal is the one word whose two spellings cannot name two different
// funds -- `1st` is not an abbreviation of `First`, it IS `First` -- which is
// why this folds and no other word-level equivalence does. It is still a RETRY
// key, keyed and consulted only for names that carry an ordinal on BOTH sides,
// and collision refuses the way seriesByName refuses.
var seriesOrdinalWord = map[string]string{
	"1st": "first", "2nd": "second", "3rd": "third", "4th": "fourth",
	"5th": "fifth", "6th": "sixth", "7th": "seventh", "8th": "eighth",
	"9th": "ninth", "10th": "tenth", "11th": "eleventh", "12th": "twelfth",
	"first": "first", "second": "second", "third": "third", "fourth": "fourth",
	"fifth": "fifth", "sixth": "sixth", "seventh": "seventh", "eighth": "eighth",
	"ninth": "ninth", "tenth": "tenth", "eleventh": "eleventh", "twelfth": "twelfth",
}

// normalizeOrdinalSeriesName is normalizeSeriesName with every ordinal token
// folded onto its spelled-out word. It returns "" when the name carries no
// ordinal at all, so a caller keys and queries only the names for which the two
// spellings can actually differ.
func normalizeOrdinalSeriesName(s string) string {
	key := normalizeSeriesName(s)
	if key == "" {
		return ""
	}
	toks := strings.Fields(key)
	found := false
	for i, t := range toks {
		if w, ok := seriesOrdinalWord[t]; ok {
			toks[i] = w
			found = true
		}
	}
	if !found {
		return ""
	}
	return strings.Join(toks, " ")
}

// seriesByOrdinal keys each declared name that carries an ordinal under its
// ordinal-folded spelling, refusing on collision the way seriesByName does.
func seriesByOrdinal(decls []SeriesDecl) map[string]*SeriesDecl {
	out := make(map[string]*SeriesDecl)
	for i := range decls {
		d := &decls[i]
		if d.SeriesID == "" || d.Name == "" {
			continue
		}
		key := normalizeOrdinalSeriesName(d.Name)
		if key == "" {
			continue
		}
		prev, seen := out[key]
		if !seen {
			out[key] = d
			continue
		}
		if prev != nil && prev.SeriesID != d.SeriesID {
			out[key] = nil // ambiguous: two series answer to this spelling
		}
	}
	return out
}

var seriesPunctReplacer = strings.NewReplacer(
	"&", " and ",
	"?", " ",
	"'", "",
	"’", "",
)

// seriesByName maps each declared series name, normalised, onto its series id.
//
// A normalised name that two DISTINCT series share maps to the empty string: a
// series_id is the link key into the ISS panel, so attributing a vote to the
// wrong fund is silently worse than leaving the column blank. Nothing here
// guesses — a heading that is not in this map, or that resolves to the empty
// string, stamps nothing at all.
func seriesByName(decls []SeriesDecl) map[string]*SeriesDecl {
	out := make(map[string]*SeriesDecl, len(decls))
	for i := range decls {
		d := &decls[i]
		if d.SeriesID == "" || d.Name == "" {
			continue
		}
		key := normalizeSeriesName(d.Name)
		if key == "" {
			continue
		}
		prev, seen := out[key]
		if !seen {
			out[key] = d
			continue
		}
		if prev != nil && prev.SeriesID != d.SeriesID {
			out[key] = nil // ambiguous: two series answer to this name
		}
	}
	return out
}

// lookupSeriesByName resolves one body heading to the series the header declares
// under that name, or to nil when the heading names no declared series or an
// ambiguous one. A nil result means stamp nothing.
func lookupSeriesByName(idx map[string]*SeriesDecl, heading string) *SeriesDecl {
	d, _ := lookupSeriesEntry(idx, heading)
	return d
}

// lookupSeriesEntry is lookupSeriesByName plus the one distinction the collision
// rule needs: declared reports whether the header spells this normalised name AT
// ALL. A name two distinct series answer to is present in the index mapped to
// nil, so d==nil,declared==true is the deliberate refusal to guess between them,
// while d==nil,declared==false is simply a name the filing never declared.
//
// Only the second may be retried under a tolerance. Retrying an AMBIGUOUS name
// converts a refusal into a stamp, which is exactly what seriesByName's collision
// rule exists to prevent.
func lookupSeriesEntry(idx map[string]*SeriesDecl, heading string) (d *SeriesDecl, declared bool) {
	key := normalizeSeriesName(heading)
	if key == "" {
		return nil, false
	}
	d, declared = idx[key]
	return d, declared
}

// lookupSeriesStrippingRegistrant resolves a heading whose leading tokens are
// exactly the filing's OWN registrant name -- the COMPANY CONFORMED NAME its own
// SGML header declares -- by deleting that prefix and requiring the remainder to
// equal a declared <SERIES-NAME> under the same exact normalised equality
// everything else demands.
//
// It is a deletion of one string the filing itself spells, not a tolerance: the
// prefix removed is character-exact against the registrant name after folding,
// the boundary is a whole token so a registrant name cannot eat into the fund's,
// and the remainder must match exactly and unambiguously. It exists because the
// banner of a wrapped fund heading prints the complex before the fund
// ("MORGAN STANLEY INSTITUTIONAL FUND INC. ACTIVE INTERNATIONAL ALLOCATION
// PORTFOLIO" for a series declared "ACTIVE INTERNATIONAL ALLOCATION PORTFOLIO"),
// so reassembling the banner is necessary but not sufficient.
//
// The caller must have tried the heading AS PRINTED first and failed. A heading
// the header declares AMBIGUOUSLY has not failed -- it is a refusal to choose
// between two series -- and retrying it here would convert that refusal into a
// stamp, so the caller passes only genuinely unresolved headings.
//
// Returns nil, which means stamp nothing, whenever any of that does not hold.
//
// prefix is the registrant name ALREADY normalised. The registrant is a
// per-filing constant while this runs once per unresolved banner, so folding it
// here would make the strip cost O(banners x len(registrant name)) on input the
// filer controls end to end; the caller folds it once per filing instead.
func lookupSeriesStrippingRegistrant(idx map[string]*SeriesDecl, heading, prefix string) *SeriesDecl {
	if prefix == "" {
		return nil
	}
	rest, ok := strings.CutPrefix(normalizeSeriesName(heading), prefix)
	if !ok {
		return nil
	}
	// Normalised keys are single-space separated, so a leading space is exactly
	// the token boundary: without it "Growth Trust" would strip out of
	// "Growth Trustee Fund".
	rest, ok = strings.CutPrefix(rest, " ")
	if !ok || rest == "" {
		return nil
	}
	return lookupSeriesByName(idx, rest)
}

// lookupSeriesTolerant resolves a body heading to a declared series, allowing
// the ONE tolerance a full-corpus recon could justify: several registrants print
// the heading with a leading internal fund code ("2A14 Mid Cap Core Trust",
// "2CZ5 High Yield Fund") that the header never spells. That token is dropped and
// the remainder retried, and ONLY after the heading as printed has failed —
// hand-verified at 0 errors in 25 accepts, 883 distinct headings.
//
// Nothing else is tolerated. Suffix stripping (dropping a trailing "fund",
// "trust", "portfolio") was measured at 1 WRONG accept in 25: it collapses the
// REGISTRANT name "The Tocqueville Trust" onto its own series "The Tocqueville
// Fund" and moves 309 blocks of votes onto a fund that did not cast them. A
// series_id is a link key, so a wrong one silently transfers votes between funds
// and is far worse than a blank; no fuzzy, prefix, substring or edit-distance
// rule may be added here.
func lookupSeriesTolerant(idx map[string]*SeriesDecl, heading string) *SeriesDecl {
	d, _ := lookupSeriesTolerantEntry(idx, heading)
	return d
}

// lookupSeriesTolerantEntry is lookupSeriesTolerant plus the declared bit, under
// the same tolerance: declared reports that the filing's own header spells this
// normalised name — as printed, or with the leading internal fund code dropped —
// whether or not it spells it for exactly one series.
//
// The distinction is what a caller needs to tell a name the filing DECLARES
// TWICE from a line the filing does not name at all. Both stamp nothing, but only
// the first is evidence that the line is a fund heading: the filing has said this
// section belongs to some fund and refused to say which. A caller carrying a fund
// as state must CLEAR on it, because leaving the previous fund standing there
// files this section's votes under the section above — the silent transfer
// between funds the collision rule exists to prevent, one step along.
func lookupSeriesTolerantEntry(idx map[string]*SeriesDecl, heading string) (d *SeriesDecl, declared bool) {
	d, declared = lookupSeriesEntry(idx, heading)
	if d != nil || declared {
		// declared with d==nil is the header naming two distinct series. That is
		// a refusal to stamp, not a failed lookup, so the code strip must not
		// reopen it.
		return d, declared
	}
	fields := strings.Fields(heading)
	// The code may be printed in parentheses: `(ZW4X) GEI Total Return ...`.
	if len(fields) < 2 || !internalFundCode(strings.Trim(fields[0], "()")) {
		return nil, false
	}
	return lookupSeriesEntry(idx, strings.Join(fields[1:], " "))
}

// internalFundCode reports whether tok is a registrant's internal fund code:
// EXACTLY four alphanumeric characters carrying at least one digit. The digit is
// what keeps a real leading word of a fund name — "Core", "Gold", "High" — from
// ever being stripped, and the exact length is what keeps a longer word from it.
func internalFundCode(tok string) bool {
	if len(tok) != 4 {
		return false
	}
	digit := false
	for i := 0; i < len(tok); i++ {
		switch c := tok[i]; {
		case c >= '0' && c <= '9':
			digit = true
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z':
		default:
			return false
		}
	}
	return digit
}

// overlayHeaderIndex is the filing's own <SERIES-NAME> index, built once per
// filing, for the ONE consumer that needs to ask "does this filing's header
// itself name a series for this heading?" -- seriesOverlay.applyWithHeader's
// cross-check. It is per-filing state used from the single goroutine that walks
// that filing, so the memo needs no lock.
//
// Nothing here resolves a heading for a layout parser. The rungs the layouts run
// are untouched, and the elision tolerance below is reachable ONLY through an
// overlay row, where the alternative is a map id that may be wrong.
type overlayHeaderIndex struct {
	byName map[string]*SeriesDecl
	memo   map[string]*SeriesDecl
}

// newOverlayHeaderIndex builds the index from a filing's header declarations.
func newOverlayHeaderIndex(decls []SeriesDecl) *overlayHeaderIndex {
	return &overlayHeaderIndex{byName: seriesByName(decls), memo: map[string]*SeriesDecl{}}
}

// resolve returns the series this filing's own header names under heading, or
// nil when it names none or names two. A nil index resolves nothing, which is
// what leaves apply's behaviour unchanged for callers that have no header.
func (h *overlayHeaderIndex) resolve(heading string) *SeriesDecl {
	if h == nil || heading == "" {
		return nil
	}
	if d, ok := h.memo[heading]; ok {
		return d
	}
	d, _ := lookupSeriesTolerantEntry(h.byName, heading)
	if d == nil {
		d = h.elidedTokenMatch(heading)
	}
	h.memo[heading] = d
	return d
}

// elidedTokenMatch resolves a heading whose words this vendor ELIDES with an
// apostrophe -- `2A32 Int'l Equity Index B` for the declared `International
// Equity Index Trust B` (CIK 756913, S000008297) -- which no rung above can
// reach: normalizeSeriesName deletes the apostrophe, so the printed token keys
// as `intl` against a declared `international` and aligns nowhere.
//
// The discipline is the one every other tolerance in this package carries. The
// apostrophe must be PRINTED, so only a token the filer itself marked as
// shortened is ever read as short; an elided token must abbreviate its declared
// token under issAbbreviates (same first letter, rest a subsequence); every
// other printed token must match EXACTLY; at least two must be spelled in full;
// the only declared tokens the heading may omit are brTypeTailWord, which carry
// no strategy; and two declared series answering stamps NOTHING, since choosing
// between them would move one fund's votes onto another.
func (h *overlayHeaderIndex) elidedTokenMatch(heading string) *SeriesDecl {
	fields := strings.Fields(heading)
	if len(fields) > 1 && internalFundCode(strings.Trim(fields[0], "()")) {
		fields = fields[1:]
	}
	type printedToken struct {
		tok    string
		elided bool
	}
	var toks []printedToken
	elided := false
	for _, f := range fields {
		mark := strings.ContainsAny(f, "'’")
		for _, t := range strings.Fields(normalizeSeriesName(f)) {
			toks = append(toks, printedToken{t, mark})
			elided = elided || mark
		}
	}
	if !elided || len(toks) < 3 {
		return nil
	}
	var hit *SeriesDecl
	for name, d := range h.byName {
		if d == nil || d.SeriesID == "" {
			continue
		}
		dt := strings.Fields(name)
		j, exact, fit := 0, 0, true
		for _, p := range toks {
			// A declared type word the heading does not print may be skipped, and
			// only while it does not itself answer the printed token.
			for j < len(dt) && dt[j] != p.tok && brTypeTailWord[dt[j]] {
				j++
			}
			switch {
			case j >= len(dt):
				fit = false
			case dt[j] == p.tok:
				exact++
			case p.elided && issAbbreviates(p.tok, dt[j]):
			default:
				fit = false
			}
			if !fit {
				break
			}
			j++
		}
		for ; fit && j < len(dt); j++ {
			if !brTypeTailWord[dt[j]] {
				fit = false
			}
		}
		if !fit || exact < 2 {
			continue
		}
		if hit != nil && hit.SeriesID != d.SeriesID {
			return nil
		}
		hit = d
	}
	return hit
}

// classIDsFor returns the class-contract ids belonging to one series id.
func classIDsFor(sc []SeriesClass, seriesID string) []string {
	var out []string
	for _, s := range sc {
		if s.SeriesID == seriesID && s.ClassID != "" {
			out = append(out, s.ClassID)
		}
	}
	return out
}
