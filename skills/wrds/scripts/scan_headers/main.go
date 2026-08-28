// scan_headers — fast EDGAR header indexer.
//
// Reads the SGML header of each filing (up to </SEC-HEADER>) and emits one TSV
// row per record to stdout. Two emit modes share the header read:
//
//	roles  (default) one row per (file, role, cik)   — role-block CIKs
//	series           one row per (file, series, class) — 40-Act series/class block
//
// Companion binary `scan_covers` reads a filelist and extracts cover-page
// fields (item12, max_prc, etc.) via per-form profiles.
//
// Usage:
//
//	scan_headers -shard /wrds/sec/archives/000000 [-concurrency N]
//	scan_headers -files-from list.txt -emit series [-archive-root DIR]
//
// A filelist path may be absolute or relative to -archive-root. The `fname`
// column of wrdssec_all.wrds_forms is `edgar/data/{cik}/{accession}.txt`, which
// is NOT the archive layout — convert to {cik:010d}[:6]/{cik}/{accession}.txt
// before writing the filelist.
package main

import (
	"bufio"
	"bytes"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
)

// roles mode kept its original 4 KB window; the series/class block sits below
// the role blocks and a registrant filing for dozens of series overruns it.
const (
	rolesHeaderBytes  = 4096
	seriesHeaderBytes = 1 << 20
)

var (
	reAccession = regexp.MustCompile(`ACCESSION NUMBER:[ \t]+([^ \t\r\n]+)`)
	reFormType  = regexp.MustCompile(`CONFORMED SUBMISSION TYPE:[ \t]+([^\r\n]+)`)
	reFiled     = regexp.MustCompile(`FILED AS OF DATE:[ \t]+([0-9]+)`)
	reCIK       = regexp.MustCompile(`CENTRAL INDEX KEY:[ \t]+([0-9]+)`)
	// Role header: starts column 0, uppercase tokens + spaces/slashes/hyphens,
	// followed by ':' and nothing but whitespace to EOL. Matches "FILER:",
	// "REPORTING-OWNER:", "SUBJECT COMPANY:", etc.
	reRole    = regexp.MustCompile(`^([A-Z][A-Z0-9 /\-]*):[ \t\r]*$`)
	endMarker = []byte("</SEC-HEADER>")
)

type row struct {
	path, formType, filedDate, accession, role, cik string
}

func (r row) fields() []string {
	return []string{r.path, r.formType, r.filedDate, r.accession, r.role, r.cik}
}

// readHeader returns the header bytes up to </SEC-HEADER>, capped at max.
func readHeader(path string, max int) ([]byte, bool) {
	f, err := os.Open(path)
	if err != nil {
		return nil, false
	}
	defer f.Close()

	buf := make([]byte, max)
	n, _ := io.ReadFull(f, buf)
	if n <= 0 {
		return nil, false
	}
	buf = buf[:n]
	if idx := bytes.Index(buf, endMarker); idx >= 0 {
		return buf[:idx], true
	}
	// Cap reached without the end marker: drop the final, possibly truncated
	// line so a partial value cannot leak into the output.
	if n == max {
		if nl := bytes.LastIndexByte(buf, '\n'); nl >= 0 {
			buf = buf[:nl]
		}
	}
	return buf, true
}

// scanTop pulls the three submission-level fields every mode needs.
func scanTop(header []byte) (accession, formType, filedDate string) {
	sc := bufio.NewScanner(bytes.NewReader(header))
	sc.Buffer(make([]byte, 0, 8192), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if accession == "" {
			if m := reAccession.FindStringSubmatch(line); m != nil {
				accession = m[1]
			}
		}
		if formType == "" {
			if m := reFormType.FindStringSubmatch(line); m != nil {
				formType = strings.TrimRight(strings.TrimSpace(m[1]), "\r")
			}
		}
		if filedDate == "" {
			if m := reFiled.FindStringSubmatch(line); m != nil {
				filedDate = m[1]
			}
		}
		if accession != "" && formType != "" && filedDate != "" {
			return
		}
	}
	return
}

