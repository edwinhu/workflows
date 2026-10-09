# Lexis Public Records: measured reference

Measured 2026-10-08/09 in a live session on the UVA Lexis+ account, driving the user's signed-in Chromium over CDP :9222. Nothing here is from documentation. Re-measure before relying on a field id months later.

## Access and permissible use

- Entry: `https://advance.lexis.com/publicrecordshome` (product menu "Public Records"). The app is an iframe served from `https://r3.lexis.com/laprma/Default.aspx`; once signed in, navigate to `r3.lexis.com/laprma/*` pages directly.
- Every page shows the account's permissible-use settings: DPPA "I have no permissible use", GLBA "I have no permissible use". Person-level sources (people locate, SSN, voter, death, DMV-type data) are restricted by that. Business sources work.
- Never sign in on the user's behalf. A signed-out tab means stop and tell the user.

## Source menu (Default.aspx)

| Group | Sources |
|---|---|
| People | Locate a Person, Death Records, Voter Registration |
| Assets | Current Asset Report (People), FAA Aircraft |
| Licenses | FAA Pilots, FCC, Hunting & Fishing, Professional, Health Care Provider (+ Sanctions), Tax Professionals |
| Businesses | Locate a Business (Nationwide) `TopBusinessSearch.aspx?national=true`, California Business Locator, Corporation Filings `CorporateFilings.aspx`, FEIN `FeinRecords.aspx`, Fictitious Business Names `Fbn.aspx`, Texas Sales Permit, UCC Filings `Ucc.aspx` |
| Real Property | Real Property, Foreclosures, Property History |
| Courts & Filings | Bankruptcy `Bankruptcies.aspx`, Criminal, Judgments & Liens `JnL.aspx`, Marriage & Divorce, OSHA Inspection |

## Corporation Filings (`CorporateFilings.aspx`)

### Coverage

Page: `https://r3.lexis.com/coverage/CorpFil.html` — per state: status (Updating / Historical / Suspended), coverage start, coverage end, last update, frequency.

- 2026-10-09: Nevada Updating, 12/11/1877–09/09/2026, last update 09/22/2026, weekly.
- **Delaware is not listed at all**, and the Filing Jurisdiction dropdown has 50 entries without Delaware. Delaware entity status is not available on Lexis.
- Hawaii and New Mexico are Historical; Michigan is Suspended.

### Form field ids

`#MainContent_Company_CompanyName`, `#MainContent_Company_Fein`, `#MainContent_Name_FirstName` / `MiddleName` / `LastName`, `#MainContent_Address_Address1`, `#MainContent_Address_City`, `#MainContent_Address_State_stateList`, `#MainContent_Address_Zip5`, `#MainContent_StrictMatch`, `#MainContent_UsePhonetics`, `#MainContent_UseNicknames`, `#MainContent_SearchRegisteredAgents`, `#MainContent_CharterNumber` (Charter/Filing Number), `#MainContent_FilingJurisdiction_stateList`. Submit: `#MainContent_formSubmit_searchButton`.

### The stale-form trap

**The form keeps the previous search's terms.** A stale company name ANDs with a new charter number and returns no results. Fix: clear every text input, checkbox and select before each search (or reload the page and clear anyway). `scripts/corp-lookup.ts` does this.

### Terms-and-connectors segments

Address, Business Address, Business Type, Company Name, Contact, Contact Address, Contact Status, Filing Date, Filing Jurisdiction, Filing Number, Incorp State, Name, Regis Agent, Corp Status.

### Results list (`Results.aspx?setId=...`)

Rows are numbered `1.\t` with tab-separated columns. Each record carries `Name Type:`, `Filing Date:`, `Registration Number:`, `Status:`, `Record Type: CURRENT`. A domestic entity can appear twice (registered-office and registered-agent address), so match on Registration Number, not row count.

### Full view

`__doPostBack('ctl00$MainContent$resultsViewLinks$fullListButton','')` → `SourceDocReportResults.aspx?...&s=CorporateFilingReport`. The full Nevada record holds:

