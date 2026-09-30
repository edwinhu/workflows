package main

// parse_s1_mgmt — officers, directors, the CEO, a self-described-founder flag and
// VC-affiliated directors out of the MANAGEMENT section of an IPO prospectus.
//
// This file holds the public extraction contract, the orchestration that turns a
// prospectus body into an Extraction, and the filelist driver that writes the two
// gzipped TSVs. The parsing itself lives beside it: section.go finds the section,
// table.go reads the HTML Name/Age/Position grid, ascii.go reads the pre-2001
// fixed-width one, bio.go joins each person to their bio and classify.go derives
// the three variables.

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/net/html"
)

// Section labels a person row's block within the MANAGEMENT table.
const (
	SectionOfficer     = "officer"
	SectionDirector    = "director"
	SectionKeyEmployee = "key_employee"
	SectionUnknown     = "unknown"
)

// Filing-level parse outcomes.
const (
	StatusOK            = "ok"
	StatusNoMgmtSection = "no_mgmt_section"
	StatusNoMgmtTable   = "no_mgmt_table"
	StatusParseError    = "parse_error"
)

// Person is one row of the MANAGEMENT Name/Age/Position table, joined to the
// bio that the same section carries for that name.
//
// NameRaw keeps the cell exactly as the filing writes it, committee footnote
// markers and dot leaders included ("Marc L. Andreessen(1)(3)",
// "Scott D. Cook (1).......").  Name is that cell normalised.
//
// Bio is the person's own bio text, page furniture dropped and text blocks
// rejoined; "" when the section carries no bio for this name. FounderEvidence
// and VCEvidence quote the substring that set the flag beside them, so a false
// positive is legible without re-running the parser.
type Person struct {
	Seq                  int
	NameRaw              string
	Name                 string
	Age                  int
	Position             string
	Section              string
	IsCEO                bool
	FounderSelfDescribed bool
	FounderEvidence      string
	VCAffiliated         bool
	VCFirm               string
	VCEvidence           string
	Bio                  string
}

// FilingSummary is the one-row-per-filing record. A filing that yields no
// persons is invisible in the persons TSV, so every filing gets one of these
// whatever happens to it.
type FilingSummary struct {
	Status                  string
	NPersons                int
	NOfficers               int
	NDirectors              int
	CEOName                 string
	CEOFounderSelfDescribed bool
	CEOFounderEvidence      string
	CEOSinceText            string
	CEOSinceInception       bool
	NVCDirectors            int
}

// Extraction is what one filing yields.
type Extraction struct {
	Persons []Person
	Filing  FilingSummary
}

// ExtractManagement is the public extraction entry point: raw is a complete
// EDGAR dissemination file (SGML header plus its documents), and the result is
// the MANAGEMENT section's officers, directors and key employees plus the
// filing-level CEO / founder / VC summary.
func ExtractManagement(raw []byte) Extraction {
	return extractBody(PrimaryDocument(string(raw)))
}

// extractBody is the shared spine: the driver reaches it with a streamed
// prospectus body, ExtractManagement with one sliced out of a whole file.
func extractBody(body string) Extraction {
	if IsHTML(body) {
		return extractHTML(body)
	}
	return extractASCII(body)
}

func extractHTML(body string) Extraction {
	doc, err := html.Parse(strings.NewReader(body))
	if err != nil {
		return Extraction{Filing: FilingSummary{Status: StatusParseError}}
	}
	blocks := docBlocks(doc)
	_, hi, tableIdx, hdr, status := mgmtSection(blocks)
	if status != StatusOK {
		return Extraction{Filing: FilingSummary{Status: status}}
	}
	grid := blocks[tableIdx].Grid
	cols, ok := columnRoles(grid, hdr)
	if !ok {
		return Extraction{Filing: FilingSummary{Status: StatusNoMgmtTable}}
	}
	persons := buildPersons(gridRows(grid, hdr, cols))
	if len(persons) == 0 {
		return Extraction{Filing: FilingSummary{Status: StatusNoMgmtTable}}
	}
	var prose []string
	for j := tableIdx + 1; j < hi; j++ {
		b := blocks[j]
		if b.Kind != blockText || b.InTable || blockIsFurniture(blocks, j) {
			continue
		}
		prose = append(prose, b.Text)
	}
	attachBios(persons, prose)
	return finish(persons)
}

