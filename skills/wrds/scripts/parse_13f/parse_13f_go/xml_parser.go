package main

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// ---------------------------------------------------------------------------
// SGML header parsing — shared between XML and text mode
// ---------------------------------------------------------------------------

var (
	rePeriod      = regexp.MustCompile(`CONFORMED PERIOD OF REPORT:\s+(\d{8})`)
	reFiledDate   = regexp.MustCompile(`FILED AS OF DATE:\s+(\d{8})`)
	reSubType     = regexp.MustCompile(`CONFORMED SUBMISSION TYPE:\s+(.+)`)
	reCompanyName = regexp.MustCompile(`COMPANY CONFORMED NAME:\s+(.+)`)
	reCIK         = regexp.MustCompile(`CENTRAL INDEX KEY:\s+(\d+)`)
	reAccession   = regexp.MustCompile(`ACCESSION NUMBER:\s+(\S+)`)
)

// parseHeader extracts filing metadata from the SGML header (first ~4 KB).
func parseHeader(buf []byte) FilingMeta {
	// Use first 4096 bytes for header fields (or entire buffer if smaller).
	head := buf
	if len(head) > 4096 {
		head = head[:4096]
	}

	var meta FilingMeta

	if m := rePeriod.FindSubmatch(head); m != nil {
		meta.PeriodOfReport = string(m[1])
	}
	if m := reFiledDate.FindSubmatch(head); m != nil {
		meta.FiledDate = string(m[1])
	}
	if m := reSubType.FindSubmatch(head); m != nil {
		meta.FormType = strings.TrimSpace(string(m[1]))
	}
	if m := reCompanyName.FindSubmatch(head); m != nil {
		meta.CompanyName = strings.TrimSpace(string(m[1]))
	}
	if m := reCIK.FindSubmatch(head); m != nil {
		meta.CIK = string(m[1])
	}
	if m := reAccession.FindSubmatch(head); m != nil {
		meta.Accession = strings.TrimSpace(string(m[1]))
	}

	return meta
}

// ---------------------------------------------------------------------------
// Primary-doc XML extraction (amendment info, report type)
// ---------------------------------------------------------------------------

var (
	reFilterTitle = regexp.MustCompile(`\b(PUT|CALL|OPT|WAR)\b`)
)

// primaryDocInfo holds amendment and report-type info from primary_doc.xml.
type primaryDocInfo struct {
	IsAmendment   bool
	AmendmentType string // RESTATEMENT, NEW HOLDINGS, or ""
	ReportType    string // 13F HOLDINGS REPORT, 13F NOTICE, 13F COMBINATION REPORT
}

// extractPrimaryDoc parses the first <DOCUMENT> block for amendment metadata.
func extractPrimaryDoc(buf []byte) primaryDocInfo {
	var info primaryDocInfo

	// Find the first <DOCUMENT>...</DOCUMENT> block.
	docStart := bytes.Index(buf, []byte("<DOCUMENT>"))
	if docStart < 0 {
		return info
	}
	docEnd := bytes.Index(buf[docStart:], []byte("</DOCUMENT>"))
	if docEnd < 0 {
		return info
	}
	docBlock := buf[docStart : docStart+docEnd]

	// Find <XML>...</XML> within the first document.
	xmlStart := bytes.Index(docBlock, []byte("<XML>"))
	xmlEnd := bytes.Index(docBlock, []byte("</XML>"))
	if xmlStart < 0 || xmlEnd < 0 || xmlEnd <= xmlStart {
		return info
	}
	xmlContent := docBlock[xmlStart+len("<XML>") : xmlEnd]

	// Same charset trap as the information table. Here the casualty is quieter
	// but not harmless: a rejected primary_doc loses isAmendment,
	// amendmentType and reportType, so an amendment stops being flagged as one
	// and a 13F notice stops being recognised as a notice.
	if decodeCharset {
		xmlContent, _, _ = normalizeCharset(xmlContent)
	}

	// Parse the primary_doc XML — we only need a few fields.
	decoder := xml.NewDecoder(bytes.NewReader(xmlContent))
	decoder.Strict = false
	decoder.AutoClose = xml.HTMLAutoClose

	var inIsAmendment, inAmendmentType, inReportType bool
	for {
		tok, err := decoder.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "isAmendment":
				inIsAmendment = true
			case "amendmentType":
				inAmendmentType = true
			case "reportType":
				inReportType = true
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "isAmendment":
				inIsAmendment = false
			case "amendmentType":
				inAmendmentType = false
			case "reportType":
				inReportType = false
			}
		case xml.CharData:
			s := strings.TrimSpace(string(t))
			if s == "" {
				continue
			}
			if inIsAmendment {
				info.IsAmendment = strings.EqualFold(s, "true") || s == "Y" || s == "y"
			}
			if inAmendmentType {
				info.AmendmentType = strings.ToUpper(s)
			}
			if inReportType {
				info.ReportType = strings.ToUpper(s)
			}
		}
	}

	return info
}

