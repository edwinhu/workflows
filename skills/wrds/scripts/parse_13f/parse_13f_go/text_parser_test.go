package main

import (
	"strings"
	"testing"
)

// Minimal SGML filing for testing header extraction + basic holdings parsing.
const testFiling1 = `<SEC-DOCUMENT>0000000000-01-000001.txt : 20010401
<SEC-HEADER>0000000000-01-000001.hdr.sgml : 20010401
<ACCEPTANCE-DATETIME>20010401120000
ACCESSION NUMBER:		0000000000-01-000001
CONFORMED SUBMISSION TYPE:	13F-HR
FILED AS OF DATE:		20010401
CONFORMED PERIOD OF REPORT:	20010331

FILER:

	COMPANY DATA:
		COMPANY CONFORMED NAME:			ACME INVESTMENT ADVISORS
		CENTRAL INDEX KEY:			0001234567

</SEC-HEADER>
<DOCUMENT>
<TYPE>13F-HR
<TABLE>
NAME OF ISSUER         TITLE OF CLASS         CUSIP       VALUE   SHARES  SH/PRN  INVDISC  SOLE    SHARED  NONE
---                    ---                    ---         ---     ---     ---     ---      ---     ---     ---
APPLE INC              COM                    037833100   50000   100000  SH      SOLE     100000  0       0
MICROSOFT CORP         COM                    594918104   30000   50000   SH      SOLE     50000   0       0
GOOGLE INC             PUT                    38259P508   10000   20000   SH      SOLE     20000   0       0
AMAZON COM INC         COM                    023135106   25000   75000   PRN     SOLE     75000   0       0
</TABLE>
</DOCUMENT>
</SEC-DOCUMENT>
`

func TestParseTextBasic(t *testing.T) {
	result, err := parseText([]byte(testFiling1), "/test/path/filing.txt")
	if err != nil {
		t.Fatalf("parseText returned error: %v", err)
	}

	// Check metadata
	if result.Meta.CIK != "0001234567" {
		t.Errorf("CIK = %q, want %q", result.Meta.CIK, "0001234567")
	}
	if result.Meta.PeriodOfReport != "20010331" {
		t.Errorf("PeriodOfReport = %q, want %q", result.Meta.PeriodOfReport, "20010331")
	}
	if result.Meta.FiledDate != "20010401" {
		t.Errorf("FiledDate = %q, want %q", result.Meta.FiledDate, "20010401")
	}
	if result.Meta.FormType != "13F-HR" {
		t.Errorf("FormType = %q, want %q", result.Meta.FormType, "13F-HR")
	}
	if result.Meta.CompanyName != "ACME INVESTMENT ADVISORS" {
		t.Errorf("CompanyName = %q, want %q", result.Meta.CompanyName, "ACME INVESTMENT ADVISORS")
	}
	if result.Meta.Accession != "0000000000-01-000001" {
		t.Errorf("Accession = %q, want %q", result.Meta.Accession, "0000000000-01-000001")
	}
	if result.Meta.ParseMode != "text" {
		t.Errorf("ParseMode = %q, want %q", result.Meta.ParseMode, "text")
	}
	if result.Meta.ParseStatus != "ok" {
		t.Errorf("ParseStatus = %q, want %q", result.Meta.ParseStatus, "ok")
	}

	// PUT should be filtered out, PRN should be filtered out
	// Expect: APPLE (SH), MICROSOFT (SH) = 2 rows
	if len(result.Rows) != 2 {
		t.Fatalf("got %d rows, want 2 (PUT and PRN filtered)", len(result.Rows))
	}
	if result.Meta.NRows != 2 {
		t.Errorf("NRows = %d, want 2", result.Meta.NRows)
	}

	// Check first row (APPLE)
	apple := result.Rows[0]
	if apple.NameOfIssuer != "APPLE INC" {
		t.Errorf("row0 NameOfIssuer = %q, want %q", apple.NameOfIssuer, "APPLE INC")
	}
	if apple.TitleOfClass != "COM" {
		t.Errorf("row0 TitleOfClass = %q, want %q", apple.TitleOfClass, "COM")
	}
	if apple.CUSIP9 != "037833100" {
		t.Errorf("row0 CUSIP9 = %q, want %q", apple.CUSIP9, "037833100")
	}
	if apple.Value != 50000 {
		t.Errorf("row0 Value = %d, want 50000", apple.Value)
	}
	if apple.Shares != 100000 {
		t.Errorf("row0 Shares = %d, want 100000", apple.Shares)
	}
	if apple.SharesType != "SH" {
		t.Errorf("row0 SharesType = %q, want %q", apple.SharesType, "SH")
	}
	if apple.VotingSole != 100000 {
		t.Errorf("row0 VotingSole = %d, want 100000", apple.VotingSole)
	}
	if apple.ParseMode != "text" {
		t.Errorf("row0 ParseMode = %q, want %q", apple.ParseMode, "text")
	}

	// Check second row (MICROSOFT)
	msft := result.Rows[1]
	if msft.NameOfIssuer != "MICROSOFT CORP" {
		t.Errorf("row1 NameOfIssuer = %q, want %q", msft.NameOfIssuer, "MICROSOFT CORP")
	}
	if msft.CUSIP9 != "594918104" {
		t.Errorf("row1 CUSIP9 = %q, want %q", msft.CUSIP9, "594918104")
	}
	if msft.Shares != 50000 {
		t.Errorf("row1 Shares = %d, want 50000", msft.Shares)
	}
}

func TestParseTextCommaNumbers(t *testing.T) {
	filing := `<SEC-DOCUMENT>
<SEC-HEADER>
ACCESSION NUMBER:		0000000000-02-000001
CONFORMED SUBMISSION TYPE:	13F-HR
FILED AS OF DATE:		20020401
CONFORMED PERIOD OF REPORT:	20020331
FILER:
	COMPANY DATA:
		COMPANY CONFORMED NAME:			TEST FUND
		CENTRAL INDEX KEY:			0009999999
</SEC-HEADER>
<DOCUMENT>
<TYPE>13F-HR
<TABLE>
NAME OF ISSUER         TITLE OF CLASS         CUSIP       VALUE       SHARES      SH/PRN
APPLE INC              COM                    037833100   1,234,567   2,345,678   SH
</TABLE>
</DOCUMENT>
</SEC-DOCUMENT>
`
	result, err := parseText([]byte(filing), "/test/commas.txt")
	if err != nil {
		t.Fatalf("parseText returned error: %v", err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(result.Rows))
	}
	if result.Rows[0].Value != 1234567 {
		t.Errorf("Value = %d, want 1234567", result.Rows[0].Value)
	}
	if result.Rows[0].Shares != 2345678 {
		t.Errorf("Shares = %d, want 2345678", result.Rows[0].Shares)
	}
}

