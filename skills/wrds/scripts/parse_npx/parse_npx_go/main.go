// parse_npx_go — concurrent N-PX proxy-voting filing parser.
//
// Reads a filelist of EDGAR dissemination files, parses each one (modern XML or
// legacy text mode) and emits two TSVs:
//
//   - votes:    one row per <voteRecord> (XML era) or per proposal line (text era)
//   - manifest: one row per filing, including the ones that parsed to nothing
//
// Usage:
//
//	parse_npx_go -files-from list.txt -out votes.tsv.gz -manifest manifest.tsv.gz
package main

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
	"strconv"
	"strings"
	"sync"
)

const version = "parse_npx_go v0.1.0"

// ---------------------------------------------------------------------------
// TSV serialization
// ---------------------------------------------------------------------------

// sanitize replaces tabs and newlines with a space and drops carriage returns,
// so no field value can shift a TSV column or split a row.
func sanitize(s string) string {
	s = strings.ReplaceAll(s, "\t", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", "")
	return s
}

// TSV serializes a VoteRow in voteColumns order. No header row is ever written.
func (r VoteRow) TSV() string {
	return strings.Join([]string{
		sanitize(r.FilePath),
		sanitize(r.Accession),
		sanitize(r.CIK),
		sanitize(r.PeriodOfReport),
		sanitize(r.FiledDate),
		sanitize(r.FormType),
		sanitize(r.RegistrantName),
		sanitize(r.SeriesID),
		sanitize(r.ClassIDs),
		sanitize(r.FundName),
		sanitize(r.IssuerName),
		sanitize(r.CUSIP),
		sanitize(r.ISIN),
		sanitize(r.FIGI),
		sanitize(r.Ticker),
		sanitize(r.MeetingDate),
		sanitize(r.MeetingType),
		sanitize(r.RecordDate),
		sanitize(r.ItemSeq),
		sanitize(r.VoteDescription),
		sanitize(r.VoteCategories),
		sanitize(r.OtherVoteDescription),
		sanitize(r.VoteSource),
		sanitize(r.SharesVotedTotal),
		sanitize(r.SharesOnLoan),
		sanitize(r.HowVoted),
		sanitize(r.SharesVoted),
		sanitize(r.ManagementRecommendation),
		sanitize(r.OtherManagers),
		sanitize(r.VoteOtherInfo),
		sanitize(r.ParseMode),
		sanitize(r.Layout),
	}, "\t")
}

// TSV serializes a FilingMeta in manifestColumns order.
func (m FilingMeta) TSV() string {
	return strings.Join([]string{
		sanitize(m.FilePath),
		sanitize(m.Accession),
		sanitize(m.CIK),
		sanitize(m.PeriodOfReport),
		sanitize(m.FiledDate),
		sanitize(m.FormType),
		sanitize(m.CompanyName),
		strconv.Itoa(m.NRows),
		sanitize(m.ParseMode),
		sanitize(m.Layout),
		sanitize(m.ParseStatus),
		sanitize(m.ErrorMsg),
	}, "\t")
}

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

// readFilelist reads a newline-delimited file of paths.
func readFilelist(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var paths []string
	s := bufio.NewScanner(f)
	s.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if line != "" {
			paths = append(paths, line)
		}
	}
	return paths, s.Err()
}

// resolvePath prepends the archive root to a relative path only. An absolute
// path in the filelist is used as given.
//
// A relative entry is joined onto the root — which Cleans away any ".." — and
// then refused unless the result is still under the root. The filelist is
// machine-generated from EDGAR index metadata and nothing audits its path
// strings, so a traversal must not reach os.Open.
func resolvePath(archiveRoot, p string) (string, error) {
	if archiveRoot == "" || strings.HasPrefix(p, "/") {
		return p, nil
	}
	root := filepath.Clean(archiveRoot)
	full := filepath.Join(root, p)
	if !withinRoot(root, full) {
		return "", fmt.Errorf("path escaped the archive root: %q resolves to %q, outside %q", p, full, root)
	}
	// Join only contains the lexical path. A symlink inside the root can still
	// point out of it, so compare the physical paths when both sides resolve.
	if realRoot, ok := resolveRootOnce(root); ok {
		if realFull, err := filepath.EvalSymlinks(full); err == nil && !withinRoot(realRoot, realFull) {
			return "", fmt.Errorf("path escaped the archive root: %q links to %q, outside %q", p, realFull, realRoot)
		}
	}
	return full, nil
}

