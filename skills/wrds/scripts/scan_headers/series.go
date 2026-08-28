package main

import (
	"bufio"
	"bytes"
	"regexp"
	"strings"
)

// The SGML header of a 40-Act filing carries a series/class block. Series IDs
// became mandatory for N-1A/N-3/N-4/N-6 registrants on 2006-02-06, so this
// reaches four years further back than the SEC's published series/class
// masters, which are annual snapshots of then-active registrants from 2010.
//
//	<SERIES-AND-CLASSES-CONTRACTS-DATA>
//	 <EXISTING-SERIES-AND-CLASSES-CONTRACTS>
//	  <SERIES>
//	   <OWNER-CIK>0000021832
//	   <SERIES-ID>S000010817
//	   <SERIES-NAME>Columbia Connecticut Municipal Reserves
//	   <CLASS-CONTRACT>
//	    <CLASS-CONTRACT-ID>C000030030
//	    <CLASS-CONTRACT-NAME>G Trust Shares
//	    <CLASS-CONTRACT-TICKER-SYMBOL>CCTXX
//
// A registrant files for dozens of series at once, so every triple is emitted;
// a first-match regex silently drops all but one.
var (
	reOwnerCIK    = regexp.MustCompile(`(?i)<OWNER-CIK>\s*([0-9]+)`)
	reSeriesID    = regexp.MustCompile(`(?i)<SERIES-ID>\s*(S[0-9]{9})`)
	reSeriesName  = regexp.MustCompile(`(?i)<SERIES-NAME>\s*(.*)`)
	reClassID     = regexp.MustCompile(`(?i)<CLASS-CONTRACT-ID>\s*(C[0-9]{9})`)
	reClassName   = regexp.MustCompile(`(?i)<CLASS-CONTRACT-NAME>\s*(.*)`)
	reClassTicker = regexp.MustCompile(`(?i)<CLASS-CONTRACT-TICKER-SYMBOL>\s*(.*)`)
	reSeriesEnd   = regexp.MustCompile(`(?i)</SERIES>`)
	reClassEnd    = regexp.MustCompile(`(?i)</CLASS-CONTRACT>`)
)

// seriesRow is one (filing, series, class) triple. A series carrying no class
// contract emits one row with the class fields empty rather than vanishing.
type seriesRow struct {
	path, accession, formType, filedDate string
	ownerCIK, seriesID, seriesName       string
	classID, className, classTicker      string
}

func (r seriesRow) fields() []string {
	return []string{
		r.path, r.accession, r.formType, r.filedDate, r.ownerCIK,
		r.seriesID, r.seriesName, r.classID, r.className, r.classTicker,
	}
}

var seriesColumns = []string{
	"filepath", "accession", "form_type", "filed_date", "owner_cik",
	"series_id", "series_name", "class_id", "class_name", "class_ticker",
}

// scrub keeps a value from shifting a column or splitting a row.
func scrub(s string) string {
	s = strings.TrimSpace(s)
	s = strings.NewReplacer("\t", " ", "\r", "", "\n", " ").Replace(s)
	return s
}

func parseSeriesBlock(header []byte, path, accession, formType, filedDate string) []seriesRow {
	var (
		out                             []seriesRow
		ownerCIK, seriesID, seriesName  string
		classID, className, classTicker string
		sawClass, emittedSeries         bool
	)

	flushClass := func() {
		if !sawClass {
			return
		}
		out = append(out, seriesRow{
			path: path, accession: accession, formType: formType, filedDate: filedDate,
			ownerCIK: ownerCIK, seriesID: seriesID, seriesName: seriesName,
			classID: classID, className: className, classTicker: classTicker,
		})
		classID, className, classTicker, sawClass = "", "", "", false
		emittedSeries = true
	}

	flushSeries := func() {
		flushClass()
		if seriesID != "" && !emittedSeries {
			out = append(out, seriesRow{
				path: path, accession: accession, formType: formType, filedDate: filedDate,
				ownerCIK: ownerCIK, seriesID: seriesID, seriesName: seriesName,
			})
		}
		seriesID, seriesName, emittedSeries = "", "", false
	}

	sc := bufio.NewScanner(bytes.NewReader(header))
	sc.Buffer(make([]byte, 0, 8192), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case reSeriesEnd.MatchString(line):
			flushSeries()
		case reClassEnd.MatchString(line):
			flushClass()
		default:
			if m := reOwnerCIK.FindStringSubmatch(line); m != nil {
				ownerCIK = scrub(m[1])
			}
			if m := reSeriesID.FindStringSubmatch(line); m != nil {
				flushSeries()
				seriesID = scrub(m[1])
			}
			if m := reSeriesName.FindStringSubmatch(line); m != nil {
				seriesName = scrub(m[1])
			}
			if m := reClassID.FindStringSubmatch(line); m != nil {
				flushClass()
				classID = scrub(m[1])
				sawClass = true
			}
			if m := reClassName.FindStringSubmatch(line); m != nil {
				className = scrub(m[1])
			}
			if m := reClassTicker.FindStringSubmatch(line); m != nil {
				classTicker = scrub(m[1])
			}
		}
	}
	flushSeries()
	return out
}
