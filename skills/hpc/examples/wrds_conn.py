"""WRDS PostgreSQL connection helper for polars/connectorx on UVA HPC."""
import os
from pathlib import Path
from urllib.parse import quote_plus


def wrds_uri(user: str = "edwin_hu") -> str:
    """Build a PostgreSQL URI from ~/.pgpass credentials.

    connectorx doesn't read .pgpass natively, so we parse it ourselves.
    """
    pgpass = Path.home() / ".pgpass"
    if not pgpass.exists():
        raise FileNotFoundError(
            f"{pgpass} not found. Create it with:\n"
            "wrds-pgdata.wharton.upenn.edu:9737:wrds:USER:PASSWORD\n"
            "chmod 600 ~/.pgpass"
        )

    host = "wrds-pgdata.wharton.upenn.edu"
    port = "9737"
    dbname = "wrds"

    for line in pgpass.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(":")
        if len(parts) >= 5 and parts[0] == host and parts[3] == user:
            password = ":".join(parts[4:])  # password may contain colons
            return f"postgresql://{user}:{quote_plus(password)}@{host}:{port}/{dbname}"

    raise ValueError(f"No .pgpass entry for {user}@{host}:{port}")


def read_wrds(query: str, **kwargs):
    """Read a WRDS SQL query into a polars DataFrame via connectorx."""
    import polars as pl
    return pl.read_database_uri(query, wrds_uri(), engine="connectorx", **kwargs)
