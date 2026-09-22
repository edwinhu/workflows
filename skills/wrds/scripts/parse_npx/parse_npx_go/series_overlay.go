package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// seriesOverlay is an external (filing, heading) -> series_id table for fund
// headings the rules left unresolved (today: the audited Gemini map). It is
// consulted only for a row whose series_id is still blank after the rules and
// the chassis stamp, only on the exact heading the parser printed, and only
// when the mapped id is one the permitted set carries -- the filing's own decls,
// its registrant's dictionary, and the ids this filing's own map rows name (see
// licenseHandMapped). Anything else is dropped rather than trusted.
type seriesOverlay struct {
	byFiling map[string]map[string]string
}

// loadSeriesOverlay reads a TSV whose header names at least filing, heading and
// series_id (any column order; extra columns ignored).
func loadSeriesOverlay(path string) (*seriesOverlay, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	if !sc.Scan() {
		return nil, fmt.Errorf("series map %s: empty", path)
	}
	col := map[string]int{}
	for i, h := range strings.Split(sc.Text(), "\t") {
		col[h] = i
	}
	for _, need := range []string{"filing", "heading", "series_id"} {
		if _, ok := col[need]; !ok {
			return nil, fmt.Errorf("series map %s: no %s column", path, need)
		}
	}
	ov := &seriesOverlay{byFiling: map[string]map[string]string{}}
	for sc.Scan() {
		parts := strings.Split(sc.Text(), "\t")
		if len(parts) <= col["series_id"] || len(parts) <= col["heading"] || len(parts) <= col["filing"] {
			continue
		}
		filing, heading, id := parts[col["filing"]], parts[col["heading"]], parts[col["series_id"]]
		if filing == "" || heading == "" || id == "" {
			continue
		}
		m := ov.byFiling[filing]
		if m == nil {
			m = map[string]string{}
			ov.byFiling[filing] = m
		}
		m[heading] = id
	}
	return ov, sc.Err()
}

// apply fills r.SeriesID from the map when it is blank, the filing has an entry
// for the row's printed fund name, and the id is declared by the filing. It is
// applyWithHeader with no header cross-check available.
func (o *seriesOverlay) apply(relPath string, declared map[string]bool, r *VoteRow) {
	o.applyWithHeader(relPath, declared, nil, r)
}

// applyWithHeader is apply plus the cross-check against the filing's OWN header
// declarations. The map is hand-audited but not audited truth: for
// `000075/756913/0001438934-14-000466.txt` it maps the heading `2A32 Int'l Equity
// Index B` to S000029541 (`International Growth Stock Trust`), a real but
// unrelated series of the same registrant, while mapping that IDENTICAL heading
// string to S000008297 (`International Equity Index Trust B`) for the same
// registrant's 2006, 2007 and 2008 filings -- one heading read two ways by one
// table, 23,999 rows filed under the wrong sleeve.
//
// So when the filing's own header names a series for this heading and the map
// names a DIFFERENT one, the header wins: a declaration the registrant itself
// printed in this filing is stronger evidence than an external map row. A
// heading the header does not name -- the common case, and the reason the
// overlay exists at all -- is left to the map exactly as before, so the
// thousands of correct rows are untouched.
func (o *seriesOverlay) applyWithHeader(relPath string, declared map[string]bool, hdr *overlayHeaderIndex, r *VoteRow) {
	if o == nil || r.SeriesID != "" {
		return
	}
	m := o.byFiling[relPath]
	if m == nil {
		return
	}
	id := m[sanitize(r.FundName)]
	if id == "" {
		return
	}
	if d := hdr.resolve(r.FundName); d != nil && d.SeriesID != "" && !overlayNamesID(id, d.SeriesID) {
		// The map contradicts the header. Stamp the header's answer when it is one
		// the overlay would have been allowed to stamp, and otherwise nothing --
		// never the contradicted map id.
		if declared[d.SeriesID] {
			r.SeriesID = d.SeriesID
		}
		return
	}
	// MISLINK-GSTI1100663-BLOCK: the map's own sibling rows for THIS filing
	// outrank a row that jumps out of the block they agree on.
	if alt := o.siblingBlockID(relPath, r.FundName, hdr); alt != "" && !overlayNamesID(id, alt) {
		if declared[alt] {
			r.SeriesID = alt
		}
		return
	}
	// A class pair the map names as "S1;S2" is stamped whole, the form the issnpx
	// class-pair rule emits; every id in it must be one the filing declares.
	for _, one := range strings.Split(id, MultiValueSep) {
		if !declared[one] {
			return
		}
	}
	r.SeriesID = id
}

