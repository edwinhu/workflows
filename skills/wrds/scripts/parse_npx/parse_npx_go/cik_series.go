package main

import (
	"bufio"
	"os"
	"sort"
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
	// byNameAll keys every dictionary name in the corpus, normalised, onto its
	// single answer, and onto nil the moment two series or two registrants
	// answer to it. It is the last rung's whole guard: see crossCIK.
	byNameAll map[string]*corpusName
	// idsAll is every series id the corpus dictionary carries, under any CIK. It
	// is not a matching route -- nothing resolves a heading through it -- only a
	// sanity check that an id an audited overlay row names is a real one: see
	// seriesOverlay.licenseHandMapped.
	idsAll map[string]bool
}

// corpusName is one normalised dictionary name's single corpus-wide answer:
// which registrant declared it and which series it is.
type corpusName struct {
	cik  string
	decl *SeriesDecl
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
		if lead := declaredLeadName(p[2]); lead != "" {
			ak := p[0] + "\t" + p[1] + "\t" + lead
			if !seen[ak] {
				seen[ak] = true
				alias := decl
				alias.Name = lead
				d.byCIK[p[0]] = append(d.byCIK[p[0]], alias)
			}
		}
	}
	d.indexCorpusNames()
	return d, sc.Err()
}

// declaredLeadName is the name a declaration spells before a TRAILING rename
// parenthetical -- `Victory 500 Index VIP Series (formerly Victory S&P 500 Index
// VIP Series)` is also, and at that same vintage, `Victory 500 Index VIP
// Series`. The registrant is declaring one name and annotating the old one, and
// a filing of that vintage prints the leading name alone, so the whole-string
// index misses it by the parenthetical. It returns "" when there is no such
// tail. Only the leading name is an alias: the former name inside the
// parenthetical is NOT keyed, since the declaration says that name is no longer
// the fund's.
func declaredLeadName(name string) string {
	s := strings.TrimRight(name, " \t")
	if !strings.HasSuffix(s, ")") {
		return ""
	}
	i := strings.LastIndexByte(s, '(')
	if i <= 0 {
		return ""
	}
	inner := strings.ToLower(strings.TrimLeft(s[i+1:len(s)-1], " \t"))
	renamed := false
	for _, k := range []string{"formerly", "formally", "f/k/a", "fka"} {
		if strings.HasPrefix(inner, k) {
			renamed = true
			break
		}
	}
	if !renamed {
		return ""
	}
	lead := strings.TrimRight(s[:i], " \t,")
	if lead == "" || lead == name {
		return ""
	}
	return lead
}

// indexCorpusNames builds byNameAll once the per-CIK slices have stopped
// growing; a pointer taken during the scan would dangle on the next append.
func (d *cikSeries) indexCorpusNames() {
	d.byNameAll = make(map[string]*corpusName)
	d.idsAll = make(map[string]bool)
	for cik, decls := range d.byCIK {
		for i := range decls {
			x := &decls[i]
			key := normalizeSeriesName(x.Name)
			if x.SeriesID != "" {
				d.idsAll[x.SeriesID] = true
			}
			if key == "" || x.SeriesID == "" {
				continue
			}
			prev, seen := d.byNameAll[key]
			if !seen {
				d.byNameAll[key] = &corpusName{cik: cik, decl: x}
				continue
			}
			if prev != nil && (prev.decl.SeriesID != x.SeriesID || prev.cik != cik) {
				d.byNameAll[key] = nil // ambiguous corpus-wide: two series, or two registrants
			}
		}
	}
}

