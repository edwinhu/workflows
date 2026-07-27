# CIZ Flag Dictionary

Every flag value below was dumped from `crsp.metaflaginfo` on the WRDS PostgreSQL
server (2026-07-26). This file is a snapshot for offline reading — **the live table
is authoritative**:

```sql
SELECT flagvalue, flagdesc, flagdef FROM crsp.metaflaginfo WHERE flagtype = 'PC' ORDER BY 1;
SELECT flagtype, flagtypedesc FROM crsp.metaflagtype ORDER BY 1;
```

CIZ replaced SIZ's packed numeric codes (`SHRCD`, `EXCHCD`, `DISTCD`, `DLSTCD`) with
alphanumeric flag columns. `MetaItemInfo.itemflagtype` tells you which flag type a
given column uses; that type is the key into this dictionary.

Flag types are listed alphabetically by type code.

## Flag type index

| Type | Description |
|------|-------------|
| `AD` | Distribution Detail Type |
| `AF` | Aggregate Factor to Adjust Shares Flag |
| `AG` | Aggregate Date Flag |
| `AR` | Aggregate Return Flag |
| `AS` | Amount Source Type |
| `AT` | Distribution Type |
| `AV` | Aggregate Volume Flag |
| `CB` | ICB Industry Type |
| `CD` | Delisting Corporate Action Type |
| `CF` | Aggregate Completeness Flag |
| `CG` | Aggregate Completeness Sub-Flag |
| `CI` | Distribution Impact |
| `CL` | Item Class |
| `CP` | Capitalization Flag |
| `CS` | Delist Completion Status Type |
| `CT` | Conditional Type |
| `CU` | Distribution Original Currency Type |
| `CY` | Item Category |
| `DE` | Aggregate Delisting Flag |
| `DR` | Delisting Reason Type |
| `EC` | Primary Exchange |
| `ED` | Date Status Flag |
| `EG` | Exchange Group |
| `ET` | Exchange Tier |
| `FD` | Flag Type and Item Flag Type |
| `FI` | File Category |
| `FK` | File Key Type |
| `FO` | Portfolio Order |
| `FR` | File Row Frequency |
| `FT` | Distribution Frequency Type |
| `I1` | Issuer Status |
| `I8` | Index Count and Value Availability Type |
| `IB` | Index Breakpoint Formation Type |
| `IF` | Index Family Type |
| `IJ` | Statistic Breakpoint Type |
| `IT` | Issuer Type |
| `IW` | Index Weighting Type |
| `MF` | Constituent Membership Flag |
| `MS` | Statistic Flag |
| `MT` | SIZ to CIZ Mapping Type |
| `MU` | Siz to CIZ Mapping Sub-Type |
| `PC` | Price Flag - Multiple - See Definition |
| `PF` | Calendar Period Flag |
| `PM` | Distribution Payment Method Type |
| `PP` | Frequency Type |
| `PT` | Delisting Payment Summary Type |
| `RD` | Daily Return Duration Flag |
| `RM` | Return Missing Flag - Daily and Delisting |
| `S2` | Security Sub-Type |
| `S3` | Security Type |
| `S4` | Share Type |
| `SD` | Share Change Source Type |
| `SH` | Share Class |
| `SY` | Statistic Assignment Type |
| `TG` | Index Frequency |
| `TS` | Trading Status |
| `TX` | Distribution Tax Status Type |
| `UC` | UES Industry Type |
| `UD` | Underlying Data for Index Family |
| `UT` | Universe Type |
| `YN` | Yes No Flag |
| `YX` | Yes No Unavailable Flag |

## `AD` — Distribution Detail Type

| Value | Description |
|-------|-------------|
| `CAPG` | Capital Gains |
| `CDIV` | Cash Dividend |
| `CDM` | Cash Dividend - Missing Terms |
| `CDPSR` | Cash Dividend - Proceeds from Sale of Rights |
| `CPBLST` | Cash Payment - Buyback - Limited Self Tender |
| `CPEX` | Cash Payment - Exchange |
| `CPEXCSH` | Cash Payment - Exchange - Cash |
| `CPFL` | Cash Payment - Final Liquidation |
| `CPM` | Cash Payment - Merger |
| `CPPL` | Cash Payment - Partial Liquidation |
| `CPRCSH` | Cash Payment - Reorganization - Cash |
| `CPSCM` | Cash Payment - Shares Changed Merger |
| `CPSCMO` | Cash Payment - Shares Changed Merger Other |
| `CPSIL` | Cash Payment - Step in Liquidation |
| `CPSOA` | Cash Payment - Sale of Assets |
| `ICLA` | Issuer Change - Liquidation Announcement |
| `ICSAA` | Issuer Change - Sale of Assets Announcement |
| `ROC` | Return of Capital |
| `RPSR` | ROC - Proceeds from Sale of Rights |
| `SDIV` | Special Dividends |
| `SDROC` | Special Dividends - ROC |
| `SECBLST` | Security Payment - Buyback - Limited Self Tender |
| `SECDO` | Security Payment - Distribution Offer |
| `SECDW` | Security Change - Declared Worthless |
| `SECEX` | Security Payment - Exchange |
| `SECFL` | Security Payment - Final Liquidation |
| `SECMRG` | Security Payment - Merger |
| `SECMWM` | Security Payment - Merger with Missing Terms |
| `SECNOD` | Security Payment - Non-Ordinary Distribution |
| `SECPL` | Security Payment - Partial Liquidation |
| `SECPMT` | Security Payment |
| `SECRD` | Security Payment - Rights Distribution |
| `SECRSD` | Security Payment - Reorg Stock Distribution |
| `SECSDN` | Security Payment - Stock Dividend New |
| `SECSDO` | Security Payment - Stock Dividend Other |
| `SECSIM` | Security Payment - Step in Merger - TBR |
| `SECSO` | Security Payment - Spin-Off |
| `SECSTL` | Security Payment - Step in Total Liquidation |
| `SECUM` | Security Payment - Unknown Merger |
| `STKDIV` | Forward or Reverse Split - Stock Dividend |
| `STKSPL` | Forward or Reverse Split - Stock Split |
| `TSCC` | TSO Observation - Shares Changed Conversion |
| `TSCM` | TSO Observation - Shares Changed Merger |
| `TSCMO` | TSO Observation - Shares Changed Merger Other |
| `TSCU` | TSO Observation - Shares Changed Unknown |
| `TSOF` | TSO Observation - Secondary Offer |
| `ULIQ` | Unknown Liquidation |
| `UMRGR` | Unknown Merger |
| `URTSD` | Unknown Rights Distribution |