- Filing Number, Name, Business Type, **Status and Status Date**, Place Incorporated, Date Incorporated, Date Last Seen
- Registered Agent type
- **Annual Report Filings**: each filed date and filing number, plus the next **Due Date** (a missed one shows here)
  - Dating a default from it (measured 2026-10-09 on 19 Nevada entities revoked or in default in 2023): for Revoked and Permanently Revoked records the Due Date is the missed list, so default starts the next day. For **Default** records the Due Date can be blank or roll forward to a future list (seen: due 06/30/2026 on an entity in default since 2023); use **Status Date** as the default start instead. For an entity **Active again**, the Due Date is its next list, and an earlier default date cannot be recovered from the record. Status Date is the date of the *current* status only: a revoked entity later made permanent shows the permanent-revocation date.
- Stock Information (authorized shares)
- **Officers** (name, title, status ACTIVE/INACTIVE, date, address) and Historical Contacts
- **Filing History** (date, type, ref no., description): amendments with old/new authorized capital, certificates of designation of preferred stock, registered-agent changes/resignations

Worked example, E0232352011-8 INTELLIGENT HIGHWAY SOLUTIONS, INC.: PERMANENTLY REVOKED, Status Date 05/01/2025; last annual list filed 05/04/2018, next due 04/30/2019 (missed); authorized shares raised 1.25B → 10B (09/25/2015) → 15.05B (10/13/2017); Series A convertible preferred designation 09/11/2015; registered agent resigned 10/26/2015 and 04/22/2019.

Script check 2026-10-09 (`corp-lookup.ts --full`): E0232352011-8 → PERMANENTLY REVOKED, Status Date 05/01/2025, Date Incorporated 04/22/2011, last annual list 05/04/2018, due 04/30/2019. C21244-2004 (LAS VEGAS SANDS CORP.) → ACTIVE, empty Status Date, Date Incorporated 08/09/2004, last annual list 07/23/2026, next due 08/31/2027 — for a current entity `due_date` is the upcoming date, not a missed one.

### Validation run

100 seeded linked Nevada entities looked up by registration number at 20–45 s per search: 100/100 exact matches. OpenCorporates 2023-07-06 status vs Lexis 2026-10: Permanently Revoked 31/31 unchanged; Merged 12/12, Converted Out 4/4, Merge Dissolved 2/2, Dissolved 2/2 unchanged; Active 21/30 still active (9 later revoked/default); Revoked 6/11 unchanged (4 → permanently revoked, 1 reinstated); Default 3/8 unchanged (3 cured, 2 revoked). No transition inconsistent with Nevada law.

## Judgments & Liens (`JnL.aspx`)

- Fields: company name, FEIN, address, filing number, tax certificate number.
- Segments: Amount (numeric), Attorney, Certificate Number, Creditor (+Address), Debtor (+Address), Filing Date, Filing Number, Filing Office, Filing State, IRS Serial Number, Release Date, Satisfied Date, Status, Type.
- Measured: company "Troika Media Group" (no strict match) → 244 records. Each row: debtor and address, filing date, amount, certificate number, type (STATE TAX WARRANT, STATE TAX LIEN, CIVIL JUDGMENT, CIVIL NEW FILING/DISMISSAL), filing number and office, release filings where present, creditor (e.g. STATE OF NEW YORK $812,802 warrant 2/3/2022 with release; PULSEPOINT INC civil judgment $20,636 12/15/2020).
- Results also list related individuals (officers) with LexID. Use Strict Search and restrict to the company debtor.

### Live check of `scripts/jnl-lookup.ts` (2026-10-09, 2 searches, paced)

