"""
Comparative Analysis: SVB vs Peer Company Insider Disposals (2020-2023)

This script compares insider stock disposal transactions between SVB and its peer
companies using WRDS Thomson Reuters Form 4 data. Peer companies are identified
from ISS Incentive Lab peer designations (2020-2021).

Data Sources:
- Thomson Reuters Insider Filings (tr_insiders) - Form 4 transaction data
- ISS Incentive Lab (iss_incentive_lab.comppeer) - Peer company designations

Usage:
    pixi run python compare_svb_peer_insider_disposals.py
"""

import psycopg2
import pandas as pd
import numpy as np
import logging
import sys
from datetime import datetime
from typing import Dict, List, Tuple
from pathlib import Path

# ds_schema ships with the ds skill; the directory is SEARCHED for, not counted to.
sys.path.insert(0, str(next(_q for _q in Path(__file__).resolve().parents
                            if (_q / "ds" / "scripts").is_dir()) / "ds" / "scripts"))
from ds_schema import check_schema  # noqa: E402

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# WRDS Connection
WRDS_HOST = "wrds-pgdata.wharton.upenn.edu"
WRDS_PORT = 9737
WRDS_USER = "eddyhu"

# SVB Information
SVB_TICKER = "SIVB"
SVB_CIK = "0000719739"
SVB_NAME = "SVB Financial Group"

# Analysis period
START_DATE = "2020-01-01"
END_DATE = "2023-12-31"


def get_wrds_connection():
    """Create WRDS PostgreSQL connection (uses ~/.pgpass)"""
    return psycopg2.connect(
        host=WRDS_HOST,
        port=WRDS_PORT,
        database="wrds",
        user=WRDS_USER
    )


def load_peer_companies(peer_csv_path: str = "data/processed/compensation/svb_iss_peer_companies_2003_2023.csv") -> pd.DataFrame:
    """
    Load SVB peer companies from ISS Incentive Lab data.
    Focus on 2020-2021 peer group (most relevant to failure analysis).

    Returns:
        DataFrame with columns: fiscalyear, peercik, peerticker, peername
    """
    logger.info("Loading ISS peer company data...")

    df = pd.read_csv(peer_csv_path)
    check_schema(
        df,
        ["fiscalyear", "peerticker", "peername", "peercik"],
        name="ISS Incentive Lab peer designations",
    )

    # Filter for 2020-2021 (most relevant years)
    df_filtered = df[df['fiscalyear'].isin([2020.0, 2021.0])].copy()

    # Get unique peers
    peers = df_filtered[['peerticker', 'peername', 'peercik']].drop_duplicates()
    peers = peers.dropna(subset=['peerticker'])  # Need tickers for Thomson Reuters

    logger.info(f"Found {len(peers)} unique peer companies for 2020-2021")
    logger.info(f"Peers: {', '.join(sorted(peers['peerticker'].tolist()))}")

    return peers


