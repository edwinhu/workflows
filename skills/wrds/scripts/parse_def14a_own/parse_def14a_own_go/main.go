package main

// parse_def14a_own — DEF 14A beneficial-ownership table extractor, grid driver.
//
// Reads DEF 14A filings straight out of /wrds/sec/archives (one shard filelist
// per SGE task) and writes gzipped TSV: one row per (filing, holder row x share
// class), plus a manifest row per filing.
//
// The extraction core (sgml/grid/section/extract/parse/textfallback) is the
// r2000 `proxyown` extractor unchanged. Only the driver differs: the r2000
// version walked a local fetch manifest and wrote NDJSON.

import (
	"bufio"
	"compress/gzip"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// Institutional / index-fund holders: a 13G stake that is float, not a block.
// Copied verbatim from the r2000 summarize.py INST regex so the TSV carries the
// same is_institution column the r2000 parquet did.
var reInst = regexp.MustCompile(`(?i)\b(vanguard|blackrock|barclays\s+global|fmr\b|fidelity|state\s+street|` +
	`capital\s+research|capital\s+group|capital\s+world|t\.?\s*rowe|wellington|` +
	`dodge\s*&\s*cox|northern\s+trust|bank\s+of\s+new\s+york|mellon|` +
	`j\.?p\.?\s*morgan|morgan\s+stanley|goldman\s+sachs|invesco|aim\s+management|` +
	`alliance\s*bernstein|alliance\s+capital|franklin\s+resources|janus|putnam|` +
	`massachusetts\s+financial|mfs\b|geode|legal\s*&\s*general|norges|ubs\b|` +
	`deutsche\s+bank|prudential|tiaa|teachers\s+insurance|citigroup|wells\s+fargo|` +
	`southeastern\s+asset|primecap|lord\s+abbett|scudder|amvescap|` +
	`asset\s+management|investment\s+management|capital\s+management|` +
	`advisers|advisors|global\s+investors|index\s+fund|mutual\s+fund)\b`)

// job is one filing, as listed in a shard filelist.
type job struct {
	RelPath    string
	CIK        string
	Accession  string
	Form       string
	FilingDate string
	Company    string
}

// Manifest is one row per filing. A filing that parses to zero rows is
// invisible in the rows file — it looks exactly like a proxy with no ownership
// table — so every filing gets a manifest row whatever happens to it.
type Manifest struct {
	Accession  string
	CIK        string
	FilingDate string
	Form       string
	SourceFile string
	Bytes      int
	Parser     string
	TablesSeen int
	TablesUsed int
	NRows      int
	NPctParsed int
	HasGroup   bool
	Status     string // ok | error
	Err        string
}

const rowHeader = "accession\tcik\tcompany\tfiling_date\ttable_kind\ttable_index\trow_index\t" +
	"holder_name\tshares\tpercent\tpercent_marker\tshare_class\tis_group_row\tgroup_n_persons\t" +
	"footnote_markers\tparser\tsource_file\tproxy_year\tis_institution"

const manifestHeader = "accession\tcik\tfiling_date\tform\tsource_file\tbytes\tparser\t" +
	"tables_seen\ttables_used\tn_rows\tn_percent_parsed\thas_group_row\tparse_status\terror"

func main() {
	filesFrom := flag.String("files-from", "", "filelist: TSV relpath[,cik,accession,form,fdate,company] per line")
	archiveRoot := flag.String("archive-root", "/wrds/sec/archives", "EDGAR archive root")
	out := flag.String("out", "", "output path for ownership rows (.tsv.gz)")
	manifestPath := flag.String("manifest", "", "output path for the per-filing manifest (.tsv.gz)")
	concurrency := flag.Int("concurrency", runtime.NumCPU(), "parallel workers")
	dbg := flag.String("debug", "", "diagnose one filing and exit")
	flag.Parse()

	if *dbg != "" {
		DebugFile(*dbg, 40)
		return
	}
	if *filesFrom == "" || *out == "" || *manifestPath == "" {
		fmt.Fprintln(os.Stderr, "usage: parse_def14a_own -files-from LIST -out rows.tsv.gz -manifest man.tsv.gz")
		os.Exit(2)
	}

	jobs, err := readFileList(*filesFrom)
	must(err)
	fmt.Fprintf(os.Stderr, "filelist rows in: %d\n", len(jobs))

	type result struct {
		rows []Row
		man  Manifest
	}
	ch := make(chan job)
	resCh := make(chan result, 256)
	var wg sync.WaitGroup
	for w := 0; w < *concurrency; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range ch {
				rows, man := process(*archiveRoot, j)
				resCh <- result{rows, man}
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

	var allRows []Row
	var allMan []Manifest
	for r := range resCh {
		allRows = append(allRows, r.rows...)
		allMan = append(allMan, r.man)
	}

	// Deterministic order. The sort must be STABLE: workers finish in arbitrary
	// order, so two rows with an equal key (the same table row emitted for two
	// class pairs) would otherwise swap between runs.
	sort.SliceStable(allRows, func(i, j int) bool {
		a, b := allRows[i], allRows[j]
		switch {
		case a.CIK != b.CIK:
			return a.CIK < b.CIK
		case a.FilingDate != b.FilingDate:
			return a.FilingDate < b.FilingDate
		case a.Accession != b.Accession:
			return a.Accession < b.Accession
		case a.TableIndex != b.TableIndex:
			return a.TableIndex < b.TableIndex
		case a.RowIndex != b.RowIndex:
			return a.RowIndex < b.RowIndex
		case a.ShareClass != b.ShareClass:
			return a.ShareClass < b.ShareClass
		}
		return a.HolderName < b.HolderName
	})
	sort.SliceStable(allMan, func(i, j int) bool {
		if allMan[i].CIK != allMan[j].CIK {
			return allMan[i].CIK < allMan[j].CIK
		}
		return allMan[i].Accession < allMan[j].Accession
	})

	must(writeGz(*out, rowHeader, len(allRows), func(i int) string { return rowTSV(allRows[i]) }))
	must(writeGz(*manifestPath, manifestHeader, len(allMan), func(i int) string { return manTSV(allMan[i]) }))

	nFound, nPct, nGroup, nErr := 0, 0, 0, 0
	for _, m := range allMan {
		if m.NRows > 0 {
			nFound++
		}
		if m.NPctParsed > 0 {
			nPct++
		}
		if m.HasGroup {
			nGroup++
		}
		if m.Status != "ok" {
			nErr++
		}
	}
	fmt.Fprintf(os.Stderr,
		"filings processed: %d\nfilings with >=1 table row: %d\nfilings with >=1 parsed percent: %d\n"+
			"filings with a D&O group row: %d\nfilings with a read/parse error: %d\nownership rows out: %d\n",
		len(allMan), nFound, nPct, nGroup, nErr, len(allRows))
	if nErr > 0 {
		// Loud, not fatal: the shard's manifest records which filings failed and
		// scan_shard.sh asserts manifest_rows == files_in.
		fmt.Fprintf(os.Stderr, "WARNING: %d filings errored; see parse_status in the manifest\n", nErr)
	}
}

func readFileList(path string) ([]job, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []job
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := strings.TrimRight(sc.Text(), "\r\n")
		if strings.TrimSpace(line) == "" {
			continue
		}
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
		// Fall back to the archive path when the filelist carries paths only:
		// 000010/104169/0000104169-24-000123.txt
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
	return out, sc.Err()
}

func process(archiveRoot string, j job) ([]Row, Manifest) {
	base := Row{
		Accession:  j.Accession,
		CIK:        j.CIK,
		Company:    j.Company,
		FilingDate: j.FilingDate,
		SourceFile: j.RelPath,
	}
	man := Manifest{Accession: j.Accession, CIK: j.CIK, FilingDate: j.FilingDate,
		Form: j.Form, SourceFile: j.RelPath, Status: "ok"}

	raw, err := os.ReadFile(filepath.Join(archiveRoot, j.RelPath))
	if err != nil {
		man.Status, man.Err = "error", oneLine(err.Error())
		return nil, man
	}
	man.Bytes = len(raw)

	body := PrimaryDocument(string(raw))
	var rows []Row
	var seen, used int
	if IsHTML(body) {
		man.Parser = "html_dom"
		rows, seen, used = ExtractHTML(body, base)
		if len(rows) == 0 {
			// An HTML wrapper around an ASCII table: try the text path.
			r2, s2, u2 := ExtractText(body, base)
			if len(r2) > 0 {
				man.Parser = "text_table"
				rows, seen, used = r2, s2, u2
			}
		}
	} else {
		man.Parser = "text_table"
		rows, seen, used = ExtractText(body, base)
	}
	man.TablesSeen, man.TablesUsed, man.NRows = seen, used, len(rows)
	for _, r := range rows {
		if r.Percent != nil {
			man.NPctParsed++
		}
		if r.IsGroupRow {
			man.HasGroup = true
		}
	}
	return rows, man
}

func rowTSV(r Row) string {
	year := ""
	if len(r.FilingDate) >= 4 {
		year = r.FilingDate[:4]
	}
	var b strings.Builder
	w := func(s string) { b.WriteString(clean(s)); b.WriteByte('\t') }
	w(r.Accession)
	w(r.CIK)
	w(r.Company)
	w(r.FilingDate)
	w(r.TableKind)
	w(strconv.Itoa(r.TableIndex))
	w(strconv.Itoa(r.RowIndex))
	w(r.HolderName)
	w(fnum(r.Shares))
	w(fnum(r.Percent))
	w(r.PctMarker)
	w(r.ShareClass)
	w(btoa(r.IsGroupRow))
	w(strconv.Itoa(r.GroupN))
	w(r.Footnotes)
	w(r.Parser)
	w(r.SourceFile)
	w(year)
	b.WriteString(btoa(reInst.MatchString(r.HolderName)))
	return b.String()
}

func manTSV(m Manifest) string {
	f := []string{m.Accession, m.CIK, m.FilingDate, m.Form, m.SourceFile,
		strconv.Itoa(m.Bytes), m.Parser, strconv.Itoa(m.TablesSeen), strconv.Itoa(m.TablesUsed),
		strconv.Itoa(m.NRows), strconv.Itoa(m.NPctParsed), btoa(m.HasGroup), m.Status, clean(m.Err)}
	for i := range f {
		f[i] = clean(f[i])
	}
	return strings.Join(f, "\t")
}

func fnum(v *float64) string {
	if v == nil {
		return ""
	}
	return strconv.FormatFloat(*v, 'f', -1, 64)
}

func btoa(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

// clean keeps the TSV one-record-per-line: a holder cell can carry newlines and
// a tab, and either would silently split the row.
func clean(s string) string {
	if strings.ContainsAny(s, "\t\n\r") {
		s = strings.NewReplacer("\t", " ", "\n", " ", "\r", " ").Replace(s)
	}
	return s
}

func oneLine(s string) string { return clean(s) }

func writeGz(path, header string, n int, line func(int) string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	gz := gzip.NewWriter(f)
	bw := bufio.NewWriterSize(gz, 1<<20)
	if _, err := bw.WriteString(header + "\n"); err != nil {
		return err
	}
	for i := 0; i < n; i++ {
		if _, err := bw.WriteString(line(i) + "\n"); err != nil {
			return err
		}
	}
	if err := bw.Flush(); err != nil {
		return err
	}
	if err := gz.Close(); err != nil {
		return err
	}
	return f.Sync()
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "FATAL:", err)
		os.Exit(1)
	}
}
