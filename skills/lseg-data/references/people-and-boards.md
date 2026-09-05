# People, officers and boards in LSEG — what is and is not there

Short version: **LSEG is not a board-data source.** It reaches private companies and it names
officers, but it carries no person identifier and no employment history, so it cannot answer "does
this director also work for firm X" — the question most governance work actually needs. For that,
use Capital IQ People Intelligence or BoardEx on WRDS (see the `wrds` skill's `capiq.md`,
`boardex.md`, `people-linking.md`).

## The officer field family is four fields

Probed 21 candidate names against a public company; these are the ones that resolve:

| resolves | does NOT exist |
|---|---|
| `TR.OfficerName` | `TR.OfficerID`, `TR.OfficerPermID` |
| `TR.OfficerTitle` | `TR.OfficerPrimaryCompany`, `TR.OfficerAffiliation`, `TR.OfficerCompanyName` |
| `TR.OfficerRank` | `TR.OfficerOtherBoards`, `TR.OfficerBiography`, `TR.OfficerBoardStatus` |
| `TR.OfficerAge` | `TR.DirectorName`, `TR.BoardMemberName`, `TR.ODDirectorName` |

Consequences, in order of how much they hurt:

1. **No person identifier.** A person cannot be tracked across companies, so the standard
   affiliation inference (does this director appear on the sponsor's payroll) is unavailable.
2. **No employment history.** Nothing analogous to CIQ's `wrds_professional` (median 17 roles per
   director) or BoardEx's `dir_profile_emp`.
3. **No board-membership flag.** Directors and executives are one undifferentiated list; you would
   have to parse `TR.OfficerTitle` strings.

Default returns rank R1 only — pass `parameters={"RNK": "R1:R25"}` for the full list.
`TR.OfficerName(RNK=R1:R25)` inline syntax throws "The '(' delimiter is unexpected in formula".

## Board aggregates exist, but they are ESG fields

`TR.BoardSize`, `TR.IndependentBoardMembers`, `TR.BoardMeetingAttendanceAvg`,
`TR.GovernancePillarScore` — counts and scores for large listed companies, not director-level
rosters. `references/corporate-governance.md` is shareholder activism and poison pills (SDC), not
board composition.

## Private companies ARE reachable — by PI, not RIC

`discovery.search` returns private companies with a `PI` identifier and no RIC, and that PI is
directly queryable:

```python
r = discovery.search(query="Ivanti Inc", top=5)          # -> PI 5000484437, "Private Company"
ld.get_data(universe=["5000484437"], fields=["TR.CommonName"])   # -> "Ivanti Inc"
```

### A SHORT PI SILENTLY RESOLVES TO THE WRONG COMPANY

A bare numeric universe is put through identifier *guessing*, not a PI lookup, and short ids collide
with another namespace. There is no error and no null — you get a different company's data under the
id you asked for. Verified 2026-09-04:

```python
search("Koch Industries", view=ORGANISATIONS)   # -> PI 11501, "Koch Industries LLC, Private Company"
ld.get_data(["11501"], ["TR.CommonName"])       # -> "Eurafrep", France          <-- WRONG COMPANY
ld.get_data(["5000484437"], ["TR.CommonName"])  # -> "Ivanti Inc"                <-- correct
```

`"11501@PI"` is not the fix — that raises `Unable to resolve all requested identifiers`. The suffix
form does not work here at all.

**Always carry `DocumentTitle` from the search hit and assert it against `TR.CommonName` before
keeping a row.** A private-company panel keyed on search PIs is silently contaminated otherwise, and
the contamination is invisible in every downstream check: the row count is right, no field is null,
and the name column is a real company. Ten-digit PIs resolved correctly in every case tested; the
short ones are the hazard, and you cannot tell which you have without looking.

Officer coverage for them is thin and management-weighted: across 8 PE-owned private companies,
**13 officer rows total, 1 with a board title, 0 sponsor-affiliated**. Ivanti returned CEO, CMO and
Chief Legal Counsel; two companies returned nothing.

## The People search view has the graph but not the keys

`w.search(query, view="People")` indexes private-company people and the search METADATA advertises a
rich officer/director property set — `OfficersAndDirectorsPersonId`, `OfficerDirectorCompanies`,
`OfficerDirectorTitles`, `OfficerDirectorStartDate`. In practice:

- `Select` on those properties returns them empty; hits carry only
  `BusinessEntity, DocumentTitle, PermID, PI`.
- `DocumentTitle` is `"Name - Company - Role"`, so one row per person-company-role, and searching a
  person's name does return their other roles — Orlando Bravo appears at Dynatrace, QlikTech AND
  Thoma Bravo Lp.
- **But each row carries a DIFFERENT PermID**, so the PermID is per-role, not a stable person id.
  Linking still requires name matching, with the usual hazard: "J. Orlando Bravo, SED International
  CFO" is a different person.

Tested end to end on three PE-owned companies (Ivanti/Clearlake, Culligan/Advent, Vera Whole
Health/CD&R): 24, 8 and 11 people indexed, **zero** also appearing at the sponsor. The index holds
management, not sponsor board designees.

## Where LSEG does win

`TR.PEInvest*` — private-company OWNERSHIP, keyed by PI, at 93% resolution on one 595-company test:
`TR.PEInvestCompanyCurrentInvestorFirms`, `...AllInvestorFirms`, `...PortfolioStatus`,
`...CompanyCurrentPublicStatus`, plus round dates and valuations (7–35 rows per company). It named
the correct sponsor for every add-on acquiror checked — Culligan→Advent, Vera Whole
Health→CD&R, 365 Retail Markets→Providence, Avantor→New Mountain.

So the division that holds up: **LSEG for who owns the company, CIQ/BoardEx for who sits on its
board.**