## `AF` — Aggregate Factor to Adjust Shares Flag

| Value | Description |
|-------|-------------|
| `B` | Both |
| `N` | None |
| `O` | Other |
| `S` | Stock Split |

## `AG` — Aggregate Date Flag

| Value | Description |
|-------|-------------|
| `ED` | End Date |
| `LA` | Last Available |
| `MI` | Missing/Not Tracked |
| `NS` | New Security |
| `NT` | Not Tracked |
| `PE` | Period-End |

## `AR` — Aggregate Return Flag

| Value | Description |
|-------|-------------|
| `CR` | Compounded Return |
| `DE` | Compounded Return - Delists |
| `GP` | Gap Between Prices is too Large |
| `IP` | Compounded Return - Incomplete Period |
| `MP` | Compounded Return - Missing Prices(s) |
| `NS` | New Security |
| `NT` | Not Tracked |

## `AS` — Amount Source Type

| Value | Description |
|-------|-------------|
| `CF` | Non-Transferable - Calculated |
| `CV` | Calculated but Transferable |
| `FM` | Fair Market Value |
| `MK` | Market Value |
| `MP` | Market Value - Price Provided |
| `N/A` | Not Applicable |
| `NF` | Non-Transferable - Fair Market |
| `UN` | Unknown |
| `UT` | Unknown Transferable |
| `UV` | Non-Transferable - Unknown |

## `AT` — Distribution Type

| Value | Description |
|-------|-------------|
| `CD` | Cash Dividend |
| `CG` | Capital Gains |
| `CP` | Cash Payment |
| `FRS` | Forward or Reverse Split |
| `IN` | Issuer Notification |
| `N/A` | Not Applicable |
| `ROC` | Return of Capital |
| `SD` | Special Dividends |
| `SP` | Security Payment |
| `TSOO` | Total Shares Outstanding Observation |

## `AV` — Aggregate Volume Flag

| Value | Description |
|-------|-------------|
| `CV` | Complete Volume |
| `DE` | Delisting |
| `GP` | Gap during period |
| `IP` | Incomplete Period |
| `MI` | Missing/Not Tracked |
| `MV` | Missing Volume |
| `NS` | New Security |

## `CB` — ICB Industry Type

| Value | Description |
|-------|-------------|
| `BASMAT` | Basic Materials |
| `CONDIS` | Consumer Discretionary |
| `CONSTAP` | Consumer Staples |
| `ENERGY` | Energy |
| `FINL` | Financials |
| `HEALTH` | Health Care |
| `INDL` | Industrials |
| `NOAVAIL` | Not Available |
| `REIT` | Real Estate Investment Trusts |
| `TECH` | Technology |
| `TELECOM` | Telecommunications |
| `UTIL` | Utilities |

## `CD` — Delisting Corporate Action Type

| Value | Description |
|-------|-------------|
| `GDR` | Dropped |
| `GEX` | Exchange |
| `GLI` | Liquidation |
| `LOS` | Lost Source |
| `MER` | Merger |
| `N/A` | Not Applicable |

## `CF` — Aggregate Completeness Flag

| Value | Description |
|-------|-------------|
| `G` | Green |
| `R` | Red |
| `Y` | Yellow |

## `CG` — Aggregate Completeness Sub-Flag

| Value | Description |
|-------|-------------|
| `G1` | Green-1 |
| `G2` | Green-2 |
| `G3` | Green-3 |
| `R1` | Red-1 |
| `R2` | Red-2 |
| `R3` | Red-3 |
| `Y1` | Yellow-1 |
| `Y2` | Yellow-2 |
| `Y3` | Yellow-3 |

## `CI` — Distribution Impact

| Value | Description |
|-------|-------------|
| `C1` | One Ordinary Cash Dividend |
| `C2` | Two Ordinary Cash Dividends |
| `CS` | One Cash Dividend & One Stock Split |
| `D1` | One Delisting Action |
| `D2` | Two Delisting Actions |
| `F1` | One Share Factor - Non-Split |
| `M2` | Two Corporate Actions |
| `MU` | Multiple Corporate Actions |
| `N1` | One Non-Ordinary |
| `NA` | Not Applicable |
| `NO` | No Corporate Actions |
| `O1` | One 'Other' Action |
| `P1` | One Price Factor - Non-Split |
| `S1` | One Stock Split/Dividend |
| `S2` | Two Stock Splits/Dividends |
| `T1` | One (Tender) Offer Action |

## `CL` — Item Class