func TestParseTextColumnSwapCIK918509(t *testing.T) {
	// Dutch pension CIK 918509 pre-2005: value and shares should be swapped
	filing := `<SEC-DOCUMENT>
<SEC-HEADER>
ACCESSION NUMBER:		0000000000-03-000001
CONFORMED SUBMISSION TYPE:	13F-HR
FILED AS OF DATE:		20030401
CONFORMED PERIOD OF REPORT:	20030331
FILER:
	COMPANY DATA:
		COMPANY CONFORMED NAME:			STICHTING PENSIOENFONDS
		CENTRAL INDEX KEY:			0000918509
</SEC-HEADER>
<DOCUMENT>
<TYPE>13F-HR
<TABLE>
NAME OF ISSUER         TITLE OF CLASS         CUSIP       VALUE   SHARES  SH/PRN
APPLE INC              COM                    037833100   500     1000    SH
</TABLE>
</DOCUMENT>
</SEC-DOCUMENT>
`
	result, err := parseText([]byte(filing), "/test/dutch.txt")
	if err != nil {
		t.Fatalf("parseText returned error: %v", err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(result.Rows))
	}
	// The filing reports shares before value (swapped columns).
	// Parser reads position 1 as value=500, position 2 as shares=1000.
	// After swap correction: value=1000, shares=500.
	if result.Rows[0].Value != 1000 {
		t.Errorf("Value = %d, want 1000 (swapped to correct)", result.Rows[0].Value)
	}
	if result.Rows[0].Shares != 500 {
		t.Errorf("Shares = %d, want 500 (swapped to correct)", result.Rows[0].Shares)
	}
}

func TestParseTextAmendment(t *testing.T) {
	filing := `<SEC-DOCUMENT>
<SEC-HEADER>
ACCESSION NUMBER:		0000000000-04-000001
CONFORMED SUBMISSION TYPE:	13F-HR/A
FILED AS OF DATE:		20040401
CONFORMED PERIOD OF REPORT:	20040331
FILER:
	COMPANY DATA:
		COMPANY CONFORMED NAME:			AMEND FUND
		CENTRAL INDEX KEY:			0005555555
</SEC-HEADER>
<DOCUMENT>
<TYPE>13F-HR/A
<TABLE>
NAME OF ISSUER         TITLE OF CLASS         CUSIP       VALUE   SHARES  SH/PRN  INVDISC
APPLE INC              COM                    037833100   50000   100000  SH      SOLE
</TABLE>
</DOCUMENT>
</SEC-DOCUMENT>
`
	result, err := parseText([]byte(filing), "/test/amend.txt")
	if err != nil {
		t.Fatalf("parseText returned error: %v", err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(result.Rows))
	}
	if !result.Rows[0].IsAmendment {
		t.Error("IsAmendment should be true for 13F-HR/A")
	}
}

func TestParseTextFilterDerivatives(t *testing.T) {
	filing := `<SEC-DOCUMENT>
<SEC-HEADER>
ACCESSION NUMBER:		0000000000-05-000001
CONFORMED SUBMISSION TYPE:	13F-HR
FILED AS OF DATE:		20050401
CONFORMED PERIOD OF REPORT:	20050331
FILER:
	COMPANY DATA:
		COMPANY CONFORMED NAME:			FILTER TEST
		CENTRAL INDEX KEY:			0007777777
</SEC-HEADER>
<DOCUMENT>
<TYPE>13F-HR
<TABLE>
NAME OF ISSUER         TITLE OF CLASS         CUSIP       VALUE   SHARES  SH/PRN
APPLE INC              COM                    037833100   50000   100000  SH
APPLE INC              CALL                   037833100   10000   20000   SH
APPLE INC              PUT                    037833101   10000   20000   SH
APPLE INC              OPT                    037833102   10000   20000   SH
APPLE INC              CONV BD                037833103   10000   20000   SH
APPLE INC              CONV BOND              037833104   10000   20000   SH
APPLE INC              COM WAR                037833105   10000   20000   SH
</TABLE>
</DOCUMENT>
</SEC-DOCUMENT>
`
	result, err := parseText([]byte(filing), "/test/filter.txt")
	if err != nil {
		t.Fatalf("parseText returned error: %v", err)
	}
	// Only the first row (COM) should survive
	if len(result.Rows) != 1 {
		t.Fatalf("got %d rows, want 1 (derivatives filtered)", len(result.Rows))
	}
	if result.Rows[0].TitleOfClass != "COM" {
		t.Errorf("surviving row TitleOfClass = %q, want COM", result.Rows[0].TitleOfClass)
	}
}

func TestParseTextMultiLineVoting(t *testing.T) {
	// Test continuation lines for voting authority
	filing := `<SEC-DOCUMENT>
<SEC-HEADER>
ACCESSION NUMBER:		0000000000-12-000001
CONFORMED SUBMISSION TYPE:	13F-HR
FILED AS OF DATE:		20120401
CONFORMED PERIOD OF REPORT:	20120331
FILER:
	COMPANY DATA:
		COMPANY CONFORMED NAME:			MULTILINE FUND
		CENTRAL INDEX KEY:			0001111111
</SEC-HEADER>
<DOCUMENT>
<TYPE>13F-HR
<TABLE>
NAME OF ISSUER         TITLE OF CLASS         CUSIP       VALUE   SHARES  SH/PRN  INVDISC
APPLE INC              COM                    037833100   50000   100000  SH      SOLE
                                                                                          100000  0       0
MICROSOFT CORP         COM                    594918104   30000   50000   SH      SOLE
                                                                                          40000   5000    5000
</TABLE>
</DOCUMENT>
</SEC-DOCUMENT>
`
	result, err := parseText([]byte(filing), "/test/multiline.txt")
	if err != nil {
		t.Fatalf("parseText returned error: %v", err)
	}
	if len(result.Rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(result.Rows))
	}
	// First row should pick up voting from continuation line
	if result.Rows[0].VotingSole != 100000 {
		t.Errorf("row0 VotingSole = %d, want 100000", result.Rows[0].VotingSole)
	}
	// Second row should pick up voting from continuation line
	if result.Rows[1].VotingSole != 40000 {
		t.Errorf("row1 VotingSole = %d, want 40000", result.Rows[1].VotingSole)
	}
	if result.Rows[1].VotingShared != 5000 {
		t.Errorf("row1 VotingShared = %d, want 5000", result.Rows[1].VotingShared)
	}
	if result.Rows[1].VotingNone != 5000 {
		t.Errorf("row1 VotingNone = %d, want 5000", result.Rows[1].VotingNone)
	}
}

