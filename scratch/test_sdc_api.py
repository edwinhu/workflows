#!/usr/bin/env python3
"""
Test SDC Platinum datacloud API for Poison Pills data.

Based on reverse-engineered API from Refinitiv Workspace.
"""
import json
import requests
import lseg.data as ld

# API endpoint discovered from CDP monitoring
DATACLOUD_URL = "https://amers1-apps.platform.refinitiv.com/datacloud-nonviews/snapshot/rest/async?timeout=1"

# Request body format for Poison Pills (from captured traffic)
POISON_PILLS_QUERY = [{
    "select": {
        "cache": "Off",
        "formula": "TR.PPIssuerName, TR.PPPillAdoptionDate",
        "identifiers": 'SCREEN(U(IN(DEALS)) AND IN(TR.PPIssuerNation, "US"),CURN=USD)',
        "lang": "en-US",
        "output": "col, in, t, sorta, TR.PPIssuerName, sorta, TR.PPPillAdoptionDate",
        "productId": "SDC_PLATINUM:UNITY",
        "titleLang": "en-US"
    }
}]

# First try: Use LSEG Data Library to get access token
def get_lseg_session():
    """Initialize LSEG Data session and get access token."""
    try:
        ld.open_session()
        # Try to get the session's access token
        session = ld.get_default_session()
        print(f"Session type: {type(session)}")
        print(f"Session: {session}")
        return session
    except Exception as e:
        print(f"Failed to open LSEG session: {e}")
        return None

def test_direct_api():
    """Try calling the datacloud API directly (will likely fail without auth)."""
    headers = {
        "Content-Type": "application/json; charset=UTF-8",
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) LSEG Workspace/1.26.602",
        "X-App-Request-Id": "test-request-123",
        "Referer": "https://amers1-apps.platform.refinitiv.com/Apps/SDCPlatinum/1.38.31/",
    }

    print("\n=== Testing direct API call (no auth) ===")
    try:
        response = requests.post(
            DATACLOUD_URL,
            headers=headers,
            json=POISON_PILLS_QUERY,
            timeout=30
        )
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text[:500]}")
    except Exception as e:
        print(f"Error: {e}")

def test_via_lseg_library():
    """Try using LSEG library's internal methods to access deals data."""
    print("\n=== Testing via LSEG Data Library ===")
    try:
        ld.open_session()

        # Try the standard SCREEN query syntax that we found
        # This might work if LSEG library supports it
        screen_query = 'SCREEN(U(IN(DEALS)) AND IN(TR.PPIssuerNation, "US"),CURN=USD)'

        print(f"Trying query: {screen_query}")

        # Method 1: Try get_data with SCREEN
        try:
            df = ld.get_data(
                universe=screen_query,
                fields=['TR.PPIssuerName', 'TR.PPPillAdoptionDate']
            )
            print(f"Success! Got {len(df)} rows")
            print(df.head())
        except Exception as e:
            print(f"get_data failed: {e}")

        # Method 2: Try the discovery module if available
        try:
            from lseg.data.discovery import search
            result = search("poison pill", view="DEALS")
            print(f"Search result: {result}")
        except Exception as e:
            print(f"Discovery search failed: {e}")

        ld.close_session()
    except Exception as e:
        print(f"LSEG library error: {e}")

if __name__ == "__main__":
    print("=" * 60)
    print("SDC Platinum API Test")
    print("=" * 60)

    # Test 1: Direct API (will show us what auth is needed)
    test_direct_api()

    # Test 2: Via LSEG library
    test_via_lseg_library()