// ---------------------------------------------------------------------------
// Information-table XML extraction
// ---------------------------------------------------------------------------

// parseXML parses a post-2013Q3 XML-format 13F filing.
func parseXML(buf []byte, filePath string) (*ParseResult, error) {
	meta := parseHeader(buf)
	meta.FilePath = filePath
	meta.ParseMode = "xml"
	meta.ParseStatus = "ok"

	// Extract amendment/report-type info from the primary document.
	pdi := extractPrimaryDoc(buf)

	// Check for 13F-NT (notice): no holdings to parse.
	if strings.Contains(strings.ToUpper(pdi.ReportType), "NOTICE") ||
		strings.Contains(strings.ToUpper(meta.FormType), "13F-NT") {
		meta.ParseMode = "notice"
		meta.NRows = 0
		return &ParseResult{Meta: meta}, nil
	}

	// Find the second <DOCUMENT> block (INFORMATION TABLE).
	secondDoc := findSecondDocument(buf)
	if secondDoc == nil {
		return nil, fmt.Errorf("no second DOCUMENT block (information table) found")
	}

	// Extract content between <XML> and </XML> tags in the second document.
	xmlContent := extractXMLContent(secondDoc)
	if xmlContent == nil {
		return nil, fmt.Errorf("no <XML>...</XML> content in information table document")
	}

	// Decode a legacy-encoded table before parsing. Without this, a
	// windows-1252 declaration makes encoding/xml fail on its first token and
	// the filing silently reports zero holdings — see charset.go.
	if decodeCharset {
		var charsetOK bool
		xmlContent, _, charsetOK = normalizeCharset(xmlContent)
		if !charsetOK {
			// A charset we cannot decode still loses the holdings, but it must
			// not look like a filing that simply held nothing.
			label, _, _, _ := declaredEncoding(xmlContent)
			return nil, fmt.Errorf("information table declares unsupported encoding %q", label)
		}
	}

	// Parse the information table entries.
	rows, err := parseInfoTable(xmlContent, filePath, meta, pdi)
	if err != nil {
		return nil, fmt.Errorf("parsing information table: %w", err)
	}

	meta.NRows = len(rows)

	return &ParseResult{
		Rows: rows,
		Meta: meta,
	}, nil
}

// findSecondDocument locates the second <DOCUMENT>...</DOCUMENT> block.
func findSecondDocument(buf []byte) []byte {
	firstStart := bytes.Index(buf, []byte("<DOCUMENT>"))
	if firstStart < 0 {
		return nil
	}
	firstEnd := bytes.Index(buf[firstStart:], []byte("</DOCUMENT>"))
	if firstEnd < 0 {
		return nil
	}
	after := firstStart + firstEnd + len("</DOCUMENT>")
	if after >= len(buf) {
		return nil
	}
	secondStart := bytes.Index(buf[after:], []byte("<DOCUMENT>"))
	if secondStart < 0 {
		return nil
	}
	absSecondStart := after + secondStart
	secondEnd := bytes.Index(buf[absSecondStart:], []byte("</DOCUMENT>"))
	if secondEnd < 0 {
		return nil
	}
	return buf[absSecondStart : absSecondStart+secondEnd+len("</DOCUMENT>")]
}

