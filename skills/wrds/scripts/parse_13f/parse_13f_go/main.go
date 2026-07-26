// parse_13f_go — concurrent 13F EDGAR filing parser.
//
// Reads a filelist, parses each filing (XML or text mode), and emits:
//   - holdings TSV (one row per holding)
//   - manifest TSV (one row per filing)
//
// Usage:
//
//	parse_13f_go -files-from list.txt -out holdings.tsv.gz -manifest manifest.tsv.gz
package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"flag"
	"fmt"
	"io"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
)

const version = "parse_13f_go v0.2.1"

// ---------------------------------------------------------------------------
// TSV serialization
// ---------------------------------------------------------------------------

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// sanitize replaces tabs and newlines in a string field to prevent TSV column shifts.
func sanitize(s string) string {
	s = strings.ReplaceAll(s, "\t", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", "")
	return s
}

// TSV returns a tab-separated string of Row fields in holdingsColumns order.
func (r Row) TSV() string {
	return strings.Join([]string{
		r.FilePath,
		r.Accession,
		r.CIK,
		r.PeriodOfReport,
		r.FiledDate,
		r.FormType,
		sanitize(r.NameOfIssuer),
		sanitize(r.TitleOfClass),
		r.CUSIP9,
		r.CUSIP8,
		r.CUSIP6,
		strconv.FormatInt(r.Value, 10),
		strconv.FormatInt(r.Shares, 10),
		r.SharesType,
		sanitize(r.InvestmentDiscretion),
		sanitize(r.OtherManager),
		strconv.FormatInt(r.VotingSole, 10),
		strconv.FormatInt(r.VotingShared, 10),
		strconv.FormatInt(r.VotingNone, 10),
		boolStr(r.CUSIPValid),
		boolStr(r.IsAmendment),
		r.AmendmentType,
		r.ParseMode,
	}, "\t")
}

// TSV returns a tab-separated string of FilingMeta fields in manifestColumns order.
func (m FilingMeta) TSV() string {
	return strings.Join([]string{
		m.FilePath,
		m.Accession,
		m.CIK,
		m.PeriodOfReport,
		m.FiledDate,
		m.FormType,
		sanitize(m.CompanyName),
		strconv.Itoa(m.NRows),
		m.ParseMode,
		m.ParseStatus,
		sanitize(m.ErrorMsg),
	}, "\t")
}

// ---------------------------------------------------------------------------
// Detection switch
// ---------------------------------------------------------------------------

// detectMode examines the file content and returns "xml" or "text".
// Must handle namespace prefixes (e.g., <n1:infoTable>, <ns1:informationTable>).
func detectMode(buf []byte) string {
	lower := bytes.ToLower(buf)
	if bytes.Contains(lower, []byte("<type>information table")) ||
		bytes.Contains(lower, []byte("infotable>")) ||
		bytes.Contains(lower, []byte("informationtable")) {
		return "xml"
	}
	return "text"
}

// parseFile dispatches to the appropriate parser based on content detection.
func parseFile(buf []byte, filePath string) *ParseResult {
	mode := detectMode(buf)

	var result *ParseResult
	var err error

	switch mode {
	case "xml":
		result, err = parseXML(buf, filePath)
	default:
		result, err = parseText(buf, filePath)
	}

	if err != nil {
		fmt.Fprintf(os.Stderr, "%s: %v\n", filePath, err)
		meta := parseHeader(buf)
		meta.FilePath = filePath
		meta.ParseMode = mode
		meta.ParseStatus = "error"
		meta.ErrorMsg = err.Error()
		return &ParseResult{Meta: meta}
	}

	return result
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

// openOutput opens a file for writing, optionally wrapping with gzip.
// Returns the underlying file, a writer (possibly gzipped), and a close func.
func openOutput(path string) (*os.File, io.Writer, func(), error) {
	f, err := os.Create(path)
	if err != nil {
		return nil, nil, nil, err
	}

	if strings.HasSuffix(path, ".gz") {
		// BestSpeed, not the default level. The writer goroutine is the only
		// serial stage in the pipeline, and profiling put compress/flate at
		// 9.2% of total CPU — the entire measured serial fraction. Level 1
		// cuts that roughly in half for ~15% more bytes on disk, and the
		// decompressed stream is unchanged either way.
		gw, _ := gzip.NewWriterLevel(f, gzip.BestSpeed)
		closer := func() {
			gw.Close()
			f.Close()
		}
		return f, gw, closer, nil
	}

	closer := func() {
		f.Close()
	}
	return f, f, closer, nil
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

func main() {
	var (
		filesFrom    string
		archiveRoot  string
		outFile      string
		manifestFile string
		concurrency  int
		showVersion  bool
	)

	flag.StringVar(&filesFrom, "files-from", "", "filelist, one path per line (required)")
	flag.StringVar(&archiveRoot, "archive-root", "/wrds/sec/archives", "prepended to relative paths")
	flag.StringVar(&outFile, "out", "", "holdings output TSV (gzipped if .gz suffix)")
	flag.StringVar(&manifestFile, "manifest", "", "manifest output TSV (gzipped if .gz suffix)")
	flag.IntVar(&concurrency, "concurrency", runtime.NumCPU()*8, "worker goroutines")
	flag.BoolVar(&showVersion, "version", false, "print version and exit")
	flag.BoolVar(&fastXML, "fast-xml", true, "use the hand-rolled information-table scanner")
	flag.BoolVar(&verifyFast, "verify-fast-xml", false,
		"cross-check every fast-scanned filing against encoding/xml (slow; equivalence harness)")
	flag.BoolVar(&decodeCharset, "decode-charset", true,
		"transcode windows-1252/latin-1 filing XML to UTF-8 (false reproduces the pre-fix drop)")
	flag.Parse()

	if showVersion {
		fmt.Println(version)
		return
	}

	if filesFrom == "" || outFile == "" || manifestFile == "" {
		fmt.Fprintln(os.Stderr, "error: -files-from, -out, and -manifest are required")
		flag.Usage()
		os.Exit(2)
	}

	paths, err := readFilelist(filesFrom)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error reading filelist: %v\n", err)
		os.Exit(1)
	}

	// Open output files.
	_, holdingsWriter, holdingsClose, err := openOutput(outFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error opening holdings output: %v\n", err)
		os.Exit(1)
	}
	defer holdingsClose()

	_, manifestWriter, manifestClose, err := openOutput(manifestFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error opening manifest output: %v\n", err)
		os.Exit(1)
	}
	defer manifestClose()

	// Channels.
	jobs := make(chan string, 1024)
	results := make(chan *ParseResult, 1024)

	// Worker pool.
	var wg sync.WaitGroup
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for p := range jobs {
				full := p
				if archiveRoot != "" && !strings.HasPrefix(p, "/") {
					full = strings.TrimRight(archiveRoot, "/") + "/" + p
				}

				buf, err := os.ReadFile(full)
				if err != nil {
					fmt.Fprintf(os.Stderr, "%s: %v\n", full, err)
					results <- &ParseResult{
						Meta: FilingMeta{
							FilePath:    p,
							ParseStatus: "error",
							ErrorMsg:    err.Error(),
						},
					}
					continue
				}

				result := parseFile(buf, p)
				results <- result
			}
		}()
	}

	// Writer goroutine.
	var writerWG sync.WaitGroup
	writerWG.Add(1)
	go func() {
		defer writerWG.Done()
		hBuf := bufio.NewWriterSize(holdingsWriter, 1<<20)
		mBuf := bufio.NewWriterSize(manifestWriter, 1<<20)
		defer hBuf.Flush()
		defer mBuf.Flush()

		for r := range results {
			// Write holdings rows.
			for _, row := range r.Rows {
				hBuf.WriteString(row.TSV())
				hBuf.WriteByte('\n')
			}
			// Write manifest row.
			mBuf.WriteString(r.Meta.TSV())
			mBuf.WriteByte('\n')
		}
	}()

	// Feed jobs.
	for _, p := range paths {
		jobs <- p
	}
	close(jobs)
	wg.Wait()
	close(results)
	writerWG.Wait()
}
