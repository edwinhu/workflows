package main

import (
	"fmt"
	"regexp"
	"strings"
)

// Grid -> ownership rows.

// Row is one holder x one share class in one table.
type Row struct {
	Accession  string   `json:"accession"`
	CIK        string   `json:"cik"`
	Company    string   `json:"company"`
	FilingDate string   `json:"filing_date"`
	TableKind  string   `json:"table_kind"`
	TableIndex int      `json:"table_index"`
	RowIndex   int      `json:"row_index"`
	HolderName string   `json:"holder_name"`
	Shares     *float64 `json:"shares"`
	Percent    *float64 `json:"percent"`
	PctMarker  string   `json:"percent_marker"`
	ShareClass string   `json:"share_class"`
	IsGroupRow bool     `json:"is_group_row"`
	GroupN     int      `json:"group_n_persons"`
	Footnotes  string   `json:"footnote_markers"`
	Parser     string   `json:"parser"`
	SourceFile string   `json:"source_file"`

	// noHolder marks a row that is structurally part of the table — it counts
	// toward the two-row floor that decides whether the block is a table at
	// all — but names no holder, so it is never emitted. A row whose name is
	// only a postal address is the case this exists for.
	noHolder bool

	// classHint is a class / series / fund label recovered from a column
	// header rather than from a class-shaped value. It is copied onto
	// ShareClass by ScreenRows AFTER every drop rule has run, so recovering it
	// can populate the grain key without changing which rows are emitted.
	classHint string

	// series is per-FILING context, carried on the base Row: the fund / series
	// names the SGML header declares. Set only for a multi-series filing.
	series []string
	// seriesLocal marks a row whose fund identity came from a label row INSIDE
	// its own table, which is more specific than the document heading and must
	// not be overwritten by it.
	seriesLocal bool
}

var (
	reHdrPct = regexp.MustCompile(`(?i)percent|%|of\s+class|of\s+outstanding`)
	// The arithmetic glue of an additive table: a column holding nothing but a
	// bare "+" or "=" between the component columns it adds up.
	reArithGlue = regexp.MustCompile(`^\s*[+=]\s*$`)
	// A share column that is a COMPONENT of one holding — sole and shared power,
	// options, deferred or restricted units, the total — rather than a holding of
	// its own. Read only where the table states no percent at all, to tell J&J's
	// directors table (common shares, deferred units, options, total) from a
	// fund-family table with one column per fund.
	reComponentCol = regexp.MustCompile(`(?i)total|option|deferred|restricted|unvested|underlying|exercisab|\bunits?\b|\bsole\b|shared|voting|disposit|investment\s+power|\bdirect|\bindirect|aggregate|percent|\bplan\b|award|\bvested\b|\bheld\b|\bother\b`)
	// The words that name a POWER or a component of one holding rather than a
	// class of stock: such columns decompose a single holding between them.
	reSharePowerCol = regexp.MustCompile(`(?i)\bsole\b|shared|voting|disposit|investment\s+power|\bdirect\b|\bindirect\b`)

	reHdrShares = regexp.MustCompile(`(?i)shares|amount|number|beneficially\s+owned|ownership|aggregate`)
	reHdrClass  = regexp.MustCompile(`(?i)\bclass\s+[a-d]\b|common\s+stock|series\s+[a-z0-9]+\s+(?:common|preferred)|preferred\s+stock|ordinary\s+shares|\bclass\s+[a-d]$`)
	// reHdrNameCol matches the header of the column that names the HOLDER.
	// "Title of Class" is deliberately absent: it heads a class column, and a
	// proxy that puts one to the left of the holder column otherwise has its
	// class labels read as holder names.
	// "beneficial owners?" must end at a WORD BOUNDARY: without it the regex
	// matches "Amount and Nature of Beneficial OwnerSHIP of Common Stock", which
	// is the SHARES column's header, and repoint() then moves the name role off
	// the holder column onto it -- losing every person row in the table.
	reHdrNameCol = regexp.MustCompile(`(?i)\bname\b|beneficial\s+owners?\b|stockholder|shareholder|\bholder`)
	// A row-level column stating which ISSUER the holding is in. A proxy has one
	// issuer, so such a column exists exactly when several are listed side by
	// side -- a fund complex's trustee table, or a holding-company group -- and
	// the issuer is then part of the grain, exactly like a class. Consulted only
	// for a column that is NOT the name column, so a stub headed "Company" in a
	// table whose holders are companies is untouched.
	reHdrIssuerCol = regexp.MustCompile(`(?i)^\s*(?:company|companies|issuer|entity|registrant|` +
		`name\s+of\s+(?:company|issuer|entity|registrant))\b`)

	// reHdrClassCol matches the header of a ROW-LEVEL column stating which
	// class, series or fund the row's holding is in. Anchored at the head of
	// the header so "Percentage of Fund" is not read as a fund column.
	reHdrClassCol = regexp.MustCompile(`(?i)^\s*(?:title\s+of\s+(?:class|series)|class\s+of\s+(?:stock|shares|securities)|share\s+class|series|fund|portfolio)\b|^\s*class\s*(?:\||$)`)
	// A footnote reference trailing a column header: "... of stock (2)".
	reHdrFootnote = regexp.MustCompile(`\s*\(\d{1,2}\)\s*$`)
	// A column of MONEY, not of shares. A fund-family proxy's trustee table
	// prints compensation in dollars beside a "dollar range of fund shares
	// owned" column, so the ownership cue matches the table and the dollars are
	// read as a share count. The second half of the alternation is what keeps a
	// genuine "shares beneficially owned" column out of this.
	reHdrMoney = regexp.MustCompile(`(?i)compensation|fees\s+earned|\bsalary\b|\bbonus\b|dollar\s+(?:range|value|amount)`)
	reHdrOwned = regexp.MustCompile(`(?i)shares?\s+(?:owned|held|beneficially)|beneficially\s+owned|percent`)
	// A share column's header that says the shares are OWNED rather than merely
	// counted. Read only where the table has no percent column (see
	// looksLikeOwnership).
	reHdrOwnedShares = regexp.MustCompile(`(?i)\bowned\b|\bowns\b|ownership|\bheld\b|\bholdings?\b|beneficial|\bvot(?:ing|es)\b|\binterest\b`)
	// A share column's header that names an AWARD or a plan benefit rather than a
	// holding. Read only where the table has no percent column, and only to
	// reject a table EVERY share column of which is one of these: a genuine
	// ownership table routinely carries an options or restricted-stock component
	// column beside its common-stock column, and rejecting on any single award
	// column would throw the holding away with it.
	// Deliberately NOT including "unit": a spanning header row ("Number of Shares
	// or Units" over a Common Stock, a Stock Equivalent Units and an Options
	// column) contributes its words to EVERY column below it, so a unit cue makes
	// the common-stock column award-flavoured too and the whole table is lost.
	reHdrAwardCol = regexp.MustCompile(`(?i)\boption|\bgrant|\baward|\bssar|\bsars?\b|exercisab|` +
		`\bunvested\b|\bvest|restricted|deferred|purchas|(?:share|stock|equity)\s+investment`)
	reSkipName = regexp.MustCompile(`(?i)^(name|names?\s+(and\s+address\s+)?of\s+.*|(name\s+of\s+)?beneficial\s+owners?|title\s+of\s+class|total|subtotal|directors?|non-?employee\s+directors?|executive\s+officers?|named\s+executive\s+officers?|nominees?|continuing\s+directors?|other\s+executive\s+officers?|5%\s+.*|principal\s+.*holders?|common\s+stock|class\s+[a-d].*)$`)
	// The table must look like an ownership table, not an equity-comp-plan or
	// compensation table that also carries share counts.
	reOwnCue = regexp.MustCompile(`(?i)beneficial|percent\s*(?:age)?\s*of\s*(?:class|shares|common|outstanding)|amount\s+and\s+nature|%\s*of\s*class|shares\s+owned|owned\s+of\s+record|as\s+a\s+group|principal\s+(?:stock|share)holders`)
	// An OPTION-DETAIL or share-PURCHASE table: it names the same people as the
	// ownership table and repeats "Shares Owned" beside its own columns, so
	// reCompCue's "unless it also reads as ownership" escape lets it through.
	// These phrases describe an option or a purchase and never a holding, so
	// they veto the table outright.
	reOptDetailCue = regexp.MustCompile(`(?i)remaining\s+contractual\s+(?:life|term)|` +
		`in[- ]?the[- ]?money|option\s+price\s+range|option\s+average\s+price|` +
		`average\s+option\s+price|net\s+shares\s+from\s+\S+\s+options|` +
		`average\s+purchase\s+price|average\s+discount`)

	// Compensation, option-grant and pay-ratio tables also carry names, share
	// counts and percents. "Percent of total options granted" is the one that
	// slips past the ownership cue, so the option-grant vocabulary is listed.
	reCompCue = regexp.MustCompile(`(?i)equity\s+compensation\s+plan|weighted[- ]average\s+exercise\s+price|securities\s+remaining\s+available|option\s+awards|stock\s+awards|salary|bonus|summary\s+compensation|options?\s+granted|exercise\s+price|expiration\s+date|grant\s+date\s+present\s+value|all\s+other\s+compensation|long[- ]term\s+incentive|individual\s+grants|realizable\s+value`)
)