// extractXMLContent pulls content between <XML> and </XML> pseudo-tags,
// stripping the outer tags themselves (they are not valid XML).
func extractXMLContent(doc []byte) []byte {
	start := bytes.Index(doc, []byte("<XML>"))
	if start < 0 {
		// Try case-insensitive.
		lower := bytes.ToLower(doc)
		start = bytes.Index(lower, []byte("<xml>"))
	}
	if start < 0 {
		return nil
	}
	start += len("<XML>")

	end := bytes.Index(doc[start:], []byte("</XML>"))
	if end < 0 {
		lower := bytes.ToLower(doc[start:])
		end = bytes.Index(lower, []byte("</xml>"))
	}
	if end < 0 {
		return nil
	}
	return bytes.TrimSpace(doc[start : start+end])
}

// fastXML selects the hand-rolled information-table scanner in xml_fast.go.
// verifyFast additionally runs the encoding/xml path on every filing the
// scanner accepted and reports any divergence — the equivalence harness, not
// something to leave on in production.
// decodeCharset transcodes legacy-encoded filing XML to UTF-8 instead of
// letting encoding/xml reject it and drop the holdings. Setting it false
// reproduces the pre-fix output exactly, which is how the recovery delta was
// measured; it is not a mode anyone should run in production.
var (
	fastXML       = true
	verifyFast    = false
	decodeCharset = true
)

// parseInfoTable parses infoTable elements from the XML content.
func parseInfoTable(xmlContent []byte, filePath string, meta FilingMeta, pdi primaryDocInfo) ([]Row, error) {
	if fastXML {
		if rows, ok := parseInfoTableFast(xmlContent, filePath, meta, pdi); ok {
			if verifyFast {
				ref, err := parseInfoTableXML(xmlContent, filePath, meta, pdi)
				if err != nil || !rowsEqual(rows, ref) {
					fmt.Fprintf(os.Stderr, "FASTXML-MISMATCH\t%s\tfast=%d\tref=%d\terr=%v\n",
						filePath, len(rows), len(ref), err)
				}
			}
			return rows, nil
		}
		if verifyFast {
			fmt.Fprintf(os.Stderr, "FASTXML-FALLBACK\t%s\n", filePath)
		}
	}
	return parseInfoTableXML(xmlContent, filePath, meta, pdi)
}

// rowsEqual reports whether two row slices are identical field-for-field.
func rowsEqual(a, b []Row) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// parseInfoTableXML is the reference implementation: encoding/xml token walk.
func parseInfoTableXML(xmlContent []byte, filePath string, meta FilingMeta, pdi primaryDocInfo) ([]Row, error) {
	decoder := xml.NewDecoder(bytes.NewReader(xmlContent))
	decoder.Strict = false

	var rows []Row

	for {
		tok, err := decoder.Token()
		if err != nil {
			break // EOF or error — done
		}

		se, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}

		// Match on Local name, ignoring namespace prefix.
		if se.Name.Local != "infoTable" {
			continue
		}

		row, skip, err := parseOneInfoTable(decoder, filePath, meta, pdi)
		if err != nil {
			// Skip malformed entries but continue parsing.
			continue
		}
		if skip {
			continue
		}
		rows = append(rows, row)
	}

	return rows, nil
}