// finish derives the three variables and the filing summary. The summary is
// computed FROM the person rows rather than alongside them, so the two can never
// disagree about who the CEO is or how many directors a VC sits for.
func finish(persons []Person) Extraction {
	for i := range persons {
		persons[i].FounderSelfDescribed, persons[i].FounderEvidence = detectFounder(persons[i])
		persons[i].VCAffiliated, persons[i].VCFirm, persons[i].VCEvidence = detectVC(persons[i].Bio)
	}
	f := FilingSummary{Status: StatusOK, NPersons: len(persons)}
	for _, p := range persons {
		switch p.Section {
		case SectionOfficer:
			f.NOfficers++
		case SectionDirector:
			f.NDirectors++
			if p.VCAffiliated {
				f.NVCDirectors++
			}
		}
	}
	if k := pickCEO(persons); k >= 0 {
		persons[k].IsCEO = true
		f.CEOName = persons[k].Name
		f.CEOFounderSelfDescribed = persons[k].FounderSelfDescribed
		f.CEOFounderEvidence = persons[k].FounderEvidence
		f.CEOSinceText, f.CEOSinceInception = ceoTenure(persons[k].Bio)
	}
	return Extraction{Persons: persons, Filing: f}
}

// ---------------------------------------------------------------------------
// filelist driver
// ---------------------------------------------------------------------------

type job struct {
	RelPath    string
	CIK        string
	Accession  string
	Form       string
	FilingDate string
	Company    string
}

const personHeader = "accession\tcik\tform\tseq\tname_raw\tname\tage\tposition\tsection\t" +
	"is_ceo\tfounder_self_described\tfounder_evidence\tvc_affiliated\tvc_firm\tvc_evidence"

const filingHeader = "accession\tcik\tform\tstatus\tn_persons\tn_officers\tn_directors\t" +
	"ceo_name\tceo_founder_self_described\tceo_founder_evidence\tceo_since_text\t" +
	"ceo_since_inception\tn_vc_directors"

// result is what a worker hands back: formatted rows, not an Extraction. A
// prospectus bio runs to a few kilobytes and none of it reaches the output, so
// dropping it at the worker keeps the collector's memory proportional to the
// output rather than to the corpus.
type result struct {
	cik        string
	accession  string
	personRows []string
	filingRow  string
}

func main() {
	filesFrom := flag.String("files-from", "", "filelist: relpath[\\tcik\\taccession\\tform\\tfdate\\tcompany] per line")
	archiveRoot := flag.String("archive-root", "/wrds/sec/archives", "EDGAR archive root")
	out := flag.String("out", "", "output path for person rows (.tsv.gz)")
	filingsPath := flag.String("filings", "", "output path for the per-filing summary (.tsv.gz)")
	concurrency := flag.Int("concurrency", runtime.NumCPU(), "parallel workers")
	flag.Parse()

	if *filesFrom == "" || *out == "" || *filingsPath == "" {
		fmt.Fprintln(os.Stderr, "usage: parse_s1_mgmt -files-from LIST -out persons.tsv.gz -filings filings.tsv.gz")
		os.Exit(2)
	}

	jobs, err := readFileList(*filesFrom)
	must(err)
	fmt.Fprintf(os.Stderr, "filelist rows in: %d\n", len(jobs))

	if *concurrency < 1 {
		*concurrency = 1
	}
	ch := make(chan job)
	resCh := make(chan result, 64)
	var wg sync.WaitGroup
	for w := 0; w < *concurrency; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range ch {
				resCh <- process(*archiveRoot, j)
			}
		}()
	}
	go func() {
		for _, j := range jobs {
			ch <- j
		}
		close(ch)
		wg.Wait()
		close(resCh)
	}()

	var all []result
	for r := range resCh {
		all = append(all, r)
	}
	sort.SliceStable(all, func(i, k int) bool {
		if all[i].cik != all[k].cik {
			return all[i].cik < all[k].cik
		}
		return all[i].accession < all[k].accession
	})

	var personRows, filingRows []string
	for _, r := range all {
		personRows = append(personRows, r.personRows...)
		filingRows = append(filingRows, r.filingRow)
	}
	must(writeGz(*out, personHeader, personRows))
	must(writeGz(*filingsPath, filingHeader, filingRows))

	fmt.Fprintf(os.Stderr, "filings processed: %d\nperson rows out: %d\n", len(all), len(personRows))
}