def get_company_insider_disposals(ticker: str, company_name: str,
                                   start_date: str, end_date: str) -> pd.DataFrame:
    """
    Fetch insider disposal transactions for a single company.

    Args:
        ticker: Stock ticker symbol
        company_name: Company name (for logging)
        start_date: Start date (YYYY-MM-DD)
        end_date: End date (YYYY-MM-DD)

    Returns:
        DataFrame with disposal transactions
    """
    logger.info(f"Querying {ticker} ({company_name})...")

    conn = get_wrds_connection()

    # Same query structure as form4.py
    query = f"""
    SELECT DISTINCT
        t.ticker,
        t.fdate as filing_date,
        t.trandate as transaction_date,
        h.owner as insider_name,
        COALESCE(
            CASE
                -- C-Suite Executives (check all three rolecode fields)
                WHEN h.rolecode1 IN ('CEO', 'CFO', 'COO', 'CT', 'GC', 'CO', 'CI', 'P')
                     OR h.rolecode2 IN ('CEO', 'CFO', 'COO', 'CT', 'GC', 'CO', 'CI', 'P')
                     OR h.rolecode3 IN ('CEO', 'CFO', 'COO', 'CT', 'GC', 'CO', 'CI', 'P')
                THEN 'Executive Officer'

                -- EVP/SVP level officers
                WHEN h.rolecode1 IN ('EVP', 'SVP', 'OE', 'OS', 'OT', 'OX')
                     OR h.rolecode2 IN ('EVP', 'SVP', 'OE', 'OS', 'OT', 'OX')
                     OR h.rolecode3 IN ('EVP', 'SVP', 'OE', 'OS', 'OT', 'OX')
                THEN 'Senior Officer'

                -- Board members (including dual director/officer roles)
                WHEN h.rolecode1 IN ('D', 'CB', 'VC', 'OD', 'DO')
                     OR h.rolecode2 IN ('D', 'CB', 'VC', 'OD', 'DO')
                THEN 'Director'

                -- Other officers (generic O, controller, financial, secretary)
                WHEN h.rolecode1 IN ('O', 'C', 'F', 'FO', 'S', 'AC', 'MD', 'R')
                     OR h.rolecode2 IN ('O', 'C', 'F', 'FO', 'S', 'AC', 'MD', 'R')
                     OR h.rolecode3 IN ('O', 'C', 'F', 'FO', 'S', 'AC', 'MD', 'R')
                THEN 'Officer'

                -- 10% beneficial owners
                WHEN h.rolecode1 = 'B' OR h.rolecode1 = 'H'
                THEN '10% Owner'

                ELSE 'Other Insider'
            END,
            'Other Insider'
        ) as insider_role,
        t.trancode as trans_code,
        t.acqdisp,
        t.shares as trans_shares,
        t.tprice as price_per_share,
        t.sharesheld as shares_held,
        t.ownership as direct_indirect,
        t.cname as company_name
    FROM tr_insiders.table1 t
    LEFT JOIN tr_insiders.header h
        ON t.dcn = h.dcn AND t.personid = h.personid
    WHERE t.ticker = '{ticker}'
      AND t.trandate BETWEEN '{start_date}' AND '{end_date}'
      AND t.shares IS NOT NULL
      AND t.shares != 0
      AND t.acqdisp = 'D'
      AND t.trancode IN ('S', 'D', 'G', 'F')
    ORDER BY t.trandate DESC, h.owner
    """

    try:
        df = pd.read_sql(query, conn)
        check_schema(
            df,
            ["ticker", "filing_date", "transaction_date", "insider_name", "insider_role",
             "trans_code", "acqdisp", "trans_shares", "price_per_share", "shares_held",
             "direct_indirect", "company_name"],
            name=f"Form 4 disposals for {ticker}",
            exact=True,
        )

        if not df.empty:
            # Filter for executive officers AND directors
            # Use word boundaries \b for acronyms to avoid false matches
            executive_keywords = [
                r'\bCEO\b', r'\bCFO\b', r'\bCOO\b', r'\bCTO\b', 'Chief', 'President',
                r'\bEVP\b', r'\bSVP\b', r'\bVP\b', 'Executive', 'Officer',
                'Treasurer', 'Controller', r'\bDirector\b'
            ]

            is_executive = df['insider_role'].fillna('').str.contains(
                '|'.join(executive_keywords),
                case=False,
                na=False,
                regex=True
            )

            df = df[is_executive].copy()

            # Calculate transaction value
            df['transaction_value'] = df['trans_shares'] * df['price_per_share']

            logger.info(f"  ✓ {ticker}: {len(df)} executive disposal transactions")
        else:
            logger.info(f"  ✓ {ticker}: No disposal transactions found")

        return df

    except Exception as e:
        logger.error(f"  ✗ {ticker}: Error - {e}")
        return pd.DataFrame()

    finally:
        conn.close()


def collect_all_insider_data(peers: pd.DataFrame, start_date: str, end_date: str) -> pd.DataFrame:
    """
    Collect insider disposal data for SVB and all peer companies.

    Args:
        peers: DataFrame with peer company info
        start_date: Start date
        end_date: End date

    Returns:
        Combined DataFrame with all transactions
    """
    logger.info("="*70)
    logger.info("Collecting insider disposal data for SVB and peers...")
    logger.info("="*70)

    all_data = []

    # 1. Get SVB data first
    svb_df = get_company_insider_disposals(SVB_TICKER, SVB_NAME, start_date, end_date)
    if not svb_df.empty:
        svb_df['is_svb'] = True
        svb_df['company_display_name'] = SVB_NAME
        all_data.append(svb_df)

    # 2. Get peer data
    for _, peer in peers.iterrows():
        ticker = peer['peerticker']
        name = peer['peername']

        peer_df = get_company_insider_disposals(ticker, name, start_date, end_date)

        if not peer_df.empty:
            peer_df['is_svb'] = False
            peer_df['company_display_name'] = name
            all_data.append(peer_df)

    # Combine all data
    if all_data:
        combined = pd.concat(all_data, ignore_index=True)
        logger.info(f"\n✓ Total transactions collected: {len(combined):,}")
        logger.info(f"  - SVB: {len(combined[combined['is_svb']]):,}")
        logger.info(f"  - Peers: {len(combined[~combined['is_svb']]):,}")
        return combined
    else:
        logger.warning("No data collected")
        return pd.DataFrame()