// crossCIK answers a heading that resolved against neither the filing's own
// declarations nor its own registrant's dictionary rows: the printed name is a
// fund of a SIBLING registrant of the same sponsor, tagged under another CIK.
// Claymore Exchange-Traded Fund Trust 2 prints nine funds of Claymore
// Exchange-Traded Fund Trust (CIK 1364089, 14,290 rows); State Farm Mutual Fund
// Trust prints `State Farm Small Cap Equity Index Fund`, tagged S000002061 at
// CIK 1034633 (3,256 rows).
//
// EXACTNESS AND CORPUS-WIDE UNIQUENESS ARE THE WHOLE GUARD. The normalised name
// must be one the corpus answers with exactly one series of exactly one
// registrant; anything else stays blank. Nothing here is stemmed, cut or
// widened -- a loose cross-CIK rung would mislink across sponsors, which is what
// every widened rung has cost before. It is consulted only after every
// registrant-scoped rung has refused, so a same-CIK answer always wins, and the
// filer's own CIK is excluded: those rows are the registrant-scoped rungs' own
// business and their refusals are not overridden here.
//
// CONTEMPORANEITY IS PART OF THE GUARD. byNameAll indexes every vintage of every
// name with no date filter, so an exact and unique hit may be a name the other
// registrant adopted years AFTER the filing: BLACKROCK FUNDS' 2004 heading
// `BLACKROCK BALANCED PORTFOLIO` matched S000003863 of CIK 319108 off its
// 20250630 declaration, a series called `Mercury Balanced Capital Strategy
// Portfolio` in 2004. The heading and the matched name never coexisted, so the
// hit is refused. dictContemporaneous is the same comparison on the same-CIK
// path; period is the filing's, empty when unknown, and a decl with no
// declaration date is read as contemporaneous the way that path reads it.
//
// ABANDONMENT IS THE OTHER HALF OF CONTEMPORANEITY. A matched name whose
// declaration precedes the period is still wrong when the SAME series, under
// the same registrant, was redeclared under a DIFFERENT name at or before that
// period: the registrant's own statement that the name was superseded. SYNTAX
// ETF TRUST's 2023 wrapped banner `EQUITY` matched S000008805 of CIK 88525 off
// its 20060630 declaration, a series renamed `Large Cap Core` in 2010 and
// `Guggenheim StylePlus - Large Core Fund` in 2013; S000008807 is the same
// shape for `GLOBAL`. The guard above refuses a name adopted too LATE, this one
// a name dropped too EARLY, and neither widens anything.
//
// THE FILER'S OWN BRAND INFIX REFUSES. Lazard Retirement Series Inc heads all
// 30 sections of its 2017 filing with the RETAIL spelling its sibling The
// Lazard Funds Inc registered, and its own sleeve is that name plus one token
// of its own COMPANY CONFORMED NAME (`Lazard Retirement Global Dynamic
// Multi-Asset Portfolio`, S000037000). A heading the filer's own dictionary
// names at one inserted registrant-brand token is the filer's own sleeve
// printed short of its brand, so the sibling's identically-spelled retail
// series is the wrong answer and the heading stays blank.
// sameCIK is crossCIK's mirror on the filer's OWN CIK: the heading is spelled
// exactly as ONE series of this registrant's own dictionary, at some vintage,
// and that series is one the filing's own header never declared. A registrant
// that splits a period's sleeves across TWO accessions -- a declaring pool --
// leaves each accession's header short of the other's series while both bodies
// still print every banner they cover. Nationwide Variable Insurance Trust
// (CIK 353905, 20140630) declares S000005402 `NVIT International Equity Fund`
// and prints a section headed `NVIT International Index Fund`, which is
// S000012313's own dictionary name, declared for the same period by the sibling
// accession. The registrant-scoped near-miss rungs reach that banner by
// swapping `Index` for `Equity` and stamp the wrong sleeve; the dictionary
// spells it right.
//
// EXACTNESS AND REGISTRANT-WIDE UNIQUENESS ARE THE GUARD, as they are on
// crossCIK. The normalised heading must be answered by exactly one series id of
// this CIK across EVERY vintage -- a name two of the registrant's own sleeves
// have carried settles nothing and falls through to the chain's existing
// behaviour unchanged. registrantExactName is the neighbouring rung and is not
// this one: it reads the contemporaneous pool through seriesByName, so a name
// the registrant reused years apart survives its refusal via
// dictContemporaneous's tiebreak. Nothing here is stemmed, cut or widened.
//
// CONTEMPORANEITY AND ABANDONMENT ARE READ THE SAME WAY crossCIK reads them: a
// name adopted after the period is refused, as is one the registrant had
// already superseded by it. The earliest vintage spelling the heading is the
// one dated, so a long-held name is judged by when it was adopted.
func (d *cikSeries) sameCIK(cik, heading, period string) *SeriesDecl {
	if d == nil || cik == "" || heading == "" {
		return nil
	}
	key := normalizeSeriesName(heading)
	if key == "" {
		return nil
	}
	var hit *SeriesDecl
	own := d.byCIK[cik]
	for i := range own {
		x := &own[i]
		if x.SeriesID == "" || normalizeSeriesName(x.Name) != key {
			continue
		}
		if hit != nil && hit.SeriesID != x.SeriesID {
			return nil // two of this registrant's own sleeves answer to it
		}
		if hit == nil || (len(x.DeclDate) == 8 && (len(hit.DeclDate) != 8 || x.DeclDate < hit.DeclDate)) {
			hit = x
		}
	}
	if hit == nil {
		return nil
	}
	if len(period) == 8 && len(hit.DeclDate) == 8 && hit.DeclDate > period {
		return nil
	}
	if d.abandonedByPeriod(&corpusName{cik: cik, decl: hit}, key, period) {
		return nil
	}
	return hit
}

