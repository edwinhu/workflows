#!/usr/bin/env python3
"""Test WRDS PostgreSQL connectivity."""

import sys

def test_connection():
    """Test WRDS connection and print available libraries."""
    try:
        import psycopg2
    except ImportError:
        print("ERROR: psycopg2 not installed")
        print("Install with: pip install psycopg2-binary")
        return False

    try:
        conn = psycopg2.connect(
            host='wrds-pgdata.wharton.upenn.edu',
            port=9737,
            database='wrds',
            sslmode='require'
        )
        print("SUCCESS: Connected to WRDS")

        with conn.cursor() as cur:
            # List schemas
            cur.execute("""
                SELECT schema_name
                FROM information_schema.schemata
                WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                ORDER BY schema_name
                LIMIT 20
            """)
            schemas = cur.fetchall()
            print(f"\nAvailable schemas (first 20):")
            for (schema,) in schemas:
                print(f"  - {schema}")

            # Test key tables
            print("\nTesting key tables:")
            test_tables = [
                ('comp', 'company'),
                ('crsp', 'stocknames'),
                ('tr_insiders', 'table1'),
                ('iss_incentive_lab', 'comppeer'),
            ]
            for schema, table in test_tables:
                try:
                    cur.execute(f"SELECT 1 FROM {schema}.{table} LIMIT 1")
                    print(f"  {schema}.{table}")
                except Exception as e:
                    print(f"  {schema}.{table} - NOT ACCESSIBLE: {e}")

        conn.close()
        return True

    except Exception as e:
        print(f"ERROR: {e}")
        print("\nCheck:")
        print("  1. ~/.pgpass exists with correct credentials")
        print("  2. ~/.pgpass has chmod 600 permissions")
        print("  3. Network connectivity to wrds-pgdata.wharton.upenn.edu:9737")
        return False


if __name__ == '__main__':
    success = test_connection()
    sys.exit(0 if success else 1)