| Value | Description |
|-------|-------------|
| `CodeSICCD` | SIC - Standard Industrial Classification Code |
| `DateAnnual` | Annual Year-End Date |
| `DateDaily` | Daily Calendar Date |
| `DateDaily14` | Daily Calendar Date - 14 days |
| `DateDaily180` | Daily Calendar Date - 180 days |
| `DateDlyEnd` | Daily Calendar End Date |
| `DateDlyStart` | Daily Calendar Start Date |
| `DateDlyWNull` | Daily Calendar Date With Null |
| `DateMonth` | Month-End Date |
| `DateQuarter` | Quarter-End Date |
| `DateTrade` | Daily Trading Date |
| `DateTrdEnd` | Daily Trading End Date |
| `DateTrdStart` | Daily Trading Start Date |
| `DescVar-255` | Description field - 255 characters wide |
| `DescVar-50` | Description field - 50 characters wide |
| `FlagFix-1` | Flag that is exactly 1 character |
| `FlagFix-2` | Flag that is exactly 2 characters |
| `FlagFix-3` | Flag that is exactly 3 characters |
| `FlagFix-4` | Flag that is exactly 4 characters |
| `FlagFix-5` | Flag that is exactly 5 characters |
| `FlagFix-8` | Flag that is exactly 8 characters |
| `FlagVar-1` | Flag that can be up to 1 character |
| `FlagVar-16` | Flag that can be up to 16 characters |
| `FlagVar-20` | Flag that can be up to 20 characters |
| `FlagVar-3` | Flag that can be up to 3 characters |
| `FlagVar-4` | Flag that can be up to 4 characters |
| `FlagVar-5` | Flag that can be up to 5 characters |
| `FlagVar-6` | Flag that can be up to 6 characters |
| `FlagVar-7` | Flag that can be up to 7 characters |
| `IdCNUM` | CNUM - CUSIP Bureau Issuer - Exactly 6 characters |
| `IdCUSIP` | CUSIP Bureau Security - Exactly 8 characters wide |
| `IdCUSIP9` | CUSIP Bureau Security with Check Digit - width 9 |
| `IdFileName` | CRSP File Name |
| `IdFlagValue` | CRSP Flag Value |
| `IdItemName` | CRSP Item Name |
| `IdNAICS` | NAICS - North Amer Industry Classification System |
| `IdnumCompno` | NASDAQ Compno |
| `IdnumIssueno` | NASDAQ Issuno |
| `IdR` | R code for the data type |
| `IdSAS` | SAS code for the data type |
| `IdSASForm` | SAS code for the data format |
| `IdSQL` | SQL code for the data type |
| `IdTicker` | Ticker - up to 5 upper case letters |
| `IdTradingSymbol` | Trading Symbol - up to 7 upper case letters |
| `KeyColCov` | Column Coverage Key |
| `KeyColumn` | Column Key |
| `KeyFile` | File Key |
| `KeyFlag` | Flag Key |
| `KeyFlagCov` | Flag Coverage Key |
| `KeyFlagType` | Flag Type Key |
| `KeyINDFAM` | INDFAM |
| `KeyINDNO` | INDNO |
| `KeyItem` | Item Key |
| `KeyPERMCO` | PERMCO |
| `KeyPERMNO` | PERMNO |
| `KeySIZtoCIZ` | SIZ to CIZ Key |
| `Name100` | Name Field 100 |
| `Name50` | Name Field 50 |
| `Name60` | Name Field 60 |
| `Name80` | Name Field 80 |
| `Num1to10` | Number from 1 to 10 |
| `Num1to4` | Number from 1 to 4 |
| `Num1to7` | Number from 1 to 7 |
| `NumCnt100` | Count from 0 to 100 |
| `NumCnt100K` | Count from 0 to 100,000 |
| `NumCnt10K` | Count from 0 to 10,000 |
| `NumCnt1B` | Count from 0 to 1,000,000,000 |
| `NumCnt1K` | Count from 0 to 1,000 |
| `NumCnt1M` | Count from 0 to 1,000,000 |
| `NumCnt20` | Count from 0 to 20 |
| `NumCnt200` | Count from 0 to 200 |
| `NumCnt350` | Count from 0 to 350 |
| `PctShares` | Shares Percentage |
| `PerAny` | Period Value - Any Frequency |
| `PerDay` | Daily Period Value - YYYYMMDD |
| `PerMonth` | Monthly Period Value - YYYYMM |
| `PerQuarter` | Quarterly Period Value - YYYYQ |
| `PerYear` | Annual (Yearly) Period Value - YYYY |
| `QtyShares` | Quantity Shares |
| `QtyVolume` | Quantity Volume |
| `RatioCount` | Ratio of Counts |
| `RatioFactor` | Calculation Factors |
| `RatioIncRet` | Income Return |
| `RatioReturn` | Return |
| `ValBaseLvl` | Base Index Level |
| `ValCap` | Security or Issuer Capitalization |
| `ValDivAmt` | Distribution or Dividend Amount |
| `ValLevel` | Index Level |
| `ValMktVal` | Market Value for an Index |
| `ValPrc` | Security Price |
| `ValPrcVol` | Security Price times Volume |
| `ValSecStat` | Security Statistics |

## `CP` — Capitalization Flag

| Value | Description |
|-------|-------------|
| `AD` | ADR |
| `BP` | Basis Price Capitalization |
| `DE` | Delisted |
| `MP` | Missing Price |
| `MS` | Missing Shares |
| `NA` | Not Applicable |
| `NT` | Not Tracked |
| `PB` | Prior Basis Price Capitalization |

## `CS` — Delist Completion Status Type

| Value | Description |
|-------|-------------|
| `FPAY` | Final Payment |
| `N/A` | Not Applicable |
| `NDC` | No Distributions, Closed |
| `NDP` | No Distributions, Pending |
| `NFC` | No Final, Closed |
| `NFP` | No Final, Pending |
| `NVP` | No Value, Pending |
| `UNAV` | Unavailable |
| `VCL` | Valued, Closed |