func (d *cikSeries) crossCIK(cik, heading, period, registrantKey string) *SeriesDecl {
	if d == nil || cik == "" || heading == "" {
		return nil
	}
	key := normalizeSeriesName(heading)
	if key == "" {
		return nil
	}
	e := d.byNameAll[key]
	if e == nil || e.cik == cik {
		return nil
	}
	if len(period) == 8 && len(e.decl.DeclDate) == 8 && e.decl.DeclDate > period {
		return nil
	}
	if d.abandonedByPeriod(e, key, period) {
		return nil
	}
	if d.ownBrandInfix(cik, key, registrantKey) {
		return nil
	}
	return e.decl
}

// abandonedByPeriod reports whether the matched decl's name had been superseded
// by the filing's period: the SAME series id, under the SAME registrant, carries
// another dictionary row declared strictly after the matched one and strictly
// before period, under a different normalised name. A missing or malformed date
// on either side is read as contemporaneous, the way the guard above reads it.
// A superseding row declared AT the period itself does not count: the rename and
// this filing coincide, so its body cannot yet be expected to print the new name.
func (d *cikSeries) abandonedByPeriod(e *corpusName, key, period string) bool {
	if e == nil || e.decl == nil || len(period) != 8 || len(e.decl.DeclDate) != 8 {
		return false
	}
	for _, x := range d.byCIK[e.cik] {
		if x.SeriesID != e.decl.SeriesID || len(x.DeclDate) != 8 {
			continue
		}
		if x.DeclDate <= e.decl.DeclDate || x.DeclDate >= period {
			continue
		}
		if normalizeSeriesName(x.Name) != key {
			return true
		}
	}
	return false
}

// typeWordRenamed reports whether ONE series id of this registrant is declared,
// across the corpus dictionary's vintages, under both of these trailing type
// words. That is the registrant's own proof that the two words spell one tier
// rather than two: Wilshire Mutual Funds declares S000001049 `DOW JONES
// WILSHIRE 5000 INDEX PORTFOLIO` in 2006 and `WILSHIRE 5000 INDEX FUND` from
// 2009 on, so a `... Fund` heading there is a rename of a declared
// `... Portfolio`, not a sibling tier. One id carrying both is required: a
// registrant that merely declares some Funds and some Portfolios says nothing,
// which is exactly the two-tier trust the tier guard exists for.
func (d *cikSeries) typeWordRenamed(cik, a, b string) bool {
	if d == nil || cik == "" || a == "" || b == "" || a == b {
		return false
	}
	seen := map[string]string{}
	for _, x := range d.byCIK[cik] {
		if x.SeriesID == "" || x.Name == "" {
			continue
		}
		f := strings.Fields(normalizeSeriesName(x.Name))
		if len(f) < 2 {
			continue
		}
		tw := f[len(f)-1]
		if tw != a && tw != b {
			continue
		}
		if prev, ok := seen[x.SeriesID]; ok && prev != tw {
			return true
		}
		seen[x.SeriesID] = tw
	}
	return false
}