// rootRealPaths memoises filepath.EvalSymlinks over cleaned archive roots. The
// root is invariant across a run while resolvePath is called once per filelist
// entry, and EvalSymlinks costs one lstat per path component — roughly ten
// syscalls per filing for an answer that cannot change. An empty stored value
// records a root that does not resolve.
var rootRealPaths sync.Map

func resolveRootOnce(root string) (string, bool) {
	if v, ok := rootRealPaths.Load(root); ok {
		s := v.(string)
		return s, s != ""
	}
	s, err := filepath.EvalSymlinks(root)
	if err != nil {
		s = ""
	}
	rootRealPaths.Store(root, s)
	return s, s != ""
}

// withinRoot reports whether full is strictly below root. The comparison is
// made on path components rather than on the raw string, so a sibling that
// merely shares the root's prefix — say /wrds/sec/archives-old against
// /wrds/sec/archives — is not contained, and a root that Cleans to "." still
// contains the ordinary relative entries joined onto it.
func withinRoot(root, full string) bool {
	rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(full))
	if err != nil {
		return false
	}
	if rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false
	}
	return true
}

// openOutput opens a file for writing, gzipping it iff the path ends in .gz.
func openOutput(path string) (io.Writer, func(), error) {
	f, err := os.Create(path)
	if err != nil {
		return nil, nil, err
	}
	if strings.HasSuffix(path, ".gz") {
		// BestSpeed, not the default level: the single writer goroutine is the
		// only serial stage in the pipeline, so compression sits directly on
		// the critical path. The decompressed stream is identical either way.
		gw, err := gzip.NewWriterLevel(f, gzip.BestSpeed)
		if err != nil {
			f.Close()
			return nil, nil, err
		}
		return gw, func() { gw.Close(); f.Close() }, nil
	}
	return f, func() { f.Close() }, nil
}

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

// headBytes is how much of a filing is read up front for header parsing and
// era detection. Never the whole file: filings run 10–200 MB and the worker
// pool multiplies whatever a worker holds by the concurrency.
const headBytes = 256 << 10

// detectMode returns "xml" for the post-2024 structured era and "text" for the
// legacy free-text era, judged from the head of the dissemination file.
func detectMode(head []byte) string {
	lower := bytes.ToLower(head)
	for _, marker := range [][]byte{
		[]byte("primary_doc.xml"),
		[]byte("proxyvotetable"),
		[]byte("<proxytable"),
		[]byte("proxyvotingrecord"),
	} {
		if bytes.Contains(lower, marker) {
			return "xml"
		}
	}
	return "text"
}

// ---------------------------------------------------------------------------
// Row sink: the streaming funnel from a worker to the writer goroutine
// ---------------------------------------------------------------------------

// rowBatch is how many rows a worker accumulates before handing a ParseResult
// to the writer. A modern filing carries tens of thousands of vote records, so
// rows are handed off in bounded batches rather than accumulated whole.
const rowBatch = 2048

// rowSink batches VoteRows into ParseResult values on the results channel. A
// ParseResult with an empty Meta.FilePath is a row batch; one carrying a
// FilePath is the filing's manifest row and closes it out.
type rowSink struct {
	out  chan<- *ParseResult
	buf  []VoteRow
	n    int
	meta *FilingMeta
}

