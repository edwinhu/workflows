#!/usr/bin/env -S uv run python3
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
        print("  4. On Linux there is no desktop session — use a platform session,")
        print("     or the browser path: python3 workspace_cdp.py token")
        try:
            ld.close_session()
        except:
            pass
        return False


def test_browser_path():
    """Test the CDP/Workspace-Web path (no machine credentials required)."""
    import os
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        import workspace_cdp as w
    except ImportError as exc:
        print(f"ERROR: cannot import workspace_cdp ({exc})")
        return False

    try:
        print("Reading token from the Workspace Web tab...")
        w.token()
        print("SUCCESS: token retrieved")

        print("\nTesting datagrid...")
        r = w.datagrid(["AAPL.O"], ["TR.CommonName", "TR.Revenue"])
        if r.get("data"):
            print(f"SUCCESS: {r['data'][0]}")
        else:
            print(f"WARNING: no data — {r}")
            return False
        return True
    except SystemExit as exc:      # workspace_cdp raises SystemExit with guidance
        print(f"ERROR: {exc}")
        return False


if __name__ == '__main__':
    if "--browser" in sys.argv:
        ok = test_browser_path()
    else:
        ok = test_connection()
    sys.exit(0 if ok else 1)