## `CT` — Conditional Type

| Value | Description |
|-------|-------------|
| `N/A` | Not Applicable |
| `NT` | Not Tracked |
| `NW` | Non-Leading When Issued |
| `RW` | Regular Way |
| `WI` | When Issued |

## `CU` — Distribution Original Currency Type

| Value | Description |
|-------|-------------|
| `N/A` | Not Applicable |
| `NUS` | Non-US |
| `USD` | United States dollar |

## `CY` — Item Category

| Value | Description |
|-------|-------------|
| `CODE` | Integer Code |
| `DATE` | Date Field |
| `DESCRIPTION` | Wide Character Description Field |
| `FLAG` | Character Flag Field |
| `ID` | Character Identifier Field |
| `IDNUM` | Numeric Identifier Field |
| `KEY` | Integer Field used as a Unique Key |
| `NAME` | Medium width character field |
| `NUMBER` | Integer value < 2,000,000,000 |
| `PERIOD` | Integer field used for a Calendar Period |
| `QUANTITY` | Integer with values that can exceed 2,000,000 |
| `RATIO` | Calculated floating point number |
| `VALUE` | Field with a wide range of numeric values |

## `DE` — Aggregate Delisting Flag

| Value | Description |
|-------|-------------|
| `A` | Amount - Return Included |
| `G` | Gap - Return Excluded |
| `M` | Missing- Return Excluded |
| `N` | Not Applicable |
| `P` | Price- Return Included |
| `V` | Value Partial - Return Included |

## `DR` — Delisting Reason Type

| Value | Description |
|-------|-------------|
| `BKPY` | Bankruptcy |
| `CORQ` | Company Request |
| `DEEX` | Denied Exception |
| `DELQ` | Delinquent |
| `DERE` | Deregistration |
| `EQRQ` | Equity Requirements |
| `FARG` | Failure to Register |
| `FDCV` | Fund Conversion |
| `FING` | Financial Guidelines |
| `INSC` | Insufficient Capital |
| `INSF` | Insufficient Float |
| `LP` | Low Price |
| `MTMK` | Market Makers |
| `MVB` | Moved to Boston |
| `MVCHI` | Moved to Chicago |
| `MVMF` | Moved to Mutual Fund |
| `MVMO` | Moved to Montreal |
| `MVNM` | Moved to NYSE MKT |
| `MVOT` | Moved to OTC |
| `MVPAC` | Moved to Pacific |
| `MVPH` | Moved to Philadelphia |
| `MVTO` | Moved to Toronto |
| `N/A` | Not Applicable |
| `NACT` | Not Applicable - Active |
| `OFFRE` | Offer Rescinded |
| `PUBI` | Public Interest |
| `SERQ` | SEC Required |
| `SHLD` | Shareholders |
| `UNAV` | Unavailable |
| `UNL` | Unlisted |
| `VIO` | Violation |

## `EC` — Primary Exchange

| Value | Description |
|-------|-------------|
| `A` | NYSE American |
| `B` | BATS |
| `I` | IEX |
| `N` | NYSE |
| `Q` | NASDAQ |
| `R` | NYSE ARCA |
| `X` | Unknown |

## `ED` — Date Status Flag

| Value | Description |
|-------|-------------|
| `CLMB` | Columbus Day |
| `COOL` | Special Event |
| `DDEF` | Special Event |
| `EAST` | Easter Saturday |
| `ELEC` | Election Day |
| `EMBH` | Special Event |
| `GFRI` | Good Friday |
| `GHBF` | Special Event |
| `GLOR` | Special Event |
| `GRFF` | Special Event |
| `JFKA` | Special Event |
| `JUL4` | Independence Day |
| `LABR` | Labor Day |
| `LBJF` | Special Event |
| `LINC` | Lincoln's Birthday |
| `LNBG` | Special Event |
| `MLKD` | Martin Luther King's Day |
| `MLKM` | Special Event |
| `MMRL` | Memorial Day |
| `MNTN` | Close for Maintenance |
| `MOON` | Special Event |
| `N/A` | Not Applicable |
| `NAVY` | Special Event |
| `NEWY` | New Years Day |
| `NIXF` | Special Event |
| `NYBO` | Special Event |
| `PRES` | Presidents Day |
| `RGNF` | Special Event |
| `SATC` | Special Event |
| `SEP11` | Special Event |
| `SNDY` | Special Event |
| `SNOW` | Special Event |
| `TNKG` | Thanksgiving |
| `TRDF` | Full Day Trading |
| `TRDH` | Partial Day Trading |
| `TRDS` | Saturday Trading |
| `TRUF` | Special Event |
| `VETR` | Veterans Day |
| `VJDY` | Special Event |
| `WASH` | Washington's birthday |
| `WKND` | Weekend |
| `XMAS` | Christmas |

## `EG` — Exchange Group

| Value | Description |
|-------|-------------|
| `A` | NYSE Market Only |
| `ALL` | All - No Exchange restriction is done |
| `N` | NSYE Only |
| `N/A` | Not Applicable |
| `NA` | NYSE-NYSE Market |
| `NANMS` | NYSE-NYSE Market-NMS-Global-GlobalSelect |
| `NAQ` | NYSE-NYSE Market-NASDAQ |
| `NAQR` | NYSE-NYSE Market-NASDAQ-ARCA |
| `Q` | NASDAQ Only |
| `R` | ARCA Only |

## `ET` — Exchange Tier