type colRole struct {
	role   string // "name" | "shares" | "pct" | "class" | "other"
	header string
	// hdrCells is this column's cell in EVERY header row, kept so a column
	// pair's label can be chosen from the header row that distinguishes it from
	// its siblings, and so a continuation table that inherits these roles
	// inherits the headers with them.
	hdrCells []string
}

type compacted struct {
	rows    [][]string
	pctFlag []bool
	nHeader int
	roles   []colRole
	// hdrClassCols are the class columns chosen by their HEADER (repoint
	// below), as opposed to one chosen by its values matching reClassVal. A
	// fund table states BOTH the fund and the class in columns of their own and
	// needs both to identify the holding. Their labels are carried on
	// Row.classHint rather than Row.ShareClass so that no existing screen
	// decision changes: the layout screen reads ShareClass.
	hdrClassCols []int
	// series is the set of fund / series names the filing's SGML header
	// declares, folded by NormLabel. A column whose cells are those names is
	// the fund column of a fund-family proxy, whatever its header says.
	series map[string]string
	// inherited marks a table whose columns came from the table it continues,
	// so the caller keeps handing the ORIGINAL headed table on rather than a
	// copy of itself.
	inherited bool
	// carryClass is the last value seen in each header-chosen class column,
	// handed to the NEXT table of the same shape. A fund-family proxy repeats
	// the whole table with its headers once per page and writes the fund only on
	// the row it changes, so the first rows of every table but the first carry a
	// blank fund that belongs to the table before.
	carryClass []string
}

// compact drops columns that never hold anything but $ ( ) % and whitespace —
// the fragment cells EDGAR HTML splits numbers across — while remembering that a
// dropped "%"-only column marks its left neighbour as a percent column.
func compact(g *Grid) *compacted {
	// 1. Drop footnote rows: a rowspan/colspan-expanded full-width paragraph
	//    repeats one long string across every column and would otherwise
	//    dominate every column's role vote.
	var keepRows [][]string
	for i := range g.Rows {
		distinct := map[string]bool{}
		maxLen := 0
		for _, c := range g.Rows[i] {
			if c == "" {
				continue
			}
			distinct[c] = true
			if len(c) > maxLen {
				maxLen = len(c)
			}
		}
		if len(distinct) == 1 && maxLen > 90 && len(g.Rows[i]) > 2 {
			continue
		}
		keepRows = append(keepRows, g.Rows[i])
	}

	ncol := 0
	for _, r := range keepRows {
		if len(r) > ncol {
			ncol = len(r)
		}
	}
	at := func(i, j int) string {
		if j < len(keepRows[i]) {
			return keepRows[i][j]
		}
		return ""
	}

	// 2. Drop columns that never hold anything but $ ( ) % and whitespace — the
	//    fragment cells EDGAR HTML splits numbers across — remembering that a
	//    dropped "%"-only column marks its left neighbour as a percent column.
	// Header signature per raw column, used to decide which adjacent columns
	// are one logical column split by colspan.
	hdrEnd := len(keepRows)
	for i := range keepRows {
		if rowIsData(keepRows[i]) {
			hdrEnd = i
			break
		}
	}
	sig := make([]string, ncol)
	for j := 0; j < ncol; j++ {
		var parts []string
		for i := 0; i < hdrEnd; i++ {
			if v := flat(at(i, j)); v != "" {
				parts = append(parts, v)
			}
		}
		sig[j] = strings.Join(uniq(parts), " ")
	}

	var groups [][]int
	pctFlag := []bool{}
	for j := 0; j < ncol; j++ {
		junk, sawPct := true, false
		for i := range keepRows {
			c := at(i, j)
			if c == "" {
				continue
			}
			if !reOnlyPunct.MatchString(flat(c)) {
				junk = false
			}
			// Only a "%" in a DATA row is the glyph that trails the value in the
			// column to the left. A "%" in the HEADER block is that column's own
			// name: "Number | %" over each class, whose data cells may be nothing
			// but "*" markers. Flagging its left neighbour turns the class's
			// share count into a percent.
			if strings.Contains(c, "%") && i >= hdrEnd {
				sawPct = true
			}
		}
		if junk {
			if sawPct && len(pctFlag) > 0 {
				pctFlag[len(pctFlag)-1] = true
			}
			continue
		}
		// 3. Merge column j into the previous kept column when the two are one
		//    logical column the colspan expansion split: identical contents, or
		//    the same header with no row filling both.
		if len(groups) > 0 {
			prev := groups[len(groups)-1]
			p := prev[len(prev)-1]
			// Compatible = no row where the two hold DIFFERENT non-empty
			// values. Equal values are the colspan replication itself, and a
			// spanning footnote row must not block the merge.
			compatible := true
			for i := range keepRows {
				a, b := at(i, p), at(i, j)
				if a != "" && b != "" && a != b {
					compatible = false
					break
				}
			}
			if compatible && sig[p] == sig[j] {
				groups[len(groups)-1] = append(prev, j)
				continue
			}
		}
		groups = append(groups, []int{j})
		pctFlag = append(pctFlag, false)
	}
	rows := make([][]string, len(keepRows))
	for i := range keepRows {
		r := make([]string, len(groups))
		for k, g := range groups {
			for _, j := range g {
				if v := at(i, j); v != "" {
					r[k] = v
					break
				}
			}
		}
		rows[i] = r
	}
	return &compacted{rows: rows, pctFlag: pctFlag}
}

