# SIZ → CIZ Column Crosswalk

Transcribed from CRSP's *Cross-Reference Guide Legacy FIZ/SIZ to CIZ* (document last
modified 2025-12-03) and reconciled against the live WRDS schema. Mappings are organised
by **legacy** file, because that is the direction you port code in.

The machine-readable version of this crosswalk is `crsp.metasiztociz` — query it when you
need a column this file does not list:

```sql
SELECT sizitemname, cizfilename, cizitemname, cizitemdesc, sizcolmapseq
FROM crsp.metasiztociz
WHERE sizfilename = 'SFZ_DP_DLY'
ORDER BY sizcolposition, sizcolmapseq;
```

## Contents

- [File-Level Map](#file-level-map)
- [SFZ_DP_DLY / SFZ_DS_DLY — Daily](#sfz_dp_dly--sfz_ds_dly--daily)
- [SFZ_MTH and SFZ_AGG_MTH — Monthly](#sfz_mth-and-sfz_agg_mth--monthly)
- [SFZ_AGG_QTR / SFZ_AGG_ANN — Quarterly and Annual](#sfz_agg_qtr--sfz_agg_ann--quarterly-and-annual)
- [SFZ_HDR — Header](#sfz_hdr--header)
- [SFZ_NAM — Name History](#sfz_nam--name-history)
- [SFZ_NDI — NASDAQ Trading Info](#sfz_ndi--nasdaq-trading-info)
- [SFZ_DEL / SFZ_MDEL — Delisting](#sfz_del--sfz_mdel--delisting)
- [SFZ_DIS — Distributions](#sfz_dis--distributions)
- [SFZ_SHR — Shares](#sfz_shr--shares)
- [Index Files](#index-files)
- [Columns With No CIZ Equivalent](#columns-with-no-ciz-equivalent)

## File-Level Map

| Legacy (SIZ/FIZ) | CIZ | Notes |
|------------------|-----|-------|
| `Sfz_dp_dly` | `StkDlyPrimarySecurityData` | Primary daily items |
| `Sfz_ds_dly` | `StkDlySecurityData` | Superset of all daily items |
| `Sfz_mth` | `StkMthSecurityData` | Return methodology changed |
| `Sfz_agg_mth` | `StkMthSecurityData` | Adds `MthCompFlg`, `MthCompSubFlg` |
| `Sfz_agg_qtr` | `StkQtrSecurityData` | Adds `QtrCompFlg`, `QtrCompSubFlg` |
| `Sfz_agg_ann` | `StkAnnSecurityData` | Adds `AnnCompFlg`, `AnnCompSubFlg` |
| `Sfz_hdr` | `StkSecurityInfoHdr` + `StkIssuerInfoHdr` | Split security/issuer |
| `Sfz_nam` | `StkSecurityInfoHist` + `StkIssuerInfoHist` | Split security/issuer |
| `Sfz_ndi` | `StkSecurityInfoHist` + `StkDlySecurityData` | `mmcnt` moved to daily |
| `Sfz_del`, `Sfz_mdel` | `StkDelists` | Active securities no longer present |
| `Sfz_dis` | `StkDistributions` | `DisSeqNbr` added to key |
| `Sfz_shr` | `StkShares` | See also new `StkMthFloatShares` |
| `Sfz_mbr` | `StkIndMembership` | `INDFAM` added |
| `Sfz_dind` | `IndDlySeriesData` | Investable-index rows added |
| `Sfz_mind` | `IndMthSeriesData` | |
| `Sfz_indhdr` | `IndSeriesInfoHdr` + `IndFamilyInfoHdr` | |
| `Sfz_portd` | `IndSecStatistics` | Annual security breakpoints |
| `Sfz_portm` | `IndIssStatistics` | Quarterly issuer breakpoints |
| `Sfz_rb` | `IndSecRebalSummary` + `IndIssRebalSummary` | Issuer caps split out |

## SFZ_DP_DLY / SFZ_DS_DLY — Daily

| Legacy | CIZ | Note |
|--------|-----|------|
| `kypermno` | `PERMNO` | |
| `caldt` | `DlyCalDt` (also `YYYYMMDD`) | |
| `prc` | `DlyPrc` + `DlyPrcFlg` | Always positive now |
| `ret` | `DlyRet` | Delisting return included |
| `retx` | `DlyRetx` | |
| `tcap` | `DlyCap` + `DlyCapFlg` | $ thousands |
| `vol` | `DlyVol` | |
| `bidlo` | `DlyLow` (see also `DlyBid`) | Some values moved to `DlyBid` |
| `askhi` | `DlyHigh` (see also `DlyAsk`) | Some values moved to `DlyAsk` |
| `bid` | `DlyBid` | |
| `ask` | `DlyAsk` | |
| `numtrd` | `DlyNumTrd` | NASDAQ only, from 1982-11-01 |
| `openprc` | `DlyOpen` | |
| `cfacpr` | `DlyCumFacPr` | Moved to `StkDlyCumulativeAdjFactor` |
| `cfacshr` | `DlyCumFacShr` | Moved to `StkDlyCumulativeAdjFactor` |

New in CIZ with no SIZ predecessor: `DlyPrevPrc`, `DlyPrevPrcFlg`, `DlyPrevDt`,
`DlyPrevCap`, `DlyPrevCapFlg`, `DlyRetI`, `DlyRetMissFlg`, `DlyRetDurFlg`,
`DlyOrdDivAmt`, `DlyNonOrdDivAmt`, `DlyFacPrc`, `DlyDistRetFlg`, `DlyClose`,
`DlyMMCnt`, `DlyPrcVol`, `DlyDelFlg`.

## SFZ_MTH and SFZ_AGG_MTH — Monthly

| Legacy | CIZ | Note |
|--------|-----|------|
| `mcaldt` | `MthCalDt` (also `YYYYMM`) | |
| `mprc` / `mthprc` | `MthPrc` + `MthPrcFlg` | |
| `mret` / `mthret` | `MthRet` | **Compounded daily — different estimator** |
| `mretx` / `mthretx` | `MthRetx` | Same caveat |
| `mtcap` / `mthcap` | `MthCap` | |
| `mvol` / `mthvol` | `MthVol` | |
| `maltprc` | `MthPrc` | Variation of the same concept |
| `maltprcdt` | `MthPrcDt` + `MthDtFlg` | |
| `mthprevprc` | `MthPrevPrc` (+ `MthPrevPrcFlg`) | |
| `mthprevdt` | `MthPrevDt` (+ `MthPrevDtFlg`) | |
| `mthprevcap` | `MthPrevCap` | |
| `mthdiscnt` | `MthDisCnt` | |
| `mthprcvol` | `MthPrcVol` | |
| `mthfacshrflg` | `MthFacShrFlg` | |
| `mthprcvolmisscnt` | `MthPrcVolMissCnt` | |
| `mthdelflg` | `MthDelFlg` | |
| `ncusip` | `CUSIP` | as of `MthPrcDt` |
| `ticker` | `Ticker` | as of `MthPrcDt` |
| `comnam` | `IssuerNm` | as of `MthPrcDt` |
| `mbidlo`, `maskhi`, `mbid`, `mask`, `mspread` | **not present** | Derive from `StkDlySecurityData` (`DlyLow`, `DlyHigh`, `DlyBid`, `DlyAsk`, `DlyAsk - DlyBid`) |

New: `MthCompFlg`, `MthCompSubFlg`.

## SFZ_AGG_QTR / SFZ_AGG_ANN — Quarterly and Annual

Identical structure to the monthly aggregate with the prefix swapped
(`qtr*` / `ann*`) and the period key changed (`YYYYQ` / `YYYY`, `QtrCalDt` / `AnnCalDt`).
Legacy `qcaldt` → `QtrCalDt`; legacy `acaldt` → `AnnCalDt`. New: `QtrCompFlg`/
`QtrCompSubFlg` and `AnnCompFlg`/`AnnCompSubFlg`.

## SFZ_HDR — Header

| Legacy | CIZ | Table |
|--------|-----|-------|
| `kypermno` | `PERMNO` | security |
| `cusip` | `HdrCUSIP` (see also `CNUM`) | security |
| `cusip9` | `HdrCUSIP9` | security |
| `htick` | `Ticker` | security |
| `permco` | `PERMCO` | both |
| `compno` | `NASDCompno` | both |
| `issuno` | `NASDIssuno` | security |
| `hexcd` | **not present** — see `PrimaryExch` + `ConditionalType` | security |
| `hsiccd` | `SICCD` | both |
| `begdt` | `SecurityBegDt` | security |
| `enddt` | `SecurityEndDt` | security |
| `hdlstcd` | `SecurityActiveFlg` + `DelActionType` + `DelStatusType` + `DelReasonType` + `DelPaymentType` | security |
| `hcomnam` | `SecurityNm` / `IssuerNm` | security / both |
| `htsymbol` | `TradingSymbol` | security |
| `hsnaics` | `NAICS` | both |
| `hshrcd` | `USIncFlg` + `IssuerType` + `SecurityType` + `SecuritySubType` + `ShareType` | security / both |
| `hprimexch` | `PrimaryExch` | security |
| `htrdstat` | `TradingStatusFlg` | security |
| `hsecstat` | `ConditionalType` | security |

New: `SecurityHdrFlg`, `ExchangeTier`, `SecInfoStartDt`, `SecInfoEndDt`, `ShareClass`,
`ICBIndustry`, `UESIndustry`; issuer side adds `IssuerBegDt`, `IssuerEndDt`,
`IssuerHdrFlg`, `CNUM`, `SecurityRangeCnt`, `SecurityTotalCnt`, `IssuerStatusType`.

`HSICCD` was "last non-zero SICCD"; CIZ `SICCD` is the SICCD on the last active name
record — so 100+ PERMNOs now show `SICCD = 0` where legacy showed a valid code.

## SFZ_NAM — Name History

| Legacy | CIZ |
|--------|-----|
| `namedt` | `SecInfoStartDt` |
| `nameenddt` | `SecInfoEndDt` |
| `ncusip` | **`CUSIP`** |
| `ncusip9` | `CUSIP9` |
| `ticker` | `Ticker` |
| `comnam` | `IssuerNm` (see also `SecurityNm`) |
| `shrcls` | `ShareClass` |
| `shrcd` | `ShareType` + `SecurityType` + `SecuritySubType` + `USIncFlg` + `IssuerType` |
| `exchcd` | **not present** — see `PrimaryExch` + `ConditionalType` |
| `siccd` | `SICCD` |
| `tsymbol` | `TradingSymbol` |
| `snaics` | `NAICS` |
| `primexch` | `PrimaryExch` |
| `trdstat` | `TradingStatusFlg` |
| `secstat` | `ConditionalType` |

`secstat` values also changed representation: legacy `'R'` is CIZ `'RW'`. Renaming the
column is not enough; the value comparison has to change too.

## SFZ_NDI — NASDAQ Trading Info

| Legacy | CIZ | Table |
|--------|-----|-------|
| `trtsdt` | `SecInfoStartDt` | `StkSecurityInfoHist` |
| `trtsenddt` | `SecInfoEndDt` | `StkSecurityInfoHist` |
| `nmsind` | `ExchangeTier` | `StkSecurityInfoHist` |
| `mmcnt` | `DlyMMCnt` | `StkDlySecurityData` |
| `nsdinx` | **not present** — closest are `SICCD`, `NAICS`, `ICBIndustry`, `UESIndustry` | |
| `trtscd` | **not present** | |

## SFZ_DEL / SFZ_MDEL — Delisting

| Legacy | CIZ |
|--------|-----|
| `(m)dlstdt` | `DelistingDt` |
| `(m)dlstcd` | `DelActionType` + `DelStatusType` + `DelReasonType` + `DelPaymentType` |
| `(m)nwperm` | `DelPERMNO` |
| `(m)nwcomp` | `DelPERMCO` |
| `(m)nextdt` | `DelNextDt` |
| `(m)dlprc` | **`DelNextPrc`** (not `DelDtPrc`) |
| `(m)dlpdt` | `DelAmtDt` |
| `(m)dlamt` | `DelDivAmt` (distributions after delisting only) |
| `(m)dlret` | `DelRet` |
| `(m)dlretx` | **not present** |

New: `DelDtPrc`, `DelDtPrcFlg`, `DelNextPrcFlg`, `DelRetMissType`, `DelDisType`,
`DelDlyDt`.

## SFZ_DIS — Distributions

| Legacy | CIZ |
|--------|-----|
| `distcd` | `DisType` + `DisFreqType` + `DisPaymentType` + `DisDetailType` + `DisTaxType` + `DisOrigCurType` (+ `DisOrdinaryFlg`) |
| `divamt` | `DisDivAmt` |
| `facpr` | `DisFacPr` |
| `facshr` | `DisFacShr` |
| `dclrdt` | `DisDeclareDt` |
| `exdt` | `DisExDt` |
| `rcrddt` | `DisRecordDt` |
| `paydt` | `DisPayDt` |
| `acperm` | `DisPERMNO` |
| `accomp` | `DisPERMCO` |

New: `DisSeqNbr` (part of the key), `DisAmountSourceType`.

## SFZ_SHR — Shares

| Legacy | CIZ |
|--------|-----|
| `shrsdt` | `ShrStartDt` |
| `shrsenddt` | `ShrEndDt` |
| `shrout` | `ShrOut` |
| `shrflg` | `ShrSource` |

New: `ShrFacType`, `ShrAdrFlg`.

## Index Files

### SFZ_DIND / SFZ_MIND → `IndDlySeriesData` / `IndMthSeriesData`

| Legacy | CIZ (daily) | CIZ (monthly) |
|--------|-------------|---------------|
| `kyindno` | `INDNO` | `INDNO` |
| `caldt` / `mcaldt` | `DlyCalDt` | `MthCalDt` |
| `tret` / `mtret` | `DlyTotRet` | `MthTotRet` |
| `tind` / `mtind` | `DlyTotInd` | `MthTotInd` |
| `aret` / `maret` | `DlyPrcRet` | `MthPrcRet` |
| `aind` / `maind` | `DlyPrcInd` | `MthPrcInd` |
| `iret` / `miret` | `DlyIncRet` | `MthIncRet` |
| `iind` / `miind` | `DlyIncInd` | `MthIncInd` |
| `usdcnt` | `DlyUsdCnt` | `MthUsdCnt` |
| `usdval` | `DlyUsdVal` | `MthUsdVal` |
| `totcnt` | `DlyTotCnt` | `MthTotCnt` |
| `totval` | `DlyTotVal` | `MthTotVal` |

New: `DlyEligCnt`/`MthEligCnt`, `DlyWgtAmt`/`MthWgtAmt`.

### SFZ_INDHDR → `IndSeriesInfoHdr` / `IndFamilyInfoHdr`

| Legacy | CIZ |
|--------|-----|
| `kyindno` | `INDNO` |
| `indname` | `IndNm` |
| `indbegdt` | `IndBegDt` |
| `indenddt` | `IndEndDt` |
| `indfam` | `INDFAM` |
| `portnum` | `PortNum` |
| `baselvl` | `BaseLvl` |
| `basedt` | `BaseDt` |
| `calcrule` | `BreakPointStatType` |
| `listrule` | `RuleGroup` |

`AVAILABILITY`, `METHOD`, `REBALRULE`, `PUNIVERSE`, `UNIVERSE` were restructured into
`AssignStatType`, `IndFamType`, `WeightType`, `BreakpointFreqType`, `PortOrder`,
`BreakpointStatType`, `BreakpointINDFAM`, `UniverseType`, `ExchangeGroup`.

### SFZ_MBR → `StkIndMembership`

| Legacy | CIZ |
|--------|-----|
| `kypermno` | `PERMNO` |
| `keyset` | `INDFAM` |
| `mbrdt` | `MbrStartDt` |
| `mbrenddt` | `MbrEndDt` |
| `mbrflag` | `MbrFlg` |

`INDNO` is the better join key for most purposes; use `INDFAM` only when comparing to
legacy `KEYSET`.

### SFZ_PORTD / SFZ_PORTM → `IndSecStatistics` / `IndIssStatistics`

| Legacy | CIZ (security) | CIZ (issuer) |
|--------|----------------|--------------|
| `kypermno` | `PERMNO` | `PERMCO` |
| `keyset` | `INDFAM` | `INDFAM` |
| `annual` | `YYYY` + `SecAssignYYYY` | `YYYYQ` + `IssAssignYYYYQ` |
| `(m)pportnum` | `SecAssignPortNum` | `IssAssignPortNum` |
| `(m)pindno` | `SecAssignINDNO` | `IssAssignINDNO` |
| `(m)pstat` | `SecStat` | `IssStat` |
| `(m)ppflg` | `SecStatFlg` | `IssStatFlg` |

The legacy `ANNUAL` field was overloaded (calculation year vs assignment year) and is
now two columns. Issuer cap-based statistics that used to be duplicated across every
PERMNO of a PERMCO are collapsed into one issuer row.

### SFZ_RB → `IndSecRebalSummary` / `IndIssRebalSummary`

| Legacy | CIZ (security) | CIZ (issuer) |
|--------|----------------|--------------|
| `kyindno` | `INDNO` | `INDNO` |
| `rbbegdt` | `SecAssignStartDt` | `IssAssignStartDt` |
| `rbenddt` | `SecAssignEndDt` | `IssAssignEndDt` |
| `rusdcnt` | **not present** — see `SecIssuerAllCnt`, `SecSecurityAllCnt` | `IssIssuerAllCnt`, `IssSecurityAllCnt` |
| `minid` | `SecMinStatPERMNO` | `IssMinStatPERMCO` |
| `maxid` | `SecMaxStatPERMNO` | `IssMaxStatPERMCO` |
| `minstat` | `SecMinStat` (+ `SecLowBreakpoint`) | `IssMinStat` |
| `maxstat` | `SecMaxStat` (+ `SecHighBreakpoint`) | `IssMaxStat` |

## Columns With No CIZ Equivalent

Do not construct a substitute for these without saying so explicitly in the write-up:

| Legacy column | Status |
|---------------|--------|
| `DLRETX` | Removed. No delisting return excluding dividends. |
| `EXCHCD` / `HEXCD` | Removed. `PrimaryExch` + `ConditionalType` + `TradingStatusFlg` cover the same ground with different values. |
| `TRTSCD` (NASDAQ status code) | Removed. |
| `NSDINX` (NASDAQ index code) | Removed. Closest: `SICCD`, `NAICS`, `ICBIndustry`, `UESIndustry`. |
| `MBIDLO`, `MASKHI`, `MBID`, `MASK`, `MSPREAD` | Removed from monthly. Derive from the daily file. |
| `RUSDCNT` | Removed from rebalancing files. |
| `SHRCD`, `DISTCD`, `DLSTCD` as single codes | Unpacked; not reconstructable in a way CRSP endorses, and WRDS explicitly declines to reverse-engineer them. |