// emit backfills the filing-level columns the parsers do not know about, then
// buffers the row, flushing a batch downstream when it is full.
func (s *rowSink) emit(r VoteRow) error {
	m := s.meta
	if r.FilePath == "" {
		r.FilePath = m.FilePath
	}
	if r.Accession == "" {
		r.Accession = m.Accession
	}
	if r.CIK == "" {
		r.CIK = m.CIK
	}
	if r.PeriodOfReport == "" {
		r.PeriodOfReport = m.PeriodOfReport
	}
	if r.FiledDate == "" {
		r.FiledDate = m.FiledDate
	}
	if r.FormType == "" {
		r.FormType = m.FormType
	}
	if r.RegistrantName == "" {
		r.RegistrantName = m.CompanyName
	}
	if r.ParseMode == "" {
		r.ParseMode = m.ParseMode
	}
	if r.Layout == "" {
		r.Layout = m.Layout
	}
	s.buf = append(s.buf, r)
	s.n++
	if len(s.buf) >= rowBatch {
		s.flush()
	}
	return nil
}

func (s *rowSink) flush() {
	if len(s.buf) == 0 {
		return
	}
	s.out <- &ParseResult{Rows: s.buf}
	s.buf = nil
}

// ---------------------------------------------------------------------------
// Per-filing parsing
// ---------------------------------------------------------------------------

// processFile parses one filing, streaming its rows into sink, and returns the
// filing's manifest row. Any panic in a layout parser is contained here: one
// malformed filing must not take a worker, or the run, down.
//
// headBuf is the worker's reusable head buffer, sized headBytes; it is owned by
// the caller so the allocation is once per worker rather than once per filing.
// seriesMap is the optional -series-map overlay; nil means none loaded.
var seriesMap *seriesOverlay

// cikDict is the optional -cik-series dictionary; nil means none loaded.
var cikDict *cikSeries