// compactWith is compact plus the per-filing context the role vote reads: the
// declared fund / series names. A filing declaring fewer than two series has
// nothing to disambiguate, so the set is left nil.
func compactWith(g *Grid, base Row) *compacted {
	c := compact(g)
	c.series = SeriesSet(base.series)
	return c
}

func rowIsData(raw []string) bool {
	hasName, hasNum := false, false
	for _, c0 := range raw {
		c := flat(c0)
		if c == "" {
			continue
		}
		if hasWords(c, 1) && len(c) >= 3 && !reOnlyPunct.MatchString(c) {
			hasName = true
		}
		if v, ok := ParseShares(c); ok && v >= 100 {
			hasNum = true
		}
		if _, _, mk, pi := ParsePercent(c); pi && (mk == "*" || mk == "<1%" || strings.Contains(c, "%")) {
			hasNum = true
		}
	}
	return hasName && hasNum
}

func (c *compacted) analyze() {
	// header block = rows before the first data-shaped row
	c.nHeader = 0
	for i, r := range c.rows {
		if rowIsData(r) {
			c.nHeader = i
			break
		}
		if i == len(c.rows)-1 {
			c.nHeader = len(c.rows)
		}
	}
	ncol := 0
	for _, r := range c.rows {
		if len(r) > ncol {
			ncol = len(r)
		}
	}
	c.roles = make([]colRole, ncol)
	for j := 0; j < ncol; j++ {
		var hdr []string
		cells := make([]string, 0, c.nHeader)
		for i := 0; i < c.nHeader && i < len(c.rows); i++ {
			v := ""
			if j < len(c.rows[i]) {
				v = flat(c.rows[i][j])
			}
			cells = append(cells, v)
			if v != "" {
				hdr = append(hdr, v)
			}
		}
		c.roles[j].header = strings.Join(uniq(hdr), " | ")
		c.roles[j].hdrCells = cells
	}
	nameCol := -1
	for j := 0; j < ncol; j++ {
		words, strongPct, bigNum, pctish, classish, seriesish, n := 0, 0, 0, 0, 0, 0, 0
		glue := 0
		for i := c.nHeader; i < len(c.rows); i++ {
			if j >= len(c.rows[i]) {
				continue
			}
			cell := flat(c.rows[i][j])
			if cell == "" {
				continue
			}
			// A STACKED cell holds one value per class on its own line. Its
			// MAGNITUDE must be read from one line, since the concatenation is
			// an impossible number — but the "%" / "*" / "less than" marks are
			// read from the whole cell, which is where the proxy may have put
			// the single "%" that belongs to all of its lines.
			val := stackFirst(c.rows[i][j])
			n++
			if reArithGlue.MatchString(cell) {
				glue++
			}
			if hasWords(cell, 2) {
				words++
			}
			if strings.Contains(cell, "%") || reStar.MatchString(cell) || reLessThan.MatchString(cell) {
				strongPct++
			}
			if v, ok := ParseShares(val); ok && (v >= 1000 || strings.Contains(val, ",")) {
				bigNum++
			}
			if _, _, _, pi := ParsePercent(val); pi {
				pctish++
			}
			if reClassVal.MatchString(cell) {
				classish++
			}
			if c.series[NormLabel(cell)] != "" {
				seriesish++
			}
		}
		hdr := c.roles[j].header
		if roleVotes != nil {
			roleVotes[j] = fmt.Sprintf("n=%d words=%d strongPct=%d bigNum=%d pctish=%d classish=%d seriesish=%d glue=%d pctFlag=%v hdr=%q",
				n, words, strongPct, bigNum, pctish, classish, seriesish, glue, c.pctFlag[j], trunc(hdr, 40))
		}
		switch {
		case n == 0:
			c.roles[j].role = "other"
		case glue == n && !reHdrPct.MatchString(hdr):
			// An ADDITIVE table spells its arithmetic out in columns of its own:
			// record shares + plan shares + deferred shares = total. A lone "+"
			// is also the footnote / star marker, so such a column otherwise
			// votes itself a PERCENT column and the holder is emitted once per
			// component pair.
			c.roles[j].role = "other"
		case reHdrMoney.MatchString(hdr) && !reHdrOwned.MatchString(hdr):
			// Money, not shares. Runs before the numeric votes so a dollar
			// column cannot be read as a share count.
			c.roles[j].role = "other"
		case seriesish*2 >= n && seriesish > 0 && bigNum == 0:
			// A fund-family proxy lists the fund in a column of its own; the
			// holder column is the next one along.
			c.roles[j].role = "class"
			c.hdrClassCols = append(c.hdrClassCols, j)
		case classish*2 >= n && classish > 0 && bigNum == 0:
			c.roles[j].role = "class"
		case c.pctFlag[j] || strongPct > bigNum && strongPct > 0:
			c.roles[j].role = "pct"
		case bigNum > 0:
			c.roles[j].role = "shares"
		case reHdrPct.MatchString(hdr) && pctish > 0:
			c.roles[j].role = "pct"
		case reHdrShares.MatchString(hdr) && pctish > 0:
			c.roles[j].role = "shares"
		case words*2 >= n && nameCol < 0:
			c.roles[j].role = "name"
		case pctish > 0:
			c.roles[j].role = "pct"
		default:
			c.roles[j].role = "other"
		}
		if c.roles[j].role == "name" && nameCol < 0 {
			nameCol = j
		}
	}
	if nameCol < 0 {
		// first column with any words becomes the name column
		for j := 0; j < ncol; j++ {
			for i := c.nHeader; i < len(c.rows); i++ {
				if j < len(c.rows[i]) && hasWords(flat(c.rows[i][j]), 1) {
					c.roles[j].role = "name"
					nameCol = j
					break
				}
			}
			if nameCol >= 0 {
				break
			}
		}
	}
	c.repoint()
}

// colFilled counts the data cells of column j that hold anything. A fund
// table's class column holds bare letters ("A", "C"), which are not words.
func (c *compacted) colFilled(j int) int {
	n := 0
	for i := c.nHeader; i < len(c.rows); i++ {
		if j >= len(c.rows[i]) || isSpanRow(c.rows[i]) {
			continue
		}
		v := flat(c.rows[i][j])
		// A colspan fragment holding only "$", "(", "%" or a footnote marker
		// states no class, however its header reads.
		if v == "" || reOnlyPunct.MatchString(v) || reHdrFootnote.MatchString("x"+v) {
			continue
		}
		n++
	}
	return n
}

// isSpanRow reports whether a row is one label repeated across the table by
// colspan expansion — a sub-heading ("Board Members who are not interested
// persons of the Funds"), not data. Every column looks filled on such a row.
func isSpanRow(r []string) bool {
	first, n := "", 0
	for _, cell := range r {
		v := flat(cell)
		if v == "" {
			continue
		}
		n++
		if first == "" {
			first = v
		} else if v != first {
			return false
		}
	}
	return n >= 2
}

// colWords counts the data cells of column j that carry at least one word.
func (c *compacted) colWords(j int) int {
	n := 0
	for i := c.nHeader; i < len(c.rows); i++ {
		if j < len(c.rows[i]) && hasWords(flat(c.rows[i][j]), 1) {
			n++
		}
	}
	return n
}