func TestParseTextNoTable(t *testing.T) {
	// Filing with no TABLE tag should still attempt to parse
	filing := `<SEC-DOCUMENT>
<SEC-HEADER>
ACCESSION NUMBER:		0000000000-06-000001
CONFORMED SUBMISSION TYPE:	13F-HR
FILED AS OF DATE:		20060401
CONFORMED PERIOD OF REPORT:	20060331
FILER:
	COMPANY DATA:
		COMPANY CONFORMED NAME:			NO TABLE FUND
		CENTRAL INDEX KEY:			0006666666
</SEC-HEADER>
<DOCUMENT>
<TYPE>13F-HR
APPLE INC              COM                    037833100   50000   100000  SH      SOLE     100000  0       0
</DOCUMENT>
</SEC-DOCUMENT>
`
	result, err := parseText([]byte(filing), "/test/notable.txt")
	if err != nil {
		t.Fatalf("parseText returned error: %v", err)
	}
	// Should still parse the holding even without TABLE tags
	if len(result.Rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(result.Rows))
	}
}

func TestParseTextEmptyFiling(t *testing.T) {
	result, err := parseText([]byte(""), "/test/empty.txt")
	if err != nil {
		t.Fatalf("parseText returned error: %v", err)
	}
	if result.Meta.ParseStatus != "error" {
		t.Errorf("ParseStatus = %q, want %q", result.Meta.ParseStatus, "error")
	}
	if len(result.Rows) != 0 {
		t.Errorf("got %d rows, want 0 for empty filing", len(result.Rows))
	}
}

func TestParseHeaderLocal(t *testing.T) {
	meta := parseHeaderLocal([]byte(testFiling1))
	if meta.CIK != "0001234567" {
		t.Errorf("CIK = %q, want %q", meta.CIK, "0001234567")
	}
	if meta.PeriodOfReport != "20010331" {
		t.Errorf("PeriodOfReport = %q, want %q", meta.PeriodOfReport, "20010331")
	}
	if meta.FiledDate != "20010401" {
		t.Errorf("FiledDate = %q, want %q", meta.FiledDate, "20010401")
	}
	if meta.FormType != "13F-HR" {
		t.Errorf("FormType = %q, want %q", meta.FormType, "13F-HR")
	}
	if meta.CompanyName != "ACME INVESTMENT ADVISORS" {
		t.Errorf("CompanyName = %q, want %q", meta.CompanyName, "ACME INVESTMENT ADVISORS")
	}
	if meta.Accession != "0000000000-01-000001" {
		t.Errorf("Accession = %q, want %q", meta.Accession, "0000000000-01-000001")
	}
}

func TestParseLineFields(t *testing.T) {
	tests := []struct {
		name      string
		line      string
		wantIss   string
		wantTitle string
		wantCUSIP string
		wantVal   int64
		wantShr   int64
		wantType  string
	}{
		{
			name:      "standard spacing",
			line:      "APPLE INC              COM                    037833100   50000   100000  SH",
			wantIss:   "APPLE INC",
			wantTitle: "COM",
			wantCUSIP: "037833100",
			wantVal:   50000,
			wantShr:   100000,
			wantType:  "SH",
		},
		{
			name:      "with commas",
			line:      "APPLE INC              COM                    037833100   1,234   2,345,678  SH",
			wantIss:   "APPLE INC",
			wantTitle: "COM",
			wantCUSIP: "037833100",
			wantVal:   1234,
			wantShr:   2345678,
			wantType:  "SH",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := parseLine(tt.line)
			if h == nil {
				t.Fatal("parseLine returned nil")
			}
			if h.nameOfIssuer != tt.wantIss {
				t.Errorf("issuer = %q, want %q", h.nameOfIssuer, tt.wantIss)
			}
			if h.titleOfClass != tt.wantTitle {
				t.Errorf("title = %q, want %q", h.titleOfClass, tt.wantTitle)
			}
			if h.cusip != tt.wantCUSIP {
				t.Errorf("cusip = %q, want %q", h.cusip, tt.wantCUSIP)
			}
			if h.value != tt.wantVal {
				t.Errorf("value = %d, want %d", h.value, tt.wantVal)
			}
			if h.shares != tt.wantShr {
				t.Errorf("shares = %d, want %d", h.shares, tt.wantShr)
			}
			if h.sharesType != tt.wantType {
				t.Errorf("sharesType = %q, want %q", h.sharesType, tt.wantType)
			}
		})
	}
}

func TestParseTextInvestmentDiscretion(t *testing.T) {
	filing := `<SEC-DOCUMENT>
<SEC-HEADER>
ACCESSION NUMBER:		0000000000-07-000001
CONFORMED SUBMISSION TYPE:	13F-HR
FILED AS OF DATE:		20070401
CONFORMED PERIOD OF REPORT:	20070331
FILER:
	COMPANY DATA:
		COMPANY CONFORMED NAME:			DISC FUND
		CENTRAL INDEX KEY:			0008888888
</SEC-HEADER>
<DOCUMENT>
<TYPE>13F-HR
<TABLE>
NAME OF ISSUER         TITLE OF CLASS         CUSIP       VALUE   SHARES  SH/PRN  INVDISC  SOLE    SHARED  NONE
APPLE INC              COM                    037833100   50000   100000  SH      DFND     80000   10000   10000
</TABLE>
</DOCUMENT>
</SEC-DOCUMENT>
`
	result, err := parseText([]byte(filing), "/test/disc.txt")
	if err != nil {
		t.Fatalf("parseText returned error: %v", err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(result.Rows))
	}
	if result.Rows[0].InvestmentDiscretion != "DFND" {
		t.Errorf("InvestmentDiscretion = %q, want DFND", result.Rows[0].InvestmentDiscretion)
	}
	if result.Rows[0].VotingSole != 80000 {
		t.Errorf("VotingSole = %d, want 80000", result.Rows[0].VotingSole)
	}
	if result.Rows[0].VotingShared != 10000 {
		t.Errorf("VotingShared = %d, want 10000", result.Rows[0].VotingShared)
	}
	if result.Rows[0].VotingNone != 10000 {
		t.Errorf("VotingNone = %d, want 10000", result.Rows[0].VotingNone)
	}
}

