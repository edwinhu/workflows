# WRDS Connection Pooling

## Contents

- [Overview](#overview)
- [Basic Pool Setup](#basic-pool-setup)
- [Thread-Safe Pool (for concurrent access)](#thread-safe-pool-for-concurrent-access)
- [Connection Parameters](#connection-parameters)
- [Pool Sizing Guidelines](#pool-sizing-guidelines)
- [Connection Health Checks](#connection-health-checks)
- [Named Cursors for Large Result Sets](#named-cursors-for-large-result-sets)
- [Error Handling Patterns](#error-handling-patterns)
- [Integration with pandas](#integration-with-pandas)
- [Environment-Based Configuration](#environment-based-configuration)
- [Troubleshooting](#troubleshooting)

## Overview

WRDS PostgreSQL connections benefit from pooling due to SSL handshake overhead. This module details connection pool configuration, lifecycle management, and troubleshooting.

## Basic Pool Setup

```python
import psycopg2
from psycopg2.pool import SimpleConnectionPool
from contextlib import contextmanager
import atexit
import logging

logger = logging.getLogger(__name__)

class WRDSPool:
    """Thread-safe WRDS connection pool with lifecycle management."""

    _instance = None

    def __new__(cls):
        """Singleton pattern for connection pool."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, minconn=1, maxconn=5):
        if self._initialized:
            return

        self.pool = SimpleConnectionPool(
            minconn=minconn,
            maxconn=maxconn,
            host='wrds-pgdata.wharton.upenn.edu',
            port=9737,
            database='wrds',
            sslmode='require',
            connect_timeout=30,
            options='-c statement_timeout=300000'  # 5 min query timeout
        )

        # Register cleanup on program exit
        atexit.register(self.close)
        self._initialized = True
        logger.info(f"WRDS pool initialized: {minconn}-{maxconn} connections")

    @contextmanager
    def connection(self):
        """Get connection with automatic return to pool."""
        conn = None
        try:
            conn = self.pool.getconn()
            yield conn
        except psycopg2.OperationalError as e:
            logger.error(f"Connection error: {e}")
            if conn:
                # Mark connection as broken
                self.pool.putconn(conn, close=True)
                conn = None
            raise
        finally:
            if conn:
                self.pool.putconn(conn)

    @contextmanager
    def cursor(self, cursor_factory=None):
        """Get cursor with connection management."""
        with self.connection() as conn:
            cursor = conn.cursor(cursor_factory=cursor_factory)
            try:
                yield cursor
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                cursor.close()

    def close(self):
        """Close all connections in pool."""
        if hasattr(self, 'pool') and self.pool:
            self.pool.closeall()
            logger.info("WRDS pool closed")

# Convenience function
def get_pool() -> WRDSPool:
    """Get or create the WRDS connection pool."""
    return WRDSPool()
```

## Thread-Safe Pool (for concurrent access)

For multi-threaded applications, use `ThreadedConnectionPool`:

```python
from psycopg2.pool import ThreadedConnectionPool
import threading

class ThreadSafeWRDSPool:
    """Thread-safe connection pool for concurrent access."""

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self, minconn=1, maxconn=10):
        with self._lock:
            if self._initialized:
                return

            self.pool = ThreadedConnectionPool(
                minconn=minconn,
                maxconn=maxconn,
                host='wrds-pgdata.wharton.upenn.edu',
                port=9737,
                database='wrds',
                sslmode='require'
            )
            self._initialized = True

    @contextmanager
    def connection(self):
        """Thread-safe connection acquisition."""
        conn = self.pool.getconn()
        try:
            yield conn
        finally:
            self.pool.putconn(conn)
```

## Connection Parameters

### Required Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `host` | `wrds-pgdata.wharton.upenn.edu` | WRDS PostgreSQL host |
| `port` | `9737` | Non-standard PostgreSQL port |
| `database` | `wrds` | Main WRDS database |
| `sslmode` | `require` | SSL required for WRDS |

### Optional Parameters

| Parameter | Recommended | Description |
|-----------|-------------|-------------|
| `connect_timeout` | `30` | Connection timeout in seconds |
| `statement_timeout` | `300000` | Query timeout in ms (5 min) |
| `application_name` | Project name | Helps WRDS identify your app |

### Authentication via ~/.pgpass

WRDS credentials are read from `~/.pgpass`:

```
# Format: hostname:port:database:username:password
wrds-pgdata.wharton.upenn.edu:9737:wrds:myusername:mypassword
```

Ensure proper permissions:
```bash
chmod 600 ~/.pgpass
```

## Pool Sizing Guidelines

| Use Case | minconn | maxconn | Notes |
|----------|---------|---------|-------|
| Single-threaded scripts | 1 | 1 | No pooling overhead |
| Jupyter notebooks | 1 | 3 | Occasional queries |
| Batch processing | 2 | 5 | Parallel queries |
| Web applications | 5 | 20 | High concurrency |

## Connection Health Checks

```python
def check_connection_health(pool: WRDSPool) -> bool:
    """Verify pool connection is healthy."""
    try:
        with pool.cursor() as cursor:
            cursor.execute("SELECT 1")
            result = cursor.fetchone()
            return result == (1,)
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return False

def reconnect_if_needed(pool: WRDSPool) -> bool:
    """Attempt reconnection if pool is unhealthy."""
    if check_connection_health(pool):
        return True

    logger.warning("Pool unhealthy, attempting reconnection...")

    # Close existing pool
    pool.close()

    # Reinitialize
    pool._initialized = False
    pool.__init__()

    return check_connection_health(pool)
```

## Named Cursors for Large Result Sets

For queries returning large datasets, use server-side cursors:

```python
from psycopg2.extras import NamedTupleCursor

def fetch_large_dataset(pool: WRDSPool, query: str, params: tuple = None,
                        batch_size: int = 10000):
    """Fetch large dataset using server-side cursor."""
    with pool.connection() as conn:
        # Named cursor enables server-side processing
        with conn.cursor(name='large_fetch') as cursor:
            cursor.itersize = batch_size
            cursor.execute(query, params)

            for row in cursor:
                yield row
```

## Error Handling Patterns

```python
import psycopg2
from psycopg2 import OperationalError, InterfaceError, DatabaseError
import time

def retry_on_connection_error(pool: WRDSPool, query: str,
                               params: tuple = None,
                               max_retries: int = 3,
                               delay: float = 1.0):
    """Execute query with automatic retry on connection errors."""
    last_error = None

    for attempt in range(max_retries):
        try:
            with pool.cursor() as cursor:
                cursor.execute(query, params)
                return cursor.fetchall()

        except (OperationalError, InterfaceError) as e:
            last_error = e
            logger.warning(f"Connection error (attempt {attempt + 1}): {e}")

            if attempt < max_retries - 1:
                time.sleep(delay * (attempt + 1))  # Exponential backoff
                continue

        except DatabaseError as e:
            # Query errors should not be retried
            logger.error(f"Query error: {e}")
            raise

    raise last_error
```

## Integration with pandas

```python
import pandas as pd

def query_to_dataframe(pool: WRDSPool, query: str,
                       params: tuple = None) -> pd.DataFrame:
    """Execute query and return results as DataFrame."""
    with pool.connection() as conn:
        return pd.read_sql_query(query, conn, params=params)

def query_to_dataframe_chunked(pool: WRDSPool, query: str,
                                params: tuple = None,
                                chunksize: int = 10000):
    """Execute query and yield DataFrame chunks."""
    with pool.connection() as conn:
        for chunk in pd.read_sql_query(query, conn, params=params,
                                        chunksize=chunksize):
            yield chunk
```

## Environment-Based Configuration

```python
import os

def create_pool_from_env() -> WRDSPool:
    """Create pool with configuration from environment."""
    return WRDSPool(
        minconn=int(os.getenv('WRDS_POOL_MIN', 1)),
        maxconn=int(os.getenv('WRDS_POOL_MAX', 5))
    )

# Usage in scripts
# export WRDS_POOL_MIN=2
# export WRDS_POOL_MAX=10
```

## Troubleshooting

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `connection refused` | Firewall/network | Check VPN, firewall rules |
| `authentication failed` | Bad credentials | Verify ~/.pgpass |
| `SSL SYSCALL error` | Network interruption | Retry with exponential backoff |
| `too many connections` | Pool exhausted | Increase maxconn or check for leaks |
| `statement timeout` | Query too slow | Optimize query or increase timeout |

### Connection Leak Detection

```python
import traceback
import weakref

class DebugPool(WRDSPool):
    """Pool with connection leak detection."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._active = weakref.WeakValueDictionary()

    @contextmanager
    def connection(self):
        conn = self.pool.getconn()
        conn_id = id(conn)
        self._active[conn_id] = conn

        # Store stack trace for debugging
        conn._checkout_stack = traceback.extract_stack()

        try:
            yield conn
        finally:
            if conn_id in self._active:
                del self._active[conn_id]
            self.pool.putconn(conn)

    def report_leaks(self):
        """Report any connections not returned to pool."""
        for conn_id, conn in self._active.items():
            stack = ''.join(traceback.format_list(conn._checkout_stack))
            logger.warning(f"Connection {conn_id} not returned:\n{stack}")
```
