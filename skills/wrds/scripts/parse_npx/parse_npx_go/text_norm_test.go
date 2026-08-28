package main

import (
	"strings"
	"testing"
)

func TestTextNormalization(t *testing.T) {
	t.Run("named and numeric entities decode", func(t *testing.T) {
		src := []byte(`<p>AT&amp;T &quot;Inc.&quot;&nbsp;&#160;&#38;&#x26; O&apos;Neil &mdash; 5 &lt; 6 &gt; 4</p>`)
		got := string(stripHTML(src))
		for _, want := range []string{`AT&T`, `"Inc."`, `&&`, `O'Neil`, "—", `5 < 6 > 4`} {
			if !strings.Contains(got, want) {
				t.Errorf("stripHTML output missing %q; got %q", want, got)
			}
		}
		if strings.Contains(got, "&amp;") || strings.Contains(got, "&#") || strings.Contains(got, "&nbsp;") {
			t.Errorf("undecoded entity survived: %q", got)
		}
	})

	t.Run("block tags break lines and inline tags vanish", func(t *testing.T) {
		src := []byte(`<HTML><BODY>` +
			`<STYLE>.x{color:red}</STYLE>` +
			`<SCRIPT>var drop = 1;</SCRIPT>` +
			`<P><FONT SIZE="2">Meeting Date: <B>FEB 28, 2017</B></FONT></P>` +
			`<DIV>Record Date: <SPAN>DEC 30, 2016</SPAN></DIV>` +
			`<TABLE><TR><TD>1.1</TD><TD>Elect Director</TD></TR></TABLE>` +
			`First<BR>Second` +
			`</BODY></HTML>`)
		got := string(stripHTML(src))
		if strings.Contains(got, "<") || strings.Contains(got, ">") {
			t.Fatalf("markup survived stripHTML: %q", got)
		}
		if strings.Contains(got, "color:red") || strings.Contains(got, "var drop") {
			t.Fatalf("style/script content was not dropped: %q", got)
		}
		lines := []string{}
		for _, ln := range strings.Split(got, "\n") {
			if s := strings.TrimSpace(ln); s != "" {
				lines = append(lines, s)
			}
		}
		joined := strings.Join(lines, "|")
		// Inline markup must not split a line; block markup must.
		if !strings.Contains(joined, "Meeting Date: FEB 28, 2017") {
			t.Errorf("inline tags split a line; lines were %q", joined)
		}
		if !strings.Contains(joined, "Record Date: DEC 30, 2016") {
			t.Errorf("inline tags split a line; lines were %q", joined)
		}
		for _, want := range []string{"First", "Second"} {
			found := false
			for _, ln := range lines {
				if ln == want {
					found = true
				}
			}
			if !found {
				t.Errorf("<BR> did not produce a line break before %q; lines were %q", want, joined)
			}
		}
		if len(lines) < 4 {
			t.Errorf("block tags did not preserve line structure; got %d lines: %q", len(lines), joined)
		}
	})

	t.Run("windows-1252 body round-trips", func(t *testing.T) {
		body := []byte("<?xml version=\"1.0\" encoding=\"windows-1252\"?>\n<r>\x93Smart\x94 don\x92t \x97 dash \x85</r>")
		out, err := normalizeCharset(body)
		if err != nil {
			t.Fatalf("normalizeCharset(windows-1252) returned error: %v", err)
		}
		got := string(out)
		for _, want := range []string{"“Smart”", "don’t", "—", "…"} {
			if !strings.Contains(got, want) {
				t.Errorf("cp1252 byte not transcoded; want %q in %q", want, got)
			}
		}
		if strings.ContainsRune(got, '�') {
			t.Errorf("transcoding produced a replacement rune: %q", got)
		}
	})

	t.Run("latin-1 and mislabelled ascii decode", func(t *testing.T) {
		for _, label := range []string{"iso-8859-1", "us-ascii", "ascii"} {
			body := []byte("<?xml version=\"1.0\" encoding=\"" + label + "\"?>\n<r>caf\xe9</r>")
			out, err := normalizeCharset(body)
			if err != nil {
				t.Errorf("normalizeCharset(%s) returned error: %v", label, err)
				continue
			}
			if !strings.Contains(string(out), "café") {
				t.Errorf("normalizeCharset(%s) = %q, want it to contain %q", label, out, "café")
			}
		}
	})

	t.Run("utf-8 passes through unchanged", func(t *testing.T) {
		body := []byte("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<r>café “q”</r>")
		out, err := normalizeCharset(body)
		if err != nil {
			t.Fatalf("normalizeCharset(utf-8) returned error: %v", err)
		}
		if string(out) != string(body) {
			t.Fatalf("utf-8 body was altered:\n got %q\nwant %q", out, body)
		}
	})

	t.Run("unknown encoding label errors rather than emptying", func(t *testing.T) {
		body := []byte("<?xml version=\"1.0\" encoding=\"shift_jis\"?>\n<r>x</r>")
		out, err := normalizeCharset(body)
		if err == nil {
			t.Fatalf("normalizeCharset(shift_jis) returned nil error with output %q", out)
		}
	})
}