func TestCIK918509PostSwapThreshold(t *testing.T) {
	// CIK 918509 at or after 20050101 should NOT swap columns
	filing := `<SEC-DOCUMENT>
<SEC-HEADER>
ACCESSION NUMBER:		0000000000-05-000002
CONFORMED SUBMISSION TYPE:	13F-HR
FILED AS OF DATE:		20050401
CONFORMED PERIOD OF REPORT:	20050331
FILER:
	COMPANY DATA:
		COMPANY CONFORMED NAME:			STICHTING PENSIOENFONDS
		CENTRAL INDEX KEY:			0000918509
</SEC-HEADER>
<DOCUMENT>
<TYPE>13F-HR
<TABLE>
NAME OF ISSUER         TITLE OF CLASS         CUSIP       VALUE   SHARES  SH/PRN
APPLE INC              COM                    037833100   500     1000    SH
</TABLE>
</DOCUMENT>
</SEC-DOCUMENT>
`
	result, err := parseText([]byte(filing), "/test/dutch_post.txt")
	if err != nil {
		t.Fatalf("parseText returned error: %v", err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(result.Rows))
	}
	// No swap for post-2005
	if result.Rows[0].Value != 500 {
		t.Errorf("Value = %d, want 500 (no swap post-2005)", result.Rows[0].Value)
	}
	if result.Rows[0].Shares != 1000 {
		t.Errorf("Shares = %d, want 1000 (no swap post-2005)", result.Rows[0].Shares)
	}
}

func TestParseTextCommaDelimited(t *testing.T) {
	// Argyle/Cortland style comma-delimited lines
	filing := `<SEC-DOCUMENT>
<SEC-HEADER>
ACCESSION NUMBER:		0000000000-08-000001
CONFORMED SUBMISSION TYPE:	13F-HR
FILED AS OF DATE:		20080401
CONFORMED PERIOD OF REPORT:	20080331
FILER:
	COMPANY DATA:
		COMPANY CONFORMED NAME:			ARGYLE FUND
		CENTRAL INDEX KEY:			0002222222
</SEC-HEADER>
<DOCUMENT>
<TYPE>13F-HR
<TABLE>
APPLE INC,COM,037833100,50000,100000,SH,SOLE,100000,0,0
</TABLE>
</DOCUMENT>
</SEC-DOCUMENT>
`
	result, err := parseText([]byte(filing), "/test/comma_delim.txt")
	if err != nil {
		t.Fatalf("parseText returned error: %v", err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(result.Rows))
	}
	if result.Rows[0].NameOfIssuer != "APPLE INC" {
		t.Errorf("NameOfIssuer = %q, want %q", result.Rows[0].NameOfIssuer, "APPLE INC")
	}
	if result.Rows[0].Shares != 100000 {
		t.Errorf("Shares = %d, want 100000", result.Rows[0].Shares)
	}
}

func TestIsHeaderOrSeparatorLine(t *testing.T) {
	tests := []struct {
		line string
		want bool
	}{
		{"NAME OF ISSUER         TITLE OF CLASS         CUSIP", true},
		{"---                    ---                    ---", true},
		{"=====  =====  =====", true},
		{"<S>  <C>  <C>", true},
		{"APPLE INC              COM                    037833100   50000   100000  SH", false},
		{"", true}, // blank
		{"   ", true},
	}
	for _, tt := range tests {
		got := isHeaderOrSeparator(tt.line)
		if got != tt.want {
			t.Errorf("isHeaderOrSeparator(%q) = %v, want %v", tt.line, got, tt.want)
		}
	}
}

func TestStripEmbeddedPrice(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"APPLE INC  25.50 COM  037833100  50000  100000  SH", "APPLE INC   COM  037833100  50000  100000  SH"},
		{"NO PRICE HERE COM 037833100 50000 100000 SH", "NO PRICE HERE COM 037833100 50000 100000 SH"},
	}
	for _, tt := range tests {
		got := stripEmbeddedPrice(tt.input)
		// Normalize whitespace for comparison
		got = strings.Join(strings.Fields(got), " ")
		want := strings.Join(strings.Fields(tt.want), " ")
		if got != want {
			t.Errorf("stripEmbeddedPrice(%q) = %q, want %q", tt.input, got, want)
		}
	}
}

// F3: Dashed-separator format + COMcusip concatenation
func TestParseTextDashedSeparatorAndCOMCusip(t *testing.T) {
	// Test that dashed separator lines (---) are skipped and do not
	// interfere with continuation-line logic, and that COMcusip
	// concatenation (e.g., COMMON88579Y101) is properly split.
	filing := `<SEC-DOCUMENT>
<SEC-HEADER>
ACCESSION NUMBER:		0000000000-09-000001
CONFORMED SUBMISSION TYPE:	13F-HR
FILED AS OF DATE:		20090401
CONFORMED PERIOD OF REPORT:	20090331
FILER:
	COMPANY DATA:
		COMPANY CONFORMED NAME:			DASHED FUND
		CENTRAL INDEX KEY:			0003333333
</SEC-HEADER>
<DOCUMENT>
<TYPE>13F-HR
<TABLE>
NAME OF ISSUER         TITLE OF CLASS    CUSIP       VALUE   SHARES  SH/PRN  INVDISC  SOLE    SHARED  NONE
---------------------------------------------------------------------------------------
APPLE INC              COM               037833100   50000   100000  SH      SOLE     100000  0       0
---------------------------------------------------------------------------------------
TESLA INC              COMMON88579Y101               20000   5000    SH      SOLE     5000    0       0
</TABLE>
</DOCUMENT>
</SEC-DOCUMENT>
`
	result, err := parseText([]byte(filing), "/test/dashed.txt")
	if err != nil {
		t.Fatalf("parseText returned error: %v", err)
	}
	if len(result.Rows) != 2 {
		t.Fatalf("got %d rows, want 2 (APPLE + TESLA)", len(result.Rows))
	}
	// APPLE should parse normally
	if result.Rows[0].CUSIP9 != "037833100" {
		t.Errorf("row0 CUSIP9 = %q, want %q", result.Rows[0].CUSIP9, "037833100")
	}
	// TESLA: the CUSIP is extracted from COMMON88579Y101
	if result.Rows[1].CUSIP9 != "88579Y101" {
		t.Errorf("row1 CUSIP9 = %q, want %q", result.Rows[1].CUSIP9, "88579Y101")
	}
	if result.Rows[1].Shares != 5000 {
		t.Errorf("row1 Shares = %d, want 5000", result.Rows[1].Shares)
	}
}