func processFile(relPath, fullPath string, sink *rowSink, headBuf []byte) (meta FilingMeta) {
	meta = FilingMeta{FilePath: relPath, ParseMode: "none", ParseStatus: "error"}
	sink.meta = &meta
	sink.n = 0

	f, err := os.Open(fullPath)
	if err != nil {
		meta.ErrorMsg = err.Error()
		return meta
	}
	defer f.Close()

	n, err := io.ReadFull(f, headBuf[:headBytes])
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		meta.ErrorMsg = err.Error()
		return meta
	}
	head := headBuf[:n]

	h := parseHeader(head)
	headerHasSeries := len(h.SeriesDecls) > 0
	cikDict.back(&h)
	h.FilePath = relPath
	h.ParseMode = "none"
	h.ParseStatus = "error"
	meta = h

	// A registrant filing for exactly one series lets the chassis stamp the
	// link key onto every row; a multi-series filing leaves it to the parser,
	// which is the only layer that knows which series a vote belongs to.
	sc := parseSeriesClasses(head)
	seriesRow, classRow := "", ""
	if ids := seriesIDs(sc); len(ids) == 1 {
		seriesRow = ids[0]
		classRow = strings.Join(classIDsFor(sc, seriesRow), MultiValueSep)
	}
	if !headerHasSeries {
		// Dictionary aliases can repeat an id; only distinct series count.
		ids := map[string]bool{}
		for _, d := range h.SeriesDecls {
			if d.SeriesID != "" {
				ids[d.SeriesID] = true
			}
		}
		if len(ids) == 1 {
			for id := range ids {
				seriesRow = id
			}
		}
	}

	// The registrant's own conformed name IS a dictionary fund name: a
	// single-fund registrant whose 2005 filing prints no fund heading at all
	// (`MIDAS SPECIAL EQUITIES FUND INC /MD`, S000011690). It answers only rows
	// the parser left unnamed, and only when the header declared nothing and
	// exactly one dictionary series of the CIK is spelled that way -- two
	// series answering to it refuse, the way seriesByName refuses a collision.
	registrantSeries := ""
	if !headerHasSeries && seriesRow == "" {
		want := normalizeSeriesName(h.CompanyName)
		if want != "" {
			for _, d := range h.SeriesDecls {
				if d.SeriesID == "" || normalizeSeriesName(d.Name) != want {
					continue
				}
				if registrantSeries != "" && registrantSeries != d.SeriesID {
					registrantSeries = ""
					break
				}
				registrantSeries = d.SeriesID
			}
		}
	}

	// The same shape, one rename away: a single-fund registrant that renamed
	// itself before it ever declared a series id, so the equality above can
	// never answer. Taiwan Greater China Fund (CIK 836267) prints no fund
	// heading in its 20050630 report and declares S000034279 six years later as
	// `SHELTON GREATER CHINA FUND`, under the same SEC file number -- 757 rows
	// with no series. The registrant's own conformed name reaches the SAME
	// resolver a heading reaches, and then the lead-brand swap the chain
	// already accepts for headings (`MGIT International Select Equity Fund` for
	// a declared `DWS International Select Equity Fund`), which is spelled for
	// the registrant's own name in issRegistrantBrandSwapDecl: the distinctive
	// phrase survives whole and only the lead brand token differs.
	//
	// Computed lazily, and read ONLY when the filing prints no fund heading at
	// all -- a filing that names any fund has a parser that knows which fund a
	// row belongs to, and the registrant's name is not that answer.
	registrantNoHeadingSeries := func() string {
		key := normalizeSeriesName(h.CompanyName)
		if key == "" {
			return ""
		}
		ix := issFilingIndex(h.SeriesDecls, key, h.CIK, metaPeriod(h))
		issFormerKeys(ix, h.FormerNames)
		if id := icrResolveFundShared(ix, h.CompanyName); id != "" {
			return id
		}
		if d := issRegistrantBrandSwapDecl(ix, key); d != nil {
			return d.SeriesID
		}
		return ""
	}

	defer func() {
		if r := recover(); r != nil {
			meta.ParseStatus = "error"
			meta.ErrorMsg = fmt.Sprintf("panic: %v", r)
			meta.NRows = sink.n
		}
	}()

	mode := detectMode(head)
	meta.ParseMode = mode

	// A row's class contracts are the ones the header declares under the series
	// THAT ROW names, never the chassis series'. series_id and class_ids are both
	// link keys, so handing a row another series' classes makes two columns
	// contradict each other on one row. A series declaring no class contract
	// legitimately yields the empty string, and that is the answer — not a reason
	// to fall back to some other series' classes.
	//
	// Cached per series id so the scan over the header triples happens once per
	// distinct series rather than once per row; a filing reaches millions of rows.
	classBySeries := map[string]string{}
	if seriesRow != "" {
		classBySeries[seriesRow] = classRow
	}
	classesOf := func(seriesID string) string {
		if joined, ok := classBySeries[seriesID]; ok {
			return joined
		}
		joined := strings.Join(classIDsFor(sc, seriesID), MultiValueSep)
		classBySeries[seriesID] = joined
		return joined
	}

	var declared map[string]bool
	if seriesMap != nil {
		declared = overlayDeclaredIDs(h)
		seriesMap.licenseHandMapped(relPath, h, declared)
	}
	dictFB := cikDict.exactFallback(h)
	stamp := func(r VoteRow) error {
		if r.SeriesID == "" {
			r.SeriesID = seriesRow
		}
		if r.SeriesID == "" && r.FundName == "" {
			r.SeriesID = registrantSeries
		}
		seriesMap.apply(relPath, declared, &r)
		dictFB.apply(&r)
		if r.ClassIDs == "" && r.SeriesID != "" {
			r.ClassIDs = classesOf(r.SeriesID)
		}
		return sink.emit(r)
	}

	switch mode {
	case "xml":
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			meta.ErrorMsg = err.Error()
			return meta
		}
		// Streaming: the decoder pulls off a buffered reader and rows leave
		// through the sink as they are produced, so peak memory is independent
		// of filing size.
		if _, err := parseNPXXML(bufio.NewReaderSize(f, 1<<20), &meta, stamp); err != nil {
			meta.ParseStatus = "error"
			meta.ErrorMsg = err.Error()
			meta.NRows = sink.n
			return meta
		}
		meta.ParseStatus = "ok"
	default:
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			meta.ErrorMsg = err.Error()
			return meta
		}
		buf, err := io.ReadAll(f)
		if err != nil {
			meta.ErrorMsg = err.Error()
			return meta
		}
		res := parseText(buf, meta)
		if res == nil {
			meta.ErrorMsg = "text parser returned no result"
			return meta
		}
		meta = res.Meta
		meta.FilePath = relPath
		meta.ParseMode = mode
		consolidated := consolidatedSeries(sc, res.Rows)
		// The no-heading shape, decided on the parsed rows rather than guessed:
		// every row's fund_name is empty, so the filing printed no fund heading
		// anywhere and the registrant's own name is the only name it carries.
		if !headerHasSeries && seriesRow == "" && registrantSeries == "" && consolidated == "" {
			noHeading := true
			for _, r := range res.Rows {
				if r.FundName != "" {
					noHeading = false
					break
				}
			}
			if noHeading && len(res.Rows) > 0 {
				registrantSeries = registrantNoHeadingSeries()
			}
		}
		for _, r := range res.Rows {
			if r.Layout == "" {
				r.Layout = meta.Layout
			}
			if consolidated != "" && r.SeriesID == "" {
				r.SeriesID = consolidated
			}
			if err := stamp(r); err != nil {
				meta.ParseStatus = "error"
				meta.ErrorMsg = err.Error()
				break
			}
		}
	}

	meta.NRows = sink.n
	if meta.ParseStatus == "" {
		meta.ParseStatus = "ok"
	}
	return meta
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

