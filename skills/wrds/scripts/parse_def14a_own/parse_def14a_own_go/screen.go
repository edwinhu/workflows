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
	reScreenForeign = regexp.MustCompile(`(?i)\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b|\b(?:canada|england|scotland|united\s+kingdom|switzerland|netherlands|germany|japan|france|australia|bermuda|cayman\s+islands)\s*$`)
	// A share class that is not the common stock blockw records. "Class A" is
	// left out on purpose: it is routinely the only common class there is.
	reScreenNonCommon = regexp.MustCompile(`(?i)\bpreferred\b|\bseries\s+[a-z0-9]+\b|\bclass\s+[b-z]\b|\besop\b|\bjunior\b|\bconvertible\b|\bdepositary\b|\bdebenture|\bwarrant|\boption\b`)
)

// screenTable is the per-table context the row rules need.
type screenTable struct {
	isGraph     bool            // a stock-performance graph, not an ownership table
	medianTotal float64         // median shares/(pct/100) over the table's own rows
	haveMedian  bool            //
	pctRepeats  map[float64]int // how many distinct non-group rows carry each percent
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
	return screenNames(out)
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
		screenRepairPair(&r)
		if screenNoHolder(strings.TrimSpace(r.HolderName)) {
			continue
		}
		// A registrant that files a DEF 14A has public voting shareholders, so a
		// single non-group holder of exactly 100.00% of a class is never the
		// common stock the proxy solicits: it is another class, or a total.
		if r.Percent != nil && *r.Percent == 100.0 {
			continue
		}
		// One holder, one row per filing. The 5% table and the D&O table
		// routinely disclose the same holding, and both reach the output.
		if r.Percent != nil {
			sig := screenFold(r.HolderName) + "|" + strconv.FormatFloat(*r.Percent, 'f', -1, 64)
			if seen[sig] {
				continue
			}
			seen[sig] = true
		}
		// The cell names the holder AND says who he is; only the name is the
		// holder. Runs last so every drop rule above still sees the raw cell.
		r.HolderName = cleanHolderName(r.HolderName)
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
	switch {
	case reScreenLeadNum.MatchString(name):
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
	if !strings.ContainsAny(name, "0123456789.&/") {
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
	dateRows := map[int]int{}
	for _, r := range rows {
		t := tabs[r.TableIndex]
		if t == nil {
			t = &screenTable{pctRepeats: map[float64]int{}}
			tabs[r.TableIndex] = t
		}
		name := strings.TrimSpace(r.HolderName)
		if !r.IsGroupRow {
			if reScreenIndex.MatchString(name) {
				t.isGraph = true
			}
			if reScreenDate.MatchString(name) {
				dateRows[r.TableIndex]++
			}
			if r.Percent != nil && *r.Percent >= 5.0 {
				t.pctRepeats[*r.Percent]++
			}
		}
		if r.Shares != nil && *r.Shares > 0 && r.Percent != nil && *r.Percent >= 0.5 {
			implied[r.TableIndex] = append(implied[r.TableIndex], *r.Shares/(*r.Percent/100.0))
		}
	}
	// Three period labels in one table is a graph stub, not a coincidence.
	for ti, n := range dateRows {
		if n >= 3 {
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
	return tabs
}

func screenDrop(r Row, t *screenTable) bool {
	if r.IsGroupRow {
		return false
	}
	if t != nil && t.isGraph {
		return true
	}
	name := strings.TrimSpace(r.HolderName)
	switch {
	case reScreenIndex.MatchString(name), reScreenDate.MatchString(name):
		return true
	case reScreenProse.MatchString(name):
		return true
	case reScreenForeign.MatchString(name):
		return true
	case reScreenNonCommon.MatchString(name), reScreenNonCommon.MatchString(r.ShareClass):
		return true
	}
	// A holder name never starts with a lower-case letter; a name that does is
	// the tail of a wrapped prose line.
	if name != "" && name[0] >= 'a' && name[0] <= 'z' {
		return true
	}
	// A fractional share count means the name cell absorbed the shares column,
	// so whatever was read as the percent came from somewhere else.
	if r.Shares != nil && *r.Shares != math.Trunc(*r.Shares) {
		return true
	}
	if r.Percent == nil {
		return false
	}
	// Three or more distinct holders in one table carrying the identical percent
	// is one value broadcast down a mis-aligned column.
	if t != nil && t.pctRepeats[*r.Percent] >= 3 {
		return true
	}
	// shares and percent must imply the same outstanding total as the rest of
	// the table. An order-of-magnitude miss means the two cells are from
	// different columns.
	if t != nil && t.haveMedian && r.Shares != nil && *r.Shares > 0 && *r.Percent > 0 {
		ratio := (*r.Shares / (*r.Percent / 100.0)) / t.medianTotal
		if ratio > 5.0 || ratio < 0.2 {
			return true
		}
	}
	return false
}