// F3 unit test: fallback CUSIP extraction from concatenated class+CUSIP tokens
func TestFindCUSIPTokenFallbackCOMCusip(t *testing.T) {
	tests := []struct {
		name      string
		line      string
		wantCUSIP string
		wantFound bool
	}{
		{
			name:      "COMMON prefix",
			line:      "TESLA INC              COMMON88579Y101   20000   5000    SH",
			wantCUSIP: "88579Y101",
			wantFound: true,
		},
		{
			name:      "COM prefix",
			line:      "TESLA INC              COM88579Y101   20000   5000    SH",
			wantCUSIP: "88579Y101",
			wantFound: true,
		},
		{
			name:      "CL A prefix",
			line:      "ACME CORP              CL A88579Y101   20000   5000    SH",
			wantCUSIP: "88579Y101",
			wantFound: true,
		},
		{
			name:      "PREFERRED prefix",
			line:      "ACME CORP              PREFERRED88579Y101   20000   5000    SH",
			wantCUSIP: "88579Y101",
			wantFound: true,
		},
		{
			name:      "SH prefix (shares type)",
			line:      "ACME CORP              SH88579Y101   20000   5000    SH",
			wantCUSIP: "88579Y101",
			wantFound: true,
		},
		{
			name:      "standalone CUSIP still works",
			line:      "APPLE INC              COM   037833100   50000   100000  SH",
			wantCUSIP: "037833100",
			wantFound: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			upper := strings.ToUpper(tt.line)
			cusip, idx := findCUSIPToken(upper)
			if tt.wantFound {
				if idx < 0 {
					t.Fatalf("findCUSIPToken returned -1, want CUSIP %q", tt.wantCUSIP)
				}
				if cusip != tt.wantCUSIP {
					t.Errorf("findCUSIPToken CUSIP = %q, want %q", cusip, tt.wantCUSIP)
				}
			} else {
				if idx >= 0 {
					t.Errorf("findCUSIPToken should return -1, got cusip=%q idx=%d", cusip, idx)
				}
			}
		})
	}
}

// F4: Reject tokens ending with SH/PR/PRN as CUSIPs
func TestRejectSHSuffixAsCUSIP(t *testing.T) {
	tests := []struct {
		name     string
		line     string
		wantOK   bool
	}{
		{
			name:   "166239SH is not a CUSIP",
			line:   "ACME CORP   COM   166239SH   1000   SH",
			wantOK: false,
		},
		{
			name:   "123456PRN is not a CUSIP",
			line:   "ACME CORP   COM   123456PRN   1000   SH",
			wantOK: false,
		},
		{
			name:   "valid CUSIP still works",
			line:   "ACME CORP   COM   037833100   1000   SH",
			wantOK: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			upper := strings.ToUpper(tt.line)
			_, idx := findCUSIPToken(upper)
			if tt.wantOK && idx < 0 {
				t.Error("expected findCUSIPToken to find a CUSIP, got -1")
			}
			if !tt.wantOK && idx >= 0 {
				t.Error("expected findCUSIPToken to reject token, but it matched")
			}
		})
	}
}

// F4: Pre-processing separates digits+SH so shares don't bleed into CUSIP column
func TestPreprocessDigitsSH(t *testing.T) {
	input := "ACME CORP   COM   16623910   1,216,329SH   SOLE"
	want := "ACME CORP   COM   16623910   1,216,329 SH   SOLE"
	got := preprocessSHPRN(input)
	if got != want {
		t.Errorf("preprocessSHPRN(%q) = %q, want %q", input, got, want)
	}
}

func TestPreprocessDigitsPRN(t *testing.T) {
	input := "ACME CORP   COM   16623910   500000PRN   SOLE"
	want := "ACME CORP   COM   16623910   500000 PRN   SOLE"
	got := preprocessSHPRN(input)
	if got != want {
		t.Errorf("preprocessSHPRN(%q) = %q, want %q", input, got, want)
	}
}

// P3b: price-stripped single-number-before-SH pattern.
// These cases arise when a 1-2 digit stock price (e.g., 7.47, 2.39, 5.80) is
// stripped, leaving only one number between the CUSIP and the SH marker.
// Without P3b, BCS cascade falls through to P4 (which our suspicious check
// correctly rejects because it grabs the CUSIP number as "value"), then the
// fallback extractNumbers picks the wrong field (an other-manager ID).
func TestP3bPriceStrippedSingleNumber(t *testing.T) {
	tests := []struct {
		name       string
		line       string   // already upper-cased and price-stripped
		cusipRaw   string
		wantShares int64
	}{
		{
			// F1 filing 34606: 2.39 stripped, leaving "341 SH  SH-DEF 6  341  0  0"
			name:       "F1_single_341_after_price_strip",
			line:       "M T R GAMING GRP INC                      CMN 553769100           341 SH      SH-DEF 6           341         0          0",
			cusipRaw:   "553769100",
			wantShares: 341,
		},
		{
			// F9 filing L3: 7.47 stripped, leaving "120 SH  SHARED 20  120"
			name:       "F9_L3_single_120_after_price_strip",
			line:       "TEXTRON INC             COM              883203101    120 SH       SHARED    20                                120",
			cusipRaw:   "883203101",
			wantShares: 120,
		},
		{
			// F9 filing L4: 39.32 stripped, leaving "632 SH  SHARED 21  632"
			name:       "F9_L4_single_632_after_price_strip",
			line:       "TEXTRON INC             COM              883203101       632 SH       SHARED    21                     632",
			cusipRaw:   "883203101",
			wantShares: 632,
		},
		{
			// F10 filing L2: 5.80 stripped, leaving "215 SH  SHARED 20  215"
			name:       "F10_L2_single_215_after_price_strip",
			line:       "PAREXEL INTL CORP       COM           699462107     215    SH       SHARED  20                           215",
			cusipRaw:   "699462107",
			wantShares: 215,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			upper := strings.ToUpper(tt.line)
			_, shares, shType, ok := extractBCSCascade(upper, tt.cusipRaw)
			if !ok {
				t.Fatalf("extractBCSCascade returned ok=false, want shares=%d", tt.wantShares)
			}
			if shares != tt.wantShares {
				t.Errorf("shares = %d, want %d", shares, tt.wantShares)
			}
			if shType != "SH" {
				t.Errorf("sharesType = %q, want SH", shType)
			}
		})
	}
}

