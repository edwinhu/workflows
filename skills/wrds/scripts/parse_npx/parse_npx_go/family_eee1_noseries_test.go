package main

import (
	"path/filepath"
	"testing"
)

// familyEEE1Dispatch runs the real dispatch on a family EEE no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary when one is
// named.
func familyEEE1Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_eee1", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_eee1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000132/1322252/0001193125-13-349682.txt: 4-8, 14-16, 39-41, 43-44, 55-56,
// 58-59, 70-71, 73-74, 85-86, 88-89, 100-101, 103-104, 115-116, 118-119,
// 130-131, 133-134, 145-156, 12731-12849. All SEVEN declarations are in the cut
// on purpose: with only two of them the resolver accepts `CRM SMID Cap` and the
// fixture passes while the real filing still leaks. CRM Mutual Fund Trust's 2013 N-PX
// declares seven series in the SGML header and prints one centred bold banner
// per fund, each after a page break and an <HR>. Six of the seven banners spell
// the fund the way the declaration does, minus the trailing type words, and
// resolve -- e.g. the second section:
//
//	<P STYLE="margin-top:0px;margin-bottom:0px" ALIGN="center"><FONT ... SIZE="2"><B>CRM Mid Cap </B></FONT></P>
//
// which the resolver maps to the declared `CRM MID CAP VALUE FUND`
// (S000001322). The FIRST section's banner is byte-identical in form but names
// the fund by the industry contraction `SMID`:
//
//	<P STYLE="margin-top:0px;margin-bottom:0px" ALIGN="center"><FONT ... SIZE="2"><B>CRM SMID Cap </B></FONT></P>
//
// `SMID Cap` is `SMALL/MID CAP`, so the heading never matches the declared
// `CRM SMALL/MID CAP VALUE FUND` (S000001325) and every row under it comes out
// with a blank fund_name and a blank series_id. A full-file dispatch emits 605
// rows of which 203 -- the whole of that first section, rows 0 through 202,
// from `Quantum Corporation` to `Towers Watson & Co.` -- carry no series.
//
// Fix in issResolveFund (layout_issnpx_series.go), where the banner is
// normalised before the declared-name lookup: `SMID` has to expand to
// `SMALL/MID` (equivalently, `SMALL MID`) so the stem `CRM SMID CAP` reaches
// the declared name the way `CRM MID CAP` already does.
func TestFamilyEEE1CRMSmidCapBannerNeverResolves(t *testing.T) {
	rows := familyEEE1Dispatch(t, "crm_smid_cap_heading.txt", "", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000001325" {
			t.Errorf("`CRM SMID Cap` banner not resolved: fund=%q issuer=%q item=%q series=%q want S000001325", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000082/826644/0000950129-04-006660.txt: 14-18, 24-26, 140-175. AIM Investment
// Funds' 2004 N-PX declares NO series in its SGML header, so every series name
// the resolver sees is backfilled from cik_series.tsv for CIK 0000826644. The
// filing prints one banner per fund, ruled with `=` to column 80:
//
//	============================ AIM GLOBAL ENERGY FUND ============================
//	...
//	====================== AIM GLOBAL FINANCIAL SERVICES FUND ======================
//
// and under each, ISS proposal blocks:
//
//	CHC HELICOPTER CORP.
//	Ticker:       FLY.A          Security ID:  12541C203
//	Meeting Date: OCT 28, 2003   Meeting Type: Annual/Special
//	1     Elect Craig L. Dobbin, ... as Directors   For       For        Management
//
// None of the three funds this filing reports -- Global Energy, Global Financial
// Services, Global Science & Technology -- appears in the dictionary under this
// CIK: the closest entries are `AIM Global Health Care Fund` (S000000235) and
// `INVESCO HEALTH SCIENCES FUND` (S000027905). The 2004 AIM Global Trends names
// are a dictionary floor. What is NOT a floor is the answer the parser gives
// instead: a full-file dispatch stamps ALL 272 rows -- 7 Global Energy, 29
// Global Financial Services, 236 Global Science & Technology -- with
// S000000235, the Health Care series, which none of them is. A wrong series_id
// files one fund's votes under another and nothing downstream can contradict it,
// so it is worse than the blank the brief counted.
//
// Fix in issResolveFund (layout_issnpx.go), in the candidate acceptance that
// admits a declared name sharing only the registrant's own brand tokens: `AIM
// GLOBAL ENERGY FUND` and `AIM Global Health Care Fund` share `AIM` and
// `GLOBAL` and nothing else, so the candidate carries no distinctive heading
// token and must be refused -- the same rule family CCC added for the AQR
// Emerging Momentum misattribution.
func TestFamilyEEE1AIMGlobalEnergyBannerMisattributedToHealthCare(t *testing.T) {
	rows := familyEEE1Dispatch(t, "aim_global_energy_banner.txt", "aim_dict.tsv", "issnpx", 4)
	for _, r := range rows {
		if r.SeriesID == "S000000235" {
			t.Errorf("`AIM GLOBAL ENERGY FUND` banner filed under the Health Care series: fund=%q issuer=%q item=%q series=%q want not S000000235", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000107/1072428/0001072428-12-000106.txt: 4-5, 7-8, 15-16, 41-43, 45-46,
// 51-52, 54-55, 64-65, 67-68, 77-78, 80-81, 90-91, 93-94, 103-104, 106-107,
// 116-117, 119-120, 129-130, 132-133, 142-143, 145-146, 151-152, 154-155,
// 160-161, 163-164, 173-174, 176-177, 186-187, 189-190, 199-200, 202-203,
// 212-213, 215-216, 225-226, 228-229, 238-239, 241-242, 251-252, 254-255,
// 264-265, 267-268, 277-278, 280-281, 290-293, 298, 10096-10120. All TWENTY
// declarations are in the cut for the same reason as the CRM fixture: the
// sibling `Dow` names are what the resolver has to choose between.
//
// JNL Variable Fund LLC's 2012 N-PX declares its twenty series in the SGML
// header under the adviser's ACRONYM, `JNL/MCM ...`, and prints each fund's
// section under a bare heading line spelling the acronym OUT:
//
//	JNL/Mellon Capital Management Dow 10 Fund
//	--------------------------------------------------------------------------
//	 AT&T INC.                                             Agenda Number:  933559049
//	        Security:  00206R102
//	    Meeting Date:  27-Apr-2012
//	1A.    ELECTION OF DIRECTOR: RANDALL L. STEPHENSON      Mgmt  For   For
//
//	JNL/Mellon Capital Management Financial Sector Fund
//
// The second of those resolves to S000001698. The first does not, and neither
// do the other numeric-stem funds: a full-file dispatch emits 17,849 rows of
// which 8,471 carry no series -- Dow 10 (187), S&P 10 (151), JNL 5 (1,686),
// JNL Optimized 5 (1,460), Global 15 (258), Nasdaq 25 (286), S&P 24 (315),
// S&P SMid 60 (636), Dow Dividend (293), Oil & Gas (919), VIP (2,280). What
// separates the resolving names from these is that the resolving ones carry a
// distinctive WORD (Financial, Consumer, Healthcare, Technology) while these
// are distinguished only by a NUMBER: `Dow 10` against the sibling declaration
// `Dow Dividend`, `S&P 10` against `S&P 24` and `S&P SMid 60`.
//
// Fix in issResolveFund (layout_issnpx.go), in the token comparison the
// broadridge heading path calls: a digit run has to count as a distinctive
// token, so `DOW 10` and `DOW DIVIDEND` are two candidates rather than one
// ambiguous `DOW`, and the acronym expansion `MCM` = `Mellon Capital
// Management` has to be recognised the way the other brand aliases are.
func TestFamilyEEE1JNLDow10HeadingNeverResolves(t *testing.T) {
	rows := familyEEE1Dispatch(t, "jnl_dow10_heading.txt", "", "broadridge", 6)
	for _, r := range rows {
		if r.SeriesID != "S000001693" {
			t.Errorf("`JNL/Mellon Capital Management Dow 10 Fund` heading not resolved: fund=%q issuer=%q item=%q series=%q want S000001693", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}