// parseOneInfoTable reads a single <infoTable> element and returns a Row.
// Returns skip=true if the row should be filtered out (PRN type or derivative title).
func parseOneInfoTable(decoder *xml.Decoder, filePath string, meta FilingMeta, pdi primaryDocInfo) (Row, bool, error) {
	var (
		nameOfIssuer         string
		titleOfClass         string
		cusipRaw             string
		value                int64
		shares               int64
		sharesType           string
		investmentDiscretion string
		otherManager         string
		votingSole           int64
		votingShared         int64
		votingNone           int64
		putCall              string
	)

	// Track nesting for sub-elements.
	var current string
	var inShrsOrPrnAmt bool
	var inVotingAuthority bool
	depth := 1 // we're inside the <infoTable> start element

	for depth > 0 {
		tok, err := decoder.Token()
		if err != nil {
			return Row{}, false, err
		}

		switch t := tok.(type) {
		case xml.StartElement:
			depth++
			local := t.Name.Local
			switch local {
			case "shrsOrPrnAmt":
				inShrsOrPrnAmt = true
				current = ""
			case "votingAuthority":
				inVotingAuthority = true
				current = ""
			default:
				current = local
			}

		case xml.EndElement:
			depth--
			local := t.Name.Local
			switch local {
			case "shrsOrPrnAmt":
				inShrsOrPrnAmt = false
			case "votingAuthority":
				inVotingAuthority = false
			}
			current = ""

		case xml.CharData:
			s := strings.TrimSpace(string(t))
			if s == "" {
				continue
			}
			// Sanitize interior tabs/newlines that would corrupt TSV output.
			s = strings.ReplaceAll(s, "\t", " ")
			s = strings.ReplaceAll(s, "\n", " ")

			switch {
			case current == "nameOfIssuer":
				nameOfIssuer = s
			case current == "titleOfClass":
				titleOfClass = s
			case current == "cusip":
				cusipRaw = s
			case current == "value":
				value, _ = strconv.ParseInt(s, 10, 64)
			case inShrsOrPrnAmt && current == "sshPrnamt":
				shares, _ = strconv.ParseInt(s, 10, 64)
			case inShrsOrPrnAmt && current == "sshPrnamtType":
				sharesType = strings.ToUpper(s)
			case current == "investmentDiscretion":
				investmentDiscretion = strings.ToUpper(s)
			case current == "putCall":
				putCall = strings.ToUpper(s)
			case current == "otherManager":
				otherManager = s
			case inVotingAuthority && (current == "Sole" || current == "sole"):
				votingSole, _ = strconv.ParseInt(s, 10, 64)
			case inVotingAuthority && (current == "Shared" || current == "shared"):
				votingShared, _ = strconv.ParseInt(s, 10, 64)
			case inVotingAuthority && (current == "None" || current == "none"):
				votingNone, _ = strconv.ParseInt(s, 10, 64)
			}
		}
	}

	// Filter: skip principal/bond rows.
	if sharesType == "PRN" {
		return Row{}, true, nil
	}

	// Filter: skip options (PUT/CALL) rows.
	if putCall != "" {
		return Row{}, true, nil
	}

	// Filter: skip derivative titles (PUT, CALL, OPT, WAR).
	if reFilterTitle.MatchString(strings.ToUpper(titleOfClass)) {
		return Row{}, true, nil
	}

	// Normalize CUSIP.
	cusip9, cusip8, cusip6, cusipValid := normalizeCUSIP(cusipRaw)

	row := Row{
		FilePath:             filePath,
		Accession:            meta.Accession,
		CIK:                  meta.CIK,
		PeriodOfReport:       meta.PeriodOfReport,
		FiledDate:            meta.FiledDate,
		FormType:             meta.FormType,
		NameOfIssuer:         nameOfIssuer,
		TitleOfClass:         titleOfClass,
		CUSIP9:               cusip9,
		CUSIP8:               cusip8,
		CUSIP6:               cusip6,
		Value:                value,
		Shares:               shares,
		SharesType:           sharesType,
		InvestmentDiscretion: investmentDiscretion,
		OtherManager:         otherManager,
		VotingSole:           votingSole,
		VotingShared:         votingShared,
		VotingNone:           votingNone,
		CUSIPValid:           cusipValid,
		IsAmendment:          pdi.IsAmendment,
		AmendmentType:        pdi.AmendmentType,
		ParseMode:            "xml",
	}

	return row, false, nil
}