func main() {
	var (
		filesFrom     string
		archiveRoot   string
		outFile       string
		manifestFile  string
		concurrency   int
		showVersion   bool
		seriesMapPath string
		cikSeriesPath string
	)

	flag.StringVar(&filesFrom, "files-from", "", "filelist, one path per line (required)")
	flag.StringVar(&archiveRoot, "archive-root", "/wrds/sec/archives", "prepended to relative paths")
	flag.StringVar(&outFile, "out", "", "votes output TSV, gzipped iff the path ends in .gz (required)")
	flag.StringVar(&manifestFile, "manifest", "", "manifest output TSV, gzipped iff the path ends in .gz (required)")
	flag.IntVar(&concurrency, "concurrency", runtime.NumCPU()*4, "worker goroutines")
	flag.BoolVar(&issStripRegistrantPrefix, "issnpx-registrant-prefix-strip", true,
		"issnpx: when a fund banner begins with the filing's own COMPANY CONFORMED NAME,"+
			" retry the lookup with that prefix removed; -issnpx-registrant-prefix-strip=false"+
			" disables it, which is the first step of the audit this rule requires")
	flag.StringVar(&seriesMapPath, "series-map", "",
		"TSV (filing, heading, series_id) filling a blank series_id for the exact fund heading"+
			" printed, only with a series the filing's header declares")
	flag.StringVar(&cikSeriesPath, "cik-series", "",
		"TSV (cik, series_id, series_name) backing a filing whose header declares no series"+
			" with the ids the same registrant declared in other filings")
	flag.BoolVar(&showVersion, "version", false, "print version and exit")
	flag.Parse()
	if cikSeriesPath != "" {
		d, err := loadCIKSeries(cikSeriesPath)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		cikDict = d
	}
	if seriesMapPath != "" {
		ov, err := loadSeriesOverlay(seriesMapPath)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		seriesMap = ov
	}

	if showVersion {
		fmt.Println(version)
		return
	}

	// An alternate mode (-shard) takes over the run before any output file is
	// opened and before the parse-mode flags are required.
	for _, hook := range preRunHooks {
		if handled, code := hook(); handled {
			os.Exit(code)
		}
	}

	var missing []string
	if filesFrom == "" {
		missing = append(missing, "-files-from")
	}
	if outFile == "" {
		missing = append(missing, "-out")
	}
	if manifestFile == "" {
		missing = append(missing, "-manifest")
	}
	if len(missing) > 0 {
		fmt.Fprintf(os.Stderr, "error: missing required flag(s): %s\n", strings.Join(missing, ", "))
		fmt.Fprintln(os.Stderr, "required: -files-from, -out, -manifest")
		flag.Usage()
		os.Exit(2)
	}

	if concurrency < 1 {
		concurrency = 1
	}

	paths, err := readFilelist(filesFrom)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error reading filelist: %v\n", err)
		os.Exit(1)
	}

	votesWriter, votesClose, err := openOutput(outFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error opening votes output: %v\n", err)
		os.Exit(1)
	}
	defer votesClose()

	manifestWriter, manifestClose, err := openOutput(manifestFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error opening manifest output: %v\n", err)
		os.Exit(1)
	}
	defer manifestClose()

	jobs := make(chan string, 1024)
	results := make(chan *ParseResult, 256)

	var wg sync.WaitGroup
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sink := &rowSink{out: results}
			// One head buffer per worker, reused across filings: at NumCPU*4
			// workers over hundreds of thousands of filings, a 256 KB
			// allocation per filing is pure GC traffic.
			headBuf := make([]byte, headBytes)
			for p := range jobs {
				full, err := resolvePath(archiveRoot, p)
				if err != nil {
					// A refused path is visible, exactly as an unreadable file
					// is: a manifest row with n_rows=0 and the reason.
					meta := FilingMeta{FilePath: p, ParseMode: "none", ParseStatus: "error", ErrorMsg: err.Error()}
					fmt.Fprintf(os.Stderr, "%s: %s\n", p, meta.ErrorMsg)
					results <- &ParseResult{Meta: meta}
					continue
				}
				meta := processFile(p, full, sink, headBuf)
				sink.flush()
				if meta.ParseStatus == "error" && meta.ErrorMsg != "" {
					fmt.Fprintf(os.Stderr, "%s: %s\n", p, meta.ErrorMsg)
				}
				results <- &ParseResult{Meta: meta}
			}
		}()
	}

	// One writer goroutine owns both bufio.Writers, so nothing else touches
	// the output files and row/manifest writes never interleave mid-line.
	var writerWG sync.WaitGroup
	writerWG.Add(1)
	go func() {
		defer writerWG.Done()
		vBuf := bufio.NewWriterSize(votesWriter, 1<<20)
		mBuf := bufio.NewWriterSize(manifestWriter, 1<<20)
		defer mBuf.Flush()
		defer vBuf.Flush()

		for r := range results {
			for _, row := range r.Rows {
				vBuf.WriteString(row.TSV())
				vBuf.WriteByte('\n')
			}
			// A batch carries rows only; the manifest row closes the filing.
			if r.Meta.FilePath != "" {
				mBuf.WriteString(r.Meta.TSV())
				mBuf.WriteByte('\n')
			}
		}
	}()

	for _, p := range paths {
		jobs <- p
	}
	close(jobs)
	wg.Wait()
	close(results)
	writerWG.Wait()
}

// consolidatedSeries returns the MultiValueSep-joined ids of every series the
// header declares when the filing reports the trust's votes as ONE record: two or
// more declared series, and not a single row carrying a fund heading or a
// resolved series. Such a filing (JHVIT 2011: 111 series, 6,267 meetings, no fund
// name anywhere; 645 filings and 2.45M rows on run68) attributes each vote to all
// of its funds; the linker expands the list and the ISS agreement gate is what
// says whether the funds did vote alike. Anything less than fully unlabelled
// keeps the ordinary rules, so a partially headed filing is never widened.
func consolidatedSeries(sc []SeriesClass, rows []VoteRow) string {
	ids := seriesIDs(sc)
	if len(ids) < 2 || len(rows) == 0 {
		return ""
	}
	for _, r := range rows {
		if r.FundName != "" || r.SeriesID != "" {
			return ""
		}
	}
	return strings.Join(ids, MultiValueSep)
}
