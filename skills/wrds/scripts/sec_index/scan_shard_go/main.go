// scan_shard_go — Variant B.
//
// Walks an SEC archive shard, reads the first 4 KB of each .txt file (or up
// to </SEC-HEADER>), extracts accession / form_type / filed_date / role-block
// CIKs, and emits one TSV row per (file, role, cik) to stdout.
//
// Usage:
//   scan_shard_go -shard /wrds/sec/archives/000000 [-concurrency N]
//
// Output columns (tab-separated):
//   filepath  form_type  filed_date  accession  role  cik
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

const headerBytes = 4096

var (
	reAccession = regexp.MustCompile(`ACCESSION NUMBER:[ \t]+([^ \t\r\n]+)`)
	reFormType  = regexp.MustCompile(`CONFORMED SUBMISSION TYPE:[ \t]+([^\r\n]+)`)
	reFiled     = regexp.MustCompile(`FILED AS OF DATE:[ \t]+([0-9]+)`)
	reCIK       = regexp.MustCompile(`CENTRAL INDEX KEY:[ \t]+([0-9]+)`)
	// Role header: starts column 0, uppercase tokens + spaces/slashes/hyphens,
	// followed by ':' and nothing but whitespace to EOL. Matches "FILER:",
	// "REPORTING-OWNER:", "SUBJECT COMPANY:", etc.
	reRole = regexp.MustCompile(`^([A-Z][A-Z0-9 /\-]*):[ \t\r]*$`)
	endMarker = []byte("</SEC-HEADER>")
)

type row struct {
	path, formType, filedDate, accession, role, cik string
}

func processFile(path string) []row {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	buf := make([]byte, headerBytes)
	n, _ := io.ReadFull(f, buf)
	if n <= 0 {
		return nil
	}
	buf = buf[:n]
	if idx := bytes.Index(buf, endMarker); idx >= 0 {
		buf = buf[:idx]
	} else if n == headerBytes {
		// 4KB fill without hitting </SEC-HEADER>: drop the final (possibly
		// truncated) line so partial CIKs don't leak into the output.
		if nl := bytes.LastIndexByte(buf, '\n'); nl >= 0 {
			buf = buf[:nl]
		}
	}

	var (
		accession, formType, filedDate string
		pendingRole, pendingCIK        string
		rows                           []row
	)

	flush := func() {
		if pendingRole != "" && pendingCIK != "" {
			rows = append(rows, row{
				path: path, formType: formType, filedDate: filedDate,
				accession: accession, role: pendingRole, cik: pendingCIK,
			})
		}
		pendingRole = ""
		pendingCIK = ""
	}

	scanner := bufio.NewScanner(bytes.NewReader(buf))
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

func main() {
	var (
		shard       string
		concurrency int
	)
	flag.StringVar(&shard, "shard", "", "shard directory (e.g. /wrds/sec/archives/000000)")
	flag.IntVar(&concurrency, "concurrency", runtime.NumCPU()*4, "worker goroutines")
	flag.Parse()

	if shard == "" {
		fmt.Fprintln(os.Stderr, "error: -shard required")
		os.Exit(2)
	}

	paths := make(chan string, 1024)
	results := make(chan []row, 1024)

	// Workers
	var wg sync.WaitGroup
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for p := range paths {
				if r := processFile(p); len(r) > 0 {
					results <- r
				}
			}
		}()
	}

	// Writer
	var writerWG sync.WaitGroup
	writerWG.Add(1)
	go func() {
		defer writerWG.Done()
		bw := bufio.NewWriterSize(os.Stdout, 1<<20)
		defer bw.Flush()
		for rs := range results {
			for _, r := range rs {
				fmt.Fprintf(bw, "%s\t%s\t%s\t%s\t%s\t%s\n",
					r.path, r.formType, r.filedDate, r.accession, r.role, r.cik)
			}
		}
	}()

	// Walk
	err := filepath.WalkDir(shard, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
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
	close(paths)
	wg.Wait()
	close(results)
	writerWG.Wait()

	if err != nil {
		fmt.Fprintf(os.Stderr, "walk error: %v\n", err)
		os.Exit(1)
	}
}