// Verify P3 still fires correctly for normal two-number lines (no regression).
func TestP3NotDisplacedByP3b(t *testing.T) {
	// Standard line: value=50000, shares=100000.
	// P3 should fire, NOT P3b.
	line := strings.ToUpper("APPLE INC              COM                    037833100   50000   100000  SH      SOLE     100000  0       0")
	value, shares, _, ok := extractBCSCascade(line, "037833100")
	if !ok {
		t.Fatal("extractBCSCascade returned ok=false for standard P3 case")
	}
	if value != 50000 {
		t.Errorf("value = %d, want 50000", value)
	}
	if shares != 100000 {
		t.Errorf("shares = %d, want 100000", shares)
	}
}

// F4: Full integration test -- shares+SH concatenation should not prevent CUSIP extraction
func TestParseTextSharesSHConcatenation(t *testing.T) {
	filing := `<SEC-DOCUMENT>
<SEC-HEADER>
ACCESSION NUMBER:		0000000000-10-000001
CONFORMED SUBMISSION TYPE:	13F-HR
FILED AS OF DATE:		20100401
CONFORMED PERIOD OF REPORT:	20100331
FILER:
	COMPANY DATA:
		COMPANY CONFORMED NAME:			SH TEST FUND
		CENTRAL INDEX KEY:			0004444444
</SEC-HEADER>
<DOCUMENT>
<TYPE>13F-HR
<TABLE>
NAME OF ISSUER         TITLE OF CLASS    CUSIP       VALUE   SHARES     SH/PRN  INVDISC
APPLE INC              COM               037833100   50000   1,216,329SH        SOLE
</TABLE>
</DOCUMENT>
</SEC-DOCUMENT>
`
	result, err := parseText([]byte(filing), "/test/sh_concat.txt")
	if err != nil {
		t.Fatalf("parseText returned error: %v", err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(result.Rows))
	}
	if result.Rows[0].CUSIP9 != "037833100" {
		t.Errorf("CUSIP9 = %q, want %q", result.Rows[0].CUSIP9, "037833100")
	}
	if result.Rows[0].Shares != 1216329 {
		t.Errorf("Shares = %d, want 1216329", result.Rows[0].Shares)
	}
	if result.Rows[0].SharesType != "SH" {
		t.Errorf("SharesType = %q, want SH", result.Rows[0].SharesType)
	}
}

// ---------------------------------------------------------------------------
// BCS cascade tests
// ---------------------------------------------------------------------------

func TestExtractBCSCascade(t *testing.T) {
	tests := []struct {
		name       string
		line       string
		cusipRaw   string
		wantValue  int64
		wantShares int64
		wantSHType string
		wantOK     bool
	}{
		{
			// Pattern 1 (Babson): CUSIP + check-digit + value(glued) + shares + SH
			name:       "pattern1_babson_glued_value",
			line:       "APPLE INC  COM  037833100950000  100,000 SH  SOLE",
			cusipRaw:   "037833100",
			wantValue:  50000,
			wantShares: 100000,
			wantSHType: "SH",
			wantOK:     true,
		},
		{
			// Pattern 2 (Argyle/Cortland): CUSIP + comma-delimited
			name:       "pattern2_argyle_comma",
			line:       "APPLE INC  COM  037833100,50000,100000",
			cusipRaw:   "037833100",
			wantValue:  50000,
			wantShares: 100000,
			wantSHType: "",
			wantOK:     true,
		},
		{
			// Pattern 3 (standard): CUSIP + optional check-digit + value + shares + SH
			name:       "pattern3_standard",
			line:       "APPLE INC  COM  037833100  50,000  100,000 SH  SOLE",
			cusipRaw:   "037833100",
			wantValue:  50000,
			wantShares: 100000,
			wantSHType: "SH",
			wantOK:     true,
		},
		{
			// Pattern 4 (fallback): two numbers + SH (no CUSIP anchor)
			name:       "pattern4_fallback_no_anchor",
			line:       "APPLE INC  COM  WEIRD_ID  50,000  100,000 SH",
			cusipRaw:   "WEIRD_ID",
			wantValue:  50000,
			wantShares: 100000,
			wantSHType: "SH",
			wantOK:     true,
		},
		{
			// Pattern 5: CUSIP + value + shares (no SH marker)
			name:       "pattern5_no_sh_marker",
			line:       "APPLE INC  COM  037833100 50000 100000  SOLE",
			cusipRaw:   "037833100",
			wantValue:  50000,
			wantShares: 100000,
			wantSHType: "",
			wantOK:     true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			value, shares, shType, ok := extractBCSCascade(tt.line, tt.cusipRaw)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if !ok {
				return
			}
			if value != tt.wantValue {
				t.Errorf("value = %d, want %d", value, tt.wantValue)
			}
			if shares != tt.wantShares {
				t.Errorf("shares = %d, want %d", shares, tt.wantShares)
			}
			if shType != tt.wantSHType {
				t.Errorf("sharesType = %q, want %q", shType, tt.wantSHType)
			}
		})
	}
}