def aggregate_by_company(df: pd.DataFrame) -> pd.DataFrame:
    """
    Aggregate disposal metrics by company.

    Returns:
        DataFrame with company-level summary statistics
    """
    if df.empty:
        return pd.DataFrame()

    # Aggregate by company
    summary = df.groupby(['ticker', 'company_display_name', 'is_svb']).agg({
        'trans_shares': 'sum',
        'transaction_value': 'sum',
        'filing_date': 'count',
        'insider_name': 'nunique'
    }).reset_index()

    summary.columns = [
        'ticker',
        'company_name',
        'is_svb',
        'total_shares_sold',
        'total_value_usd',
        'num_transactions',
        'num_insiders'
    ]

    # Sort by total value
    summary = summary.sort_values('total_value_usd', ascending=False)

    return summary


def calculate_statistics(summary: pd.DataFrame) -> Dict:
    """Calculate comparative statistics (SVB vs peers)"""

    if summary.empty:
        return {}

    # Split SVB and peers
    svb = summary[summary['is_svb']].iloc[0] if summary['is_svb'].any() else None
    peers = summary[~summary['is_svb']]

    stats = {
        'svb': {},
        'peers': {},
        'comparison': {}
    }

    if svb is not None:
        stats['svb'] = {
            'total_shares': svb['total_shares_sold'],
            'total_value': svb['total_value_usd'],
            'num_transactions': svb['num_transactions'],
            'num_insiders': svb['num_insiders']
        }

    if not peers.empty:
        stats['peers'] = {
            'median_shares': peers['total_shares_sold'].median(),
            'mean_shares': peers['total_shares_sold'].mean(),
            'median_value': peers['total_value_usd'].median(),
            'mean_value': peers['total_value_usd'].mean(),
            'median_transactions': peers['num_transactions'].median(),
            'mean_transactions': peers['num_transactions'].mean(),
            'median_insiders': peers['num_insiders'].median(),
            'mean_insiders': peers['num_insiders'].mean()
        }

    # Calculate SVB percentiles and comparisons
    if svb is not None and not peers.empty:
        stats['comparison'] = {
            'value_percentile': (peers['total_value_usd'] < svb['total_value_usd']).sum() / len(peers) * 100,
            'shares_percentile': (peers['total_shares_sold'] < svb['total_shares_sold']).sum() / len(peers) * 100,
            'value_vs_median_pct': ((svb['total_value_usd'] / stats['peers']['median_value']) - 1) * 100,
            'shares_vs_median_pct': ((svb['total_shares_sold'] / stats['peers']['median_shares']) - 1) * 100,
        }

    return stats


def analyze_timeline(df: pd.DataFrame) -> pd.DataFrame:
    """
    Analyze disposal patterns over time (monthly aggregation).

    Returns:
        DataFrame with monthly disposal data by company
    """
    if df.empty:
        return pd.DataFrame()

    # Convert dates
    df['transaction_date'] = pd.to_datetime(df['transaction_date'])
    df['year_month'] = df['transaction_date'].dt.to_period('M')

    # Aggregate by company and month
    timeline = df.groupby(['ticker', 'company_display_name', 'is_svb', 'year_month']).agg({
        'trans_shares': 'sum',
        'transaction_value': 'sum',
        'filing_date': 'count'
    }).reset_index()

    timeline.columns = [
        'ticker', 'company_name', 'is_svb', 'year_month',
        'shares_sold', 'value_usd', 'num_transactions'
    ]

    # Convert period back to string for CSV export
    timeline['year_month'] = timeline['year_month'].astype(str)

    return timeline


