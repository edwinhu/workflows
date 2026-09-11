# Bright Data Dataset Marketplace — Catalog Highlights

Verified 2026-06-10. **Total datasets: 1,576.** `size` ≈ approximate record count.

Re-fetch the full catalog (FREE):
```bash
curl -s https://api.brightdata.com/datasets/list \
  -H "Authorization: Bearer $BRIGHTDATA_API_TOKEN" -o brd_datasets.json
```

## Character of the marketplace

The catalog is dominated by **social, e-commerce, company, and people scrapes**. There is **no government / regulatory / court / licensing data product** beyond a single US lawyers directory. For FINRA/SEC/broker/adviser data, use the **Web Archive** (see `finra-sec-coverage.md`), not the marketplace.

## Top datasets by size

| Size | Dataset | id |
|---|---|---|
| 620M | Instagram – Profiles | `gd_l1vikfch901nx3by4` |
| 300M | Amazon products | `gd_l7q7dkf244hwjntr0` |
| 152M | TikTok – Profiles | `gd_l1villgoiiidt09ci` |
| 115M | LinkedIn people profiles | `gd_l1viktl72bvl7bjuj0` |
| 55M | LinkedIn company information | `gd_l1vikfnt1wgvvqz95w` |
| 16M | Australia real estate properties | `gd_l3cvjh111l943r4awk` |
| 10.9M | Slintel/6sense company information | `gd_l1vilg5a1decoahvgq` |
| 8M | Xing social network | `gd_l3lh4ev31oqrvvblv6` |
| 7.5M | Google Maps businesses (old) | `gd_l34jdds6yd9ofna2` |
| 7.4M | Indeed job listings | `gd_l4dx9j9sscpvs7no2` |
| 6.1M | Owler companies | `gd_l1vilaxi10wutoage7` |
| 5.6M | Manta businesses | `gd_l1vil1d81g0u8763b2` |
| 2.5M | Glassdoor companies info | `gd_l1vik5c8204suup7nc` |
| 2.3M | Crunchbase companies | `gd_l1vijqt9jfj7olije` |

## By relevance category (finance / company / people / professional)

### Company / business directory (~80 datasets)
- LinkedIn company information — 55M — `gd_l1vikfnt1wgvvqz95w`
- Slintel/6sense company info — 10.9M — `gd_l1vilg5a1decoahvgq`
- Owler companies — 6.1M — `gd_l1vilaxi10wutoage7`
- Manta businesses — 5.6M — `gd_l1vil1d81g0u8763b2`
- Glassdoor companies info / reviews / overview — 2.5M each — `gd_l1vik5c8204suup7nc`, `gd_l7j1po0921hbu0ri1z`, `gd_l7j0bx501ockwldaqf`
- Crunchbase companies — 2.3M — `gd_l1vijqt9jfj7olije`
- VentureRadar company info — 325k — `gd_l1vilsfd1xpsndbtpr`

### People / professional profiles (~105 datasets)
- LinkedIn people profiles — 115M — `gd_l1viktl72bvl7bjuj0`
- Instagram profiles — 620M — `gd_l1vikfch901nx3by4`
- TikTok profiles — 152M — `gd_l1villgoiiidt09ci`
- LinkedIn people (selected companies) — 5.1M — `gd_la9gp5sextdr6pcx6`
- Stack Overflow user profiles — ? — `gd_l6lsvdwx16v5ag07fx`

### Finance / markets (thin)
- Yahoo Finance business information — ? — `gd_lmrpz3vxmz972ghd7`
- Indeed jobs for US/CA banks — ? — `gd_la1e65us3335785cb`
- (Most "finance" hits are retail product feeds — StockX, Birkenstock, etc. — false positives.)

### Professional licensing / credentials (essentially one)
- **US lawyers directory — 1.4M — `gd_l1vil5n11okchcbvax`** (the only professional-registry-style product)

### NOT present
- No FINRA / BrokerCheck dataset.
- No SEC IAPD / adviserinfo / Form ADV / RIA dataset.
- No government / court / regulatory / sanctions / public-records product.
- Keyword grep "adviser/advisor" returns only false positives (TripAdvisor, Uniform Advantage Products).