func processRoles(path string) [][]string {
	header, ok := readHeader(path, rolesHeaderBytes)
	if !ok {
		return nil
	}

	var (
		accession, formType, filedDate string
		pendingRole, pendingCIK        string
		rows                           [][]string
	)

	flush := func() {
		if pendingRole != "" && pendingCIK != "" {
			rows = append(rows, row{
				path: path, formType: formType, filedDate: filedDate,
				accession: accession, role: pendingRole, cik: pendingCIK,
			}.fields())
		}
		pendingRole = ""
		pendingCIK = ""
	}

	scanner := bufio.NewScanner(bytes.NewReader(header))
	scanner.Buffer(make([]byte, 0, 8192), 1<<20)
	for scanner.Scan() {
		line := scanner.Text()

		if accession == "" {
			if m := reAccession.FindStringSubmatch(line); m != nil {
				accession = m[1]
				continue
			}
		}
		if formType == "" {
			if m := reFormType.FindStringSubmatch(line); m != nil {
				formType = strings.TrimRight(strings.TrimSpace(m[1]), "\r")
				continue
			}
		}
		if filedDate == "" {
			if m := reFiled.FindStringSubmatch(line); m != nil {
				filedDate = m[1]
				continue
			}
		}

		// Role header line
		if m := reRole.FindStringSubmatch(line); m != nil {
			flush()
			pendingRole = strings.TrimSpace(m[1])
			continue
		}

		// CIK line — first one per role block wins
		if pendingRole != "" && pendingCIK == "" {
			if m := reCIK.FindStringSubmatch(line); m != nil {
				pendingCIK = m[1]
				flush()
			}
		}
	}
	flush()
	return rows
}

func processSeries(path string) [][]string {
	header, ok := readHeader(path, seriesHeaderBytes)
	if !ok {
		return nil
	}
	accession, formType, filedDate := scanTop(header)
	var rows [][]string
	for _, r := range parseSeriesBlock(header, path, accession, formType, filedDate) {
		rows = append(rows, r.fields())
	}
	return rows
}

// feedFilelist pushes each line of the filelist, resolving relative paths
// against archiveRoot.
func feedFilelist(listPath, archiveRoot string, paths chan<- string) error {
	f, err := os.Open(listPath)
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 8192), 1<<20)
	for sc.Scan() {
		p := strings.TrimSpace(sc.Text())
		if p == "" {
			continue
		}
		if !filepath.IsAbs(p) {
			p = filepath.Join(archiveRoot, p)
		}
		paths <- p
	}
	return sc.Err()
}

func main() {
	var (
		shard       string
		filesFrom   string
		archiveRoot string
		emit        string
		header      bool
		concurrency int
	)
	flag.StringVar(&shard, "shard", "", "shard directory to walk (e.g. /wrds/sec/archives/000000)")
	flag.StringVar(&filesFrom, "files-from", "", "filelist, one filing path per line (alternative to -shard)")
	flag.StringVar(&archiveRoot, "archive-root", "/wrds/sec/archives", "prepended to relative filelist paths")
	flag.StringVar(&emit, "emit", "roles", "what to emit: roles | series")
	flag.BoolVar(&header, "header", false, "write a header row")
	flag.IntVar(&concurrency, "concurrency", runtime.NumCPU()*4, "worker goroutines")
	flag.Parse()

	if (shard == "") == (filesFrom == "") {
		fmt.Fprintln(os.Stderr, "error: exactly one of -shard or -files-from required")
		os.Exit(2)
	}

	var process func(string) [][]string
	var columns []string
	switch emit {
	case "roles":
		process, columns = processRoles, []string{
			"filepath", "form_type", "filed_date", "accession", "role", "cik"}
	case "series":
		process, columns = processSeries, seriesColumns
	default:
		fmt.Fprintf(os.Stderr, "error: unknown -emit %q (want roles or series)\n", emit)
		os.Exit(2)
	}

	paths := make(chan string, 1024)
	results := make(chan [][]string, 1024)

	var wg sync.WaitGroup
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for p := range paths {
				if r := process(p); len(r) > 0 {
					results <- r
				}
			}
		}()
	}

	var writerWG sync.WaitGroup
	writerWG.Add(1)
	go func() {
		defer writerWG.Done()
		bw := bufio.NewWriterSize(os.Stdout, 1<<20)
		defer bw.Flush()
		if header {
			fmt.Fprintln(bw, strings.Join(columns, "\t"))
		}
		for rs := range results {
			for _, r := range rs {
				fmt.Fprintln(bw, strings.Join(r, "\t"))
			}
		}
	}()

	var err error
	if filesFrom != "" {
		err = feedFilelist(filesFrom, archiveRoot, paths)
	} else {
		err = filepath.WalkDir(shard, func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return nil // tolerate transient NFS errors
			}
			if d.IsDir() {
				return nil
			}
			if strings.HasSuffix(path, ".txt") {
				paths <- path
			}
			return nil
		})
	}
	close(paths)
	wg.Wait()
	close(results)
	writerWG.Wait()

	if err != nil {
		fmt.Fprintf(os.Stderr, "input error: %v\n", err)
		os.Exit(1)
	}
}
