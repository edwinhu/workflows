package main

import "strings"

// A free-standing footnote sentence is the only fund evidence some htmltable
// filings print. Ziegler Lotsoff Capital Management Investment Trust 2012
// (CIK 1261788, accession 0001398344-12-002719) declares exactly two series and
// prints two vote tables with no masthead over either: 296 actually-voted rows,
// then `The Micro Cap Fund was liquidated and ceased operations after the close
// of trading on November 15, 2011.`, then 22 rows whose every Vote cell is `*`,
// then `* The Adviser did not vote any proxies on behalf of the Long/Short
// Credit Fund during the reporting period.` Every row of the filing came out
// with no series at all, and the liquidation sentence was read as a MASTHEAD --
// `Micro Cap Fund` stands inside it, so the tolerant resolver answered for the
// whole sentence -- which stamped the second table with the first fund's id.
//
// Both readings below are deliberately narrow. A footnote is refused as a
// masthead by its sentence shape (htmlFundFootnoteSentence), and it attributes a
// table only under conditions the filing itself proves: exactly two declared
// series, not one row naming a fund anywhere, and exactly two such footnotes
// naming the two distinct series, one of which disclaims votes outright.

// htmlDisclaimerPhrases are the statements a footnote makes about a fund's own
// (absence of) voting activity. They are what distinguishes a prose sentence
// about a fund from a banner that names one: a masthead states no fact.
var htmlDisclaimerPhrases = [...]string{
	"was liquidated", "were liquidated", "ceased operations",
	"did not vote any prox", "voted no prox", "no proxies were voted",
	"held no voting securities",
}

// htmlDisclaimerNoVote are the phrases that disclaim votes outright, as opposed
// to merely reporting what became of the fund. One footnote of a filing must say
// this much before anything positional is read from the set.
var htmlDisclaimerNoVote = [...]string{
	"did not vote any prox", "voted no prox", "no proxies were voted",
	"held no voting securities",
}

// htmlFootnoteMinWords is how many words a line must carry before it can be a
// footnote sentence rather than a banner. A masthead is a name; these sentences
// run to a dozen words and more.
const htmlFootnoteMinWords = 6

// htmlFundFootnoteSentence reports a line that is a complete prose statement
// about a fund's voting activity: a full sentence, long enough not to be a name,
// carrying one of the phrases above. It is asked of every candidate heading, so
// a sentence like the liquidation footnote never opens a section however well
// the series index answers for the name standing inside it.
func htmlFundFootnoteSentence(line string) bool {
	line = strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(line), "*†‡§"))
	if !strings.HasSuffix(line, ".") || len(strings.Fields(line)) < htmlFootnoteMinWords {
		return false
	}
	low := strings.ToLower(line)
	for _, p := range htmlDisclaimerPhrases {
		if strings.Contains(low, p) {
			return true
		}
	}
	return false
}

// htmlFundNote is one footnote sentence: the fund it names as the filing spelled
// it, the declared series that name resolves to, whether the sentence disclaims
// votes outright, and where in the document body the sentence stands.
type htmlFundNote struct {
	off        int
	id         string
	fund       string
	disclaimed bool
}

// htmlFootnoteFundClauses cut the trailing period clause off the fund name a
// `on behalf of ...` disclaimer prints.
var htmlFootnoteFundClauses = [...]string{" during ", " for the ", " in the ", " throughout "}

// htmlFootnoteFund reads the fund a footnote sentence names, in the two shapes
// measured: the subject of a liquidation statement, and the object of an
// `on behalf of` disclaimer. disclaimed reports the second.
func htmlFootnoteFund(line string) (fund string, disclaimed, ok bool) {
	line = strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(line), "*†‡§"))
	low := strings.ToLower(line)
	for _, p := range htmlDisclaimerNoVote {
		if !strings.Contains(low, p) {
			continue
		}
		i := strings.Index(low, "behalf of ")
		if i < 0 {
			return "", false, false
		}
		fund = line[i+len("behalf of "):]
		lowFund := strings.ToLower(fund)
		for _, clause := range htmlFootnoteFundClauses {
			if k := strings.Index(lowFund, clause); k > 0 {
				fund = fund[:k]
				break
			}
		}
		return htmlFootnoteFundName(fund), true, true
	}
	for _, p := range [...]string{" was liquidated", " were liquidated", " ceased operations"} {
		if i := strings.Index(low, p); i > 0 {
			return htmlFootnoteFundName(line[:i]), false, true
		}
	}
	return "", false, false
}

// htmlFootnoteFundName trims the sentence furniture off the name: the article the
// prose carries and the punctuation the clause ends on.
func htmlFootnoteFundName(fund string) string {
	fund = strings.TrimSpace(strings.Trim(strings.TrimSpace(fund), ".,;:"))
	if rest, cut := strings.CutPrefix(fund, "The "); cut {
		fund = rest
	} else if rest, cut := strings.CutPrefix(fund, "the "); cut {
		fund = rest
	}
	return strings.TrimSpace(fund)
}

