"""
WRDS database connector for downloading proxy statements and company data.
"""
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
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
        
    def get_proxy_text(self, accession_number: str, cik: Optional[str] = None, 
                      prefer_clean: bool = True) -> Optional[Tuple[str, bool]]:
        """
        Get the full text of a proxy statement.
        
        First attempts to get WRDSFNAME from WRDS database for reference,
        then downloads from SEC EDGAR. Checks for clean versions in 
        /wrds/sec/wrds_clean_filings/ first if prefer_clean is True.
        
        Args:
            accession_number: SEC accession number (e.g., '0001193125-23-062686')
            cik: Company CIK (optional, will be looked up if not provided)
            prefer_clean: Whether to prefer clean version if available
            
        Returns:
            Tuple of (text, is_clean) or None if not found
        """
        import httpx
        import time
        import subprocess
        import tempfile
        import os
        
        # If CIK not provided, look it up from WRDS
        if not cik:
            query = """
            SELECT DISTINCT r.cik
            FROM wrds_sec_search.filing_view f
            JOIN wrds_sec_search.registrant r ON r.accession = f.accession
            WHERE f.accession = %s
              AND f.form IN ('DEF 14A', 'DEFM14A', 'DEFC14A', 'DEF 14C')
            LIMIT 1
            """
            
            try:
                with self.get_connection() as conn:
                    with conn.cursor() as cursor:
                        cursor.execute(query, (accession_number,))
                        result = cursor.fetchone()
                        if result:
                            cik = result[0]
                        else:
                            logger.error(f"Could not find CIK for accession {accession_number}")
                            return None
            except Exception as e:
                logger.error(f"Error looking up CIK for {accession_number}: {e}")
                return None
        
        # First, let's check if WRDS has the file path
        wrdsfname = None
        clean_wrdsfname = None
        try:
            wrds_query = """
            SELECT wrdsfname
            FROM wrdssec.wrds_forms
            WHERE accession = %s
              AND form IN ('DEF 14A', 'DEFM14A', 'DEFC14A', 'DEF 14C')
            LIMIT 1
            """
            
            with self.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(wrds_query, (accession_number,))
                    result = cursor.fetchone()
                    if result and result[0]:
                        wrdsfname = result[0]
                        logger.info(f"WRDS file path: /wrds/sec/warchives/{wrdsfname}")
                        
                        # Check if clean version exists
                        # Clean filings typically have same structure but in different directory
                        clean_path_parts = wrdsfname.split('/')
                        if len(clean_path_parts) >= 2:
                            # Construct clean filing path (typically same structure)
                            clean_wrdsfname = wrdsfname  # Will be used with clean directory
                            logger.info(f"Will check for clean version at: /wrds/sec/wrds_clean_filings/{clean_wrdsfname}")
        except Exception as e:
            logger.debug(f"Could not get WRDS file path: {e}")
        
        # Try to download clean version first if requested
        if prefer_clean and clean_wrdsfname:
            clean_full_path = f"/wrds/sec/wrds_clean_filings/{clean_wrdsfname}"
            
            try:
                # Create a temporary file to download to
                with tempfile.NamedTemporaryFile(mode='w+', suffix='.txt', delete=False) as tmp_file:
                    tmp_path = tmp_file.name
                
                # First try rclone for clean version
                rclone_cmd = [
                    'rclone',
                    'copy',
                    f'wrds:{clean_full_path}',
                    os.path.dirname(tmp_path),
                    '--include', os.path.basename(tmp_path)
                ]
                
                # Rename the file to match expected name
                expected_path = os.path.join(os.path.dirname(tmp_path), os.path.basename(clean_wrdsfname))
                
                logger.info(f"Attempting to download clean version from WRDS: {clean_full_path}")
                result = subprocess.run(rclone_cmd, capture_output=True, text=True, timeout=60)
                
                if result.returncode == 0:
                    # rclone downloads with original filename, so we need to rename
                    if os.path.exists(expected_path):
                        os.rename(expected_path, tmp_path)
                    
                    if os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 0:
                        # Read the downloaded file
                        with open(tmp_path, 'r', encoding='utf-8', errors='ignore') as f:
                            text = f.read()
                        
                        # Clean up temporary file
                        os.unlink(tmp_path)
                        
                        logger.success(f"Downloaded clean version: {len(text)} characters")
                        return (text, True)  # Return with is_clean=True
                else:
                    logger.debug(f"Clean version not available: {result.stderr}")
                    if os.path.exists(tmp_path):
                        os.unlink(tmp_path)
                    if 'expected_path' in locals() and os.path.exists(expected_path):
                        os.unlink(expected_path)
                        
            except Exception as e:
                logger.debug(f"Error trying clean version: {e}")
                if 'tmp_path' in locals() and os.path.exists(tmp_path):
                    os.unlink(tmp_path)
                if 'expected_path' in locals() and os.path.exists(expected_path):
                    os.unlink(expected_path)
        
        # Try to download from WRDS via rclone (original version)
        if wrdsfname:
            wrds_full_path = f"/wrds/sec/warchives/{wrdsfname}"
            
            try:
                # Create a temporary file to download to
                with tempfile.NamedTemporaryFile(mode='w+', suffix='.txt', delete=False) as tmp_file:
                    tmp_path = tmp_file.name
                
                # First try rclone (faster and more reliable)
                rclone_cmd = [
                    'rclone',
                    'copy',
                    f'wrds:{wrds_full_path}',
                    os.path.dirname(tmp_path),
                    '--include', os.path.basename(tmp_path)
                ]
                
                # Rename the file to match expected name
                expected_path = os.path.join(os.path.dirname(tmp_path), os.path.basename(wrdsfname))
                
                logger.info(f"Downloading from WRDS via rclone: {wrds_full_path}")
                result = subprocess.run(rclone_cmd, capture_output=True, text=True, timeout=60)
                
                if result.returncode == 0:
                    # rclone downloads with original filename, so we need to rename
                    if os.path.exists(expected_path):
                        os.rename(expected_path, tmp_path)
                    
                    if os.path.exists(tmp_path):
                        # Read the downloaded file
                        with open(tmp_path, 'r', encoding='utf-8', errors='ignore') as f:
                            text = f.read()
                        
                        # Clean up temporary file
                        os.unlink(tmp_path)
                        
                        logger.success(f"Downloaded {len(text)} characters from WRDS via rclone")
                        return (text, False)  # Return original version
                else:
                    logger.debug(f"rclone download failed: {result.stderr}")
                    # Fall back to SCP
                    ssh_config = os.path.expanduser('~/.ssh/config_external')
                    if os.path.exists(ssh_config):
                        scp_cmd = [
                            'scp',
                            '-F', ssh_config,
                            '-o', 'ConnectTimeout=30',
                            f'wrds:{wrds_full_path}',
                            tmp_path
                        ]
                        
                        logger.info(f"Falling back to SCP: {wrds_full_path}")
                        result = subprocess.run(scp_cmd, capture_output=True, text=True, timeout=60)
                        
                        if result.returncode == 0 and os.path.exists(tmp_path):
                            # Read the downloaded file
                            with open(tmp_path, 'r', encoding='utf-8', errors='ignore') as f:
                                text = f.read()
                            
                            # Clean up temporary file
                            os.unlink(tmp_path)
                            
                            logger.success(f"Downloaded {len(text)} characters from WRDS via SCP")
                            return (text, False)  # Return original version
                        else:
                            logger.warning(f"SCP download failed: {result.stderr}")
                            if os.path.exists(tmp_path):
                                os.unlink(tmp_path)
                    else:
                        logger.debug("SSH config not found, skipping SCP fallback")
                        
            except subprocess.TimeoutExpired:
                logger.warning("WRDS download timed out")
                if 'tmp_path' in locals() and os.path.exists(tmp_path):
                    os.unlink(tmp_path)
                if 'expected_path' in locals() and os.path.exists(expected_path):
                    os.unlink(expected_path)
            except Exception as e:
                logger.warning(f"Error downloading from WRDS: {e}")
                if 'tmp_path' in locals() and os.path.exists(tmp_path):
                    os.unlink(tmp_path)
                if 'expected_path' in locals() and os.path.exists(expected_path):
                    os.unlink(expected_path)
        
        # Fallback: Download from SEC EDGAR
        try:
            # Remove leading zeros from CIK for EDGAR URL
            cik_stripped = cik.lstrip('0')
            
            # Remove dashes from accession number for URL path
            accession_no_dashes = accession_number.replace('-', '')
            
            # Construct EDGAR URL
            edgar_url = f"https://www.sec.gov/Archives/edgar/data/{cik_stripped}/{accession_no_dashes}/{accession_number}.txt"
            
            logger.info(f"Downloading from SEC EDGAR: {edgar_url}")
            
            # Download with retries
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    response = httpx.get(
                        edgar_url,
                        follow_redirects=True,
                        timeout=30,
                        headers={
                            'User-Agent': 'Academic Research Python/3.x',
                            'Accept': 'text/plain, text/html'
                        }
                    )
                    
                    if response.status_code == 200:
                        text = response.text
                        logger.success(f"Downloaded {len(text)} characters from SEC EDGAR")
                        return (text, False)  # SEC EDGAR is original version
                    else:
                        logger.warning(f"EDGAR returned status {response.status_code} for {edgar_url}")
                        
                except httpx.TimeoutException:
                    logger.warning(f"Timeout downloading from EDGAR (attempt {attempt + 1}/{max_retries})")
                    if attempt < max_retries - 1:
                        time.sleep(2 ** attempt)  # Exponential backoff
                except Exception as e:
                    logger.error(f"Error downloading from EDGAR (attempt {attempt + 1}/{max_retries}): {e}")
                    if attempt < max_retries - 1:
                        time.sleep(2 ** attempt)
            
            logger.error(f"Failed to download proxy text after {max_retries} attempts")
            return None
            
        except Exception as e:
            logger.error(f"Error downloading proxy text for {accession_number}: {e}")
            return None
        
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