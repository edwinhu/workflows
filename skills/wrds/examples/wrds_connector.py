"""
WRDS database connector for downloading proxy statements and company data.
"""
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
import pandas as pd
import psycopg2
from psycopg2 import pool
from contextlib import contextmanager

from config.settings import (
    WRDS_HOST,
    WRDS_PORT,
    WRDS_DATABASE,
    WRDS_USERNAME,
    RAW_DATA_DIR,
    PROXY_PDF_PATTERN,
)
from config.logging_config import logger, log_database_operation


class WRDSConnector:
    """Connector for WRDS PostgreSQL database."""
    
    def __init__(self, min_connections: int = 1, max_connections: int = 5):
        """
        Initialize WRDS connector with connection pooling.
        
        Args:
            min_connections: Minimum number of connections in pool
            max_connections: Maximum number of connections in pool
        """
        self.connection_pool = None
        self.min_connections = min_connections
        self.max_connections = max_connections
        self.proxy_dir = RAW_DATA_DIR / "proxy_statements"
        self.proxy_dir.mkdir(parents=True, exist_ok=True)
        
    def initialize(self):
        """Initialize the connection pool."""
        try:
            # Read password from ~/.pgpass
            password = None
            pgpass_path = os.path.expanduser("~/.pgpass")
            
            if os.path.exists(pgpass_path):
                with open(pgpass_path, 'r') as f:
                    for line in f:
                        parts = line.strip().split(':')
                        if len(parts) >= 5 and parts[0] == WRDS_HOST and parts[2] == WRDS_DATABASE:
                            password = parts[4]
                            break
            
            if not password:
                raise ValueError("Could not find WRDS password in ~/.pgpass")
            
            # Connection parameters
            self.connection_pool = psycopg2.pool.SimpleConnectionPool(
                self.min_connections,
                self.max_connections,
                host=WRDS_HOST,
                port=WRDS_PORT,
                database=WRDS_DATABASE,
                user=WRDS_USERNAME,
                password=password
            )
            logger.info("Initialized WRDS connection pool")
        except Exception as e:
            logger.error(f"Failed to initialize WRDS connection pool: {e}")
            raise
            
    def close(self):
        """Close all connections in the pool."""
        if self.connection_pool:
            self.connection_pool.closeall()
            logger.info("Closed WRDS connection pool")
            
    @contextmanager
    def get_connection(self):
        """
        Context manager for getting a connection from the pool.
        
        Yields:
            psycopg2 connection object
        """
        connection = None
        try:
            connection = self.connection_pool.getconn()
            yield connection
        finally:
            if connection:
                self.connection_pool.putconn(connection)
                
    def get_company_identifiers(self, rssd_ids: List[str]) -> pd.DataFrame:
        """
        Get company identifiers (CIK, CUSIP, GVKEY) for given RSSD IDs.
        
        Args:
            rssd_ids: List of RSSD identifiers
            
        Returns:
            DataFrame with company identifiers
        """
        query = """
        SELECT DISTINCT
            c.gvkey,
            c.cusip,
            c.cik,
            c.conm as company_name,
            c.sic,
            c.naics,
            c.state,
            c.datadate
        FROM comp.company c
        WHERE c.sic IN ('6021', '6022', '6029', '6035', '6036')  -- Banking SIC codes
          AND c.datadate >= '2019-01-01'
          AND (
            c.conm IN (
                SELECT DISTINCT conm 
                FROM comp.company 
                WHERE sic IN ('6021', '6022', '6029', '6035', '6036')
            )
          )
        ORDER BY c.conm, c.datadate DESC
        """
        
        with self.get_connection() as conn:
            df = pd.read_sql_query(query, conn)
            
        log_database_operation("SELECT", "comp.company", len(df))
        logger.info(f"Retrieved {len(df)} company records from WRDS")
        
        return df
        
    def get_proxy_filings(self, ciks: List[str], start_date: str, end_date: str) -> pd.DataFrame:
        """
        Get proxy statement filings for given CIKs.
        
        Args:
            ciks: List of CIK identifiers
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)
            
        Returns:
            DataFrame with filing information
        """
        # Convert CIKs to integers and back to strings to remove leading zeros
        cik_list = [str(int(cik)) for cik in ciks if cik]
        
        query = """
        SELECT DISTINCT
            f.cik,
            f.company_name,
            f.form_type,
            f.filing_date,
            f.period_of_report,
            f.accession_number,
            f.file_name
        FROM edgar.filings f
        WHERE f.form_type IN ('DEF 14A', 'DEFM14A', 'DEFC14A', 'DEF 14C')
          AND f.cik = ANY(%s)
          AND f.filing_date BETWEEN %s AND %s
        ORDER BY f.cik, f.filing_date DESC
        """
        
        with self.get_connection() as conn:
            df = pd.read_sql_query(query, conn, params=(cik_list, start_date, end_date))
            
        log_database_operation("SELECT", "edgar.filings", len(df))
        logger.info(f"Retrieved {len(df)} proxy filings from WRDS")
        
        return df
        
    def get_filing_documents(self, accession_numbers: List[str]) -> pd.DataFrame:
        """
        Get document URLs for given accession numbers.
        
        Args:
            accession_numbers: List of SEC accession numbers
            
        Returns:
            DataFrame with document information
        """
        query = """
        SELECT
            d.accession_number,
            d.sequence,
            d.type,
            d.description,
            d.filename,
            d.url
        FROM edgar.filing_docs d
        WHERE d.accession_number = ANY(%s)
          AND (
            d.type LIKE '%14A%' 
            OR d.description LIKE '%proxy%'
            OR d.description LIKE '%definitive%'
          )
        ORDER BY d.accession_number, d.sequence
        """
        
        with self.get_connection() as conn:
            df = pd.read_sql_query(query, conn, params=(accession_numbers,))
            
        log_database_operation("SELECT", "edgar.filing_docs", len(df))
        logger.info(f"Retrieved {len(df)} document records from WRDS")
        
        return df
        
    # Filing text: use skills/edgar/scripts/edgar_filing.py (fetch/extract), not a per-filing fetch here.
        
    def download_proxy_statements(self, documents_df: pd.DataFrame) -> List[Dict]:
        """
        Download proxy statement documents.
        
        Args:
            documents_df: DataFrame with document URLs
            
        Returns:
            List of download results
        """
        results = []
        
        for _, row in documents_df.iterrows():
            cik = row.get('cik', 'unknown')
            filing_date = row.get('filing_date', datetime.now()).strftime('%Y%m%d')
            form_type = row.get('form_type', 'DEF14A').replace(' ', '_')
            
            # Create year directory
            year = filing_date[:4]
            year_dir = self.proxy_dir / year
            year_dir.mkdir(exist_ok=True)
            
            # Generate filename
            filename = PROXY_PDF_PATTERN.format(
                year=year,
                cik=cik,
                filing_date=filing_date,
                form_type=form_type
            )
            file_path = self.proxy_dir / filename
            
            result = {
                'cik': cik,
                'filing_date': filing_date,
                'form_type': form_type,
                'url': row.get('url'),
                'file_path': str(file_path),
                'status': 'pending'
            }
            
            # Note: Actual download would require additional implementation
            # For now, we just track what needs to be downloaded
            results.append(result)
            
        logger.info(f"Prepared {len(results)} documents for download")
        return results
        
    def get_bank_holding_companies(self) -> pd.DataFrame:
        """
        Get list of bank holding companies with their identifiers.
        
        Returns:
            DataFrame with BHC information
        """
        query = """
        SELECT DISTINCT
            c.gvkey,
            c.cusip,
            c.cik,
            c.conm as company_name,
            c.sic,
            c.state,
            c.fyear,
            c.datadate,
            c.at as total_assets
        FROM comp.company c
        WHERE c.sic = '6712'  -- Bank Holding Companies
           OR (c.sic IN ('6021', '6022', '6029') AND c.conm LIKE '%Bancorp%')
           OR (c.sic IN ('6021', '6022', '6029') AND c.conm LIKE '%Financial%')
        ORDER BY c.at DESC NULLS LAST
        """
        
        with self.get_connection() as conn:
            df = pd.read_sql_query(query, conn)
            
        log_database_operation("SELECT", "comp.company", len(df))
        logger.info(f"Retrieved {len(df)} bank holding companies from WRDS")
        
        return df
        
    def match_rssd_to_cik(self, bhc_names: List[str]) -> pd.DataFrame:
        """
        Match BHC names to CIKs using fuzzy matching.
        
        Args:
            bhc_names: List of BHC names from FFIEC
            
        Returns:
            DataFrame with matched CIKs
        """
        # Build query with ILIKE ANY for multiple pattern matching
        patterns = []
        for name in bhc_names:
            # Create search patterns for each name
            patterns.append(f'%{name}%')
            # Also search for first word only
            first_word = name.split()[0] if name.split() else name
            patterns.append(f'%{first_word}%')
        
        query = """
        SELECT DISTINCT
            c.cik,
            c.conm as company_name,
            c.sic,
            c.state,
            MAX(c.datadate) as latest_date
        FROM comp.company c
        WHERE c.conm ILIKE ANY(%s)
          AND c.sic IN ('6021', '6022', '6029', '6035', '6036', '6712')
        GROUP BY c.cik, c.conm, c.sic, c.state
        ORDER BY c.conm
        """
        
        with self.get_connection() as conn:
            df = pd.read_sql_query(query, conn, params=(patterns,))
            
        log_database_operation("SELECT", "comp.company", len(df))
        logger.info(f"Matched {len(df)} companies to CIKs")
        
        return df


def main():
    """Example usage of the WRDS connector."""
    connector = WRDSConnector()
    
    try:
        connector.initialize()
        
        # Get bank holding companies
        bhcs = connector.get_bank_holding_companies()
        print(f"Found {len(bhcs)} bank holding companies")
        
        # Show top 5 by assets
        top_bhcs = bhcs.nlargest(5, 'total_assets', keep='first')
        for _, bhc in top_bhcs.iterrows():
            print(f"{bhc['company_name']} - CIK: {bhc['cik']} - Assets: ${bhc['total_assets']:,.0f}M")
            
        # Get proxy filings for top companies
        if not top_bhcs.empty:
            ciks = top_bhcs['cik'].dropna().unique().tolist()
            filings = connector.get_proxy_filings(ciks[:3], '2023-01-01', '2023-12-31')
            print(f"\nFound {len(filings)} proxy filings for 2023")
            
    finally:
        connector.close()


if __name__ == "__main__":
    main()