// siblingBlockID is the second cross-check on a map row, and the one that needs
// no header answer for the heading itself. The header cross-check above fires
// only when the filing's own header resolves the SAME heading to a different
// series; a vendor rename the header does not spell resolves to NOTHING, so a
// map row on such a heading has nothing to disagree with and is stamped
// unexamined, however far it lands from its own siblings.
//
// iShares Trust (CIK 0001100663, filing 0001193125-07-193032) prints four
// `ISHARES S&P GSTI[TM] <X> INDEX FUND` banners -- S&P's later name for the
// Goldman Sachs index family -- which the header spells under the old brand and
// resolves to nothing. The map reads three of them onto the registrant's own
// contiguous Goldman Sachs block (NETWORKING -> S000004353, SEMICONDUCTOR ->
// S000004354, SOFTWARE -> S000004355) and the fourth, TECHNOLOGY, onto
// S000004329, `iShares Dow Jones U.S. Technology Sector Index Fund` (ticker
// IYW), a different family that prints its OWN banner and its own 1,563 rows in
// this same filing -- one series id handed two printed sections, and 1,684 rows
// of the Goldman Sachs fund filed under a fund that cast none of them.
//
// The evidence is the map's own siblings, read only within this one filing. A
// sibling heading that differs from this heading in EXACTLY ONE token states how
// this registrant spells the difference: the sibling's declared name carries the
// sibling's token, and substituting this heading's token for it yields a name
// the filing's header declares -- `iShares Goldman Sachs Technology Index Fund`,
// S000004352, sole class C000012082, ticker IGM. Two or more siblings must agree
// unanimously on the substituted answer, so a single coincidental one-token
// neighbour decides nothing, and an answer that merely restates the map's own id
// changes nothing. Registrant-scoped by construction: every input is this
// filing's map rows and this filing's header declarations.
func (o *seriesOverlay) siblingBlockID(relPath, heading string, hdr *overlayHeaderIndex) string {
	if o == nil || hdr == nil {
		return ""
	}
	m := o.byFiling[relPath]
	self := sanitize(heading)
	toks := strings.Fields(normalizeSeriesName(heading))
	if len(m) < 3 || len(toks) < 3 {
		return ""
	}
	votes := map[string]int{}
	for sibHeading, sibID := range m {
		if sibHeading == self || strings.Contains(sibID, MultiValueSep) {
			continue
		}
		sibToks := strings.Fields(normalizeSeriesName(sibHeading))
		p, ok := overlayLoneTokenDiff(toks, sibToks)
		if !ok {
			continue
		}
		// The sibling's own declared name, which must carry the sibling's
		// distinguishing token exactly once for the substitution to be defined.
		name := overlayDeclaredName(hdr, sibID, sibToks[p])
		if name == nil {
			continue
		}
		name[indexOfToken(name, sibToks[p])] = toks[p]
		if d, _ := lookupSeriesEntry(hdr.byName, strings.Join(name, " ")); d != nil && d.SeriesID != "" {
			votes[d.SeriesID]++
		}
	}
	if len(votes) != 1 {
		return ""
	}
	for id, n := range votes {
		if n >= 2 {
			return id
		}
	}
	return ""
}

// overlayLoneTokenDiff returns the single position at which two equal-length
// token runs differ. Any other shape -- different lengths, identical runs, two
// or more differences -- is not a sibling pair and reports false.
func overlayLoneTokenDiff(a, b []string) (int, bool) {
	if len(a) != len(b) {
		return 0, false
	}
	at := -1
	for i := range a {
		if a[i] == b[i] {
			continue
		}
		if at >= 0 {
			return 0, false
		}
		at = i
	}
	return at, at >= 0
}