// Test the suspicious-shares heuristic: shares < 1000 and value > shares*50
func TestBCSCascadeSuspiciousShares(t *testing.T) {
	// If the first matching pattern yields shares < 1000 and value > shares*50,
	// it should skip that match and try the next pattern.
	// Here pattern 3 would match "45.67" as shares (price), but that gets
	// rejected and the next pattern picks up the real shares.
	line := "APPLE INC  COM  037833100  50000  45.67  100000 SH  SOLE"
	value, shares, _, ok := extractBCSCascade(line, "037833100")
	if !ok {
		t.Fatal("expected ok=true")
	}
	// The 45.67 should be skipped as suspicious; pattern should find 100000
	// (but the exact behavior depends on which pattern matches -- the key
	// thing is we don't get shares=45)
	if shares < 1000 && value > shares*50 {
		t.Errorf("suspicious shares not filtered: value=%d, shares=%d", value, shares)
	}
}

// Test column-separator repair
func TestRepairColumnSeparators(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		wantValue  int64
		wantShares int64
	}{
		{
			// Malformed comma grouping: ,2345, has 4 digits between commas
			// BCS splits ,234 5, -> strip commas -> "1234 5678" -> value=1234, shares=5678
			name:       "wrong_comma_grouping_4digits",
			input:      "1,2345,678",
			wantValue:  1234,
			wantShares: 5678,
		},
		{
			// Trailing single digit after comma
			name:       "trailing_single_digit",
			input:      "123,456,7",
			wantValue:  0,
			wantShares: 123456,
		},
		{
			// Pattern: NNN,NN,NNN (like 123,45,678)
			name:       "short_middle_group",
			input:      "123,45,678",
			wantValue:  123,
			wantShares: 45678,
		},
		{
			// Normal comma grouping -- no repair needed
			name:       "normal_commas",
			input:      "1,234,567",
			wantValue:  0,
			wantShares: 1234567,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			val, shr := repairColumnSeparators(tt.input)
			if val != tt.wantValue {
				t.Errorf("value = %d, want %d", val, tt.wantValue)
			}
			if shr != tt.wantShares {
				t.Errorf("shares = %d, want %d", shr, tt.wantShares)
			}
		})
	}
}

// Integration test: BCS cascade in parseLine.
// Pattern 1 (Babson glued) requires CUSIP embedded in a longer token,
// which our tokenizer cannot discover without prior CUSIP knowledge.
// This test covers pattern 3 (standard) via parseLine, which is the
// highest-volume pattern.
func TestParseLineBCSCascadeIntegration(t *testing.T) {
	line := "BABSON CAPITAL   COM   037833100   50000   100,000 SH   SOLE"
	h := parseLine(line)
	if h == nil {
		t.Fatal("parseLine returned nil")
	}
	if h.value != 50000 {
		t.Errorf("value = %d, want 50000", h.value)
	}
	if h.shares != 100000 {
		t.Errorf("shares = %d, want 100000", h.shares)
	}
}

// F3b: preprocessSplitCUSIP unit tests
func TestPreprocessSplitCUSIP(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "6-2-1 dashed",
			input: "APPLE INC   COM   066365-10-7   50000   100000  SH",
			want:  "APPLE INC   COM   066365107   50000   100000  SH",
		},
		{
			name:  "6-2-1 spaced",
			input: "APPLE INC   COM   023840 10 1   50000   100000  SH",
			want:  "APPLE INC   COM   023840101   50000   100000  SH",
		},
		{
			name:  "8-1 dashed",
			input: "APPLE INC   COM   03189710-1   50000   100000  SH",
			want:  "APPLE INC   COM   031897101   50000   100000  SH",
		},
		{
			name:  "no change for standard CUSIP",
			input: "APPLE INC   COM   037833100   50000   100000  SH",
			want:  "APPLE INC   COM   037833100   50000   100000  SH",
		},
		{
			name:  "alpha in CUSIP",
			input: "APPLE INC   COM   00846U-10-1   50000   100000  SH",
			want:  "APPLE INC   COM   00846U101   50000   100000  SH",
		},
		{
			name:  "multiple CUSIPs on one line",
			input: "FUND A   023840 10 1   FUND B   066365-10-7",
			want:  "FUND A   023840101   FUND B   066365107",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := preprocessSplitCUSIP(tt.input)
			if got != tt.want {
				t.Errorf("preprocessSplitCUSIP(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// F3b: Full integration test — dashed CUSIP filing
func TestParseTextDashedCUSIP(t *testing.T) {
	filing := `<SEC-DOCUMENT>
<SEC-HEADER>
ACCESSION NUMBER:		0000000000-13-000001
CONFORMED SUBMISSION TYPE:	13F-HR
FILED AS OF DATE:		20130401
CONFORMED PERIOD OF REPORT:	20130331
FILER:
	COMPANY DATA:
		COMPANY CONFORMED NAME:			DASHED CUSIP FUND
		CENTRAL INDEX KEY:			0005555555
</SEC-HEADER>
<DOCUMENT>
<TYPE>13F-HR
<TABLE>
NAME OF ISSUER         TITLE OF CLASS    CUSIP       VALUE   SHARES  SH/PRN  INVDISC
Amp Inc.                       Common        03189710-1        36,340       676,883      SH                  SOLE
Bankers Trust Corp.            Common        066365-10-7        7,207        81,667      SH                  SOLE
</TABLE>
</DOCUMENT>
</SEC-DOCUMENT>
`
	result, err := parseText([]byte(filing), "/test/dashed_cusip.txt")
	if err != nil {
		t.Fatalf("parseText returned error: %v", err)
	}
	if len(result.Rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(result.Rows))
	}
	if result.Rows[0].CUSIP9 != "031897101" {
		t.Errorf("row0 CUSIP9 = %q, want 031897101", result.Rows[0].CUSIP9)
	}
	if result.Rows[0].Shares != 676883 {
		t.Errorf("row0 Shares = %d, want 676883", result.Rows[0].Shares)
	}
	if result.Rows[1].CUSIP9 != "066365107" {
		t.Errorf("row1 CUSIP9 = %q, want 066365107", result.Rows[1].CUSIP9)
	}
	if result.Rows[1].Shares != 81667 {
		t.Errorf("row1 Shares = %d, want 81667", result.Rows[1].Shares)
	}
}

// F3b: Full integration test — spaced CUSIP filing
func TestParseTextSpacedCUSIP(t *testing.T) {
	filing := `<SEC-DOCUMENT>
<SEC-HEADER>
ACCESSION NUMBER:		0000000000-14-000001
CONFORMED SUBMISSION TYPE:	13F-HR
FILED AS OF DATE:		20140401
CONFORMED PERIOD OF REPORT:	20140331
FILER:
	COMPANY DATA:
		COMPANY CONFORMED NAME:			SPACED CUSIP FUND
		CENTRAL INDEX KEY:			0006666666
</SEC-HEADER>
<DOCUMENT>
<TYPE>13F-HR
<TABLE>
NAME OF ISSUER       TITLE OF CLASS   CUSIP      VALUE    SHARES    SH/PRN  INVDISC
ALLMERICA FINANCIAL  COMMON           019754 10 0  3854   70000 SH  SOLE    70000  0  0
AMERICAN MGMT SYS    COMMON           027352 10 3  33272  975000 SH SOLE   975000  0  0
</TABLE>
</DOCUMENT>
</SEC-DOCUMENT>
`
	result, err := parseText([]byte(filing), "/test/spaced_cusip.txt")
	if err != nil {
		t.Fatalf("parseText returned error: %v", err)
	}
	if len(result.Rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(result.Rows))
	}
	if result.Rows[0].CUSIP8 != "01975410" {
		t.Errorf("row0 CUSIP8 = %q, want 01975410", result.Rows[0].CUSIP8)
	}
	if result.Rows[0].Shares != 70000 {
		t.Errorf("row0 Shares = %d, want 70000", result.Rows[0].Shares)
	}
	if result.Rows[1].CUSIP8 != "02735210" {
		t.Errorf("row1 CUSIP8 = %q, want 02735210", result.Rows[1].CUSIP8)
	}
}

// F3b: Full integration test — pipe-delimited filing
func TestParseTextPipeDelimited(t *testing.T) {
	filing := `<SEC-DOCUMENT>
<SEC-HEADER>
ACCESSION NUMBER:		0000000000-15-000001
CONFORMED SUBMISSION TYPE:	13F-HR
FILED AS OF DATE:		20150401
CONFORMED PERIOD OF REPORT:	20150331
FILER:
	COMPANY DATA:
		COMPANY CONFORMED NAME:			PIPE FORMAT FUND
		CENTRAL INDEX KEY:			0007777777
</SEC-HEADER>
<DOCUMENT>
<TYPE>13F-HR
<TABLE>
- --------------------|---------------|-----------|--------------|------------|
      ITEM 1:       |   ITEM 2:     | ITEM 3:   |    ITEM 4:   |   ITEM 5:  |
   NAME OF ISSUER   |TITLE OF CLASS | CUSIP     |VALUE (X$1000)| PRINC. AMT.|
- --------------------|---------------|-----------|--------------|------------|
AmeriSource Health  | COMMON STOCK  |03071P102  |         8,123|     237,600| SH
- --------------------|---------------|-----------|--------------|------------|
ABR Information     | COMMON STOCK  |00077R108  |         8,024|     461,800| SH
</TABLE>
</DOCUMENT>
</SEC-DOCUMENT>
`
	result, err := parseText([]byte(filing), "/test/pipe_delim.txt")
	if err != nil {
		t.Fatalf("parseText returned error: %v", err)
	}
	if len(result.Rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(result.Rows))
	}
	if result.Rows[0].CUSIP8 != "03071P10" {
		t.Errorf("row0 CUSIP8 = %q, want 03071P10", result.Rows[0].CUSIP8)
	}
	if result.Rows[0].Shares != 237600 {
		t.Errorf("row0 Shares = %d, want 237600", result.Rows[0].Shares)
	}
	if result.Rows[1].CUSIP8 != "00077R10" {
		t.Errorf("row1 CUSIP8 = %q, want 00077R10", result.Rows[1].CUSIP8)
	}
}

