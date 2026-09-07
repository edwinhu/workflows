package main

import (
	"bufio"
	"os"
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
		d.byCIK[p[0]] = append(d.byCIK[p[0]], SeriesDecl{SeriesID: p[1], Name: p[2]})
	}
	return d, sc.Err()
}

// back supplies dictionary decls to a filing whose header declares none.
func (d *cikSeries) back(meta *FilingMeta) {
	if d == nil || len(meta.SeriesDecls) > 0 {
		return
	}
	if decls := d.byCIK[meta.CIK]; len(decls) > 0 {
		meta.SeriesDecls = append([]SeriesDecl(nil), decls...)
	}
}

// dictFallback stamps a row whose heading equals, EXACTLY, one dictionary name of
// the filing's registrant that the header itself did not declare. The header
// stays the authority for what it declares (those names are excluded here, so
// a rule that already refused them cannot be overridden); this only reaches
// headings the header does not know at all, and a name two dictionary series
// answer to is refused the way seriesByName refuses it.
type dictFallback struct {
	byName map[string]*SeriesDecl
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
	return &dictFallback{byName: seriesByName(extra)}
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
}
