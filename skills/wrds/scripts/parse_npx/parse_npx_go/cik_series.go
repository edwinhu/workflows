package main

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

// cikSeries is a per-registrant series dictionary: every (series_id, name) a
// CIK has declared in any filing's SGML header. EDGAR carries no series tags
// before 2006, so a 2004-2005 N-PX declares nothing and its rows cannot be
// attributed from its own header; the ids are stable, so the registrant's later
// declarations are the ones that header would have carried. It backs a filing
// ONLY when the header declares no series -- a header that declares any is the
// authority for that filing -- and it supplies decls without class contracts,
// so class_ids stay blank on rows it attributes.
type cikSeries struct {
	byCIK map[string][]SeriesDecl
}

// loadCIKSeries reads a headerless TSV: cik, series_id, series_name[, ...].
// Duplicate (cik, id, name) rows collapse; the same id under two names keeps
// both, since a fund renamed later still resolves under either.
func loadCIKSeries(path string) (*cikSeries, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	d := &cikSeries{byCIK: map[string][]SeriesDecl{}}
	seen := map[string]bool{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		p := strings.Split(sc.Text(), "\t")
		if len(p) < 3 || p[0] == "" || p[1] == "" || p[2] == "" {
			continue
		}
		k := p[0] + "\t" + p[1] + "\t" + p[2]
		if seen[k] {
			continue
		}
		seen[k] = true
		decl := SeriesDecl{SeriesID: p[1], Name: p[2]}
		if len(p) > 3 && len(p[3]) == 8 && isAllDigits(p[3]) {
			decl.DeclDate = p[3]
		}
		d.byCIK[p[0]] = append(d.byCIK[p[0]], decl)
	}
	return d, sc.Err()
}

// back supplies dictionary decls to a filing whose header declares none.
func (d *cikSeries) back(meta *FilingMeta) {
	if d == nil || len(meta.SeriesDecls) > 0 {
		return
	}
	if decls := d.byCIK[meta.CIK]; len(decls) > 0 {
		period := meta.PeriodOfReport
		if period == "" {
			period = meta.ReportPeriodEnd
		}
		meta.SeriesDecls = dictContemporaneous(decls, period)
	}
}

// dictContemporaneous drops the dictionary entries that make one name answer to
// two series when the registrant simply reused the name years apart: CIK
// 1217286 declared `JPMorgan Market Neutral Fund` for S000002614 in 2006 and
// again for S000002838 in 2014, and a 2005 filing printing that banner means
// the 2006 holder. The entry whose DECLARATION is nearest the filing's period
// survives and the rest of that name is dropped, so seriesByName sees one
// answer instead of refusing both.
//
// The tiebreak is dictionary-only evidence: it fires only when every colliding
// entry carries a declaration date, which a header-sourced decl never does, and
// only when one entry is strictly nearest. Names that do not collide, and the
// surviving id's OTHER names, are untouched.
func dictContemporaneous(decls []SeriesDecl, period string) []SeriesDecl {
	if len(period) != 8 {
		return append([]SeriesDecl(nil), decls...)
	}
	byName := map[string][]int{}
	for i, x := range decls {
		if k := normalizeSeriesName(x.Name); k != "" {
			byName[k] = append(byName[k], i)
		}
	}
	drop := map[int]bool{}
	for _, idx := range byName {
		best, bestGap, tied := -1, 0, false
		ids := map[string]bool{}
		for _, i := range idx {
			if decls[i].DeclDate == "" {
				best = -1
				break
			}
			ids[decls[i].SeriesID] = true
			gap := dateGapDays(decls[i].DeclDate, period)
			switch {
			case best < 0 || gap < bestGap:
				best, bestGap, tied = i, gap, false
			case gap == bestGap && decls[i].SeriesID != decls[best].SeriesID:
				tied = true
			}
		}
		if best < 0 || tied || len(ids) < 2 {
			continue
		}
		for _, i := range idx {
			if decls[i].SeriesID != decls[best].SeriesID {
				drop[i] = true
			}
		}
	}
	out := make([]SeriesDecl, 0, len(decls))
	for i, x := range decls {
		if !drop[i] {
			out = append(out, x)
		}
	}
	return out
}

// dateGapDays is the absolute distance between two YYYYMMDD dates, counting
// months as 31 days: an ordering, not a calendar.
func dateGapDays(a, b string) int {
	n := func(s string) int {
		y, _ := strconv.Atoi(s[:4])
		m, _ := strconv.Atoi(s[4:6])
		d, _ := strconv.Atoi(s[6:8])
		return y*372 + m*31 + d
	}
	if g := n(a) - n(b); g < 0 {
		return -g
	} else {
		return g
	}
}

