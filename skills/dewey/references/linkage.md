# Dewey Cross-Dataset Linkage Map

Which datasets share join keys, so you can combine them. Derived from `schemas.json` (column-name match). **Confirm the exact column name + format per dataset in `schemas.json` before joining** — names/casing vary (e.g. `PLACEKEY` vs `placekey`, `naics_code` vs `NAICS_CODE_2022`).

## Quick guide — pick a spine

- **Places / foot traffic** → `placekey` joins SafeGraph Places ↔ Spend ↔ Advan Patterns ↔ PassBy ↔ Veraset.
- **Public companies** → `ticker` / `cusip`·`cik` links Extract Alpha, ExchangeData, 7 Chord, Context Analytics, ConsumerEdge brand→ticker, Revelio.
- **Private companies / firmographics** → `domain` is the workhorse (BrightQuery, PDL, Rhetorik, Veridion, Similarweb, IPinfo).
- **People / labor** → `person/profile id` + `linkedin` (People Data Labs ↔ Revelio Labs).
- **Geography** → `latitude/longitude` → spatial-join to `fips`/`cbg` (ATTOM, Census-keyed sets, NatureQuant, ClimateCheck).


## `placekey` — 7 datasets
*POI spine — join SafeGraph/Advan/PassBy/Veraset on the same point of interest*

- **PassBy**: PassBy Placekeys (Jan), Store Info
- **SafeGraph**: Global Places (POI) & Geometry, Spend Patterns
- **Veraset**: Home Visits, Visits, Work Visits

## `ticker` — 23 datasets
*Public-equity spine — link financial/estimates/sentiment/workforce to a listed company*

- **7 Chord**: BondDroid Credit Curves, Historical Top Liquid Bond Prices & Liquidity Indicators, Top Liquid Bond Prices & Liquidity Indicators
- **Advan Research**: Foot Traffic / Weekly Patterns Plus
- **AnaChart**: NASDAQ100 Analyst Recommendation and Price Target History
- **BrightQuery**: 504 Data - Legal Entity, 7a - Legal Entity, Benefit Plan Data, Firmographic Information, Legal Entity, Stock Event Timeline
- **Context Analytics**: Social Sentiment Metrics for Equities - Twitter
- **Extract Alpha**: Estimize - Equities Combined Consensus New, Estimize - Equities Combined Estimates New, Estimize - Metrics Actuals, Estimize - Metrics Consensus, Estimize - Metrics Instruments
- **LinkUp**: Ticker Analytics
- **People Data Labs**: Company Insights
- **Revelio Labs**: Company Reference, Individual Position
- **Veridion**: Firmographics (Company Core Profiles)
- **WageScape**: Job Postings with Salary

## `cusip / isin / sedol / figi / cik` — 13 datasets
*Security/issuer identifiers (cross-vendor equity & bond linking)*

- **7 Chord**: Historical Top Liquid Bond Prices & Liquidity Indicators, Top Liquid Bond Prices & Liquidity Indicators
- **ConsumerEdge**: Company Detail (Symbol, ISIN, RIC, Ownership Status, Etc.)
- **Exchange Data International**: Global Equity Corporate Actions, Global Equity End of Day Pricing Data w/ Adjustment Factors
- **Extract Alpha**: Estimize - Equities Combined Consensus New, Estimize - Equities Combined Estimates New, Estimize - Metrics Actuals, Estimize - Metrics Consensus, Estimize - Metrics Instruments
- **LobbyingData**: U.S. Lobbying Data
- **Revelio Labs**: Company Reference, Individual Position

## `domain / website` — 26 datasets
*Company spine via web domain — the most common firmographic join key*

- **BrightQuery**: 504 Data - Legal Entity, 7a - Legal Entity, Benefit Plan Data, Employment Data (Annual), Employment Data (Monthly), Employment Data (Most Recent), Employment Data (Quarterly), Financials (Annual), Firmographic Information, Legal Entity
- **IPinfo**: Company IP Address Data, IP ASN Data, Whois - Network, Whois - Organization
- **People Data Labs**: Alternative Domain, Company Insights, Person
- **SafeGraph**: Global Places (POI) & Geometry
- **Similarweb**: Desktop Search Keywords, Historical Desktop Search Keywords, Website Traffic Visits
- **TenderAlpha**: US Subcontracting Data, Unified Government Contract Awards
- **Veridion**: ESG Company Scores, Products, Services

## `company / legal name` — 20 datasets
*Company name (fuzzy join; pair with domain/ticker to disambiguate)*

- **AnaChart**: NASDAQ100 Analyst Recommendation and Price Target History
- **Data Axle**: Business
- **Dwellsy**: Dwellsy TotalIQ
- **LinkUp**: Company Analytics, Job Records, PIT Company Reference
- **RentHub**: Rental Data
- **Revelio Labs**: Company Reference, Individual Position, Layoffs, Sentiment, Unified Job Postings, Workforce Dynamics
- **Rhetorik**: Company Data, Office Data
- **Veridion**: ESG Company Scores, Firmographics (Company Core Profiles), Products
- **WARN Database**: WARN Layoff Data
- **WageScape**: Job Postings with Salary

## `naics` — 24 datasets
*Industry classification (segment/group, not a unique join)*