| Value | Description |
|-------|-------------|
| `G` | Global Market after 20060701 (formerly NMS) |
| `N/A` | Not Applicable |
| `NMS` | The NASDAQ National Market |
| `Q` | Global Select Market after 20060701 (new subset) |
| `S` | Capital Market after 20060701 (formerly SmallCap) |
| `SC` | NASDAQ Small Cap Market on or after 19920615 |
| `SC1` | The NASDAQ Small Cap Market before 19920615 |

## `FD` — Flag Type and Item Flag Type

| Value | Description |
|-------|-------------|
| `AD` | Action Component Detail Type Code |
| `AF` | Aggregate Share Factor Type Code |
| `AG` | Aggregate Date Type Code |
| `AR` | Aggregate Return Type Code |
| `AT` | Action Component Type Code |
| `AV` | Aggregate Volume Type Code |
| `CB` | ICB Industry Type Code |
| `CC` | Common Class Type Code |
| `CD` | Corporate Action Type Code |
| `CF` | Calendar Period Type Code |
| `CI` | Corporate Action Impact Type Code |
| `CL` | Item Class Type Code |
| `CP` | Capitalization Type Code |
| `CS` | Completion Status Type Code |
| `CT` | Conditional Type Code |
| `CU` | Currency Code |
| `CY` | Item Category Type Code |
| `DR` | Delist Reason Type Code |
| `EC` | Exchange Code |
| `ED` | Exchange Date Status Code |
| `EG` | Exchange Group Code |
| `ET` | Exchange Tier Code |
| `FD` | Flag Type Type Code |
| `FI` | File Category Type Code |
| `FK` | File Key Type Type Code |
| `FO` | Fractile Order Code |
| `FR` | File Row Frequency Type Code |
| `FT` | Frequency Type Code |
| `I1` | Issuer Status Type Code |
| `I8` | Index Count Value Type Code |
| `IB` | Index Break Point Formation Type Code |
| `IF` | Index Family Type Code |
| `IJ` | Index Breakpoint Statistic Code |
| `IT` | Issuer Type Code |
| `IW` | Index Weighting Type Code |
| `MF` | Membership Type Code |
| `MS` | Missing Statistic Code |
| `MT` | SIZ Mapping Type Code |
| `MU` | SIZ Mapping Sub-Type Code |
| `PC` | Price Type Code |
| `PM` | Payment Method Type Code |
| `PP` | Periodic Processing Frequency Code |
| `PT` | Payment Summary Type Code |
| `RD` | Return Duration Type Code |
| `RM` | Return Missing Type Code |
| `S2` | Security Sub Type Code |
| `S3` | Security Type Code |
| `S4` | Share Type Code |
| `SD` | Share Change Source Type Code |
| `SY` | Assignment Statistic Used Type Code |
| `TG` | Time Grain Type Code |
| `TS` | Trading Status Type Code |
| `TX` | Tax Status Code |
| `UT` | Universe Type Code |
| `YN` | Yes or No Type Code |
| `YX` | Yes, No, or Not Available X Type Code |

## `FI` — File Category

| Value | Description |
|-------|-------------|
| `ASSOCIATION` | Rows provide association between two keys |
| `EVENT` | Event - Non-Regular and Dated Events |
| `IDENTIFIER` | Identifiers and Descriptive Characteristics |
| `METADATA` | Metadata Files |
| `TIMESERIES` | Contains contiguous rows at a fixed frequency |

## `FK` — File Key Type

| Value | Description |
|-------|-------------|
| `AssocPerWithGap` | Association Periods with Gap Allowed |
| `AssocRangeWithGap` | Association Ranges With Gap Allowed |
| `Key` | Single Key Field |
| `KeyDtNoGap` | Key Field with Date and No Gap (i.e. Timeseries) |
| `KeyDtSeq` | Key Field with event date and sequence number |
| `KeyPeriodNoGap` | Key Field with Period and No Gap (i.e. Timeseries) |
| `KeyRangeNoGap` | Key Field with Range and No Gap |
| `KeySeq` | Key Field combined with sequence field |
| `KeySeqSeq` | Key Field combined with two sequence fields |
| `KeySeqValue` | Key Field combined with sequence field and a value |
| `KeyValue` | Key Field combined with a value |

## `FO` — Portfolio Order

| Value | Description |
|-------|-------------|
| `HIGH` | HIGH |
| `LOW` | LOW |
| `N/A` | Not Applicable |

## `FR` — File Row Frequency

| Value | Description |
|-------|-------------|
| `Annual` | Annual Period - YYYY or AnnCalDt |
| `AssocAnnual` | Association Periods with Annual Data |
| `AssocDateRange` | Association Periods with Data Ranges |
| `AssocQuarterly` | Association Periods with Quarterly Data |
| `Column` | Column - 1 row per column - file and item |
| `ColumnSeq` | ColumnSeq - 1 row per column and sequence number |
| `ColumnValue` | ColumnValue - 1 row per column per value |
| `Daily` | Daily Period - YYYYMMDD or DlyCalDt |
| `DateRange` | Date Range - Start and End |
| `Monthly` | Monthly Period - YYYYMM or MthCalDt |
| `Observation` | Observation - Event Date |
| `PeriodFreq` | Period Frequency - 1 row per period per frequency |
| `Quarterly` | Quarterly Period - YYYYQ or QtrCalDt |
| `Single` | Single Row Per Entity |
| `TypeValue` | Type Value - 1 Row per flag type and flag value |

## `FT` — Distribution Frequency Type

| Value | Description |
|-------|-------------|
| `A` | Annual |
| `E` | Extra or Special |
| `I` | Interim |
| `M` | Monthly |
| `N` | Non-Recurring |
| `N/A` | Not Applicable |
| `Q` | Quarterly |
| `S` | Semi-Annual |
| `U` | Unspecified |
| `X` | Unknown |
| `Y` | Year-End |