// htmlFootnoteFundSeries resolves a footnote's short fund name against the
// filing's OWN <SERIES-NAME> declarations and nothing wider: the name must equal
// a declared name or end it on a token boundary (`Micro Cap Fund` for
// `LOTSOFF CAPITAL MANAGEMENT MICRO CAP FUND`), and exactly one series may
// answer. Two answering refuses -- a footnote is not evidence enough to pick
// between siblings.
func htmlFootnoteFundSeries(decls []SeriesDecl, fund string) string {
	key := normalizeSeriesName(fund)
	if key == "" {
		return ""
	}
	id := ""
	for i := range decls {
		if decls[i].SeriesID == "" || decls[i].Name == "" {
			continue
		}
		name := normalizeSeriesName(decls[i].Name)
		if name != key && !strings.HasSuffix(name, " "+key) {
			continue
		}
		if id != "" && id != decls[i].SeriesID {
			return ""
		}
		id = decls[i].SeriesID
	}
	return id
}

// htmlBlockTags close a block of text. A footnote is a block of its own, so the
// text between two of these closers is what the reading below is asked about --
// and it must be the WHOLE of that text, which is what keeps a sentence printed
// inside a table cell or beside other prose from being read as one.
var htmlBlockTags = map[string]bool{
	"div": true, "p": true, "td": true, "th": true, "tr": true, "table": true,
	"li": true, "blockquote": true, "center": true, "body": true,
	"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true,
}

// htmlCloseTagEnd reads the closing tag that starts at i (`</div>`) and returns
// its lowercased name and the offset just past its `>`.
func htmlCloseTagEnd(body []byte, i int) (name string, end int) {
	j := i + len("</")
	for j < len(body) && isNameByte(body[j]) {
		j++
	}
	name = strings.ToLower(string(body[i+len("</") : j]))
	for j < len(body) && body[j] != '>' {
		j++
	}
	if j < len(body) {
		j++
	}
	return name, j
}

// htmlFootnoteNotes reads the document's footnote sentences in order, each with
// the offset of the block it stands in. The decoded block must be the sentence
// and nothing else.
func htmlFootnoteNotes(body []byte, decls []SeriesDecl) []htmlFundNote {
	var notes []htmlFundNote
	consider := func(seg []byte, off int) {
		if len(seg) == 0 {
			return
		}
		text := htmlPreText(seg)
		if !htmlFundFootnoteSentence(text) {
			return
		}
		fund, disclaimed, ok := htmlFootnoteFund(text)
		if !ok {
			return
		}
		if id := htmlFootnoteFundSeries(decls, fund); id != "" {
			notes = append(notes, htmlFundNote{off: off, id: id, fund: fund, disclaimed: disclaimed})
		}
	}
	start := 0
	for i := 0; i < len(body); {
		j := indexFrom(body, i, "</")
		if j < 0 {
			break
		}
		name, end := htmlCloseTagEnd(body, j)
		if !htmlBlockTags[name] {
			i = j + len("</")
			continue
		}
		consider(body[start:end], start)
		start, i = end, end
	}
	consider(body[start:], start)
	return notes
}

// htmlStampFootnoteAttributedTables attributes the tables of a filing that names
// its funds ONLY in the footnotes printed after them.
//
// Every condition is the filing's own evidence, and all of them are required:
// exactly two declared series; not one row of the filing naming a fund or
// carrying a series, so nothing positional is overriding a printed masthead;
// exactly two footnote sentences resolving to those two DISTINCT series; at
// least one of them disclaiming votes outright, which is what makes the other
// table's fund an elimination rather than a guess; every row standing above the
// last footnote; and each footnote standing over rows of its own. A footnote
// about a fund follows that fund's table, so the rows since the footnote before
// it are its own -- and with two funds and two tables the assignment is forced.
//
// Anything else -- three footnotes, three series, a row after the last footnote,
// a footnote naming a series another one already named -- refuses and leaves the
// rows blank, because a wrong series id is worse than none.
func htmlStampFootnoteAttributedTables(out []VoteRow, rowOff []int, body []byte, decls []SeriesDecl) {
	if len(out) == 0 || len(rowOff) != len(out) {
		return
	}
	ids := map[string]bool{}
	for i := range decls {
		if decls[i].SeriesID != "" {
			ids[decls[i].SeriesID] = true
		}
	}
	if len(ids) != 2 {
		return
	}
	for i := range out {
		if out[i].SeriesID != "" || out[i].FundName != "" {
			return
		}
	}
	notes := htmlFootnoteNotes(body, decls)
	if len(notes) != 2 || notes[0].id == notes[1].id {
		return
	}
	if !notes[0].disclaimed && !notes[1].disclaimed {
		return
	}
	var above [2]int
	prev := 0
	for k, n := range notes {
		for _, off := range rowOff {
			if off >= prev && off < n.off {
				above[k]++
			}
		}
		prev = n.off
	}
	if above[0] == 0 || above[1] == 0 || above[0]+above[1] != len(out) {
		return
	}
	prev = 0
	for _, n := range notes {
		for i := range out {
			if rowOff[i] >= prev && rowOff[i] < n.off {
				out[i].SeriesID, out[i].FundName = n.id, n.fund
			}
		}
		prev = n.off
	}
}