func process(archiveRoot string, j job) result {
	path := j.RelPath
	if !filepath.IsAbs(path) {
		path = filepath.Join(archiveRoot, j.RelPath)
	}
	e := extractFile(path)
	r := result{cik: j.CIK, accession: j.Accession, filingRow: filingTSV(j, e.Filing)}
	for _, p := range e.Persons {
		r.personRows = append(r.personRows, personTSV(j, p))
	}
	return r
}

func extractFile(path string) Extraction {
	body, err := streamPrimaryDocument(path)
	if err != nil {
		return Extraction{Filing: FilingSummary{Status: StatusParseError}}
	}
	return extractBody(body)
}

// ---------------------------------------------------------------------------
// streaming the prospectus out of a dissemination file
// ---------------------------------------------------------------------------

// streamPrimaryDocument returns the prospectus document's <TEXT> body without
// ever holding the rest of the filing.
//
// This is what makes the tail affordable. The 2020 median 424B4 is 2.5 MB but the
// p95 is 12.8 MB and the maximum 107.8 MB, and every filing bundles 3-72
// uuencoded GRAPHIC documents beside the one prospectus (design profile, P5 and
// R12). Reading the whole file per worker is 1.7 GB of resident memory at 16
// workers on that maximum; buffering only the wanted document's body, decided
// from the <TYPE> line that always precedes its <TEXT>, drops the graphics
// entirely.
//
// A filing with no <DOCUMENT> wrapper, or none of a wanted type, falls back to
// reading the file and taking PrimaryDocument's answer, so the streamed path and
// ExtractManagement agree on every input.
func streamPrimaryDocument(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	br := bufio.NewReaderSize(f, 1<<20)
	var body bytes.Buffer
	docType := ""
	capture := false
	sawDocument := false

	for {
		line, rerr := readLine(br)
		if len(line) > 0 {
			switch tag, rest := sgmlTag(line); tag {
			case "<DOCUMENT>":
				sawDocument = true
				docType, capture = "", false
				body.Reset()
			case "<TYPE>":
				docType = strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(rest), " ", ""))
			case "<TEXT>":
				capture = proxyTypes[docType]
				body.Reset()
			case "</TEXT>", "</DOCUMENT>":
				if capture {
					return body.String(), nil
				}
				capture = false
			default:
				if capture {
					body.Write(line)
				}
			}
		}
		if rerr != nil {
			if rerr != io.EOF {
				return "", rerr
			}
			break
		}
	}
	if capture && body.Len() > 0 {
		return body.String(), nil
	}
	if !sawDocument {
		raw, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		return PrimaryDocument(string(raw)), nil
	}
	// A dissemination file whose documents are all of other types: let
	// PrimaryDocument's own fallback pick one.
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return PrimaryDocument(string(raw)), nil
}

// sgmlTag reports whether a line is one of the structural SGML markers, and
// returns whatever follows it on the line. Only those markers are ever short and
// alone on a line, so this never inspects a prospectus body line beyond its first
// bytes.
func sgmlTag(line []byte) (tag, rest string) {
	i := 0
	for i < len(line) && (line[i] == ' ' || line[i] == '\t') {
		i++
	}
	if i >= len(line) || line[i] != '<' {
		return "", ""
	}
	end := i
	for end < len(line) && line[end] != '>' {
		end++
		if end-i > 12 {
			return "", ""
		}
	}
	if end >= len(line) {
		return "", ""
	}
	t := strings.ToUpper(string(line[i : end+1]))
	switch t {
	case "<DOCUMENT>", "<TEXT>", "</TEXT>", "</DOCUMENT>", "<TYPE>":
		return t, string(line[end+1:])
	}
	return "", ""
}