- **Form:** `#MainContent_Company_CompanyName`, `#MainContent_Company_Fein`, `#MainContent_StrictMatch` (checkbox), `#MainContent_FilingNumber`, `#MainContent_CertificateNumber`, `#MainContent_Address_*`, submit `#MainContent_formSubmit_searchButton`. **`#MainContent_FilingJurisdiction_stateList` was pre-set to NV** on a fresh load (a stale-form trap too); index 0 is "All Available States". The script clears every field and select before each search.
- **Results list** (`Results.aspx`): header `1 - 10 of 244`, 10 records per page, paged by a Next control (the script follows it only until `--max-records`). Rows start ` N.\t`; header `No. Debtor Address Filing Creditor`. A record is: `debtor \t address lines + COUNTY`; `\tFiling Date:`, `Amount:`, `Certificate Number:` (when present); then one block per sub-filing, each an all-caps type line + `Filing Number:` / `Filing Date:` / `Filing Office:`; then `\t<creditor>`; then optional related debtors (`\tNAME \t address`, or `LexID(sm):` individuals). The original filing and its release sit side by side (`STATE TAX WARRANT` + `STATE TAX WARRANT RELEASE`, `CIVIL JUDGMENT` + `CIVIL JUDGMENT RELEASE`, `CIVIL NEW FILING` + `CIVIL DISMISSAL`), in either order; the filing date of the release is the release date. Old rows (1991 `JUDGMENTS DOCKET`) have no Filing Number. Some rows have no Amount.
- **Troika Media Group, strict on:** 244 records, the same count as the earlier non-strict measurement (244). Strict did not narrow it. Debtors in the first 50 (by date, newest first): TROIKA INC 13, TROIKA INTERNATIONAL INC 8, TROIKA MEDIA GROUP INC 4, TROIKA LLC 4, TROIKA PRODUCTIONS INC 2, TROIKA MEDIA GROUP 1, TROIKA MEDIA LLC 1, and 8 individuals (LexID rows) where TROIKA is the *creditor* (Greenville SC magistrate civil filings). Types in those 50: STATE TAX WARRANT 14, STATE TAX LIEN 10, COUNTY TAX LIEN 8, CIVIL NEW FILING 7, CIVIL JUDGMENT 5, JUDGMENTS DOCKET 2, small claims 1. Only ~6 of the 50 are the Troika Media Group entity: **filter on the debtor name after the fact**; the output keeps `debtor` for that. Whether the checkbox reached the server is not shown: the Terms line (`company(Troika Media Group) state(ALL) filing jurisdiction(ALL)`) does not echo it. FEIN does not narrow a name search (next section); search by FEIN alone.
- **Real Brands, Inc.** (Nevada C12141-1992, REVOKED): 6 records, all Broward County FL: state tax liens (2014, 2017), civil judgments (2015 $70,610; 2017 $33,000, released), a civil new filing. A revoked Nevada shell's liens are in its operating state, not Nevada.
- Pacing for result pages: each Next click waits the same 20-45 s as a search, so 50 records cost five paced requests.

## Other sources

- **UCC Filings** (`Ucc.aspx`): company/person name, address, filing number. Segments: Assignee, Debtors, Filing Date, Filing Jurisdiction, Filing Number, Filing Status, Secured Party (+Addr).
- **Bankruptcy** (`Bankruptcies.aspx`): company/person name, case number. Segments: Attorney, Case Number, Chapter, Filing Date, Filing Jurisdiction, Petitioner, Status.
### FEIN behavior in Judgments & Liens (2026-10-09, 26 firms name+FEIN, 4 FEIN-only)

- **Name + FEIN does not narrow.** Supplying the name and the FEIN returned the same `n_results` and the same records as the name alone for 25 of 26 firms (`nevada/scratch/jnl_pilot_ein/report.md`). The one exception, United Rentals, went from 0 results (name only) to 95 with the FEIN added: the FEIN seems to act only when the name finds nothing (one case, inferred).
- **FEIN alone is a different query** (`jnl-lookup.ts` with an empty `company` and a `fein`, or `--fein-only`; the company field stays blank). It returns the filings indexed under that FEIN, which can be a subset or a different set than the name search, and it matches renamed entities:
  - Block (800429876): name search 2,262 results (98% of the first 49 debtors contain BLOCK); FEIN-only 53 results, 34 of the first 50 debtors are SQUARE INC / SQUARE INCORPORATED (the former name), 11 BLOCK INC, 45 of 50 the same entity.
  - Jabil (381886260): name 67; FEIN-only 28, 27 of 28 debtors JABIL / JABIL CIRCUIT (96%), so a clean subset.
  - DraftKings (844052441, the Holdings EIN): name 57; FEIN-only 0. The FEIN is not indexed; absence is not evidence of no liens.
  - United Rentals (061522496): name 0; FEIN-only 95, same as name+FEIN; 28 of the 40 non-blank debtors contain UNITED RENTALS (70%; 10 rows have a blank parsed debtor).