## `I1` — Issuer Status

| Value | Description |
|-------|-------------|
| `AC` | Active and Tracked |
| `NT` | Not Tracked |

## `I8` — Index Count and Value Availability Type

| Value | Description |
|-------|-------------|
| `BOTH` | Both |
| `N/A` | Not Applicable |
| `USED` | Used |

## `IB` — Index Breakpoint Formation Type

| Value | Description |
|-------|-------------|
| `F` | Use forward statistics for breakpoints |
| `L` | Largest stat in each fractile used as breakpoint |
| `X` | Not Applicable |

## `IF` — Index Family Type

| Value | Description |
|-------|-------------|
| `C` | Combination (Union) of ICGs |
| `E` | External (e.g. Treasury) |
| `F` | Fractile (even count) |
| `L` | Level-Based (External levels) |
| `N` | No Operation/Change (same as superfamily) |
| `R` | Recalc of external (S&P) |

## `IJ` — Statistic Breakpoint Type

| Value | Description |
|-------|-------------|
| `B` | Beta |
| `IC` | Issuer Cap |
| `IC2` | Issuer Cap - NYSE Break pointing |
| `N/A` | Not Applicable |
| `SC` | Security Cap |
| `SCM` | Security Cap (Monthly) |
| `SD` | Standard Deviation |
| `TOB` | Trade Only Beta |

## `IT` — Issuer Type

| Value | Description |
|-------|-------------|
| `ACOR` | Assumed Corporation |
| `CORP` | Corporation |
| `REIT` | REIT |

## `IW` — Index Weighting Type

| Value | Description |
|-------|-------------|
| `EQ` | Equal |
| `EV` | Equal/Value |
| `MC` | Market-Cap |
| `X` | Not Applicable |

## `MF` — Constituent Membership Flag

| Value | Description |
|-------|-------------|
| `NORM` | Normal Membership - 100% weight |

## `MS` — Statistic Flag

| Value | Description |
|-------|-------------|
| `CPNL` | Cur Proc Period - not active on last trading day |
| `CPPP` | Cur Proc Per Active last trd day; part trd period |
| `FWD` | Forward statistic value used |
| `IVER` | Insufficient Valid and Eligible Returns |
| `MSC` | Missing security capitalization |
| `N/A` | Not Applicable |
| `NMBR` | NonMember of Index Family during processing period |

## `MT` — SIZ to CIZ Mapping Type

| Value | Description |
|-------|-------------|
| `Closest` | Closest Match - non-exact |
| `Combined` | SIZ columns combine to form a CIZ column |
| `ConvChange` | Convention Change |
| `DateToYYYY` | Date to YYYY |
| `DateToYYYYMM` | Date to YYYYMM |
| `DateToYYYYMMDD` | Date to YYYYMMDD |
| `DateToYYYYQ` | Date to YYYYQ |
| `Denormalized` | Denormalized (duplicated) Data |
| `Documentation` | Columns from Documentation |
| `Exact` | Exact Match |
| `ManyToOne` | Many to One |
| `Mapped` | Mapped from Integer to Flag |
| `NameCleanup` | Name Column Cleanup |
| `Normalized` | Normalized Data |
| `OneToMany` | One to Many |
| `OneToOne` | One to One |
| `Reassign` | Reassignment Process |
| `Recalc` | Recalculation Process |
| `Split` | Split Code |
| `SplitToOne` | Split Rows to One |
| `Zero-ManyToMany` | Zero-Many to One |
| `Zero-ManyToNormalize` | Zero-OneToNormalized |
| `Zero-ManyToOne` | Zero-Many to Many |
| `Zero-OneToMany` | Zero-One to Many |
| `Zero-OneToOne` | Zero-OneToOne |

## `MU` — Siz to CIZ Mapping Sub-Type

