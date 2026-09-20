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
// when the mapped id is one the filing's own header declares -- an id the
// header does not know cannot be a link key for that filing, so it is dropped
// rather than trusted.
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
// for the row's printed fund name, and the id is declared by the filing.
func (o *seriesOverlay) apply(relPath string, declared map[string]bool, r *VoteRow) {
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
	// A class pair the map names as "S1;S2" is stamped whole, the form the issnpx
	// class-pair rule emits; every id in it must be one the filing declares.
	for _, one := range strings.Split(id, MultiValueSep) {
		if !declared[one] {
			return
		}
	}
	r.SeriesID = id
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
