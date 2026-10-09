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

## Other sources

- **UCC Filings** (`Ucc.aspx`): company/person name, address, filing number. Segments: Assignee, Debtors, Filing Date, Filing Jurisdiction, Filing Number, Filing Status, Secured Party (+Addr).
- **Bankruptcy** (`Bankruptcies.aspx`): company/person name, case number. Segments: Attorney, Case Number, Chapter, Filing Date, Filing Jurisdiction, Petitioner, Status.
- **FEIN** (`FeinRecords.aspx`): company name, FEIN, address. Corporation Filings also accepts an FEIN.
- **Locate a Business (Nationwide)**: company name, TIN, LexID, address, phone, person name.

## What other subscriptions do not have

- Westlaw Public Records: "Your subscription does not include this content" (UVA).
- Bloomberg Law: no Secretary of State data. Its company lookup is market data (state of incorporation, hierarchy, litigation analytics) with no registry status; delisted or bankrupt firms such as Troika Media Group were not found.

## Limits

- One search at a time; no bulk export.
- Keep scripted use human-paced (≥ 20 s between searches) and small — validation samples, not dataset construction. `scripts/corp-lookup.ts` enforces a 20 s floor and a per-run cap.
