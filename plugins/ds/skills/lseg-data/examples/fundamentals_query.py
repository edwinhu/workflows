#!/usr/bin/env python3
"""Example: Query company fundamentals from LSEG Data Library."""

import lseg.data as ld
import pandas as pd


def get_quarterly_financials(tickers: list[str], years: int = 3) -> pd.DataFrame:
    """
    Get quarterly financial data for companies.

    Args:
        tickers: List of RIC symbols (e.g., ['AAPL.O', 'MSFT.O'])
        years: Number of years of history

    Returns:
        DataFrame with quarterly financials
    """
    fields = [
        'TR.CompanyName',
        'TR.RevenueActValue',
        'TR.GrossProfitActValue',
        'TR.OperatingIncomeActValue',
        'TR.NetIncomeActValue',
        'TR.EPSActValue',
        'TR.GrossMargin',
        'TR.OperatingMargin',
        'TR.NetProfitMargin',
    ]

    df = ld.get_data(
        universe=tickers,
        fields=fields,
        parameters={
            'SDate': f'FY-{years}',
            'EDate': 'FY0',
            'Period': 'FQ0',  # Quarterly
            'Curn': 'USD'
        }
    )

    return df


def get_valuation_metrics(tickers: list[str]) -> pd.DataFrame:
    """Get current valuation metrics."""
    fields = [
        'TR.CompanyName',
        'TR.CompanyMarketCap',
        'TR.PriceClose',
        'TR.PriceToBVPerShare',
        'TR.PriceToSalesPerShare',
        'TR.EVToEBITDA',
        'TR.PERatio',
        'TR.DividendYield',
    ]

    return ld.get_data(universe=tickers, fields=fields)


def main():
    """Example usage."""
    # Tech companies
    tickers = ['AAPL.O', 'MSFT.O', 'GOOGL.O', 'AMZN.O', 'META.O']

    ld.open_session()

    try:
        print("Quarterly Financials (Last 3 Years)")
        print("=" * 60)
        financials = get_quarterly_financials(tickers)
        print(financials.to_string())

        print("\n\nCurrent Valuation Metrics")
        print("=" * 60)
        valuation = get_valuation_metrics(tickers)
        print(valuation.to_string())

    finally:
        ld.close_session()


if __name__ == '__main__':
    main()
