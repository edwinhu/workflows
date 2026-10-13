package main

import (
	"os"
	"path/filepath"
	"testing"
)

// A foreign issuer's Security ID cell prints an ISIN and no CUSIP (`ISIN
// GB0008847096`, Tesco plc; SEI Institutional International Trust 2010,
// 0000930413-10-004616, 10,142 rows with no security id of any kind on run71).
// icrISIN read the token but the row builder never carried it, so the row had
// no id at all. The ISIN lands in the isin column; a CINS (`CINS 92857W209`,
// Vodafone) is a nine-character CUSIP-format id and stays in the cusip column.
func TestICRSecurityIDCellISIN(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "icr", "I12_icr_isin_security_id.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	tesco, voda := 0, 0
	for _, r := range rows {
		switch r[colIssuerName] {
		case "Tesco plc":
			tesco++
			if r[colISIN] != "GB0008847096" || r[colCUSIP] != "" {
				t.Fatalf("Tesco: cusip %q isin %q, want isin GB0008847096 and no cusip", r[colCUSIP], r[colISIN])
			}
		case "Vodafone Group plc":
			voda++
			if r[colCUSIP] != "92857W209" {
				t.Fatalf("Vodafone: cusip %q, want the CINS 92857W209", r[colCUSIP])
			}
		}
	}
	if tesco == 0 || voda == 0 {
		t.Fatalf("rows: tesco=%d vodafone=%d, want both blocks", tesco, voda)
	}
}