def generate_report(summary: pd.DataFrame, stats: Dict, timeline: pd.DataFrame,
                    output_file: Path):
    """
    Generate comprehensive text report comparing SVB to peers.
    """
    lines = []
    lines.append("="*80)
    lines.append("SVB VS PEER COMPANIES: INSIDER STOCK DISPOSAL ANALYSIS (2020-2023)")
    lines.append("="*80)
    lines.append(f"\nGenerated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"Data Source: WRDS Thomson Reuters Insider Filings (Form 4)")
    lines.append(f"Period: {START_DATE} to {END_DATE}")
    lines.append(f"Transaction Types: Sales, Dispositions, Gifts, Tax Payments (S, D, G, F)")
    lines.append(f"Insiders: Executive Officers Only")

    # Summary table
    lines.append("\n" + "="*80)
    lines.append("SUMMARY BY COMPANY")
    lines.append("="*80)
    lines.append("\nRanked by Total Transaction Value (USD)\n")

    display = summary.copy()
    display['total_value_millions'] = (display['total_value_usd'] / 1_000_000).round(2)
    display['total_shares_thousands'] = (display['total_shares_sold'] / 1_000).round(1)

    display_cols = display[[
        'ticker', 'company_name', 'total_shares_thousands',
        'total_value_millions', 'num_transactions', 'num_insiders', 'is_svb'
    ]].copy()

    display_cols.columns = [
        'Ticker', 'Company', 'Shares_K', 'Value_M',
        'Transactions', 'Insiders', 'Is_SVB'
    ]

    lines.append(display_cols.to_string(index=False))

    # Statistical comparison
    if stats.get('svb') and stats.get('peers') and stats.get('comparison'):
        lines.append("\n" + "="*80)
        lines.append("STATISTICAL COMPARISON: SVB vs PEER MEDIAN")
        lines.append("="*80)

        svb_val = stats['svb']['total_value'] / 1_000_000
        peer_median_val = stats['peers']['median_value'] / 1_000_000
        peer_mean_val = stats['peers']['mean_value'] / 1_000_000

        svb_shares = stats['svb']['total_shares'] / 1_000
        peer_median_shares = stats['peers']['median_shares'] / 1_000

        lines.append(f"\nTotal Transaction Value:")
        lines.append(f"  SVB:           ${svb_val:,.2f}M")
        lines.append(f"  Peer Median:   ${peer_median_val:,.2f}M")
        lines.append(f"  Peer Mean:     ${peer_mean_val:,.2f}M")
        lines.append(f"  SVB vs Median: {stats['comparison']['value_vs_median_pct']:+.1f}%")
        lines.append(f"  SVB Percentile: {stats['comparison']['value_percentile']:.0f}th")

        lines.append(f"\nTotal Shares Sold:")
        lines.append(f"  SVB:           {svb_shares:,.1f}K shares")
        lines.append(f"  Peer Median:   {peer_median_shares:,.1f}K shares")
        lines.append(f"  SVB vs Median: {stats['comparison']['shares_vs_median_pct']:+.1f}%")
        lines.append(f"  SVB Percentile: {stats['comparison']['shares_percentile']:.0f}th")

        lines.append(f"\nNumber of Transactions:")
        lines.append(f"  SVB:           {stats['svb']['num_transactions']:,}")
        lines.append(f"  Peer Median:   {stats['peers']['median_transactions']:.0f}")
        lines.append(f"  Peer Mean:     {stats['peers']['mean_transactions']:.1f}")

        lines.append(f"\nNumber of Insiders Selling:")
        lines.append(f"  SVB:           {stats['svb']['num_insiders']:,}")
        lines.append(f"  Peer Median:   {stats['peers']['median_insiders']:.0f}")
        lines.append(f"  Peer Mean:     {stats['peers']['mean_insiders']:.1f}")

    # Timeline highlights
    if not timeline.empty:
        lines.append("\n" + "="*80)
        lines.append("TIMELINE ANALYSIS")
        lines.append("="*80)

        # SVB peak months
        svb_timeline = timeline[timeline['is_svb']].copy()
        if not svb_timeline.empty:
            svb_timeline = svb_timeline.sort_values('value_usd', ascending=False)
            lines.append("\nSVB Peak Disposal Months (by value):")
            for _, row in svb_timeline.head(5).iterrows():
                lines.append(f"  {row['year_month']}: ${row['value_usd']/1_000_000:.2f}M "
                           f"({row['shares_sold']/1_000:.1f}K shares, {row['num_transactions']} txns)")

        # Compare 2022-2023 (pre-failure period)
        lines.append("\n" + "-"*80)
        lines.append("2022-2023 Activity (Pre-Failure Period):")
        lines.append("-"*80)

        recent = timeline[timeline['year_month'] >= '2022-01'].copy()
        if not recent.empty:
            recent_summary = recent.groupby(['ticker', 'company_name', 'is_svb']).agg({
                'shares_sold': 'sum',
                'value_usd': 'sum',
                'num_transactions': 'sum'
            }).reset_index()

            recent_summary = recent_summary.sort_values('value_usd', ascending=False)
            recent_summary['value_millions'] = (recent_summary['value_usd'] / 1_000_000).round(2)
            recent_summary['shares_thousands'] = (recent_summary['shares_sold'] / 1_000).round(1)

            display_recent = recent_summary[[
                'ticker', 'company_name', 'shares_thousands',
                'value_millions', 'num_transactions', 'is_svb'
            ]].copy()

            display_recent.columns = ['Ticker', 'Company', 'Shares_K', 'Value_M', 'Txns', 'Is_SVB']
            lines.append("\n" + display_recent.to_string(index=False))

    # Key findings
    lines.append("\n" + "="*80)
    lines.append("KEY FINDINGS")
    lines.append("="*80)

    if stats.get('comparison'):
        if stats['comparison']['value_percentile'] > 75:
            lines.append(f"\n⚠ SVB ranked in the {stats['comparison']['value_percentile']:.0f}th percentile")
            lines.append("  for total insider disposal value - significantly higher than most peers.")
        elif stats['comparison']['value_percentile'] > 50:
            lines.append(f"\n• SVB ranked in the {stats['comparison']['value_percentile']:.0f}th percentile")
            lines.append("  for total insider disposal value - above median.")
        else:
            lines.append(f"\n• SVB ranked in the {stats['comparison']['value_percentile']:.0f}th percentile")
            lines.append("  for total insider disposal value - below median.")

    # Check for other failed banks
    failed_banks = ['FRC', 'SBNY']  # First Republic, Signature Bank
    failed_in_data = summary[summary['ticker'].isin(failed_banks)]

    if not failed_in_data.empty:
        lines.append("\n• Other failed banks in peer group:")
        for _, bank in failed_in_data.iterrows():
            lines.append(f"  - {bank['ticker']} ({bank['company_name']}): "
                       f"${bank['total_value_usd']/1_000_000:.2f}M "
                       f"({bank['num_transactions']} transactions)")

    lines.append("\n" + "="*80)
    lines.append("END OF REPORT")
    lines.append("="*80)

    # Write to file
    report_text = "\n".join(lines)
    with open(output_file, 'w') as f:
        f.write(report_text)

    logger.info(f"Report written to {output_file}")
    print("\n" + report_text)


def main():
    """Main execution"""
    logger.info("="*70)
    logger.info("SVB vs Peer Insider Disposal Comparison")
    logger.info("="*70)

    # Create output directory
    output_dir = Path("data/processed/insider_sales")
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. Load peer companies
    peers = load_peer_companies()

    if peers.empty:
        logger.error("No peer companies found")
        return

    # 2. Collect all insider data
    all_data = collect_all_insider_data(peers, START_DATE, END_DATE)

    if all_data.empty:
        logger.error("No insider transaction data collected")
        return

    # Save combined data
    combined_file = output_dir / "svb_peer_insider_disposals_combined_2020_2023.csv"
    all_data.to_csv(combined_file, index=False)
    logger.info(f"\n✓ Combined data saved to {combined_file}")

    # 3. Aggregate by company
    summary = aggregate_by_company(all_data)

    # Save summary
    summary_file = output_dir / "svb_peer_insider_disposals_summary_2020_2023.csv"
    summary.to_csv(summary_file, index=False)
    logger.info(f"✓ Summary saved to {summary_file}")

    # 4. Calculate statistics
    stats = calculate_statistics(summary)

    # 5. Analyze timeline
    timeline = analyze_timeline(all_data)

    # Save timeline
    timeline_file = output_dir / "svb_peer_insider_disposals_timeline_2020_2023.csv"
    timeline.to_csv(timeline_file, index=False)
    logger.info(f"✓ Timeline data saved to {timeline_file}")

    # 6. Generate report
    report_file = output_dir / "svb_vs_peers_insider_disposals_analysis.txt"
    generate_report(summary, stats, timeline, report_file)

    logger.info("\n" + "="*70)
    logger.info("Analysis complete!")
    logger.info("="*70)
    logger.info(f"\nOutput files in {output_dir}:")
    logger.info(f"  - {combined_file.name} (all transactions)")
    logger.info(f"  - {summary_file.name} (company-level summary)")
    logger.info(f"  - {timeline_file.name} (monthly timeline)")
    logger.info(f"  - {report_file.name} (comparative analysis report)")


if __name__ == "__main__":
    main()