// ownBrandInfix reports whether a dictionary row of the FILER's own CIK, at any
// vintage, differs from the heading by exactly one inserted token that is a
// token of the registrant's own name. The comparison is issNearMissDecl's own
// one-token-edit test, read against the filer's dictionary rather than the
// filing index, which the chain above never consults for a filing that declared
// something in its header.
func (d *cikSeries) ownBrandInfix(cik, key, registrantKey string) bool {
	banner := strings.Fields(key)
	reg := strings.Fields(registrantKey)
	if len(banner) == 0 || len(reg) == 0 {
		return false
	}
	brand := make(map[string]bool, len(reg))
	for _, t := range reg {
		brand[t] = true
	}
	own := d.byCIK[cik]
	for i := range own {
		x := &own[i]
		if x.SeriesID == "" || x.Name == "" {
			continue
		}
		nt := strings.Fields(normalizeSeriesName(x.Name))
		if len(nt) != len(banner)+1 {
			continue
		}
		for j := range nt {
			if !brand[nt[j]] {
				continue
			}
			cut := append(append([]string{}, nt[:j]...), nt[j+1:]...)
			if issOneTokenEdit(cut, banner) {
				return true
			}
		}
	}
	return false
}

// metaPeriod is the filing's period of report, falling back to the report's own
// period end the way cikSeries.back does.
func metaPeriod(meta FilingMeta) string {
	if meta.PeriodOfReport != "" {
		return meta.PeriodOfReport
	}
	return meta.ReportPeriodEnd
}

// back supplies dictionary decls to a filing whose header declares none.
func (d *cikSeries) back(meta *FilingMeta) {
	if d == nil || len(meta.SeriesDecls) > 0 {
		return
	}
	if decls := d.poolFor(meta.CIK, metaPeriod(*meta)); len(decls) > 0 {
		meta.SeriesDecls = decls
	}
}

// poolFor is one registrant's dictionary decls, contemporaneous with period.
// Nil when the dictionary carries nothing for that CIK.
func (d *cikSeries) poolFor(cik, period string) []SeriesDecl {
	if d == nil {
		return nil
	}
	decls := d.byCIK[cik]
	if len(decls) == 0 {
		return nil
	}
	return dictContemporaneous(decls, period)
}

