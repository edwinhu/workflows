package main

import (
	"bufio"
	"encoding/xml"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

// The modern N-PX era (Rule 30b1-4 amendments, filings from mid-2024) ships two
// XML payloads inside one EDGAR dissemination file: primary_doc.xml, carrying
// periodOfReport and the series/class registry, and a proxyVoteTable carrying
// one <proxyTable> per meeting agenda item.
//
// Two properties drive every decision below.
//
// Segmentation is by <TYPE>, never by position. parse_13f takes document 1 as
// the header and document 2 as the table; N-PX filers order their documents
// freely, and a positional read silently parses the wrong one. The <TYPE> line
// is the only reliable discriminator.
//
// Nothing is ever buffered whole. A filing runs 10-200 MB and carries tens of
// thousands of records, and the worker pool multiplies whatever one worker holds
// by the concurrency. The dissemination file is walked line by line off a
// bufio.Reader, each XML payload is handed to an xml.Decoder as a bounded
// section of that same stream, and rows leave through the caller's emit callback
// as they are decoded. Peak memory is one <proxyTable>, not one filing.

// ---------------------------------------------------------------------------
// Line-level walk of the dissemination file
// ---------------------------------------------------------------------------

// xmlLineBuf bounds a single line. Lines longer than this are handed on in
// fragments rather than grown into, which is what keeps a filing that ships its
// whole payload on one line from being read into memory.
const xmlLineBuf = 256 << 10

// lineSrc yields the input one line at a time, with one line of pushback.
type lineSrc struct {
	br   *bufio.Reader
	push []byte
	has  bool
	mid  bool // the previous chunk ended mid-line
}

func newLineSrc(r io.Reader) *lineSrc {
	if br, ok := r.(*bufio.Reader); ok && br.Size() >= xmlLineBuf {
		return &lineSrc{br: br}
	}
	return &lineSrc{br: bufio.NewReaderSize(r, xmlLineBuf)}
}

// next returns the next chunk of input. The slice is valid only until the next
// call. atLineStart is true only when the chunk is a whole line that began at a
// line boundary; a fragment of an over-long line must never be tested against a
// section marker, or a marker-shaped substring inside a payload would end the
// section early.
func (l *lineSrc) next() (line []byte, atLineStart bool, err error) {
	if l.has {
		l.has = false
		return l.push, true, nil
	}
	wasMid := l.mid
	b, err := l.br.ReadSlice('\n')
	switch {
	case err == bufio.ErrBufferFull:
		l.mid = true
		return b, false, nil
	case err != nil && len(b) > 0:
		// Final line with no trailing newline.
		l.mid = false
		return b, !wasMid, nil
	case err != nil:
		l.mid = false
		return nil, false, err
	}
	l.mid = false
	return b, !wasMid, nil
}

// unread pushes one whole line back, so the caller that recognised a payload's
// first line can still hand that line to the decoder.
func (l *lineSrc) unread(line []byte) {
	l.push = append(l.push[:0], line...)
	l.has = true
}

// sectionEnders close an embedded payload. All are SGML dissemination
// pseudo-tags, which are uppercase; XML element names in these filings are not.
var sectionEnders = []string{"</XML>", "</TEXT>", "</DOCUMENT>", "</SEC-DOCUMENT>"}

func isSectionEnd(line []byte) bool {
	t := strings.ToUpper(strings.TrimSpace(string(line)))
	for _, e := range sectionEnders {
		if t == e {
			return true
		}
	}
	return false
}

// section is an io.Reader over one embedded payload. It reports EOF at the
// payload's closing pseudo-tag and leaves the underlying lineSrc positioned just
// past it, so the walk can continue to the next <DOCUMENT>.
type section struct {
	src  *lineSrc
	buf  []byte
	off  int
	done bool
}

func (s *section) Read(p []byte) (int, error) {
	for s.off >= len(s.buf) {
		if s.done {
			return 0, io.EOF
		}
		line, atLineStart, err := s.src.next()
		if err != nil {
			s.done = true
			return 0, io.EOF
		}
		if atLineStart && isSectionEnd(line) {
			s.done = true
			return 0, io.EOF
		}
		s.buf = append(s.buf[:0], line...)
		s.off = 0
	}
	n := copy(p, s.buf[s.off:])
	s.off += n
	return n, nil
}

// drain consumes whatever the decoder left behind, so the next <DOCUMENT> is
// found from the right place. A decoder stops at the end of its root element and
// routinely leaves the closing pseudo-tags unread.
func (s *section) drain() {
	var sink [4096]byte
	for !s.done {
		if _, err := s.Read(sink[:]); err != nil {
			return
		}
	}
}

// nextDocument advances to the payload of the next <DOCUMENT> block and returns
// that block's <TYPE> value. ok is false at end of input.
func nextDocument(src *lineSrc) (docType string, ok bool) {
	inDoc := false
	for {
		line, atLineStart, err := src.next()
		if err != nil {
			return "", false
		}
		if !atLineStart {
			continue
		}
		t := strings.TrimSpace(string(line))
		up := strings.ToUpper(t)
		switch {
		case up == "<DOCUMENT>":
			inDoc, docType = true, ""
		case up == "</DOCUMENT>":
			inDoc, docType = false, ""
		case inDoc && strings.HasPrefix(up, "<TYPE>"):
			docType = strings.TrimSpace(t[len("<TYPE>"):])
		case inDoc && up == "<XML>":
			return docType, true
		case inDoc && looksLikeXMLStart(t):
			// Some filers omit the <XML> pseudo-tag around the payload.
			src.unread(line)
			return docType, true
		}
	}
}

func looksLikeXMLStart(t string) bool {
	for _, p := range []string{"<?xml", "<edgarSubmission", "<proxyVoteTable", "<proxyTable"} {
		if strings.HasPrefix(t, p) {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Decoder plumbing
// ---------------------------------------------------------------------------

func newXMLDecoder(r io.Reader) *xml.Decoder {
	d := xml.NewDecoder(r)
	// Filers emit HTML entities and the occasional unmatched tag inside
	// otherwise well-formed payloads. Refusing the whole filing over one of
	// those would drop tens of thousands of good vote records.
	d.Strict = false
	d.CharsetReader = xmlCharsetReader
	return d
}

// xmlCharsetReader transcodes a declared single-byte payload on the fly. The
// whole-buffer normalizeCharset cannot be used here: it would require the
// document in memory, which is the one thing this parser must not do.
func xmlCharsetReader(label string, in io.Reader) (io.Reader, error) {
	switch classifyCharset(label) {
	case charsetUTF8, charsetUndeclared:
		return in, nil
	case charsetCP1252:
		return &singleByteReader{r: bufio.NewReader(in), cp1252: true}, nil
	case charsetLatin1:
		return &singleByteReader{r: bufio.NewReader(in), cp1252: false}, nil
	}
	return nil, fmt.Errorf("unsupported declared encoding %q", label)
}

// singleByteReader widens each byte of a cp1252 or latin-1 stream to UTF-8.
type singleByteReader struct {
	r      *bufio.Reader
	cp1252 bool
	pend   [4]byte
	have   int
	off    int
}

func (s *singleByteReader) Read(p []byte) (int, error) {
	n := 0
	for n < len(p) {
		if s.off < s.have {
			p[n] = s.pend[s.off]
			s.off++
			n++
			continue
		}
		b, err := s.r.ReadByte()
		if err != nil {
			if n > 0 {
				return n, nil
			}
			return 0, err
		}
		if b < 0x80 {
			p[n] = b
			n++
			continue
		}
		r := rune(b)
		if s.cp1252 && b <= 0x9f {
			r = cp1252High[b-0x80]
		}
		s.have = utf8.EncodeRune(s.pend[:], r)
		s.off = 0
	}
	return n, nil
}

// walkChildren consumes the children of the element whose StartElement was just
// read, calling fn for each direct child, and returns after that element's
// EndElement. fn must consume its child's subtree, either by decoding it or by
// calling Decoder.Skip.
//
// Matching happens on Name.Local throughout, so a document using any namespace
// prefix (or none) decodes identically.
func walkChildren(d *xml.Decoder, fn func(xml.StartElement) error) error {
	for {
		tok, err := d.Token()
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if err := fn(t); err != nil {
				return err
			}
		case xml.EndElement:
			return nil
		}
	}
}

func elemText(d *xml.Decoder, se xml.StartElement) (string, error) {
	var v string
	if err := d.DecodeElement(&v, &se); err != nil {
		return "", err
	}
	return strings.TrimSpace(v), nil
}

// assign decodes a leaf element into dst, leaving an already-populated dst alone
// when the element is empty so a trailing duplicate cannot erase a real value.
func assign(d *xml.Decoder, se xml.StartElement, dst *string) error {
	v, err := elemText(d, se)
	if err != nil {
		return err
	}
	if v != "" {
		*dst = v
	}
	return nil
}

// ---------------------------------------------------------------------------
// The record grammar
// ---------------------------------------------------------------------------

// voteRecord is one manager's vote on an agenda item: the innermost repeating
// element, and the grain of a VoteRow.
type voteRecord struct {
	HowVoted                 string
	SharesVoted              string
	ManagementRecommendation string
}

// proxyRecord is one <proxyTable>: an agenda item at one meeting, plus the
// per-manager votes cast on it.
type proxyRecord struct {
	IssuerName           string
	CUSIP                string
	ISIN                 string
	FIGI                 string
	Ticker               string
	MeetingDate          string
	VoteDescription      string
	Categories           []string
	OtherVoteDescription string
	VoteSource           string
	SharesVotedTotal     string
	SharesOnLoan         string
	OtherManagers        []string
	VoteSeries           string
	VoteOtherInfo        string
	Votes                []voteRecord
}

func (rec *proxyRecord) decode(d *xml.Decoder) error {
	return walkChildren(d, func(se xml.StartElement) error {
		switch se.Name.Local {
		case "issuerName":
			return assign(d, se, &rec.IssuerName)
		case "cusip":
			return assign(d, se, &rec.CUSIP)
		case "isin":
			return assign(d, se, &rec.ISIN)
		case "figi":
			return assign(d, se, &rec.FIGI)
		case "ticker":
			return assign(d, se, &rec.Ticker)
		case "meetingDate":
			v, err := elemText(d, se)
			if err != nil {
				return err
			}
			if v != "" {
				rec.MeetingDate = xmlDate(v)
			}
			return nil
		case "voteDescription":
			return assign(d, se, &rec.VoteDescription)
		case "otherVoteDescription":
			return assign(d, se, &rec.OtherVoteDescription)
		case "voteSource":
			return assign(d, se, &rec.VoteSource)
		case "sharesVoted":
			// Record level, not vote level: the shares the item was voted on.
			return assign(d, se, &rec.SharesVotedTotal)
		case "sharesOnLoan":
			return assign(d, se, &rec.SharesOnLoan)
		case "voteSeries":
			return assign(d, se, &rec.VoteSeries)
		case "voteOtherInfo":
			return assign(d, se, &rec.VoteOtherInfo)
		case "voteCategories":
			return rec.decodeCategories(d)
		case "vote":
			return rec.decodeVotes(d)
		case "voteRecord":
			// Filers that omit the <vote> wrapper.
			return rec.decodeVoteRecord(d)
		case "voteManager":
			return rec.decodeManager(d)
		case "otherManagers":
			return rec.decodeOtherManagers(d)
		default:
			return d.Skip()
		}
	})
}

func (rec *proxyRecord) addCategory(d *xml.Decoder, se xml.StartElement) error {
	v, err := elemText(d, se)
	if err != nil {
		return err
	}
	if v != "" {
		rec.Categories = append(rec.Categories, v)
	}
	return nil
}

func (rec *proxyRecord) decodeCategories(d *xml.Decoder) error {
	return walkChildren(d, func(se xml.StartElement) error {
		switch se.Name.Local {
		case "categoryType":
			return rec.addCategory(d, se)
		case "voteCategory":
			return walkChildren(d, func(in xml.StartElement) error {
				if in.Name.Local == "categoryType" {
					return rec.addCategory(d, in)
				}
				return d.Skip()
			})
		default:
			return d.Skip()
		}
	})
}

func (rec *proxyRecord) decodeVotes(d *xml.Decoder) error {
	return walkChildren(d, func(se xml.StartElement) error {
		if se.Name.Local == "voteRecord" {
			return rec.decodeVoteRecord(d)
		}
		return d.Skip()
	})
}

func (rec *proxyRecord) decodeVoteRecord(d *xml.Decoder) error {
	var v voteRecord
	err := walkChildren(d, func(se xml.StartElement) error {
		switch se.Name.Local {
		case "howVoted":
			return assign(d, se, &v.HowVoted)
		case "sharesVoted":
			return assign(d, se, &v.SharesVoted)
		case "managementRecommendation":
			return assign(d, se, &v.ManagementRecommendation)
		default:
			return d.Skip()
		}
	})
	if err != nil {
		return err
	}
	rec.Votes = append(rec.Votes, v)
	return nil
}

func (rec *proxyRecord) decodeManager(d *xml.Decoder) error {
	return walkChildren(d, func(se xml.StartElement) error {
		switch se.Name.Local {
		case "otherManagers":
			return rec.decodeOtherManagers(d)
		case "otherManager":
			return rec.addManager(d, se)
		case "voteSeries":
			return assign(d, se, &rec.VoteSeries)
		case "voteOtherInfo":
			return assign(d, se, &rec.VoteOtherInfo)
		default:
			return d.Skip()
		}
	})
}

func (rec *proxyRecord) decodeOtherManagers(d *xml.Decoder) error {
	return walkChildren(d, func(se xml.StartElement) error {
		if se.Name.Local == "otherManager" {
			return rec.addManager(d, se)
		}
		return d.Skip()
	})
}

func (rec *proxyRecord) addManager(d *xml.Decoder, se xml.StartElement) error {
	v, err := elemText(d, se)
	if err != nil {
		return err
	}
	if v != "" {
		rec.OtherManagers = append(rec.OtherManagers, v)
	}
	return nil
}

// emitRows hands one VoteRow per <voteRecord> to emit, each carrying the whole
// enclosing <proxyTable>. The record-level fields are only complete once the
// element has closed — voteManager, voteSeries and voteOtherInfo follow the
// votes in real filings — so the votes of one proxyTable, and only those, are
// held until then.
func (rec *proxyRecord) emitRows(meta *FilingMeta, classes map[string][]string, emit func(VoteRow) error) (int, error) {
	base := VoteRow{
		FilePath:             meta.FilePath,
		SeriesID:             rec.VoteSeries,
		IssuerName:           rec.IssuerName,
		CUSIP:                rec.CUSIP,
		ISIN:                 rec.ISIN,
		FIGI:                 rec.FIGI,
		Ticker:               rec.Ticker,
		MeetingDate:          rec.MeetingDate,
		VoteDescription:      rec.VoteDescription,
		VoteCategories:       strings.Join(rec.Categories, MultiValueSep),
		OtherVoteDescription: rec.OtherVoteDescription,
		VoteSource:           rec.VoteSource,
		SharesVotedTotal:     rec.SharesVotedTotal,
		SharesOnLoan:         rec.SharesOnLoan,
		OtherManagers:        strings.Join(rec.OtherManagers, MultiValueSep),
		VoteOtherInfo:        rec.VoteOtherInfo,
		ParseMode:            "xml",
	}
	// primary_doc.xml precedes the vote table in every filing observed, so its
	// series/class registry is available by the time rows are built. A filing
	// that inverts the order still parses; those rows simply carry no class ids
	// from the payload, and the chassis stamps them from the SGML header.
	if rec.VoteSeries != "" {
		if ids := classes[rec.VoteSeries]; len(ids) > 0 {
			base.ClassIDs = strings.Join(ids, MultiValueSep)
		}
	}

	// An agenda item with no <voteRecord> is still an agenda item: the fund held
	// the position and the item was on the ballot, and 7.5% of items arrive this
	// way, filer-correlated, some carrying six-figure share counts at the record
	// level. Dropping it makes an item nobody reported a vote on indistinguishable
	// from an item the fund never held. The row carries the record-level fields
	// and leaves the three voteRecord-level ones empty, which is what marks it as
	// carrying no vote breakdown rather than a vote of zero.
	if len(rec.Votes) == 0 {
		if err := emit(base); err != nil {
			return 0, err
		}
		return 1, nil
	}

	n := 0
	for _, v := range rec.Votes {
		row := base
		row.HowVoted = v.HowVoted
		row.SharesVoted = v.SharesVoted
		row.ManagementRecommendation = v.ManagementRecommendation
		if err := emit(row); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// ---------------------------------------------------------------------------
// Payload parsers
// ---------------------------------------------------------------------------

// parsePrimaryDoc reads periodOfReport and the seriesId-to-classId registry.
// The elements are matched wherever they sit, because filers nest seriesClass
// under headerData in some schema revisions and flat in others.
func parsePrimaryDoc(r io.Reader, meta *FilingMeta, classes map[string][]string) error {
	d := newXMLDecoder(r)
	series := ""
	for {
		tok, err := d.Token()
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
		se, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		switch se.Name.Local {
		case "periodOfReport":
			v, err := elemText(d, se)
			if err != nil {
				return err
			}
			if v != "" {
				meta.PeriodOfReport = xmlDate(v)
			}
		case "seriesId":
			v, err := elemText(d, se)
			if err != nil {
				return err
			}
			if v != "" {
				series = v
				if _, seen := classes[series]; !seen {
					classes[series] = nil
				}
			}
		case "classId":
			v, err := elemText(d, se)
			if err != nil {
				return err
			}
			if series != "" && v != "" {
				classes[series] = append(classes[series], v)
			}
		}
	}
}

// parseVoteTable streams <proxyTable> elements, decoding and releasing each one
// before the next is read.
func parseVoteTable(r io.Reader, meta *FilingMeta, classes map[string][]string, emit func(VoteRow) error) (int, error) {
	d := newXMLDecoder(r)
	total := 0
	for {
		tok, err := d.Token()
		if err != nil {
			if err == io.EOF {
				return total, nil
			}
			return total, err
		}
		se, ok := tok.(xml.StartElement)
		if !ok || se.Name.Local != "proxyTable" {
			continue
		}
		var rec proxyRecord
		if err := rec.decode(d); err != nil {
			return total, err
		}
		n, err := rec.emitRows(meta, classes, emit)
		total += n
		if err != nil {
			return total, err
		}
	}
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// docTypeVoteTable and docTypePrimary are the <TYPE> values that select a
// payload. Matching on TYPE rather than on document order is deliberate: filers
// order documents freely and a positional read silently parses the wrong one.
const (
	docTypeVoteTable = "PROXY VOTING RECORD"
	docTypePrimary   = "N-PX"
)

// parseNPXXML streams the modern XML era off r, calling emit once per
// <voteRecord>, and fills meta from primary_doc.xml. It returns the row count.
//
// A filing carrying no PROXY VOTING RECORD document is an error, not zero rows.
// Zero-rows-and-nil is the manifest's encoding for a fund that genuinely had
// nothing to vote; a modern filing whose vote table is absent, misnamed or
// unreachable is a parser or feed failure, and collapsing the two would destroy
// the one distinction the manifest exists to preserve.
func parseNPXXML(r io.Reader, meta *FilingMeta, emit func(VoteRow) error) (int, error) {
	src := newLineSrc(r)
	classes := map[string][]string{}
	total := 0
	sawVoteTable := false

	for {
		docType, ok := nextDocument(src)
		if !ok {
			break
		}
		sec := &section{src: src}

		up := strings.ToUpper(strings.Join(strings.Fields(docType), " "))
		var err error
		switch {
		case strings.Contains(up, docTypeVoteTable):
			sawVoteTable = true
			var n int
			n, err = parseVoteTable(sec, meta, classes, emit)
			total += n
		case strings.HasPrefix(up, docTypePrimary):
			err = parsePrimaryDoc(sec, meta, classes)
		}

		sec.drain()
		if err != nil {
			return total, err
		}
	}

	if meta.ParseMode == "" || meta.ParseMode == "none" {
		meta.ParseMode = "xml"
	}
	if !sawVoteTable {
		return total, fmt.Errorf("no <DOCUMENT> with <TYPE>%s found", docTypeVoteTable)
	}
	return total, nil
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

// xmlDate normalizes the date spellings the XML era actually uses onto the
// YYYYMMDD the schema declares: MM/DD/YYYY, YYYY-MM-DD, an ISO timestamp, and
// an already-normalized YYYYMMDD. A value it cannot place is recorded as
// missing rather than written through, so the column never mixes formats.
func xmlDate(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if i := strings.IndexAny(s, "T "); i > 0 {
		s = s[:i]
	}

	parts := strings.FieldsFunc(s, func(r rune) bool {
		return r == '/' || r == '-' || r == '.'
	})
	if len(parts) == 1 {
		if len(s) == 8 && allDigits(s) {
			return s
		}
		return ""
	}
	if len(parts) != 3 {
		return ""
	}
	for _, p := range parts {
		if p == "" || !allDigits(p) {
			return ""
		}
	}

	var y, m, dd string
	if len(parts[0]) == 4 {
		y, m, dd = parts[0], parts[1], parts[2]
	} else {
		m, dd, y = parts[0], parts[1], parts[2]
	}
	if len(y) == 2 {
		// A two-digit year in a proxy-vote filing is never the 2050s.
		if y < "50" {
			y = "20" + y
		} else {
			y = "19" + y
		}
	}
	if len(y) != 4 || len(m) > 2 || len(dd) > 2 {
		return ""
	}
	return y + pad2(m) + pad2(dd)
}

func allDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return len(s) > 0
}

func pad2(s string) string {
	if len(s) == 1 {
		return "0" + s
	}
	return s
}