// overlayDeclaredName returns the tokens of the ONE name this filing's header
// declares for id and that carries tok exactly once, or nil when the header
// declares no such name, more than one, or one that spells tok twice -- each of
// which leaves the substitution undefined.
func overlayDeclaredName(hdr *overlayHeaderIndex, id, tok string) []string {
	var out []string
	for name, d := range hdr.byName {
		if d == nil || d.SeriesID != id {
			continue
		}
		fields := strings.Fields(name)
		n := 0
		for _, f := range fields {
			if f == tok {
				n++
			}
		}
		if n != 1 {
			continue
		}
		if out != nil {
			return nil
		}
		out = fields
	}
	return out
}

// overlayNamesID reports whether a mapped id -- a single series or a "S1;S2"
// class pair -- names want. A pair that carries the header's answer agrees with
// it rather than contradicting it.
func overlayNamesID(mapped, want string) bool {
	for _, one := range strings.Split(mapped, MultiValueSep) {
		if one == want {
			return true
		}
	}
	return false
}

// overlayDeclaredIDs is the set of series the overlay may stamp: the header's
// decls (or the CIK dictionary's when the header carries none) plus every series
// the registrant's dictionary knows, since a fund merged or renamed before the
// filing still voted under its old series id and the audited map names it. That
// widening licenses only ids declared EARLIER than the period; a future-vintage
// id is dropped by overlayFutureVintage below.
func overlayDeclaredIDs(meta FilingMeta) map[string]bool {
	out := map[string]bool{}
	for _, d := range meta.SeriesDecls {
		if d.SeriesID != "" {
			out[d.SeriesID] = true
		}
	}
	if cikDict != nil {
		for _, d := range cikDict.byCIK[meta.CIK] {
			if d.SeriesID != "" {
				out[d.SeriesID] = true
			}
		}
	}
	for id := range out {
		if overlayFutureVintage(meta, id) {
			delete(out, id)
		}
	}
	return out
}

// licenseHandMapped widens overlayDeclaredIDs by the ids THIS filing's own map
// rows name. A fund that changed registrants between filings -- ING Partners'
// `ING UBS U.S. ALLOCATION PORTFOLIO`, re-registered under ING Investors Trust
// and tagged S000005761 there -- has its id in no dictionary the filer's CIK
// owns, so the same-CIK membership test refuses it however well audited the map
// entry is. A map entry is not a match: it is keyed to one filing and one
// printed heading and was read by hand, so the filer's own dictionary is not the
// authority on it. The matching routes stay as strict as they are -- crossCIK
// and overlayFutureVintage are untouched, and nothing here resolves a heading;
// only an id an auditor already wrote against this exact filing is licensed.
//
// Two guards remain: the id must be one the corpus dictionary actually carries
// under some registrant (a typo or a retired id is not an audit), and
// overlayFutureVintage still refuses an id this filing's own header dates after
// the period.
func (o *seriesOverlay) licenseHandMapped(relPath string, meta FilingMeta, declared map[string]bool) {
	if o == nil || declared == nil || cikDict == nil {
		return
	}
	for _, id := range o.byFiling[relPath] {
		for _, one := range strings.Split(id, MultiValueSep) {
			if one == "" || declared[one] || !cikDict.idsAll[one] || overlayFutureVintage(meta, one) {
				continue
			}
			declared[one] = true
		}
	}
}

// overlayFutureVintage is issFutureVintage's predicate (layout_issnpx.go)
// restated over meta.SeriesDecls: the overlay is stamped from main.go's stamp
// closure, where no issSeriesIndex exists. Keep the two in step. An id whose
// earliest dated declaration post-dates BOTH this filing's period and the
// earliest dated declaration the registrant carries did not exist at the
// period, so the map may not stamp it. A declaration the filing's own header
// printed is undated and is never refused.
func overlayFutureVintage(meta FilingMeta, id string) bool {
	if len(meta.PeriodOfReport) != 8 {
		return false
	}
	first, earliest := "", ""
	for i := range meta.SeriesDecls {
		d := &meta.SeriesDecls[i]
		if len(d.DeclDate) != 8 {
			if d.SeriesID == id {
				return false
			}
			continue
		}
		if earliest == "" || d.DeclDate < earliest {
			earliest = d.DeclDate
		}
		if d.SeriesID == id && (first == "" || d.DeclDate < first) {
			first = d.DeclDate
		}
	}
	return first != "" && first > meta.PeriodOfReport && first > earliest
}