// repoint fixes the two layouts where a GROUPING column stands to the left of
// the holder column and is therefore taken for it: a fund-family proxy's "Fund"
// column, and a "Title of Class" column. The first word-bearing column is the
// holder only when nothing else is headed like the holder column.
//
// It then gives a row-level class / series / fund column the "class" role
// whatever its values look like, so the identity of the holding reaches
// share_class instead of collapsing distinct rows onto one key.
func (c *compacted) repoint() {
	isNameHdr := func(j int) bool {
		h := c.roles[j].header
		return reHdrNameCol.MatchString(h) && !reHdrClassCol.MatchString(h)
	}
	nc := -1
	for j := range c.roles {
		if c.roles[j].role == "name" {
			nc = j
			break
		}
	}
	if nc >= 0 && !isNameHdr(nc) {
		for j := range c.roles {
			if j == nc || c.roles[j].role != "other" {
				continue
			}
			if isNameHdr(j) && c.colWords(j) > 0 {
				c.roles[j].role = "name"
				c.roles[nc].role = "other"
				nc = j
				break
			}
		}
	}
	for j := range c.roles {
		if j == nc || c.roles[j].role != "other" {
			continue
		}
		isClassCol := reHdrClassCol.MatchString(c.roles[j].header) ||
			(nc >= 0 && reHdrIssuerCol.MatchString(c.roles[j].header))
		if isClassCol && c.colFilled(j) > 0 {
			c.roles[j].role = "class"
			c.hdrClassCols = append(c.hdrClassCols, j)
		}
	}
}

// matchSeries reports which declared fund / series name a cell states, allowing
// a short trailing parenthetical the proxy adds for the reader ("Vanguard 500
// Index Fund (1976)"). Returns "" when the cell names no declared series.
func (c *compacted) matchSeries(cell string) string {
	return MatchSeries(c.series, cell)
}

// seriesRowLabel reports the fund a full-width LABEL ROW inside the table names.
// A fund-family proxy that puts several funds in one table separates them with
// such a row; without it every fund's record holders collapse onto one key.
func (c *compacted) seriesRowLabel(r []string) string {
	if c.series == nil {
		return ""
	}
	lbl := ""
	for _, cell := range r {
		v := flat(cell)
		if v == "" {
			continue
		}
		if _, ok := ParseShares(v); ok {
			return ""
		}
		if _, _, _, pi := ParsePercent(v); pi {
			return ""
		}
		m := c.matchSeries(v)
		if m == "" {
			return ""
		}
		if lbl == "" {
			lbl = m
		}
	}
	return lbl
}

// fundLabelRow is the same row read WITHOUT a declared series list: a
// full-width row that carries no number and whose text ends in the fund noun
// ("Macquarie/First Trust Global Infrastructure Fund:"). A closed-end family
// that declares no series in its SGML header still names every fund this way,
// and without it one record holder of a dozen funds collapses onto one key.
func (c *compacted) fundLabelRow(r []string) string {
	txt := ""
	for _, cell := range r {
		v := flat(cell)
		if v == "" {
			continue
		}
		if _, ok := ParseShares(v); ok {
			return ""
		}
		if _, _, _, pi := ParsePercent(v); pi {
			return ""
		}
		if txt != "" && v != txt {
			return ""
		}
		txt = v
	}
	if txt == "" || len(strings.Fields(txt)) > 14 || !reFundLabelLine.MatchString(txt) ||
		reFundLabelNo.MatchString(txt) {
		return ""
	}
	return strings.TrimRight(strings.TrimSpace(txt), ":.")
}

// Prose that happens to end in the fund noun: the bullet under a fund's heading
// ("A series of Vanguard World Fund") names the family, not this table's fund.
var reFundLabelNo = regexp.MustCompile(`(?i)^(?:a|an|the)\s|advised\s+by|net\s+assets|shareholder|nominee|owner|percent|record|outstanding`)

// A line whose LAST word is the fund noun names a fund.
var reFundLabelLine = regexp.MustCompile(`(?i)\b(?:fund|portfolio|trust|series)\b\s*[:.]?\s*$`)