| Value | Description |
|-------|-------------|
| `AddedIndDaily` | Additional Daily Index Rows |
| `AddedIndHeader` | Additional Index Header Rows |
| `AddedIndIssSecRB` | Additional Rebalancing Summary Rows |
| `AddedIndMember` | Additional Index Membership Rows |
| `AddedIndMonthly` | Additional Monthly Index Series Data Rows |
| `AddedIndPortDaily` | Additional Index Portfolio Daily Assignment Rows |
| `AddedIndPortMonthly` | Additional Index Portfolio Monthly Assignment Rows |
| `AddedIndStatDaily` | Additional Index Portfolio Daily Statistics Rows |
| `AddedIndStatMonthly` | Additional Index Portfolio Monthly Statistics Rows |
| `BidAsk` | Bid Ask Convention Change |
| `CAP` | Capitalization Change |
| `CNUM6` | CNUM Issuer CUSIP |
| `DailyPrev` | Daily Previous Convention |
| `DateToYYYY` | Date to YYYY |
| `DateToYYYYMM` | Date to YYYYMM |
| `DateToYYYYMMwithJoin` | Date to YYYYMM with Join |
| `DateToYYYYQ` | Date to YYYYQ |
| `DelistCd` | Delisting Numeric Code to Mnemonic Fields |
| `DelistConv` | Delisting Convention Changes |
| `DelistConvDaily` | Delisting Convention Daily Changes |
| `DelistConvDaily_Date` | Delisting Convention Daily Changes Date |
| `DelistConvMonthly` | Delisting Convention Change Monthly |
| `DelistConvSlicing` | Delisting Convention Slicing |
| `DistCd` | Distribution Numeric Code to Mnemonic Fields |
| `DistConversion` | Distribution Key Field Conversion |
| `Exact` | Exact Match |
| `ExactRows` | Exact Rows |
| `Exchcd` | Exchange Numeric Code to Mnemonic Fields |
| `IndexBreakStat` | Index Breakpoint Statistic Levels |
| `IndexCount` | Index Counts Fields |
| `IndexCountValue` | Index Count Value |
| `IndexCountValuePT` | Index Count Value Pass-Through |
| `IndexDescription` | Index Description Fields |
| `IndexEligCnt` | Index Eligible Count |
| `IndexEligCntPT` | Index Eligible Count Pass-Through |
| `IndexInfo` | Index Information Split |
| `IndexIssuerAllCnt` | Index Issuer All Count |
| `IndexLevel` | Index Level Fields |
| `IndexMinMaxId` | Index Minimum and Maximum ID Fields |
| `IndexMinMaxStat` | Index Minimum and Maximum Statistic Fields |
| `IndexRebalCnt` | Index Rebalance Summary Count |
| `IndexReturn` | Index Return Fields |
| `IndexValue` | Index Value Fields |
| `MachinePrecision` | Machine Precision Limitations |
| `MbrFlg` | Member Flag |
| `Minus5Conv` | Minus 5 Convention |
| `MthToAgg` | Monthly To Aggregate |
| `MthToAggDateToYYYYMM` | Monthly To Aggregate with YYYYMM |
| `MthToAggPrice` | Monthly To Aggregate Price |
| `NDIToDly` | Nasdaq Information to Daily |
| `NDIToInfoHIst` | Nasdaq Information to Security Info Hist |
| `NMSIND` | NMS Indicator Convention |
| `PassThrough` | Pass Through Index Values |
| `PeriodEndToDaily` | Period End to Daily |
| `PeriodEndToPeriodEnd` | Period End to Period End |
| `Plus1Port` | Plus One Port for YYYY |
| `Price` | Price Convention Change |
| `Rename` | Rename of Item |
| `RenameMinus5` | Minus 5 Convention |
| `Rename/NextTrdDay` | Renamed Field and Next Trading Day Convention |
| `Rename/PrevQtr` | Renamed Field and Previous Quarter |
| `Rename/PrevYr` | Renamed Field and Previous Year |
| `SAME` | Same Name |
| `SECurityNm` | Security Name Convention |
| `SECurityRet` | Security Return Changes |
| `SFZ_HDR-PERMCO` | SFZ Header PERMCO convention |
| `SFZ_INDHDR-INDFAM` | SFZ Index Header to Index Family |
| `SFZ_INDHDR-INDNO` | SFZ Index Header to INDNO Characteristics |
| `SFZ_NAM-PERMCO_DT` | SFZ Names to PERMCO and Date |
| `SFZ_NAM-PERMNO_DT` | SFZ Names to PERMNO and Date |
| `ShareConversion` | Share Conversion Changes |
| `ShrCd` | Share Code Convention Change |
| `ShrFlg` | Share Flag Convention Change |
| `SICCD` | SICCD Convention Change |
| `StatFlg` | Statistic Flag Convention Change |
| `Ticker` | Ticker Convention Change |
| `YYYYtoYYYYQ` | YYYYMM to YYYYQ |
| `YYYYtoYYYYQPlus1Port` | YYYYMM to YYYYQ and Plus One Port |

## `PC` — Price Flag - Multiple - See Definition

| Value | Description |
|-------|-------------|
| `BA` | Bid Ask Average |
| `DA` | Delisting Amount (no Delisting Price) |
| `DM` | Delisting Price/Amount Missing |
| `DP` | Delisting Price |
| `GP` | Gap - more than 10 periods |
| `MI` | Missing - Prior to BegDt |
| `MP` | Missing Price |
| `NA` | Not Applicable |
| `NS` | New Security |
| `NT` | Not Tracked |
| `TR` | Closing Trade Price |

## `PF` — Calendar Period Flag

| Value | Description |
|-------|-------------|
| `COMPLETE` | Complete Period |
| `FUTURE` | Future Period |
| `PARTIAL` | Partial Period |
| `START` | Start of CRSP Data |

## `PM` — Distribution Payment Method Type

| Value | Description |
|-------|-------------|
| `FX` | Foreign Currency |
| `N/A` | Not Applicable |
| `OP` | Other Property |
| `OS` | Other Security |
| `SS` | Same Security |
| `UN` | Unspecified |
| `UNIT` | Units Including Same Issue of Common Stock |
| `USD` | USD |
| `X` | Unknown |

## `PP` — Frequency Type

| Value | Description |
|-------|-------------|
| `A` | Annually |
| `N/A` | Not Applicable |
| `Q` | Quarterly |

## `PT` — Delisting Payment Summary Type

| Value | Description |
|-------|-------------|
| `CASH` | Cash |
| `CNC` | Common and Non-Common |
| `COP` | Cash and Other Property |
| `CSHN` | Cash and Non-Common |
| `CST` | Cash and Stock |
| `CUS` | Cash and Untracked Stock |
| `DW` | Declared Worthless |
| `MAF` | Merger Attempt Failed |
| `MMI` | Missing Information |
| `MUT` | Mutual Funds |
| `N/A` | Not Applicable |
| `NCOM` | Non-Common |
| `NCOP` | Non-Common and Other Property |
| `OP` | Other Property |
| `PRCF` | Price Final |
| `SNC` | Stock and Non-Common |
| `SOP` | Stock and Other Property |
| `STK` | Stock |
| `UMAP` | Unmapped |
| `UNAV` | Unavailable |
| `USNC` | Untracked Stock and Non-Common |
| `USOP` | Untracked Stock and Other Property |
| `USTK` | Untracked Stock |

