package main

import (
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// The screen runs once over a filing's extracted rows, after both parsers, and
// removes rows whose LAYOUT says the cells were read from the wrong columns or
// that the "holder" is not a holder at all. It is deliberately a separate pass:
// several of the rules need the whole table (its median implied total, whether a
// percent repeats down the column), which no per-row extractor can see.
//
// A group row is never dropped. group_row_detection_rate is a gated metric and a
// collective label is exactly the text several of these patterns would match.

var (
	// A market index or peer-group label down the stub of a stock-performance
	// graph. The graph's indexed values start at 100 and read as percents.
	reScreenIndex = regexp.MustCompile(`(?i)(?:^|\b)(?:s\s*&\s*p|standard\s*&\s*poor|russell\s*\d|dow\s+jones|dj\s+[a-z]|nasdaq|nyse\s+(?:index|market|composite)|amex\s+index|wilshire|value\s+line|peer\s+group|peer\s+index)\b|\b(?:index|indices)$`)
	// A bare period label: the same graph's month, quarter or year stub.
	reScreenDate = regexp.MustCompile(`(?i)^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s\-/,]*(?:\d{1,4})?$|^(?:19|20)\d\d$|^(?:1[0-2]|[1-9])/(?:19|20)?\d\d$|^fy\s*\d+$|^(?:q[1-4]|[1-4]q)[\s\-/]*\d{2,4}$`)
	// Prose or a column header that reached the name column: a lead-in
	// sentence's tail, or the "Sole Voting Power" style sub-heading.
	reScreenProse = regexp.MustCompile(`(?i)\b(?:known\s+to\s+the\s+(?:company|registrant)|beneficial\s+owner(?:s)?\s+of\s+more\s+than|as\s+(?:investment\s+)?advis[eo]r|sole\s+(?:voting|dispositive)|shared\s+(?:voting|dispositive)|dispositive\s+power|voting\s+power)\b`)
	// A foreign address line: a Canadian/UK postal code, or a country tail.
	reScreenForeign      = regexp.MustCompile(`(?i)\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b|\b(?:canada|england|scotland|united\s+kingdom|switzerland|netherlands|germany|japan|france|australia|bermuda|cayman\s+islands)\s*$`)
	reScreenPersonalName = regexp.MustCompile(`^[A-Z][a-z]+(?:\s+[A-Z]\.)+\s+[A-Z][a-z]+$`)
	reScreenESOP         = regexp.MustCompile(`(?i)\besop\b`)
	// A share class that is not the common stock blockw records. "Class A" is
	// left out on purpose: it is routinely the only common class there is.
	// "Series" followed by a DESIGNATOR -- Series A, Series 1, Series AA -- is a
	// share class. Followed by a word it is part of a holder's name: a variable
	// annuity's 5% record holders are "<Fund> Series Account", separate accounts
	// that really do hold the shares, and reading them as a class dropped every
	// row of the filing.
	reScreenNonCommon = regexp.MustCompile(`(?i)\bpreferred\b|\bseries\s+[a-z0-9]{1,3}\b|\bclass\s+[b-z]\b|\besop\b|\bjunior\b|\bconvertible\b|\bdepositary\b|\bdebenture|\bwarrant|\boption\b`)
)

// screenTable is the per-table context the row rules need.
type screenTable struct {
	// fracShares counts rows whose share count has a fractional part. A MUTUAL
	// FUND's share register is fractional throughout, so two or more such rows
	// make the fraction the table's convention rather than a mis-read column.
	fracShares int
	isGraph    bool // a stock-performance graph, not an ownership table
	// prose marks a pseudo-table assembled by the PROSE reader: one row per
	// sentence, each stating its own fund and its own outstanding total. The
	// rules that compare one row's value against the rest of the COLUMN --
	// implied outstanding total, a percent repeated down the column -- have no
	// column to read here and only ever delete real holders.
	prose       bool
	medianTotal float64 // median shares/(pct/100) over the table's own rows
	haveMedian  bool    //
	// Per CLASS medians. A multi-class or per-fund table has one outstanding
	// total per class, tens of times apart, so a single table-wide median
	// throws away every class but the largest.
	medianByClass        map[string]float64
	registeredPctRepeats map[string]map[float64]int
	pctRepeats           map[float64]int // how many distinct non-group rows carry each percent
}

// ScreenRows returns the rows of one filing that survive the layout screen, in
// their original order. The input slice is not modified.
func ScreenRows(rows []Row) []Row {
	tabs := screenTables(rows)
	out := make([]Row, 0, len(rows))
	for _, r := range rows {
		if !screenDrop(r, tabs[r.TableIndex]) {
			out = append(out, r)
		}
	}
	out = screenNames(out)
	// A class label recovered from a column header reaches share_class only
	// here, after every drop rule: the screens read ShareClass, so populating
	// the grain key must not be able to change which rows survive.
	for i := range out {
		if out[i].classHint == "" {
			continue
		}
		// The hint COMPOSES with the class the extractor already named: a fund
		// family states the fund in a heading and the class in the column
		// header, and "Class A" alone is one key for every fund in the
		// document. Runs after every drop rule, so populating the grain key
		// still cannot change which rows survive.
		if out[i].ShareClass == "" {
			out[i].ShareClass = out[i].classHint
		} else if !strings.Contains(out[i].ShareClass, out[i].classHint) {
			out[i].ShareClass = withSeries(out[i].classHint, out[i].ShareClass)
		}
	}
	return out
}

var (
	// The name cell absorbed a complete amount/percent column pair. A table that
	// carries several issuers or classes side by side repeats that pair, and the
	// FIRST one -- the one inside the name cell -- is the registrant's own class;
	// whatever percent the row reported came from a column further right.
	reScreenPair = regexp.MustCompile(`^(.*?)[\s,]+(\d[\d,]{2,})\s+(\.?\d{1,3}(?:\.\d+)?)\s*%?$`)
	// A number at the head of the name cell: the cell was empty and the share
	// count slid into it, or the cell holds a street address.
	reScreenLeadNum = regexp.MustCompile(`^\(?\$?\d[\d,]{2,}`)
	// A cell that is nothing but a postal address: a numbered street line, a
	// city/state/ZIP line, or the state and ZIP alone at the foot of the stub.
	screenState = `Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|` +
		`Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|` +
		`Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New\s+Hampshire|New\s+Jersey|New\s+Mexico|` +
		`New\s+York|North\s+Carolina|North\s+Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode\s+Island|` +
		`South\s+Carolina|South\s+Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West\s+Virginia|` +
		`Wisconsin|Wyoming|D\.?C\.?|A[LKZR]|C[AOT]|DE|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|` +
		`O[HKR]|P[AR]|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY]`
	screenStreet = `street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|place|pl|plaza|way|parkway|` +
		`pkwy|highway|hwy|circle|court|ct|square|sq|building|bldg|tower|center|centre|floor|fl|broadway|park|` +
		`row|terrace|walk|wharf|americas`
	reScreenStreetFull = regexp.MustCompile(`(?i)^\(?(?:\d{1,6}[a-z]?|one|two|three|four|five|six|seven|eight|` +
		`nine|ten)\s+[\w.,'&\-/ ]*?\b(?:` + screenStreet + `)\b\.?,?(?:\s.*)?$`)
	reScreenCityStZip = regexp.MustCompile(`^\(?[A-Z][A-Za-z.\-' ]{0,40},?\s+(?:` + screenState + `)[,.]?\s*\d{5}(?:-\d{4})?\s*$`)
	reScreenStateZip  = regexp.MustCompile(`^\(?(?:` + screenState + `)[,.]?\s+\d{5}(?:-\d{4})?\s*$`)
	// The lead-in sentence's tail, or a parenthetical, in the name column.
	reScreenProseTail = regexp.MustCompile(`(?i)\b(?:are\s+the\s+holders|of\s+which|exchange\s+act|` +
		`approximately|respectively|may\s+be\s+deemed|and\s+related\s+persons)\b|^includes?\b`)
	// An initialism ("U.S. Trust", "A.G. Edwards") identifies a holder even when
	// every spelled-out word in the name is a corporate form.
	reScreenInitialism = regexp.MustCompile(`\b(?:[A-Za-z]\.){2,}`)
	reScreenWord       = regexp.MustCompile(`[A-Za-z]{2,}`)
	// The words a wrapped name cell's tail is made of.
	screenFormWords = map[string]bool{
		"JR": true, "SR": true, "II": true, "III": true, "IV": true, "MD": true, "PHD": true,
		"ESQ": true, "CPA": true, "INC": true, "INCORPORATED": true, "CORP": true, "CORPORATION": true,
		"CO": true, "COMPANY": true, "COMPANIES": true, "LTD": true, "LIMITED": true, "LP": true,
		"LLP": true, "LLC": true, "PLC": true, "NA": true, "TRUST": true, "TRUSTS": true, "THE": true,
		"AND": true, "ET": true, "AL": true, "GROUP": true, "HOLDINGS": true, "HOLDING": true,
		"PARTNERS": true, "PARTNERSHIP": true, "ASSOCIATES": true, "MANAGEMENT": true,
	}
	// An institution can be one word ("AMVESCAP", "Pensioenfonds"); a natural
	// person cannot be one bare surname with no initial and no punctuation.
	reScreenInstWord = regexp.MustCompile(`(?i)\b(?:inc|corp|corporation|co|company|companies|ltd|lp|llp|llc|` +
		`plc|trust|bank|group|fund|funds|partners|partnership|associates|management|capital|advisors|advisers|` +
		`holdings?|plan|association|foundation|systems?|international|board)\b`)
)

// screenNames runs the row rules that read only the name cell and the percent,
// after the table rules above: it repairs a name cell that absorbed the numeric
// columns, drops a cell that names no holder, and emits one row per holding.
// Group rows are never touched.
func screenNames(rows []Row) []Row {
	out := make([]Row, 0, len(rows))
	seen := map[string]bool{}
	for _, r := range rows {
		if r.IsGroupRow {
			out = append(out, r)
			continue
		}
		if !r.fundRegistration {
			screenRepairPair(&r)
		}
		if screenNoHolderWithNumberedHolder(strings.TrimSpace(r.HolderName), r.numberedHolder, r.fundRegistration) {
			if screenDropReasons != nil {
				screenDropReasons["no_holder"]++
			}
			continue
		}
		// A registrant that files a DEF 14A has public voting shareholders, so a
		// single non-group holder of exactly 100.00% of a class is never the
		// common stock the proxy solicits: it is another class, or a total.
		if r.Percent != nil && *r.Percent == 100.0 {
			if screenDropReasons != nil {
				screenDropReasons["pct_100"]++
			}
			continue
		}
		// One holder, one row per filing. The 5% table and the D&O table
		// routinely disclose the same holding, and both reach the output.
		if r.Percent != nil {
			sig := screenFold(r.HolderName) + "|" + strconv.FormatFloat(*r.Percent, 'f', -1, 64)
			if r.commonColumn || r.fundRegistration {
				// Explicit class columns and registered fund accounts are distinct holdings when
				// their percents coincide. Keep exact copies suppressed.
				sig += "|" + screenClassKey(r)
				if r.Shares != nil {
					sig += "|" + strconv.FormatFloat(*r.Shares, 'f', -1, 64)
				}
			}
			if r.styledTabs {
				sig += "|" + r.TableKind
			}
			if seen[sig] {
				if screenDropReasons != nil {
					screenDropReasons["same_holder_pct"]++
				}
				continue
			}
			seen[sig] = true
		}
		// The cell names the holder AND says who he is; only the name is the
		// holder. Runs last so every drop rule above still sees the raw cell.
		if r.fundRegistration {
			// Plan and trust identifiers are account identity, not name footnotes.
			r.HolderName = strings.Trim(stripLeadingHonorific(r.HolderName), nameTrimCut+" ")
		} else {
			r.HolderName = cleanHolderName(r.HolderName)
		}
		out = append(out, r)
	}
	return out
}

// screenRepairPair moves an absorbed amount/percent pair out of the name cell
// and onto the row, where the extractor should have put it.
func screenRepairPair(r *Row) {
	m := reScreenPair.FindStringSubmatch(strings.TrimSpace(r.HolderName))
	if m == nil {
		return
	}
	head := strings.TrimSpace(m[1])
	if len(reScreenWord.FindAllString(head, -1)) == 0 {
		return
	}
	pct, err := strconv.ParseFloat(m[3], 64)
	if err != nil || pct > 100 {
		return
	}
	shares, err := strconv.ParseFloat(strings.ReplaceAll(m[2], ",", ""), 64)
	if err != nil {
		return
	}
	r.HolderName, r.Percent, r.Shares = head, &pct, &shares
}

// screenNoHolder reports whether a name cell names no holder at all.
func screenNoHolder(name string) bool {
	return screenNoHolderWithNumberedHolder(name, false, false)
}

// wholeCell marks a name the parser assembled from every line of its cell,
// so a single word in it is not the tail of a wrapped name.
func screenNoHolderWithNumberedHolder(name string, numberedHolder, wholeCell bool) bool {
	switch {
	case reScreenLeadNum.MatchString(name) && !numberedHolder:
		return true
	case reScreenStreetFull.MatchString(name), reScreenCityStZip.MatchString(name),
		reScreenStateZip.MatchString(name):
		return true
	case reScreenProseTail.MatchString(name):
		return true
	}
	// Nothing but corporate-form words: the tail of a wrapped name cell.
	if !reScreenInitialism.MatchString(name) {
		words := reScreenWord.FindAllString(strings.ToUpper(name), -1)
		if len(words) > 0 {
			all := true
			for _, w := range words {
				if !screenFormWords[w] {
					all = false
					break
				}
			}
			if all {
				return true
			}
		}
	}
	// A lone bare surname: the tail of a wrapped name column.
	if !wholeCell && !strings.ContainsAny(name, "0123456789.&/") {
		if w := reScreenWord.FindAllString(name, -1); len(w) == 1 && w[0] == name &&
			!reScreenInstWord.MatchString(name) {
			return true
		}
	}
	return false
}

// screenFold folds a holder name to its letters and digits, so the same holder
// written with different punctuation in two tables collapses to one row.
func screenFold(s string) string {
	var b strings.Builder
	for _, c := range strings.ToUpper(s) {
		if (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			b.WriteRune(c)
		}
	}
	return b.String()
}

func screenTables(rows []Row) map[int]*screenTable {
	tabs := map[int]*screenTable{}
	implied := map[int][]float64{}
	impliedCls := map[int]map[string][]float64{}
	explicitClasses := map[int]map[string]bool{}
	dateRows := map[int]int{}
	indexRows := map[int]int{}
	pctHolders := map[int]map[float64]map[string]bool{}
	for _, r := range rows {
		t := tabs[r.TableIndex]
		if t == nil {
			t = &screenTable{pctRepeats: map[float64]int{}}
			tabs[r.TableIndex] = t
		}
		name := strings.TrimSpace(r.HolderName)
		if !r.IsGroupRow {
			if reScreenIndex.MatchString(name) {
				indexRows[r.TableIndex]++
			}
			if reScreenDate.MatchString(name) {
				dateRows[r.TableIndex]++
			}
			if r.Percent != nil && *r.Percent >= 5.0 && !r.colspanRecovery && !r.fundRegistration {
				t.pctRepeats[*r.Percent]++
			}
			if r.Percent != nil && *r.Percent >= 5.0 && r.colspanRecovery {
				if pctHolders[r.TableIndex] == nil {
					pctHolders[r.TableIndex] = map[float64]map[string]bool{}
				}
				if pctHolders[r.TableIndex][*r.Percent] == nil {
					pctHolders[r.TableIndex][*r.Percent] = map[string]bool{}
				}
				holders := pctHolders[r.TableIndex][*r.Percent]
				holders[screenFold(name)] = true
				t.pctRepeats[*r.Percent] = len(holders)
			}
		}
		if r.fundRegistration && r.Percent != nil && *r.Percent >= 5.0 {
			if t.registeredPctRepeats == nil {
				t.registeredPctRepeats = map[string]map[float64]int{}
			}
			cls := screenClassKey(r)
			if t.registeredPctRepeats[cls] == nil {
				t.registeredPctRepeats[cls] = map[float64]int{}
			}
			t.registeredPctRepeats[cls][*r.Percent]++
		}
		if r.Parser == "text_prose" {
			t.prose = true
		}
		if r.Shares != nil && *r.Shares != math.Trunc(*r.Shares) {
			t.fracShares++
		}
		if r.Shares != nil && *r.Shares > 0 && r.Percent != nil && *r.Percent >= 0.5 {
			v := *r.Shares / (*r.Percent / 100.0)
			implied[r.TableIndex] = append(implied[r.TableIndex], v)
			if k := screenClassKey(r); k != "" {
				if impliedCls[r.TableIndex] == nil {
					impliedCls[r.TableIndex] = map[string][]float64{}
				}
				impliedCls[r.TableIndex][k] = append(impliedCls[r.TableIndex][k], v)
				if r.ShareClass != "" {
					if explicitClasses[r.TableIndex] == nil {
						explicitClasses[r.TableIndex] = map[string]bool{}
					}
					explicitClasses[r.TableIndex][r.ShareClass] = true
				}
			}
		}
	}
	// Three period labels in one table is a graph stub, not a coincidence.
	for ti, n := range dateRows {
		if n >= 3 {
			tabs[ti].isGraph = true
		}
	}
	// TWO index names, not one. A performance graph plots the company against
	// an index and a peer index, so it always names at least two; a fund
	// complex's 5% RECORD HOLDER table legitimately holds ONE fund that tracks
	// an index ("Rydex Variable Trust - NASDAQ-100 2x Strategy Fund"), and
	// condemning the table for it drops every real holder in it.
	for ti, n := range indexRows {
		if n >= 2 {
			tabs[ti].isGraph = true
		}
	}
	for ti, v := range implied {
		if len(v) < 3 {
			continue
		}
		s := make([]float64, len(v))
		copy(s, v)
		sort.Float64s(s)
		tabs[ti].medianTotal, tabs[ti].haveMedian = s[len(s)/2], true
	}
	for ti, byCls := range impliedCls {
		if len(byCls) < 2 {
			continue // one class: the table-wide median is the same thing
		}
		// Explicit class columns identify distinct outstanding totals even
		// with one holder each. Post-screen hints retain their existing policy.
		if len(explicitClasses[ti]) >= 2 {
			tabs[ti].medianByClass = map[string]float64{}
		}
		for k, v := range byCls {
			if len(v) < 2 {
				continue
			}
			s := make([]float64, len(v))
			copy(s, v)
			sort.Float64s(s)
			if tabs[ti].medianByClass == nil {
				tabs[ti].medianByClass = map[string]float64{}
			}
			tabs[ti].medianByClass[k] = s[len(s)/2]
		}
	}
	return tabs
}

// screenClassKey is the class the row's holding is in, as the screen sees it:
// the recovered label counts, because the implied outstanding total is a
// property of the class whether or not ShareClass has been populated yet.
func screenClassKey(r Row) string {
	if r.ShareClass != "" {
		return r.ShareClass
	}
	return r.classHint
}

func screenDrop(r Row, t *screenTable) bool {
	why := screenDropWhy(r, t)
	if why != "" && screenDropReasons != nil {
		screenDropReasons[why]++
	}
	return why != ""
}

// screenDropReasons, when non-nil, tallies which screen rule dropped each row.
// Set by the -debug path only; nil in the pipeline.
var screenDropReasons map[string]int

func screenDropWhy(r Row, t *screenTable) string {
	if r.IsGroupRow {
		return ""
	}
	if t != nil && t.isGraph {
		return "is_graph"
	}
	name := strings.TrimSpace(r.HolderName)
	switch {
	case reScreenIndex.MatchString(name), reScreenDate.MatchString(name):
		return "index_or_date"
	case reScreenProse.MatchString(name):
		return "prose"
	case reScreenForeign.MatchString(name) && !(r.captionPerson && reScreenPersonalName.MatchString(name)):
		return "foreign"
	case reScreenNonCommon.MatchString(name) && !(r.commonColumn && strings.EqualFold(r.ShareClass, "Common Stock") && !reScreenNonCommon.MatchString(reScreenESOP.ReplaceAllString(name, ""))):
		return "non_common_name"
	case isNonCommonClass(r.ShareClass) && !((r.commonColumn || r.fundRegistration) && !reScreenOtherSecurity.MatchString(r.ShareClass)):
		return "non_common_class"
	}
	// A holder name never starts with a lower-case letter; a name that does is
	// the tail of a wrapped prose line.
	if name != "" && name[0] >= 'a' && name[0] <= 'z' {
		return "lowercase_name"
	}
	// A fractional share count means the name cell absorbed the shares column,
	// so whatever was read as the percent came from somewhere else.
	// A fractional share count usually means the name cell absorbed the shares
	// column, so whatever was read as the percent came from elsewhere. It means
	// nothing of the kind in a MUTUAL FUND's 5% record-holder table, where every
	// count is fractional by convention (Oakmark 2016: 55 correctly aligned rows,
	// each with its fund, its class and its percent, all discarded by this rule).
	// Two or more fractional rows in one table is the convention, not a mis-read.
	if r.Shares != nil && *r.Shares != math.Trunc(*r.Shares) && !r.captionCount && !(t != nil && (t.fracShares >= 2 || t.prose)) {
		return "fractional_shares"
	}
	if r.Percent == nil {
		return ""
	}
	// Three or more distinct holders in one table carrying the identical percent
	// is one value broadcast down a mis-aligned column.
	repeats := 0
	if t != nil {
		repeats = t.pctRepeats[*r.Percent]
		if r.fundRegistration {
			repeats = t.registeredPctRepeats[screenClassKey(r)][*r.Percent]
		}
	}
	if t != nil && !t.prose && repeats >= 3 {
		return "pct_repeats"
	}
	// shares and percent must imply the same outstanding total as the rest of
	// the table. An order-of-magnitude miss means the two cells are from
	// different columns.
	if t != nil && !t.prose && t.haveMedian && r.Shares != nil && *r.Shares > 0 && *r.Percent > 0 {
		med, ok := t.medianTotal, true
		if t.medianByClass != nil {
			// Several classes in one table: the table-wide median is a mixture
			// of several outstanding totals and says nothing about any of them.
			// Only this row's own class can judge it.
			med, ok = t.medianByClass[screenClassKey(r)]
		}
		if ok {
			ratio := (*r.Shares / (*r.Percent / 100.0)) / med
			if ratio > 5.0 || ratio < 0.2 {
				return "implied_total_off"
			}
		}
	}
	return ""
}

// isNonCommonClass reports a share_class that names a security OTHER than the
// common stock the proxy solicits. A lettered class of COMMON stock is common
// stock: "Class H Common Stock" is General Motors' tracking stock, disclosed in
// the director table beside the $1-2/3 par common, and matching `class [b-z]`
// alone threw away every row of that table. A label that says "common" and names
// no other security is common stock whatever letter it carries.
func isNonCommonClass(cls string) bool {
	if !reScreenNonCommon.MatchString(cls) {
		return false
	}
	if !reScreenCommonWord.MatchString(cls) {
		return true
	}
	// "Series A Convertible Preferred and Common" still names a preferred class.
	return reScreenHardNonCommon.MatchString(cls)
}

var (
	reScreenCommonWord    = regexp.MustCompile(`(?i)\bcommon\b|\bordinary\b`)
	reScreenOtherSecurity = regexp.MustCompile(`(?i)\bpreferred\b|\besop\b|\bdebenture|\bwarrant|\bdepositary\b|\bjunior\b|\boption\b`)
	// Securities that are never the common stock, whatever else the label says.
	reScreenHardNonCommon = regexp.MustCompile(`(?i)\bpreferred\b|\besop\b|\bdebenture|\bwarrant|\bdepositary\b|\bconvertible\b|\bjunior\b|\boption\b`)
)