// dictFallback stamps a row whose heading equals, EXACTLY, one dictionary name of
// the filing's registrant that the header itself did not declare. The header
// stays the authority for what it declares (those names are excluded here, so
// a rule that already refused them cannot be overridden); this only reaches
// headings the header does not know at all, and a name two dictionary series
// answer to is refused the way seriesByName refuses it.
type dictFallback struct {
	byName        map[string]*SeriesDecl
	byHeadingName map[string]*SeriesDecl // Lincoln heading lookup, including declared-name collisions
}

func (d *cikSeries) exactFallback(meta FilingMeta) *dictFallback {
	if d == nil {
		return nil
	}
	// declared maps each header id to its header name (normalised); a dictionary
	// entry is extra when the header does not know the id, or knows it under a
	// DIFFERENT name -- the registrant's own alternate spelling of a declared id.
	declared := map[string]map[string]bool{}
	for _, x := range meta.SeriesDecls {
		if declared[x.SeriesID] == nil {
			declared[x.SeriesID] = map[string]bool{}
		}
		declared[x.SeriesID][normalizeSeriesName(x.Name)] = true
	}
	var extra []SeriesDecl
	for _, x := range d.byCIK[meta.CIK] {
		if names, ok := declared[x.SeriesID]; !ok || !names[normalizeSeriesName(x.Name)] {
			extra = append(extra, x)
		}
	}
	if len(extra) == 0 {
		return nil
	}
	f := &dictFallback{byName: seriesByName(extra)}
	if normalizeSeriesName(meta.CompanyName) == "lincoln variable insurance products trust" {
		// Keep the declaring pool unchanged; combine names only to refuse collisions.
		all := append(append([]SeriesDecl(nil), meta.SeriesDecls...), extra...)
		f.byHeadingName = seriesByName(all)
	}
	return f
}

func (f *dictFallback) apply(r *VoteRow) {
	if f == nil || r.SeriesID != "" || r.FundName == "" {
		return
	}
	if d, _ := lookupSeriesEntry(f.byName, r.FundName); d != nil {
		r.SeriesID = d.SeriesID
		return
	}
	// The heading may carry a trailing parenthetical the dictionary name lacks --
	// `(Master Trust)`, a sleeve, a former name -- the same cut the header rules
	// make. A class marker stays: `FUND (A)` is a class-pair question.
	if !issClassMarker(r.FundName) {
		if head, ok := issCutTrailingParenthetical(r.FundName); ok {
			if d, _ := lookupSeriesEntry(f.byName, head); d != nil {
				r.SeriesID = d.SeriesID
			}
		}
	}
	// A sub-adviser SLEEVE after a dash: `Natixis Income Diversified Portfolio -
	// Active` for a dictionary `Natixis Income Diversified Portfolio`
	// (S000006657, 1,859 rows across three sleeves of one filing). The same cut
	// the header rules make with icrQualifierDelim, and the head still has to be
	// a dictionary name exactly; a name that is itself hyphenated carries no
	// space around its dash and is never cut.
	if r.SeriesID == "" {
		if head, _, ok := strings.Cut(r.FundName, icrQualifierDelim); ok && strings.TrimSpace(head) != "" {
			if d, _ := lookupSeriesEntry(f.byName, head); d != nil {
				r.SeriesID = d.SeriesID
			}
		}
	}
	// `JU77 Alliance Growth Portfolio`: an account code before the name
	// (SunAmerica Series Trust 2005, pvtext), read past the way the header
	// rules read `2DCN ...`.
	if r.SeriesID == "" {
		if rest, ok := issLeadingCodeToken(r.FundName); ok {
			if d, _ := lookupSeriesEntry(f.byName, rest); d != nil {
				r.SeriesID = d.SeriesID
			}
		}
	}
	// The same account code spelled in letters alone: DWS Variable Series II
	// 2006 runs its sleeve codes A..Z and then doubles and triples off the same
	// letters, `AA      DWS BALANCED VIP`, `DDD   DWS JANUS GROWTH & INCOME
	// VIP`. issLeadingCodeToken refuses these because they carry no digit,
	// which is what keeps `Growth Emerging Markets Value Fund` whole; the
	// remainder must therefore be an EXACT, unambiguous dictionary name, which
	// is itself the evidence that the first token was a code and not a word of
	// the name.
	if r.SeriesID == "" {
		if rest, ok := issLetterCodeToken(r.FundName); ok {
			if d, _ := lookupSeriesEntry(f.byName, rest); d != nil {
				r.SeriesID = d.SeriesID
			}
		}
	}
}