## `RD` — Daily Return Duration Flag

| Value | Description |
|-------|-------------|
| `D1` | 1 Trading Day and 1 Calendar Day |
| `D2` | 1 Trading Day and 2 Calendar Days |
| `D3` | 1 Trading Day and 3 Calendar Days |
| `D4` | 1 Trading Day and 4 Calendar Days |
| `DD` | Other Daily Delisting Return Duration |
| `DU` | 1 Trading Day & 5 or more Calendar Days |
| `MR` | Missing Return |
| `P1` | Multi-period 2 Trading Days or Months |
| `P2` | Multi-period 3 Trading Days or Months |
| `P3` | Multi-period 4 Trading Days or Months |
| `P4` | Multi-period 5 Trading Days or Months |
| `P5` | Multi-period 6 Trading Days or Months |
| `P6` | Multi-period 7 Trading Days or Months |
| `P7` | Multi-period 8 Trading Days or Months |
| `P8` | Multi-period 9 Trading Days or Months |
| `P9` | Multi-period 10 Trading Days or Months |

## `RM` — Return Missing Flag - Daily and Delisting

| Value | Description |
|-------|-------------|
| `DG` | Delisting Price GT 10 periods from delisting date |
| `DM` | Delisting Price/Amount Missing |
| `DP` | Delisting Pending |
| `GP` | Gap Between Prices Too Large |
| `MP` | Missing Price |
| `MV` | Missing Corporate Action Value |
| `NA` | Not Applicable |
| `NS` | New Security |
| `NT` | Not Tracked |
| `RA` | Return after Not Tracked period |

## `S2` — Security Sub-Type

| Value | Description |
|-------|-------------|
| `ATR` | Americus Trust |
| `CEF` | Closed End Fund |
| `COM` | Common |
| `ETF` | Exchange Traded Fund |
| `ETV` | Exchange Traded Vehicle |
| `UNK` | Unknown or Unspecified |

## `S3` — Security Type

| Value | Description |
|-------|-------------|
| `DERV` | Derivative |
| `EQTY` | Equity |
| `FUND` | Fund |
| `N/A` | Not Applicable |

## `S4` — Share Type

| Value | Description |
|-------|-------------|
| `AD` | American Depositary Receipt |
| `CE` | Certificate |
| `N/A` | Not Applicable |
| `NS` | No special share type specified |
| `SB` | Shares of Beneficial Interest |
| `UG` | Units General |

## `SD` — Share Change Source Type

| Value | Description |
|-------|-------------|
| `EVS` | Split/Dividend Event |
| `NC` | Name Change |
| `OBS` | Observation From Source |

## `SH` — Share Class

| Value | Description |
|-------|-------------|
| `1` | Class 1 |
| `A` | Class A |
| `B` | Class B |
| `C` | Class C |
| `D` | Class D |
| `E` | Class E |
| `G` | Class G |
| `H` | Class H |
| `L` | Class L |
| `N` | Class N |
| `NCS` | No Class Specified |
| `P` | Class P |
| `S` | Class S |
| `T` | Class T |
| `U` | Class U |
| `V` | Class V |
| `Z` | Class Z |

## `SY` — Statistic Assignment Type

| Value | Description |
|-------|-------------|
| `FWD` | Forward statistics can be used for assignments |

## `TG` — Index Frequency

| Value | Description |
|-------|-------------|
| `BTH` | Both |
| `DLY` | Daily |
| `MTH` | Monthly |

## `TS` — Trading Status

| Value | Description |
|-------|-------------|
| `A` | Active |
| `D` | Delisted |
| `H` | Halted |
| `S` | Suspended |
| `X` | Unknown or Unavailable |

## `TX` — Distribution Tax Status Type

| Value | Description |
|-------|-------------|
| `C` | Capital Gains |
| `D` | Dividend |
| `F` | Full |
| `G` | Gain/Loss |
| `N` | Non-Taxable |
| `N/A` | Not Applicable |
| `P` | Plan |
| `R` | Return of Capital |
| `T` | Tax Receipt |
| `U` | Unspecified |
| `X` | Unknown |

## `UC` — UES Industry Type

| Value | Description |
|-------|-------------|
| `CONDIS` | Consumer Discretionary |
| `CONSTAP` | Consumer Staples |
| `ENERGY` | Energy |
| `FINL` | Financials |
| `HEALTH` | Healthcare |
| `INDL` | Industrials |
| `MATL` | Materials |
| `MEDCOMM` | Media & Communications |
| `NOAVAIL` | Not Available |
| `QUASGOV` | Quasi Government |
| `REIT` | Real Estate & REITS |
| `SOVRN` | Sovereign |
| `TECH` | Technology |
| `TRUST` | Trust |
| `UTIL` | Utilities |

## `UD` — Underlying Data for Index Family

| Value | Description |
|-------|-------------|
| `MBR` | Security and membership  available |
| `NONE` | No underlying data available |
| `REB` | Sec, membership, weight, and rebal data available |
| `SEC` | Only security data available |
| `WGT` | Sec, mbr, weight data avail; rebal data not needed |

## `UT` — Universe Type

| Value | Description |
|-------|-------------|
| `CAP` | Cap-Based |
| `HLU` | Historic (Legacy) Universe |
| `N/A` | Not applicable-Security Information not Available |
| `NORULE` | Security Information available-no Rule restriction |

## `YN` — Yes No Flag

| Value | Description |
|-------|-------------|
| `N` | No |
| `Y` | Yes |

## `YX` — Yes No Unavailable Flag

| Value | Description |
|-------|-------------|
| `N` | No |
| `X` | Unavailable |
| `Y` | Yes |

