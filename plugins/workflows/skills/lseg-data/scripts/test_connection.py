#!/usr/bin/env python3
"""Test LSEG Data Library connectivity."""

import sys


def test_connection():
    """Test LSEG connection and basic data retrieval."""
    try:
        import lseg.data as ld
    except ImportError:
        print("ERROR: lseg-data not installed")
        print("Install with: pip install lseg-data")
        return False

    try:
        print("Opening LSEG session...")
        ld.open_session()
        print("SUCCESS: Session opened")

        # Test basic data retrieval
        print("\nTesting data retrieval...")
        df = ld.get_data(
            universe=['AAPL.O'],
            fields=['TR.CompanyName', 'TR.PriceClose']
        )

        if df is not None and not df.empty:
            print(f"SUCCESS: Retrieved data for {df.iloc[0]['TR.CompanyName']}")
            print(f"  Price: {df.iloc[0]['TR.PriceClose']}")
        else:
            print("WARNING: Empty response")

        # Test historical data
        print("\nTesting historical data...")
        hist = ld.get_history(
            universe='AAPL.O',
            fields=['CLOSE'],
            start='2024-01-01',
            end='2024-01-05'
        )

        if hist is not None and not hist.empty:
            print(f"SUCCESS: Retrieved {len(hist)} historical records")
        else:
            print("WARNING: Empty historical response")

        ld.close_session()
        print("\nSession closed successfully")
        return True

    except Exception as e:
        print(f"ERROR: {e}")
        print("\nCheck:")
        print("  1. lseg-data.config.json exists with valid credentials")
        print("  2. Or environment variables RDP_USERNAME, RDP_PASSWORD, RDP_APP_KEY are set")
        print("  3. Network connectivity to LSEG servers")
        try:
            ld.close_session()
        except:
            pass
        return False


if __name__ == '__main__':
    success = test_connection()
    sys.exit(0 if success else 1)