// registrantExactName is the ONE series this registrant's own dictionary spells
// EXACTLY as heading, contemporaneous with period. Nil when the dictionary
// names none, or when two answer -- the same refusal seriesByName makes
// everywhere else. It reads only rows of this CIK, so it is the registrant's own
// evidence about its own sleeve, merely at a vintage other than the header the
// filing happens to carry.
func (d *cikSeries) registrantExactName(cik, heading, period string) *SeriesDecl {
	pool := d.poolFor(cik, period)
	if len(pool) == 0 {
		return nil
	}
	x, _ := lookupSeriesEntry(seriesByName(pool), heading)
	return x
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
	// byUndotted keys the dictionary names carrying a dotted initialism under
	// its undotted spelling, for a heading that prints the same initialism
	// without its periods. Consulted only after byName has failed.
	byUndotted map[string]*SeriesDecl
	// byOrdinal keys the dictionary names carrying an ordinal under its
	// spelled-out spelling, for a heading that prints the same ordinal
	// abbreviated. Consulted only after byName has failed.
	byOrdinal map[string]*SeriesDecl
	// brandPrefixes are the registrant-brand prefixes the DICTIONARY spells and
	// a heading may drop, normalised. Two sources, both the registrant's own
	// evidence: the leading token run every dictionary name of this CIK shares
	// (`MCBT`, Martin Currie Business Trust), and the leading token run of the
	// filing's own COMPANY CONFORMED NAME that a dictionary name begins with
	// (`Mirae Asset`, of `Mirae Asset Discovery Funds`).
	brandPrefixes []string
	// corpus and cik back the last rung, which reads the dictionary of every
	// OTHER registrant: see cikSeries.crossCIK.
	corpus *cikSeries
	cik    string
	// period is the filing's PERIOD OF REPORT, which the cross-CIK rung needs to
	// refuse a declaration made after it.
	period string
	// registrantKey is the filing's COMPANY CONFORMED NAME, normalised, which
	// the cross-CIK rung needs to tell a registrant-brand infix from any other
	// inserted word.
	registrantKey string
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
	// Two dictionary rows of this CIK can spell ONE name for two ids at two
	// vintages -- the collision poolFor already resolves by period. Filter the
	// same way here, before any rung keys off extra, so byName/byUndotted/
	// byOrdinal/brandPrefixes all read the disambiguated pool rather than a list
	// seriesByName would refuse wholesale.
	extra = dictContemporaneous(extra, metaPeriod(meta))
	if len(extra) == 0 {
		// The registrant-scoped rungs have nothing to read, but the cross-CIK
		// rung reads no row of this registrant at all and still applies.
		return &dictFallback{byName: map[string]*SeriesDecl{}, corpus: d, cik: meta.CIK, period: metaPeriod(meta), registrantKey: normalizeSeriesName(meta.CompanyName)}
	}
	f := &dictFallback{byName: seriesByName(extra), byUndotted: map[string]*SeriesDecl{}, byOrdinal: seriesByOrdinal(extra), corpus: d, cik: meta.CIK, period: metaPeriod(meta), registrantKey: normalizeSeriesName(meta.CompanyName)}
	// The dictionary spells an initialism with its periods where the heading
	// spells it without: `Vesper U.S. Large Cap Short-Term Reversal Strategy ETF`
	// (S000063053) for a banner `Vesper US ...`. Only the names whose two
	// spellings differ are keyed, and a key two distinct series answer to is
	// recorded nil and refuses, the way seriesByName refuses it.
	for i := range extra {
		d := &extra[i]
		k := normalizeUndottedSeriesName(d.Name)
		if d.SeriesID == "" || k == "" {
			continue
		}
		if prev, seen := f.byUndotted[k]; seen && (prev == nil || prev.SeriesID != d.SeriesID) {
			f.byUndotted[k] = nil
			continue
		}
		f.byUndotted[k] = d
	}
	f.brandPrefixes = dictBrandPrefixes(extra, normalizeSeriesName(meta.CompanyName))
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
	// The dictionary's dotted initialism against the heading's undotted one.
	if r.SeriesID == "" {
		if d := f.byUndotted[normalizeSeriesName(r.FundName)]; d != nil {
			r.SeriesID = d.SeriesID
		}
	}
	// The dictionary's spelled-out ordinal against the heading's abbreviated
	// one, and the reverse -- both sides fold onto the word.
	if r.SeriesID == "" {
		if k := normalizeOrdinalSeriesName(r.FundName); k != "" {
			if d := f.byOrdinal[k]; d != nil {
				r.SeriesID = d.SeriesID
			}
		}
	}
	// One word the HEADING inserts that the dictionary name does not carry:
	// `ROBO Global Healthcare Technology and Innovation Index ETF` for a
	// dictionary `ROBO Global(R) Healthcare Technology and Innovation ETF`
	// (S000065730, 909 rows), where the sibling banners resolve on the (R) fold
	// alone. Exactly one internal token comes off -- the first carries the brand
	// and the last the type word, so neither is ever cut -- the remainder must be
	// a dictionary name EXACTLY, and two drops naming two different series refuse.
	if r.SeriesID == "" {
		if d := dictInternalTokenDrop(f.byName, r.FundName); d != nil {
			r.SeriesID = d.SeriesID
		}
	}
	// The heading drops the registrant brand the DICTIONARY name keeps:
	// `Emerging Markets Great Consumer VIT Fund` for `Mirae Asset Emerging
	// Markets Great Consumer VIT Fund` (S000065276, 374 rows), `Opportunistic
	// EAFE Fund` for `MCBT Opportunistic EAFE Fund` (S000009976). The strip
	// rules read the opposite direction only. The prefix is prepended and the
	// result must be a dictionary name EXACTLY; two prefixes naming two series
	// refuse, the way every other rung here refuses.
	if r.SeriesID == "" {
		if d := f.brandPrefixed(r.FundName); d != nil {
			r.SeriesID = d.SeriesID
		}
	}
	// The heading prints the registrant's OWN ACRONYM where the dictionary name
	// prints the brand that acronym stands for: `TFGT Small Cap Fund` for a
	// dictionary `Touchstone Small Cap Fund` (S000026601, Touchstone Funds Group
	// Trust 20170630), whose sibling banners resolve on the header's own
	// declarations and this one only through the dictionary. Both edits are ones
	// this file already makes separately -- the acronym token comes off the
	// heading (issRegistrantAcronym, every token of the registrant's name spelled
	// in order, three letters at least) and a dictionary brand prefix goes back on
	// (brandPrefixed, which refuses two prefixes naming two series).
	if r.SeriesID == "" {
		if d := f.acronymForBrand(r.FundName); d != nil {
			r.SeriesID = d.SeriesID
		}
	}
	// The same edit, but the acronym stands for the registrant's BRAND alone --
	// the leading words of its name before the generic entity-type words it
	// closes on: `AI Hillcrest Small Cap Value Fund` for a dictionary `American
	// Independence Hillcrest Small Cap Value Fund` (S000052272, American
	// Independence Funds Trust 20160630), the one banner of that filing whose
	// series its header does not declare. The abbreviation is the registrant's
	// own: this same CIK's dictionary rows print it themselves at the next
	// vintage (`AI International Fund`, `AI Large Cap Growth Fund`).
	if r.SeriesID == "" {
		if d := f.brandAcronymForBrand(r.FundName); d != nil {
			r.SeriesID = d.SeriesID
		}
	}
	// The mirror of the rung above: the HEADING carries a leading brand token
	// the dictionary name of an earlier vintage does not: `AMG Aston/Cornerstone
	// Large Cap Value Fund` for `ASTON/CORNERSTONE LARGE CAP VALUE FUND`
	// (S000001119, AMG Funds IV 2017, six banners of one filing rebranded from
	// `Aston Funds`). brandPrefixed prepends a prefix the DICTIONARY keeps, and
	// dictInternalTokenDrop cuts indices 1..len-2 only, so nothing reaches a
	// dropped FIRST token. Exactly one token comes off, the remainder must be
	// this registrant's own dictionary name EXACTLY, and a name two series
	// answer to refuses -- `AMG Managers LMCG Emerging Markets Fund` leaves
	// `Managers LMCG Emerging Markets Fund`, which is no dictionary name of this
	// CIK, and stays refused.
	if r.SeriesID == "" {
		if d := f.headingLeadingTokenDrop(r.FundName); d != nil {
			r.SeriesID = d.SeriesID
		}
	}
	// Last of all: the heading names a fund of a SIBLING registrant, exactly
	// and uniquely corpus-wide. Consulted whether the rungs above refused or
	// answered INEXACTLY -- the exact rung returns early above, so every id
	// still live here came from a cut of the printed name, and an exact,
	// corpus-unique, contemporaneous sibling outranks it.
	// A fund name read off the row's own account-name cell is not a masthead and
	// carries no claim that this filing reports for another registrant, so the
	// sibling rung is not licensed on it: see htmlFundCellSeries, which withholds
	// it on the layout's own route for the same reason.
	if !r.FundFromAccountCell {
		if d := f.corpus.crossCIK(f.cik, r.FundName, f.period, f.registrantKey); d != nil {
			r.SeriesID = d.SeriesID
		}
	}
}

