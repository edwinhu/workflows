# Dewey Featured Datasets & Institutional Access

## Institutional access (UVA / NYU)

Dewey sells a **Platform Subscription** at the institution level. One subscription unlocks the whole catalog — you don't license vendors individually (the WRDS pain point).

- **UVA Library** holds the institutional subscription. Log in at `app.deweydata.io` via **NetBadge** using your **UVA email**.
- **NYU** also subscribes (NYU SSO).
- Under the institutional license, **SafeGraph and most providers are free**. A few are flagged **institutional-license-only** (e.g. **Veraset** device-level movement, **ATTOM** property) — these are still included but governed by stricter terms.
- Check coverage at `docs.deweydata.io/docs/subscribed-universities`.

After logging in, mint an **API key** (Connections → Add Connection → API Key) and get each dataset's **product path** (Get Data → Connect to API). See SKILL.md "Authentication".

## Catalog (~300 datasets, ~40 providers)

### Foot traffic & location intelligence
| Provider | Dataset(s) | Description |
|----------|-----------|-------------|
| **SafeGraph** | Global Places (POI), Geometry, Spend, **Patterns** | POI master (placekey, brand, NAICS, lat/long), building footprints, card spend, foot-traffic visit patterns. See `safegraph-places.md`. |
| **Advan Research** | Monthly/Weekly Patterns, Home Panel Summary, Patterns Plus | Foot traffic aggregated to place & census-block group |
| **Veraset** | Movement | Device-level GPS mobility — **institutional license only** |
| **PassBy** | Foot Traffic | Per-POI foot-traffic analytics |
| **dataplor** | POI | Global POI, strong emerging-markets coverage |

### Consumer & market
| Provider | Description |
|----------|-------------|
| **Consumer Edge** | Brand/company purchasing patterns (card panel) |
| **PDI** | Product-level transaction data |
| **Open Brand** | Consumer survey / market research, durable goods |
| **Similarweb** | Website traffic & search-keyword data |

### Real estate
| Provider | Description |
|----------|-------------|
| **ATTOM** | Residential property & transaction records — **institutional only** |
| **Dwellsy / RentHub** | Rental marketplace & rate data |
| **ClimateCheck** | Property climate-risk scores |

### Workforce & corporate
| Provider | Description |
|----------|-------------|
| **LinkUp** | Job postings & labor-market activity — 342M postings back to 2007, plus full description text, extracted salary (Jun 2026), structured fields, remote/FT-PT tags, ONET codes. See `linkup-job-postings.md`. |
| **GovFiles** | US business-entity registry — all 50 Secretary of State offices, 84.4M entities incl. dissolved. Better dead-shell coverage than OpenCorporates. See `govfiles-business-entity.md`. |
| **People Data Labs** | Aggregated employee insights by company |
| **WageScape** | Salary / wage data |
| **Rhetorik** | Company technographics & office locations |

### Corporate actions & global market reference
| Provider | Description |
|----------|-------------|
| **Exchange Data International** | WCA/RCAN global equity corporate actions (2001→, 8.6M events, 175 cols), EOD pricing w/ adjustment factors, FX rates, futures & options. See `edi-corporate-actions.md`. |

### Other
**7 Chord** (bond pricing), **Vizion** (shipping / supply-chain), **Veridion** (firmographics), **LobbyingData** (legislative tracking).

## Discovery

Don't hardcode dataset names — they change and have versioned releases. Discover via:
- **MCP** (`search_datasets` / `semantically_search_datasets` / `list_data_partners`) — see `mcp.md`.
- The web catalog at `app.deweydata.io` (filter by category/provider, "Discover Data" lets you sample before subscribing).

Then capture the **product path / `prj_` id** from *Get Data → Connect to API / Bulk API* for the scripted pull.