// readLine returns one line including its terminator, assembling the pieces when
// the line is longer than the reader's buffer (a modern prospectus can put its
// whole body on one line).
func readLine(br *bufio.Reader) ([]byte, error) {
	var out []byte
	for {
		s, err := br.ReadSlice('\n')
		if err == bufio.ErrBufferFull {
			out = append(out, s...)
			continue
		}
		if out == nil {
			return s, err
		}
		return append(out, s...), err
	}
}

// ---------------------------------------------------------------------------
// filelist and TSV
// ---------------------------------------------------------------------------

func readFileList(path string) ([]job, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []job
	br := bufio.NewReaderSize(f, 1<<20)
	for {
		raw, rerr := readLine(br)
		line := strings.TrimRight(string(raw), "\r\n")
		if strings.TrimSpace(line) != "" {
			fs := strings.Split(line, "\t")
			j := job{RelPath: strings.TrimSpace(fs[0])}
			if len(fs) > 1 {
				j.CIK = strings.TrimSpace(fs[1])
			}
			if len(fs) > 2 {
				j.Accession = strings.TrimSpace(fs[2])
			}
			if len(fs) > 3 {
				j.Form = strings.TrimSpace(fs[3])
			}
			if len(fs) > 4 {
				j.FilingDate = strings.TrimSpace(fs[4])
			}
			if len(fs) > 5 {
				j.Company = strings.TrimSpace(fs[5])
			}
			if j.CIK == "" {
				parts := strings.Split(j.RelPath, "/")
				if len(parts) >= 2 {
					j.CIK = parts[len(parts)-2]
				}
			}
			if j.Accession == "" {
				j.Accession = strings.TrimSuffix(filepath.Base(j.RelPath), ".txt")
			}
			out = append(out, j)
		}
		if rerr != nil {
			if rerr == io.EOF {
				return out, nil
			}
			return out, rerr
		}
	}
}

func personTSV(j job, p Person) string {
	return strings.Join([]string{
		j.Accession, j.CIK, j.Form, strconv.Itoa(p.Seq),
		clean(p.NameRaw), clean(p.Name), strconv.Itoa(p.Age), clean(p.Position), p.Section,
		btoa(p.IsCEO), btoa(p.FounderSelfDescribed), clean(p.FounderEvidence),
		btoa(p.VCAffiliated), clean(p.VCFirm), clean(p.VCEvidence),
	}, "\t")
}

func filingTSV(j job, f FilingSummary) string {
	return strings.Join([]string{
		j.Accession, j.CIK, j.Form, f.Status,
		strconv.Itoa(f.NPersons), strconv.Itoa(f.NOfficers), strconv.Itoa(f.NDirectors),
		clean(f.CEOName), btoa(f.CEOFounderSelfDescribed), clean(f.CEOFounderEvidence),
		clean(f.CEOSinceText), btoa(f.CEOSinceInception), strconv.Itoa(f.NVCDirectors),
	}, "\t")
}

func clean(s string) string {
	s = strings.ReplaceAll(s, "\t", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", " ")
	return strings.TrimSpace(s)
}

func btoa(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

func writeGz(path, header string, rows []string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	zw := gzip.NewWriter(f)
	bw := bufio.NewWriterSize(zw, 1<<20)
	if _, err := bw.WriteString(header + "\n"); err != nil {
		return err
	}
	for _, r := range rows {
		if _, err := bw.WriteString(r + "\n"); err != nil {
			return err
		}
	}
	if err := bw.Flush(); err != nil {
		return err
	}
	return zw.Close()
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "fatal:", err)
		os.Exit(1)
	}
}