// acronymForBrand answers a heading whose FIRST token is the registrant's own
// acronym standing in for the brand the dictionary name spells out. Exactly one
// token comes off, it must spell the registrant's every token in order, at least
// two tokens must remain, and the remainder plus a dictionary brand prefix must
// be a dictionary name of this registrant EXACTLY -- brandPrefixed refuses an
// ambiguous one the way every other rung here refuses.
func (f *dictFallback) acronymForBrand(heading string) *SeriesDecl {
	toks := strings.Fields(normalizeSeriesName(heading))
	if len(toks) < 3 || !issRegistrantAcronym(toks[0], f.registrantKey) {
		return nil
	}
	rest := strings.Join(toks[1:], " ")
	if d := f.brandPrefixed(rest); d != nil {
		return d
	}
	return f.brandPrefixedTypeWord(rest)
}

// brandPrefixedTypeWord is acronymForBrand's second reach, for a heading that
// stops at the fund's stem and prints NO type word at all where the dictionary
// name closes on one: `TFGT Small Cap` for a dictionary `TOUCHSTONE SMALL CAP
// FUND` (S000005843, Touchstone Funds Group Trust 20070630). The acronym has
// already come off and brandPrefixed has already failed its exact match on the
// bare remainder, so the only edit left is the one the heading itself made --
// a single trailing entity word dropped.
//
// The word put back is not from a general vocabulary: it must be a word THIS
// registrant's own contemporaneous dictionary names actually close on, and the
// remainder must not already end on one (a heading that prints its own type
// word is the exact case brandPrefixed owns). Ambiguity refuses the way every
// other rung here refuses, and refuses harder: two candidate words that both
// match refuse even when they name the same series, since which word the
// heading dropped would then be a guess. Vintage is not this rung's problem --
// f.byName reads the pool dictContemporaneous already disambiguated, so a name
// two series declared years apart answers with the one nearest this filing's
// period before this rung ever sees it.
func (f *dictFallback) brandPrefixedTypeWord(remainder string) *SeriesDecl {
	key := normalizeSeriesName(remainder)
	toks := strings.Fields(key)
	if len(toks) < 2 || issEntityTypeWord(toks[len(toks)-1]) {
		return nil
	}
	var hit *SeriesDecl
	for _, w := range f.dictTypeWords() {
		d := f.brandPrefixed(key + " " + w)
		if d == nil {
			continue
		}
		if hit != nil {
			return nil
		}
		hit = d
	}
	return hit
}