- **Use:** FEIN-only is the precise, small query where the FEIN is indexed (and finds former names); it misses firms whose FEIN is not indexed, so run name-only as well and union by `filing_number`. Filter on `debtor` either way.

### Terms and Connectors (Boolean) mode in Judgments & Liens (2026-10-09, form read only — NOT yet live-tested)

Read from `JnL.aspx` by DOM inspection, no search submitted. Nothing below about results is measured.

- **Selecting it:** the visible control is the `Terms and Connectors` tab (`a#TermsTab`); clicking it checks the hidden radio `#BooleanMode` (`name=ctl00$MainContent$searchType`, `value=BooleanMode`; the other is `#FormRadio`, default). In this mode the form fields (company, FEIN, strict) are hidden; only the Additional Terms area is visible.
- **Fields:** terms textarea `#AdditionalTermsContent_AdditionalTerms_additionalTermsTextBox` (name `ctl00$AdditionalTermsContent$AdditionalTerms$additionalTermsTextBox`); segment dropdown `#AdditionalTermsContent_AdditionalTerms_segmentsDropDown`, segment text `#segmentInput`, `#segmentAddButton`; restrict-by dropdown `#AdditionalTermsContent_AdditionalTerms_restrictByDropDown` (Amount / Filing Date / Release Date / Satisfied Date), `#restrictByFrom`, `#restrictByTo`, `#restrictByAddButton`; submit `#AdditionalTermsContent_formSubmitTerms_searchButton` (the form-mode button `#MainContent_formSubmit_searchButton` is a different control).
- **Segment values** (option value = text): `address()`, `amount()`, `attorney()`, `certificate-number()`, `creditor()`, `creditor-address()`, `debtor()`, `debtor-address()`, `filing-date(is )`, `filing-number()`, `filing-office()`, `filing-state()`, `irs-serial-number()`, `name()`, `release-date(is )`, `satisfied-date(is )`, `status()`, `type()`.
- **Syntax, from the page's own Add handler** (`segmentAddButton` click): the segment's `()` becomes `(<input>)`; successive segments are joined with ` AND `. Typing `"ARISTOCRAT GROUP"` (with the quotes) in the segment box and adding Debtor produced `debtor("ARISTOCRAT GROUP")` in the textarea; adding Creditor `X` after it gave `debtor("ARISTOCRAT GROUP") AND creditor(X)`. The handler adds no quotes itself, so the quotes in `debtor("...")` are ours; that quoted form is the standard Lexis phrase delimiter but **the page's help does not say so** (unconfirmed).
- **Connectors listed on the page:** `and`, `w/N` (within N words), `and not`, `or`, `pre/N` (precedes by N words). Help: connectors work only in the Additional Terms field; `!` and `*` wildcards; precedence OR, then AND, then AND NOT, left to right. The per-connector articles did not render, and nothing confirms grouping inside a segment (`debtor("X" w/2 (CORP OR CORPORATION))`), so `--debtor-segment` builds none and uses the name without its legal-form suffix.
- **Help-text caveat:** "Enter terms in at least one field on the form in addition to the Additional Terms field." The Terms tab shows no form fields, so whether an Additional-Terms-only search is accepted is the first thing the live test answers.
- **Strict Search** (and phonetics/nicknames) is disabled in this mode (`setBoolean`).
- **Results layout:** unknown. `jnl-lookup.ts --debtor-segment` reuses the form-mode `Results.aspx` parser; check the first run with `--dump`.

- **FEIN** (`FeinRecords.aspx`): company name, FEIN, address. Corporation Filings also accepts an FEIN.
- **Locate a Business (Nationwide)**: company name, TIN, LexID, address, phone, person name.

## What other subscriptions do not have

- Westlaw Public Records: "Your subscription does not include this content" (UVA).
- Bloomberg Law: no Secretary of State data. Its company lookup is market data (state of incorporation, hierarchy, litigation analytics) with no registry status; delisted or bankrupt firms such as Troika Media Group were not found.

## Limits

- One search at a time; no bulk export.
- Keep scripted use human-paced (≥ 20 s between searches) and small — validation samples, not dataset construction. `scripts/corp-lookup.ts` and `scripts/jnl-lookup.ts` enforce a 20 s floor and a per-run cap.
