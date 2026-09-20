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
	// byNameAll keys every dictionary name in the corpus, normalised, onto its
	// single answer, and onto nil the moment two series or two registrants
	// answer to it. It is the last rung's whole guard: see crossCIK.
	byNameAll map[string]*corpusName
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
	for cik, decls := range d.byCIK {
		for i := range decls {
			x := &decls[i]
			key := normalizeSeriesName(x.Name)
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
func (d *cikSeries) crossCIK(cik, heading, period string) *SeriesDecl {
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
	return e.decl
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
	// byUndotted keys the dictionary names carrying a dotted initialism under
	// its undotted spelling, for a heading that prints the same initialism
	// without its periods. Consulted only after byName has failed.
	byUndotted map[string]*SeriesDecl
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
		// The registrant-scoped rungs have nothing to read, but the cross-CIK
		// rung reads no row of this registrant at all and still applies.
		return &dictFallback{byName: map[string]*SeriesDecl{}, corpus: d, cik: meta.CIK, period: metaPeriod(meta)}
	}
	f := &dictFallback{byName: seriesByName(extra), byUndotted: map[string]*SeriesDecl{}, corpus: d, cik: meta.CIK, period: metaPeriod(meta)}
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
	// Last of all, and only after every registrant-scoped rung above has
	// refused: the heading names a fund of a SIBLING registrant, exactly and
	// uniquely corpus-wide.
	if r.SeriesID == "" {
		if d := f.corpus.crossCIK(f.cik, r.FundName, f.period); d != nil {
			r.SeriesID = d.SeriesID
		}
	}
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