// dictTypeWords are the entity words this registrant's own contemporaneous
// dictionary names close on, sorted so the scan is deterministic.
func (f *dictFallback) dictTypeWords() []string {
	seen := map[string]bool{}
	var out []string
	for name := range f.byName {
		toks := strings.Fields(name)
		if len(toks) == 0 {
			continue
		}
		w := toks[len(toks)-1]
		if !issEntityTypeWord(w) || seen[w] {
			continue
		}
		seen[w] = true
		out = append(out, w)
	}
	sort.Strings(out)
	return out
}

// brandAcronymForBrand answers a heading whose FIRST token is an acronym of the
// registrant's BRAND -- the leading tokens of its name before the generic
// entity-type words it closes on -- standing in for the brand the dictionary
// name spells out.
//
// acronymForBrand cannot read this shape twice over. issRegistrantAcronym
// demands a letter for EVERY token of the registrant's name, so `american
// independence funds trust` demands `aift` and the printed `ai` is refused; and
// brandPrefixed could not put the brand back anyway, because the prefix this
// dictionary yields carries the entity word too (`american independence funds`),
// which is no prefix of any name of this CIK. So the brand comes off the
// registrant's OWN name with its trailing entity words cut -- at least two
// tokens must remain, at least one must have been cut, which is what keeps this
// rung disjoint from the whole-name one above -- and the acronym must spell
// every one of those tokens in order. The restored name must then be a
// dictionary name of this registrant EXACTLY; a name two series answer to is
// recorded nil by seriesByName and refuses here the way every other rung
// refuses.
func (f *dictFallback) brandAcronymForBrand(heading string) *SeriesDecl {
	all := strings.Fields(f.registrantKey)
	reg := all
	for len(reg) > 0 && issEntityTypeWord(reg[len(reg)-1]) {
		reg = reg[:len(reg)-1]
	}
	if len(reg) < 2 || len(reg) == len(all) {
		return nil
	}
	toks := strings.Fields(normalizeSeriesName(heading))
	if len(toks) < 3 || len(toks[0]) != len(reg) {
		return nil
	}
	for i := range reg {
		if reg[i] == "" || reg[i][0] != toks[0][i] {
			return nil
		}
	}
	return f.byName[strings.Join(reg, " ")+" "+strings.Join(toks[1:], " ")]
}