// F6: Concatenated value+shares repair using voting authority
func TestParseTextConcatenatedValueShares(t *testing.T) {
	filing := `<SEC-DOCUMENT>
<SEC-HEADER>
ACCESSION NUMBER:		0000000000-16-000001
CONFORMED SUBMISSION TYPE:	13F-HR
FILED AS OF DATE:		20160401
CONFORMED PERIOD OF REPORT:	20160331
FILER:
	COMPANY DATA:
		COMPANY CONFORMED NAME:			CONCAT TEST FUND
		CENTRAL INDEX KEY:			0008888888
</SEC-HEADER>
<DOCUMENT>
<TYPE>13F-HR
<TABLE>
NAME OF ISSUER         TITLE OF CLASS    CUSIP       VALUE   SHARES  SH/PRN  INVDISC  SOLE    SHARED  NONE
LUCENT TECHNOLOGIES    COM               549463107   4861710278500 SH       SOLE                10278500        0      0
NORMAL CORP            COM               037833100   50000   100000  SH      SOLE     100000  0       0
</TABLE>
</DOCUMENT>
</SEC-DOCUMENT>
`
	result, err := parseText([]byte(filing), "/test/concat.txt")
	if err != nil {
		t.Fatalf("parseText returned error: %v", err)
	}
	if len(result.Rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(result.Rows))
	}
	// LUCENT: concatenated 48617+10278500 → should be repaired via voting_sole
	lucent := result.Rows[0]
	if lucent.Value != 48617 {
		t.Errorf("LUCENT Value = %d, want 48617", lucent.Value)
	}
	if lucent.Shares != 10278500 {
		t.Errorf("LUCENT Shares = %d, want 10278500", lucent.Shares)
	}
	// NORMAL: should be unaffected
	normal := result.Rows[1]
	if normal.Value != 50000 {
		t.Errorf("NORMAL Value = %d, want 50000", normal.Value)
	}
	if normal.Shares != 100000 {
		t.Errorf("NORMAL Shares = %d, want 100000", normal.Shares)
	}
}

// Integration test: standard line uses BCS P3 (standard pattern)
func TestParseLineBCSStandardPattern(t *testing.T) {
	line := "APPLE INC              COM                    037833100   50000   100000  SH      SOLE     100000  0       0"
	h := parseLine(line)
	if h == nil {
		t.Fatal("parseLine returned nil")
	}
	if h.value != 50000 {
		t.Errorf("value = %d, want 50000", h.value)
	}
	if h.shares != 100000 {
		t.Errorf("shares = %d, want 100000", h.shares)
	}
	if h.sharesType != "SH" {
		t.Errorf("sharesType = %q, want SH", h.sharesType)
	}
}