- **ATTOM Data**: Community Information Layout
- **Advan Research**: Foot Traffic / Weekly Patterns Plus
- **BrightQuery**: Benefit Plan Data, Firmographic Information, Industry, Occupational Wage Data, Sector
- **ConsumerEdge**: Daily Spend Breakout by Census Region and NAICS Code, Daily Spend Breakout by Channel (Online/Offline) and NAICS Code
- **Data Axle**: Business
- **LinkUp**: PIT Company Reference
- **PassBy**: Daily Store Visits, Store Info, Store Visitors
- **People Data Labs**: NAICS
- **Revelio Labs**: Company Reference, Individual Position
- **SafeGraph**: Global Places (POI) & Geometry, Spend Patterns
- **TenderAlpha**: US Subcontracting Data
- **Veraset**: Home Visits, Visits
- **Veridion**: Firmographics (Company Core Profiles)
- **WageScape**: Job Postings with Salary

## `person / profile id` — 24 datasets
*Individual spine (People Data Labs ↔ Revelio workforce)*

- **BrightQuery**: Firmographic Information
- **Extract Alpha**: Estimize - Economics Estimates, Estimize - Equities Combined Estimates New, Estimize - Metrics Estimates
- **People Data Labs**: Certification, Company Insights, Country, Interest, Job Title Level, Location Name, Person, Profile, Recent Exec Departure, Recent Exec Hire, Skill
- **Revelio Labs**: Company Reference, Individual Education, Individual Position, Individual Skill, Unified Job Postings, User
- **Rhetorik**: Company Data, Office Data
- **Veridion**: Firmographics (Company Core Profiles)

## `ip / ip range` — 8 datasets
*IP address spine (IPinfo ↔ IPqwery)*

- **IPinfo**: Company IP Address Data, Geolocation IP Address Data, Geolocation IP Address Data - Last Changed, IP ASN Data, IP Address Data for Mobile Carrier Detection, IP Address Data for Privacy Detection, IP Address Data for Privacy Detection - Extended, Residential Proxy

## `latitude / longitude` — 22 datasets
*Spatial join — any point dataset to any geographic boundary*

- **ATTOM Data**: Assessor History, Community Information Layout, Neighborhood & Residential Subdivision Boundaries, School Attendance Boundaries, Tax Assessor
- **Advan Research**: Foot Traffic / Weekly Patterns Plus
- **Construction Monitor**: ConstructionWire - Reports
- **Data Axle**: Business
- **Dwellsy**: Dwellsy TotalIQ
- **IPinfo**: Geolocation IP Address Data, Geolocation IP Address Data - Last Changed
- **InfutorData**: Consumer Profiles
- **NatureQuant**: Nature Score, Urban Heat Index
- **PDI**: Stores Information, Stores Status
- **REsimplifi**: Listing Data
- **RentHub**: Rental Data
- **SafeGraph**: Global Places (POI) & Geometry, Spend Patterns
- **Veridion**: Firmographics (Company Core Profiles)
- **WageScape**: Job Postings with Salary

## `fips / census block / cbg / geoid` — 23 datasets
*Census geography spine (aggregate to tract/block-group)*

- **ATTOM Data**: Assessor History, Macro Neighborhood XREF, Neighborhood XREF, Pre-Foreclosure History, Recorder, Residential Subdivision XREF, Sub-Neighborhood XREF, Tax Assessor
- **BrightQuery**: 504 Data, 504 Data - Legal Entity, 7a - Legal Entity, 7a Data, Firmographic Information, Legal Entity
- **Construction Monitor**: ConstructionWire - Reports
- **Cotality (formerly CoreLogic)**: Property Characteristics, Property Characteristics Historical
- **Data Axle**: Business
- **InfutorData**: Consumer Address History
- **L2**: National Voter File
- **Veraset**: Home Visits, Visits, Work Visits

## `zip / postal code` — 25 datasets
*Coarse geographic join*

- **Advan Research**: Foot Traffic / Weekly Patterns Plus
- **ClimateCheck**: U.S Climate Risk Data
- **Construction Monitor**: ConstructionWire - Reports
- **Data Axle**: Business, Consumer, Consumer (Historical)
- **InfutorData**: Consumer Address History, Consumer Profiles
- **LinkUp**: Job Records
- **PDI**: Stores Information, Stores Status
- **PassBy**: Retail Store Visitors (Jan), Retail Store Visits (Jan), Store Info
- **People Data Labs**: Location
- **REsimplifi**: Listing Data
- **RentHub**: Rental Data
- **Rhetorik**: Office Data
- **SafeGraph**: Global Places (POI) & Geometry, Spend Patterns
- **Veraset**: Home Visits, Visits, Work Visits
- **Veridion**: Firmographics (Company Core Profiles)
- **WageScape**: Job Postings with Salary

## `street address` — 19 datasets
*Address-level join (normalize first)*

- **Advan Research**: Foot Traffic / Weekly Patterns Plus
- **Data Axle**: Business
- **IPinfo**: Whois - Organization
- **IPqwery**: IPqwery IP Owners
- **InfutorData**: Consumer Address History, Consumer Profiles
- **PDI**: Stores Information, Stores Status
- **PassBy**: PassBy Placekeys (Jan), Retail Store Visitors (Jan), Retail Store Visits (Jan), Store Info
- **People Data Labs**: Location
- **REsimplifi**: Listing Data
- **RentHub**: Rental Data
- **SafeGraph**: Global Places (POI) & Geometry, Spend Patterns
- **Veraset**: Home Visits, Visits