func (f *dictFallback) brandPrefixed(heading string) *SeriesDecl {
	key := normalizeSeriesName(heading)
	if key == "" {
		return nil
	}
	var hit *SeriesDecl
	for _, pre := range f.brandPrefixes {
		if pre == "" || strings.HasPrefix(key, pre+" ") {
			continue
		}
		d := f.byName[pre+" "+key]
		if d == nil {
			continue
		}
		if hit != nil && hit.SeriesID != d.SeriesID {
			return nil
		}
		hit = d
	}
	return hit
}

// headingLeadingTokenDrop drops ONE leading token from the printed heading and
// answers only when the remainder is a dictionary name of this same registrant,
// EXACTLY. One drop, never two: the token that comes off is the brand the
// registrant took at a rebrand, and a second drop would start eating the name
// itself. The remainder must keep at least two tokens, and an ambiguous key is
// recorded nil by seriesByName and refuses here the way every other rung
// refuses.
//
// The exact remainder is NOT on its own evidence that the first token is a
// brand: `Growth Emerging Markets Portfolio` leaves a dictionary `Emerging
// Markets Portfolio` (SunAmerica Series Trust), and `Growth` is a word of the
// name. So the dropped token must be the registrant's own -- the opening token
// of the filing's COMPANY CONFORMED NAME, `AMG` of `AMG Funds IV` -- which is
// the same registrant-supplied evidence dictBrandPrefixes reads in the opposite
// direction.
func (f *dictFallback) headingLeadingTokenDrop(heading string) *SeriesDecl {
	reg := strings.Fields(f.registrantKey)
	if len(reg) == 0 {
		return nil
	}
	toks := strings.Fields(normalizeSeriesName(heading))
	if len(toks) < 3 || toks[0] != reg[0] {
		return nil
	}
	return f.byName[strings.Join(toks[1:], " ")]
}

// dictBrandPrefixes collects the registrant-brand prefixes a heading may have
// dropped. Each is evidence the registrant itself supplies: a leading token run
// EVERY dictionary name carries, or the filing's own registrant name as far as a
// dictionary name spells it. A prefix that is a whole dictionary name on its own
// is not collected -- prepending it could only build a longer name out of one
// that already answers.
func dictBrandPrefixes(decls []SeriesDecl, registrantKey string) []string {
	var out []string
	shared := []string(nil)
	for i := range decls {
		toks := strings.Fields(normalizeSeriesName(decls[i].Name))
		if len(toks) < 2 {
			return nil
		}
		if shared == nil {
			shared = toks[:len(toks)-1]
			continue
		}
		n := 0
		for n < len(shared) && n < len(toks)-1 && shared[n] == toks[n] {
			n++
		}
		shared = shared[:n]
	}
	if len(shared) > 0 {
		out = append(out, strings.Join(shared, " "))
	}
	reg := strings.Fields(registrantKey)
	for n := len(reg) - 1; n >= 1; n-- {
		pre := strings.Join(reg[:n], " ")
		for i := range decls {
			if strings.HasPrefix(normalizeSeriesName(decls[i].Name), pre+" ") {
				return append(out, pre)
			}
		}
	}
	return out
}

func dictInternalTokenDrop(idx map[string]*SeriesDecl, heading string) *SeriesDecl {
	toks := strings.Fields(normalizeSeriesName(heading))
	if len(toks) < 4 {
		return nil
	}
	var out *SeriesDecl
	for i := 1; i < len(toks)-1; i++ {
		alt := append(append([]string{}, toks[:i]...), toks[i+1:]...)
		d := idx[strings.Join(alt, " ")]
		if d == nil {
			continue
		}
		if out != nil && out.SeriesID != d.SeriesID {
			return nil
		}
		out = d
	}
	return out
}