// splitStack breaks a cell into its non-empty lines. EDGAR proxies STACK one
// value per share class inside a single cell, separated by <br>.
func splitStack(raw string) []string {
	var out []string
	for _, l := range strings.Split(raw, "\n") {
		if v := norm(l); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// stackFirst reduces a stacked VALUE cell to its first line, so a column's role
// is voted on one value rather than on the concatenation of several — flattening
// "33,870,629 / 712,172 / 631,060" yields a share count that cannot exist.
// Only a cell whose every line is a number, a dash or a short class token
// qualifies: a name-and-address cell is also multi-line and must keep all of it.
func stackFirst(raw string) string {
	lines := splitStack(raw)
	if len(lines) < 2 {
		return flat(raw)
	}
	pct, comma, first := 0, 0, 0
	for _, l := range lines {
		if l == "-" {
			continue
		}
		first++
		if strings.Contains(l, "%") {
			pct++
		}
		if strings.Contains(l, ",") {
			comma++
		}
		if len(l) <= 4 {
			continue
		}
		if _, ok := ParseShares(l); ok {
			continue
		}
		if _, _, _, pi := ParsePercent(l); pi {
			continue
		}
		return flat(raw)
	}
	// The lines must be the SAME KIND of value. A cell stacking a share count
	// over its percent ("75,000" / "3.7%") is one holding written on two lines,
	// not one holding per class, and must be read whole.
	if first == 0 || (pct != 0 && pct != first) || (comma != 0 && comma != first) {
		return flat(raw)
	}
	return lines[0]
}

// subStack picks sub-row `sub` out of a label that is itself stacked the same
// way ("A B C" after flattening), and leaves an unstacked label alone.
func subStack(label string, nsub, sub int) string {
	parts := strings.Split(label, " | ")
	for i, p := range parts {
		if f := strings.Fields(p); len(f) == nsub {
			parts[i] = f[sub]
		}
	}
	return strings.Join(parts, " | ")
}

// cleanClassLabel trims a column header down to something usable as a class
// label: one line, no trailing footnote reference.
func cleanClassLabel(s string) string {
	s = strings.TrimSpace(reHdrFootnote.ReplaceAllString(flat(s), ""))
	if len(s) > 180 {
		s = strings.TrimSpace(s[:180])
	}
	return s
}

// interiorHeader reports a row INSIDE the data block that is a second column
// header: every value column holds text rather than a number, at least two of
// them differ, and none of them parses as a share count or a percent. A
// fund-family table that runs out of page width repeats its header for the next
// batch of funds, and the rows under it belong to THOSE funds.
func (c *compacted) interiorHeader(r []string, ps []pair) ([]string, bool) {
	if len(ps) < 2 || isSpanRow(r) {
		return nil, false
	}
	out := make([]string, len(ps))
	n := 0
	distinct := map[string]bool{}
	for k, p := range ps {
		v := ""
		for _, j := range []int{p.shares, p.pct} {
			if j >= 0 && j < len(r) && flat(r[j]) != "" {
				v = flat(r[j])
				break
			}
		}
		if v == "" {
			continue
		}
		if _, ok := ParseShares(v); ok {
			return nil, false
		}
		if _, _, _, pi := ParsePercent(v); pi {
			return nil, false
		}
		if !hasWords(v, 1) {
			return nil, false
		}
		out[k] = cleanClassLabel(v)
		distinct[out[k]] = true
		n++
	}
	if n < 2 || len(distinct) < 2 {
		return nil, false
	}
	return out, true
}

// splitTiedLabels separates two pairs that the chosen header row gives the SAME
// name. A multi-class table often states the class one row up and the QUANTITY
// one row down — "Series A and Series B" over both a share Number column and a
// Votes column — so two distinct holdings land on one key. Any other header row
// that tells the tied pairs apart is composed onto their labels.
func (c *compacted) splitTiedLabels(ps []pair, out []string, at func(pair, int) string, nh, used int) {
	// The distinguishing word may sit over the SHARE column ("Number" against
	// "Votes") while `at` prefers the percent column, so each header row is tried
	// from both sides.
	atShares := func(p pair, i int) string {
		if p.shares < 0 || p.shares >= len(c.roles) || i >= len(c.roles[p.shares].hdrCells) {
			return ""
		}
		return c.roles[p.shares].hdrCells[i]
	}
	for step := 0; step < 2*nh; step++ {
		i := nh - 1 - step/2
		read := at
		if step%2 == 1 {
			read = atShares
		}
		if i == used && step%2 == 0 {
			continue
		}
		tied := map[string][]int{}
		for k, v := range out {
			tied[v] = append(tied[v], k)
		}
		anyTied := false
		for _, ks := range tied {
			if len(ks) > 1 {
				anyTied = true
			}
		}
		if !anyTied {
			return
		}
		for _, ks := range tied {
			if len(ks) < 2 {
				continue
			}
			vals := map[int]string{}
			seen := map[string]bool{}
			for _, k := range ks {
				vals[k] = cleanClassLabel(read(ps[k], i))
				seen[vals[k]] = true
			}
			if len(seen) < 2 {
				continue
			}
			for _, k := range ks {
				if vals[k] != "" {
					out[k] = withSeries(out[k], vals[k])
				}
			}
		}
	}
}

// pairLabels names each (shares, percent) column pair from the header row that
// DISTINGUISHES it from its siblings. The deepest header row is usually the
// column TYPE ("Shares Held", "As % of shares outstanding"), identical over
// every pair and useless as a key; the row above it carries the class or the
// fund. Where no header row separates the pairs, the deepest non-empty cell is
// used, which is what tells "Total" from "combined voting power".
//
// Reads the recorded header cells rather than the rows, so a continuation table
// that inherited its columns is labelled too.
func (c *compacted) pairLabels(ps []pair) []string {
	out := make([]string, len(ps))
	// Two readers of one header row. The PERCENT column's cell is preferred --
	// it is the one a multi-class header usually names the class in -- but when
	// both percent columns are headed the same ("Percent of / Class") and it is
	// the SHARES columns that differ, reading the percent cell alone labels
	// every pair identically and the holdings collapse onto one key.
	reader := func(order []int) func(pair, int) string {
		return func(p pair, i int) string {
			cols := []int{p.pct, p.shares}
			for _, which := range order {
				j := cols[which]
				if j < 0 || j >= len(c.roles) || i >= len(c.roles[j].hdrCells) {
					continue
				}
				if v := c.roles[j].hdrCells[i]; v != "" {
					return v
				}
			}
			return ""
		}
	}
	at := reader([]int{0, 1})
	atShares := reader([]int{1, 0})
	nh := 0
	for _, r := range c.roles {
		if len(r.hdrCells) > nh {
			nh = len(r.hdrCells)
		}
	}
	for i := nh - 1; i >= 0; i-- {
		for _, rd := range []func(pair, int) string{at, atShares} {
			vals := make([]string, len(ps))
			distinct := map[string]bool{}
			power := false
			for k, p := range ps {
				vals[k] = rd(p, i)
				if vals[k] != "" {
					distinct[vals[k]] = true
					if reSharePowerCol.MatchString(vals[k]) {
						power = true
					}
				}
			}
			// A shares header that names a POWER or a holding's components
			// (sole / shared / voting / dispositive / direct) distinguishes
			// parts of one holding, not two classes.
			if len(distinct) < 2 || power {
				continue
			}
			// The label may WRAP over several header rows -- a fund name written
			// "Arizona" / "Dividend" / "Advantage 2" down three of them names the
			// column only as a whole, and the lowest row alone ("Advantage 2")
			// collides with another fund in the next table. Compose the rows
			// ABOVE this one that also differ between the pairs; a row whose
			// value is the same for every pair names the TABLE, not the column,
			// and is left out.
			for k, p := range ps {
				var parts []string
				for above := 0; above < i; above++ {
					v := rd(p, above)
					if v == "" || sameForEveryPair(ps, rd, above) {
						continue
					}
					parts = append(parts, v)
				}
				parts = append(parts, vals[k])
				out[k] = cleanClassLabel(strings.Join(parts, " "))
			}
			c.splitTiedLabels(ps, out, rd, nh, i)
			return out
		}
	}
	for k, p := range ps {
		for i := nh - 1; i >= 0; i-- {
			if v := at(p, i); v != "" {
				out[k] = cleanClassLabel(v)
				break
			}
		}
	}
	return out
}

// sameForEveryPair reports whether header row `i` holds the same text over every
// pair: such a row names the whole table and cannot distinguish its columns.
func sameForEveryPair(ps []pair, rd func(pair, int) string, i int) bool {
	first := rd(ps[0], i)
	for _, p := range ps[1:] {
		if rd(p, i) != first {
			return false
		}
	}
	return true
}

type pair struct{ shares, pct int }

func (c *compacted) pairs() []pair {
	// A table with no percent column at all (J&J's director table: common
	// shares, deferred units, options, total) is one holding per row, not one
	// per numeric column: emit only the total/beneficially-owned column, else
	// the last share column, which is the total in every layout seen.
	nPct := 0
	shareCols := []int{}
	for j, r := range c.roles {
		if r.role == "pct" {
			nPct++
		}
		if r.role == "shares" {
			shareCols = append(shareCols, j)
		}
	}
	if nPct == 0 && len(shareCols) > 1 {
		// ... unless the header names every column with something that is not a
		// component of one holding. A fund-family proxy states each board
		// member's holding in one column per FUND, and those are separate
		// holdings that collapse onto one key if only the first is emitted.
		per := make([]pair, len(shareCols))
		for i, j := range shareCols {
			per[i] = pair{j, -1}
		}
		labs := c.pairLabels(per)
		distinct, seen := true, map[string]bool{}
		for _, l := range labs {
			if l == "" || seen[l] || reComponentCol.MatchString(l) {
				distinct = false
				break
			}
			seen[l] = true
		}
		if distinct {
			return per
		}
		best := shareCols[len(shareCols)-1]
		for _, j := range shareCols {
			if regexp.MustCompile(`(?i)total|beneficially\s+owned`).MatchString(c.roles[j].header) {
				best = j
				break
			}
		}
		return []pair{{best, -1}}
	}
	var out []pair
	pending := -1
	for j, r := range c.roles {
		switch r.role {
		case "shares":
			if pending >= 0 {
				out = append(out, pair{pending, -1})
			}
			pending = j
		case "pct":
			out = append(out, pair{pending, j})
			pending = -1
		}
	}
	if pending >= 0 {
		out = append(out, pair{pending, -1})
	}
	// Where the table has percent columns, a share column with no percent of
	// its own is a component (options, deferred units, sole vs shared power),
	// not another class: keep only the paired columns.
	if nPct > 0 {
		var kept []pair
		for _, p := range out {
			if p.pct >= 0 {
				kept = append(kept, p)
			}
		}
		if len(kept) > 0 {
			return kept
		}
	}
	return out
}

// classLabel reads the multi-class column header spanning a (shares, pct) pair.
// colspan expansion has already replicated a "Class B Common Stock" header
// across both of its columns, so the label is simply the topmost class-shaped
// header cell over either column.
func (c *compacted) classLabel(p pair) string {
	cols := []int{}
	if p.shares >= 0 {
		cols = append(cols, p.shares)
	}
	if p.pct >= 0 {
		cols = append(cols, p.pct)
	}
	for i := 0; i < c.nHeader && i < len(c.rows); i++ {
		for _, j := range cols {
			if j < len(c.rows[i]) {
				v := flat(c.rows[i][j])
				if v != "" && reHdrClass.MatchString(v) {
					return v
				}
			}
		}
	}
	return ""
}

func (c *compacted) nameCol() int {
	for j, r := range c.roles {
		if r.role == "name" {
			return j
		}
	}
	return 0
}

// classCol is the class column whose VALUES are class designations, which is
// the one whose label goes straight onto ShareClass. The header-chosen columns
// are handled separately, via classHint.
func (c *compacted) classCol() int {
	for j, r := range c.roles {
		if r.role != "class" {
			continue
		}
		hdr := false
		for _, k := range c.hdrClassCols {
			if k == j {
				hdr = true
			}
		}
		if !hdr {
			return j
		}
	}
	return -1
}

// looksLikeOwnershipTable is the guard against compensation and equity-plan
// tables, which also carry names and share counts.
func (c *compacted) looksLikeOwnership(tableText string) bool {
	return c.ownershipReject(tableText) == ""
}

// ownershipReject names the clause that rejected the table, or "" if it is
// accepted. One function so the -debug view reports the same reason the pipeline
// acted on.
func (c *compacted) ownershipReject(tableText string) string {
	if reOptDetailCue.MatchString(tableText) {
		return "opt_detail_cue"
	}
	if reCompCue.MatchString(tableText) && !reOwnCue.MatchString(tableText) {
		return "comp_cue"
	}
	if !reOwnCue.MatchString(tableText) {
		return "no_own_cue"
	}
	ndata := 0
	for i := c.nHeader; i < len(c.rows); i++ {
		if rowIsData(c.rows[i]) {
			ndata++
		}
	}
	if ndata < 2 {
		return "ndata_lt_2"
	}
	hasP := false
	nPct, nOwned, nShares, nNotAward := 0, 0, 0, 0
	for _, r := range c.roles {
		if r.role == "pct" || r.role == "shares" {
			hasP = true
		}
		if r.role == "pct" {
			nPct++
		}
		if r.role == "shares" {
			nShares++
			if reHdrOwnedShares.MatchString(flat(r.header)) {
				nOwned++
			}
			if !reHdrAwardCol.MatchString(flat(r.header)) {
				nNotAward++
			}
		}
	}
	// A percent-less table whose EVERY share column is named as an award or plan
	// benefit ("Number of Options Received or To Be Received", "Number of Shares
	// Underlying SSAR/Option Grants", "Share Investment") repeats the ownership
	// table's people with a different count: it is a plan table, not ownership.
	//
	// The earlier form of this clause demanded instead that a share column's own
	// header say the shares are OWNED, and that threw away a whole layout class.
	// A D&O beneficial-ownership table states no percent whenever the proxy says
	// in prose that no individual reaches 1%, and it names its share columns by
	// the COMPONENTS of the holding — "Common Stock | Stock Equivalents | Options
	// Exercisable Within 60 Days | Restricted Stock | Total" (Xcel 2008), or
	// simply "Shares(1)" (United Technologies 2005). Measured on the fixed panel
	// diff, it is the largest single cause of the filings that went from rows to
	// zero rows. Restricted to percent-less tables so that no filing can lose a
	// parsed percent by this rule.
	if nPct == 0 && nShares > 0 && nOwned == 0 && nNotAward == 0 {
		return "pctless_award_cols_only"
	}
	if !hasP {
		return "no_value_col"
	}
	return ""
}

var reAddrLine = regexp.MustCompile(`(?i)^(\d|P\.?\s?O\.?\s+box|one\s+\w+\s+(street|plaza|place|way|center|centre|avenue)|c/o\b|[\w\s]+,\s*[A-Z]{2}\s+\d{5})`)

// A class designation stated inside a VALUE cell, after the number it qualifies.
var reClassInValue = regexp.MustCompile(`(?i)\bclass\s+[a-z0-9]{1,3}\b|\bseries\s+[a-z0-9]{1,3}\b`)

// A name cell that is nothing but a parenthesised qualifier continues the
// holder named on the row above.
var reParenOnlyName = regexp.MustCompile(`^\s*\([^()]*\)\s*$`)

// holderName takes the lines of a 5% holder's cell that come BEFORE the mailing
// address EDGAR proxies put under the name. The name itself routinely wraps
// ("State of" / "Wisconsin Investment Board (2)" / "P.O. Box 7842" / "Madison,
// WI 53707"), so stopping at line one both truncates the holder and collides
// every holder whose first line is as generic as "State of".
func holderName(cell string) string {
	lines := strings.Split(cell, "\n")
	if len(lines) < 2 {
		return flat(cell)
	}
	first := strings.TrimSpace(lines[0])
	if !hasWords(first, 1) {
		return flat(cell)
	}
	addr := -1
	for i := 1; i < len(lines); i++ {
		if reAddrLine.MatchString(strings.TrimSpace(lines[i])) {
			addr = i
			break
		}
	}
	if addr < 0 {
		return flat(cell) // no address under the name: the cell is the name
	}
	// The line the address starts on may CARRY part of the name: a fund named
	// for a year ("2010 Target Date Retirement Fund, Norfolk, VA") opens with a
	// digit, so reAddrLine calls the whole line an address and dropping it
	// leaves every target-date fund with the same name.
	carry := nameBeforeCity(strings.TrimSpace(lines[addr]))
	// Everything before the address is the name, capped at three lines so a
	// footnote sentence written above an address cannot be read as one.
	end := min(addr, 3)
	var head []string
	for i := 0; i < end; i++ {
		if t := strings.TrimSpace(lines[i]); t != "" {
			head = append(head, t)
		}
	}
	if carry != "" {
		head = append(head, carry)
	}
	return flat(strings.Join(head, " "))
}

var (
	// A trailing city or state part of a "Name, City, ST" line.
	reCityOrState = regexp.MustCompile(`^(?:[A-Z]{2}|[A-Z][A-Za-z.\-]*(?:\s+[A-Z][A-Za-z.\-]*)?)(?:\s+\d{5}(?:-\d{4})?)?$`)
	// A line whose HEAD is a real street address or post-office box: nothing in
	// it is part of a holder's name.
	reAddrHead = regexp.MustCompile(`(?i)^(?:\d{1,5}\s+[\w.'& -]*\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|` +
		`lane|ln|place|pl|plaza|way|parkway|pkwy|highway|hwy|circle|court|ct|square|sq|building|bldg|tower|` +
		`center|centre|floor|fl|broadway|park|row|terrace)\b|p\.?\s?o\.?\s+box|c/o\b|one\s)`)
	// A street that the line runs into without a comma: "... Karpus Investment
	// Management 183 Sully's Trail Pittsford". Nothing after it is a name.
	reAddrTail = regexp.MustCompile(`(?i)\b(?:street|avenue|ave|road|boulevard|blvd|drive|lane|place|plaza|way|` +
		`parkway|pkwy|highway|hwy|circle|court|square|building|bldg|tower|center|centre|floor|broadway|park|` +
		`row|terrace|trail|turnpike|tpke|harbor|harbour|wharf)\b[^,]*$`)
)

// nameBeforeCity returns the part of a line that precedes a trailing "City, ST"
// or "City, ST ZIP". It returns "" when the line has no comma, when its head is
// itself a street address or a box, or when nothing but one word is left -- so a
// city can never become a holder.
func nameBeforeCity(line string) string {
	parts := strings.Split(line, ", ")
	if len(parts) < 2 {
		return ""
	}
	end := len(parts)
	for end > 1 && reCityOrState.MatchString(strings.Trim(strings.TrimSpace(parts[end-1]), ",.")) {
		end--
	}
	if end == len(parts) {
		return ""
	}
	head := strings.Trim(strings.TrimSpace(strings.Join(parts[:end], ", ")), ",")
	if head == "" || len(strings.Fields(head)) < 2 {
		return ""
	}
	// Nothing is carried out of a line whose head is a street address or box,
	// nor out of one that RUNS INTO a street with no comma before it.
	if reAddrHead.MatchString(head) || reAddrTail.MatchString(head) {
		return ""
	}
	return head
}

// dropAddress trims a mailing address that a proxy wrote inline with the name:
// "The Vanguard Group, 100 Vanguard Blvd., Malvern, PA 19355".
func dropAddress(name string) string {
	parts := strings.Split(name, ", ")
	if len(parts) < 2 {
		return name
	}
	for i := 1; i < len(parts); i++ {
		if reAddrLine.MatchString(strings.TrimSpace(parts[i])) {
			return strings.TrimSpace(strings.Join(parts[:i], ", "))
		}
	}
	return name
}

// inheritHeaders gives a table with NO header row of its own the column roles of
// the table it continues. A per-fund holder table that runs over a page break
// arrives as a second <table> with no headings, and without them the grouping
// column is read as the holder and the value columns cannot be told apart.
//
// Guarded on an exact column count match, on the previous table having had a
// header, and on this table having none at all: any of those failing means it is
// a new table, not a continuation.
func (c *compacted) inheritHeaders(prev *compacted) bool {
	if prev == nil || len(c.roles) == 0 || len(prev.roles) != len(c.roles) {
		return false
	}
	if c.hasHeaderCues() || !prev.hasHeaderCues() {
		return false
	}
	c.roles = append([]colRole{}, prev.roles...)
	c.hdrClassCols = append([]int{}, prev.hdrClassCols...)
	c.inherited = true
	return true
}

// sameShape reports whether two tables are the same table repeated: identical
// column count and identical column headers. A fund-family proxy prints its
// holder table once per page that way.
func (c *compacted) sameShape(prev *compacted) bool {
	if prev == nil || len(prev.roles) != len(c.roles) || len(c.roles) == 0 {
		return false
	}
	for j := range c.roles {
		if c.roles[j].header != prev.roles[j].header {
			return false
		}
	}
	return true
}

// hasHeaderCues reports whether any column carries a header that says what the
// column IS. A continuation table has none: what looks like its header row is a
// wrapped address fragment, not a heading.
func (c *compacted) hasHeaderCues() bool {
	for _, r := range c.roles {
		h := r.header
		if h == "" {
			continue
		}
		if reHdrNameCol.MatchString(h) || reHdrPct.MatchString(h) ||
			reHdrShares.MatchString(h) || reHdrClassCol.MatchString(h) {
			return true
		}
	}
	return false
}

// ExtractGrid emits one Row per (data row x class pair). prev is the compacted
// form of the previous ACCEPTED table under the same heading, used only to give
// a header-less continuation table its predecessor's columns; it may be nil. The
// compacted form is returned so the caller can pass it along.
func ExtractGrid(g *Grid, tableText string, base Row, tableIdx int, prev *compacted) ([]Row, *compacted) {
	c := compactWith(g, base)
	c.analyze()
	c.inheritHeaders(prev)
	if !c.looksLikeOwnership(tableText) {
		return nil, c
	}
	nc := c.nameCol()
	cc := c.classCol()
	ps := c.pairs()
	// A percent column with no share column of its own, sharing a class label
	// with a complete pair, is the same logical column the colspan split in a
	// way compaction could not repair. Emitting it duplicates the holder.
	if len(ps) > 1 {
		labels := map[string]bool{}
		for _, p := range ps {
			if p.shares >= 0 {
				labels[c.classLabel(p)] = true
			}
		}
		var kept []pair
		for _, p := range ps {
			if p.shares < 0 && labels[c.classLabel(p)] {
				continue
			}
			kept = append(kept, p)
		}
		ps = kept
	}
	if len(ps) == 0 {
		return nil, c
	}
	plabels := c.pairLabels(ps)
	// A class-shaped header that SPANS every pair ("Shares of Common Stock
	// Beneficially Owned and Percentage of Outstanding Shares" over a Series A, a
	// Series B and a combined-votes pair) names the security, not the column, so
	// it cannot tell the pairs apart: the pair labels have to compose with it.
	clTells := false
	for _, p := range ps {
		if c.classLabel(p) != c.classLabel(ps[0]) {
			clTells = true
		}
	}
	var out []Row
	lastName, lastSeries := "", ""
	lastClass := make([]string, len(c.hdrClassCols))
	// The same table repeated on the next page continues the fund it ended on.
	if (c.inherited || c.sameShape(prev)) && len(prev.carryClass) == len(lastClass) {
		copy(lastClass, prev.carryClass)
	}
	defer func() { c.carryClass = lastClass }()
	// The first fund's label row sits in the header block, above the column
	// headings, so the walk below would never see it.
	for i := 0; i < c.nHeader && i < len(c.rows); i++ {
		if lbl := c.seriesRowLabel(c.rows[i]); lbl != "" {
			lastSeries = lbl
		} else if lbl := c.fundLabelRow(c.rows[i]); lbl != "" {
			lastSeries = lbl
		}
		// A holder whose row carries no number of its own — the name alone,
		// with the percent on the qualifier row under it — falls inside the
		// header block, so the walk below would lose the name it continues.
		if nc < len(c.rows[i]) {
			if nm := dropAddress(holderName(c.rows[i][nc])); nm != "" &&
				hasWords(nm, 1) && !reSkipName.MatchString(nm) && !isAddressLine(nm) &&
				!reParenOnlyName.MatchString(nm) {
				lastName = nm
			}
		}
	}
	for i := c.nHeader; i < len(c.rows); i++ {
		r := c.rows[i]
		// When the funds outrun the page width a fund-family table repeats its
		// COLUMN HEADER inside itself for the next batch of funds. Without this
		// the second batch is labelled with the first batch's funds and every
		// holder is emitted twice on one key.
		if lbls, ok := c.interiorHeader(r, ps); ok {
			for k := range plabels {
				if lbls[k] != "" {
					plabels[k] = lbls[k]
				}
			}
			continue
		}
		// A full-width label row naming one of the filing's funds separates the
		// funds a single table covers. It names no holder and carries no number.
		// The declared series name wins; a fund-shaped label row is the fallback
		// for a family that declares no series at all.
		lbl := c.seriesRowLabel(r)
		if lbl == "" {
			lbl = c.fundLabelRow(r)
		}
		if lbl != "" {
			lastSeries = lbl
			for k := range lastClass {
				lastClass[k] = ""
			}
			continue
		}
		// The row-level class / fund column is written once and left blank on
		// the rows that continue the same class, so it is forward-filled —
		// before the name checks below, which may skip this row entirely.
		rowClass, rowHint := "", ""
		if cc >= 0 && cc < len(r) {
			rowClass = r[cc]
		}
		for k, j := range c.hdrClassCols {
			v := ""
			if j < len(r) {
				v = flat(r[j])
			}
			if v != "" {
				lastClass[k] = v
			}
			rowHint = withSeries(rowHint, lastClass[k])
		}
		if nc >= len(r) {
			continue
		}
		name, fns := StripFootnotes(holderName(r[nc]))
		name = dropAddress(name)
		// A 5% holder is often laid out over two grid rows: the name alone,
		// then the address with the numbers beside it.
		// ... and the second row may be a parenthesised qualifier rather than an
		// address ("(Vanguard Variable Annuity)"), which cleanHolderName later
		// strips to nothing, leaving a row with no holder at all.
		if (reAddrLine.MatchString(name) || reParenOnlyName.MatchString(name)) && lastName != "" {
			name = lastName
		} else if name != "" {
			lastName = name
		}
		// The collective label of the D&O group total is sometimes written in the
		// STUB column that names each block's population, with the HOLDER column
		// left empty. Read strictly: only the unambiguous collective labels
		// count off a cell that is not the holder column, or the stub itself
		// ("Directors (including nominees)") turns every person row into a group.
		if name == "" || !hasWords(name, 1) || reSkipName.MatchString(name) {
			rescued := ""
			for j, cell := range r {
				if j == nc || c.roles[j].role == "shares" || c.roles[j].role == "pct" {
					continue
				}
				if t := flat(cell); t != "" {
					if ok, _ := isStrongGroupRow(t); ok {
						rescued = t
						break
					}
				}
			}
			if rescued == "" {
				continue
			}
			name, fns = StripFootnotes(rescued)
		}
		// Still nothing but an address after the two recovery attempts above:
		// the cell names no holder.
		if isAddressLine(name) {
			continue
		}
		grp, gn := isGroupRow(name)
		// A class stated inside one of the row's VALUE cells qualifies the whole
		// row when no cell of a pair states one of its own.
		rowValClass := ""
		for _, cell := range r {
			if m := reClassInValue.FindString(flat(cell)); m != "" {
				rowValClass = m
				break
			}
		}
		// Two value-column pairs of ONE source row can produce records identical
		// in every field -- a "*" in both percent columns of a two-class table
		// whose header rows do not tell the pairs apart. The second is a second
		// reading of the same cell: nothing distinguishes it for any consumer,
		// and it lands on the grain key as a duplicate. Rows that differ in ANY
		// value are kept, since those are distinct holdings.
		emitted := map[string]bool{}
		for pi, p := range ps {
			// A STACKED cell holds one value per share class, on its own line,
			// in every value column of the row at once. Flattening it
			// concatenates the digits into a share count that cannot exist and
			// collapses the classes onto one key, so the lines are taken apart.
			shLines, pcLines := []string{}, []string{}
			if p.shares >= 0 && p.shares < len(r) {
				shLines = splitStack(r[p.shares])
			}
			if p.pct >= 0 && p.pct < len(r) {
				pcLines = splitStack(r[p.pct])
			}
			nsub := 1
			if len(shLines) > 1 && len(shLines) == len(pcLines) {
				nsub = len(shLines)
			}
			for sub := 0; sub < nsub; sub++ {
				shCell, pcCell := "", ""
				if p.shares >= 0 && p.shares < len(r) {
					shCell = r[p.shares]
				}
				if p.pct >= 0 && p.pct < len(r) {
					pcCell = r[p.pct]
				}
				if nsub > 1 {
					shCell, pcCell = shLines[sub], pcLines[sub]
				}
				rw := base
				rw.TableIndex = tableIdx
				rw.RowIndex = i
				rw.HolderName = name
				rw.IsGroupRow = grp
				rw.GroupN = gn
				rw.Parser = "html_dom"
				allFns := append([]string{}, fns...)
				if shCell != "" {
					if v, ok := ParseShares(shCell); ok {
						vv := v
						rw.Shares = &vv
					}
					if _, f := StripFootnotes(shCell); len(f) > 0 {
						allFns = append(allFns, f...)
					}
				}
				if pcCell != "" {
					v, ok, mk, _ := ParsePercent(pcCell)
					if ok {
						vv := v
						rw.Percent = &vv
					}
					rw.PctMarker = mk
				}
				if rw.Shares == nil && rw.Percent == nil && rw.PctMarker == "" {
					continue
				}
				cl := c.classLabel(p)
				hint := rowHint
				if nsub > 1 {
					// The class column is stacked the same way: line `sub`
					// names this sub-row's class.
					hint = subStack(hint, nsub, sub)
				}
				if cl == "" && rowClass != "" {
					cl = rowClass
				}
				// Several value column pairs per holder row and no class-shaped
				// header that TELLS THEM APART: the header row that distinguishes
				// the pairs names them, and it composes with a fund label rather
				// than replacing it.
				if cl == "" && len(ps) > 1 {
					hint = withSeries(hint, plabels[pi])
				} else if !clTells && len(ps) > 1 && plabels[pi] != "" &&
					!reScreenNonCommon.MatchString(cl) {
					// The spanning label names the security for EVERY pair, so it
					// cannot be the key. It moves onto the hint composed with the
					// label that does distinguish them, and ScreenRows copies the
					// composition onto ShareClass after the drop rules have run —
					// which is why cl is cleared only when it was not itself
					// deciding a screen.
					hint = withSeries(cl, withSeries(hint, plabels[pi]))
					cl = ""
				}
				if lastSeries != "" {
					hint = withSeries(lastSeries, hint)
					rw.seriesLocal = true
				}
				// The percent CELL may state the class the percent is OF:
				// "6.0% Class B; Beneficial". One row per class of one fund
				// otherwise lands on one key.
				vcls := reClassInValue.FindString(flat(pcCell))
				if vcls == "" {
					vcls = reClassInValue.FindString(flat(shCell))
				}
				if vcls == "" {
					// A second percent column of the same row — the holding as a
					// percentage of the FUND rather than of the class — carries
					// no class of its own, and takes the row's.
					vcls = rowValClass
				}
				if vcls != "" {
					hint = withSeries(hint, norm(vcls))
				}
				rw.ShareClass = cl
				rw.classHint = cleanClassLabel(hint)
				rw.Footnotes = strings.Join(uniq(allFns), ",")
				sig := rw.HolderName + "\x00" + rw.ShareClass + "\x00" + rw.classHint +
					"\x00" + shCell + "\x00" + pcCell + "\x00" + rw.PctMarker
				if emitted[sig] {
					continue
				}
				emitted[sig] = true
				out = append(out, rw)
			}
		}
	}
	return out, c
}

// roleVotes, when non-nil, records the per-column counters analyze() voted on.
// Set by the -debug path only; nil in the pipeline.
var roleVotes map[int]string
