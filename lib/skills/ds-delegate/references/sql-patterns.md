# SQL Patterns Reference

Dialect-specific reference and common analytical patterns for data analysis subagents.

## Dialect Quick Reference

### DuckDB

**Date/Time:**
```sql
-- Current date/time
SELECT current_date, current_timestamp;
-- Date arithmetic
SELECT date '2024-01-15' + INTERVAL 30 DAY;
SELECT date_trunc('month', order_date);
SELECT date_part('year', order_date);
SELECT date_diff('day', start_date, end_date);
-- Generate date series
SELECT unnest(generate_series(DATE '2024-01-01', DATE '2024-12-31', INTERVAL 1 MONTH)) AS month_start;
```

**String:**
```sql
SELECT regexp_extract(col, '(\d+)', 1);
SELECT string_split(col, ',');
SELECT list_transform(string_split(col, ','), x -> trim(x));
```

**JSON/Struct:**
```sql
-- Native struct access
SELECT col.field, col['field'];
-- JSON extraction
SELECT json_extract(col, '$.key');
SELECT col->>'key';  -- text extraction
-- Unnest arrays
SELECT unnest(array_col) FROM tbl;
```

**File I/O (DuckDB-specific):**
```sql
-- Read files directly
SELECT * FROM read_csv('data.csv', auto_detect=true);
SELECT * FROM read_parquet('data/*.parquet');
SELECT * FROM read_json('data.json');
-- Write results
COPY (SELECT * FROM tbl) TO 'output.parquet' (FORMAT PARQUET);
COPY (SELECT * FROM tbl) TO 'output.csv' (HEADER, DELIMITER ',');
```

**Performance:**
- DuckDB is columnar and vectorized — prefer `SELECT col1, col2` over `SELECT *`
- Parquet files are fastest; CSV auto-detect adds overhead on large files
- Use `PRAGMA threads=N` to control parallelism
- `CREATE TABLE ... AS SELECT` for materializing intermediate results

---

### PostgreSQL

**Date/Time:**
```sql
SELECT NOW(), CURRENT_DATE;
SELECT date_trunc('month', created_at);
SELECT EXTRACT(YEAR FROM created_at);
SELECT created_at + INTERVAL '30 days';
SELECT age(end_date, start_date);
-- Generate series
SELECT generate_series('2024-01-01'::date, '2024-12-31'::date, '1 month'::interval);
```

**String:**
```sql
SELECT regexp_matches(col, '(\d+)');
SELECT string_to_array(col, ',');
SELECT string_agg(col, ', ' ORDER BY col);
```

**JSON:**
```sql
SELECT col->>'key';           -- text
SELECT col->'nested'->'key';  -- json
SELECT jsonb_array_elements(col);
SELECT jsonb_each(col);
```

**Performance:**
- Use `EXPLAIN ANALYZE` to check plans
- Index scans > seq scans for selective queries
- `WHERE col = ANY(ARRAY[...])` instead of long `IN` lists
- CTEs are optimization fences in PG < 12; use subqueries or `MATERIALIZED`/`NOT MATERIALIZED` hints in PG 12+

---

### Snowflake

**Date/Time:**
```sql
SELECT CURRENT_TIMESTAMP();
SELECT DATEADD(day, 30, order_date);
SELECT DATEDIFF(day, start_date, end_date);
SELECT DATE_TRUNC('month', order_date);
-- Note: EXTRACT returns a number, not a date
SELECT EXTRACT(year FROM order_date);
```

**Semi-structured (VARIANT):**
```sql
SELECT col:key::string;
SELECT col:nested.key::int;
SELECT f.value FROM tbl, LATERAL FLATTEN(input => col:array_field) f;
```

**String:**
```sql
SELECT REGEXP_SUBSTR(col, '\\d+', 1, 1);
SELECT SPLIT(col, ',');
SELECT LISTAGG(col, ', ') WITHIN GROUP (ORDER BY col);
```

**Performance:**
- Cluster keys on large tables (replace traditional indexes)
- Use `RESULT_SCAN(LAST_QUERY_ID())` to avoid re-running queries
- `SAMPLE (N ROWS)` for quick exploration
- Avoid `SELECT *` on wide tables — column pruning matters

---

### BigQuery

**Date/Time:**
```sql
SELECT CURRENT_TIMESTAMP();
SELECT DATE_ADD(order_date, INTERVAL 30 DAY);
SELECT DATE_DIFF(end_date, start_date, DAY);
SELECT DATE_TRUNC(order_date, MONTH);
SELECT EXTRACT(YEAR FROM order_date);
-- Generate array of dates
SELECT date FROM UNNEST(GENERATE_DATE_ARRAY('2024-01-01', '2024-12-31', INTERVAL 1 MONTH)) AS date;
```

**JSON/Arrays/Structs:**
```sql
SELECT JSON_VALUE(col, '$.key');
SELECT col.field;  -- struct access
SELECT element FROM tbl, UNNEST(array_col) AS element;
```

**String:**
```sql
SELECT REGEXP_EXTRACT(col, r'(\d+)');
SELECT SPLIT(col, ',');
SELECT STRING_AGG(col, ', ' ORDER BY col);
```

**Performance:**
- **Always filter on partitioned columns** (usually date) to avoid full scans
- Use `_TABLE_SUFFIX` for wildcard table queries
- Avoid `SELECT *` — you pay per byte scanned
- Use `APPROX_COUNT_DISTINCT` for large cardinality counts

---

### Databricks (Spark SQL)

**Date/Time:**
```sql
SELECT current_date(), current_timestamp();
SELECT date_add(order_date, 30);
SELECT datediff(end_date, start_date);
SELECT trunc(order_date, 'month');
SELECT year(order_date), month(order_date);
```

**JSON/Arrays:**
```sql
SELECT get_json_object(col, '$.key');
SELECT col.field;  -- struct
SELECT explode(array_col) FROM tbl;
SELECT from_json(col, 'struct<key:string,val:int>');
```

**String:**
```sql
SELECT regexp_extract(col, '(\\d+)', 1);
SELECT split(col, ',');
SELECT collect_list(col) FROM tbl GROUP BY grp;
```

**Performance:**
- Filter on Delta partition columns
- Use `OPTIMIZE` and `ZORDER BY` for frequently filtered columns
- `CACHE TABLE` for iterative analysis
- `TABLESAMPLE (N PERCENT)` for exploration

---

### Redshift

**Date/Time:**
```sql
SELECT GETDATE(), CURRENT_DATE;
SELECT DATEADD(day, 30, order_date);
SELECT DATEDIFF(day, start_date, end_date);
SELECT DATE_TRUNC('month', order_date);
SELECT EXTRACT(year FROM order_date);
```

**JSON:**
```sql
SELECT JSON_EXTRACT_PATH_TEXT(col, 'key');
SELECT JSON_EXTRACT_ARRAY_ELEMENT_TEXT(col, 0);
```

**String:**
```sql
SELECT REGEXP_SUBSTR(col, '\\d+');
SELECT SPLIT_PART(col, ',', 1);
SELECT LISTAGG(col, ', ') WITHIN GROUP (ORDER BY col);
```

**Performance:**
- Use `DISTKEY` and `SORTKEY` in table design
- `ANALYZE` and `VACUUM` regularly
- Avoid cross-node joins on large tables
- Use `UNLOAD` to export large result sets to S3

---

## Common Analytical Patterns

### Window Functions

```sql
-- Running total
SELECT *, SUM(amount) OVER (PARTITION BY customer_id ORDER BY order_date) AS running_total
FROM orders;

-- Row number for deduplication
SELECT * FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at DESC) AS rn
    FROM users
) WHERE rn = 1;

-- Lag/lead for change detection
SELECT *,
    LAG(status) OVER (PARTITION BY user_id ORDER BY event_time) AS prev_status,
    LEAD(status) OVER (PARTITION BY user_id ORDER BY event_time) AS next_status
FROM events;

-- Percentiles
SELECT
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount) AS median,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY amount) AS p95
FROM transactions;
-- DuckDB/PostgreSQL alternative:
SELECT quantile_cont(amount, 0.5) AS median FROM transactions;
```

### CTEs (Common Table Expressions)

```sql
-- Readable multi-step analysis
WITH daily_revenue AS (
    SELECT date_trunc('day', order_date) AS day, SUM(amount) AS revenue
    FROM orders
    GROUP BY 1
),
daily_with_ma AS (
    SELECT *,
        AVG(revenue) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS ma_7d
    FROM daily_revenue
)
SELECT * FROM daily_with_ma ORDER BY day;
```

### Cohort Retention

```sql
WITH user_cohort AS (
    SELECT user_id,
           date_trunc('month', MIN(first_activity)) AS cohort_month
    FROM activity
    GROUP BY user_id
),
user_activity AS (
    SELECT user_id,
           date_trunc('month', activity_date) AS activity_month
    FROM activity
)
SELECT
    c.cohort_month,
    -- DuckDB/PostgreSQL: date_diff or EXTRACT(EPOCH FROM ...)
    EXTRACT(YEAR FROM age(a.activity_month, c.cohort_month)) * 12 +
    EXTRACT(MONTH FROM age(a.activity_month, c.cohort_month)) AS months_since,
    COUNT(DISTINCT a.user_id) AS active_users,
    COUNT(DISTINCT a.user_id)::FLOAT / MAX(cohort_size) AS retention_rate
FROM user_cohort c
JOIN user_activity a USING (user_id)
JOIN (SELECT cohort_month, COUNT(*) AS cohort_size FROM user_cohort GROUP BY 1) cs
    ON c.cohort_month = cs.cohort_month
GROUP BY 1, 2
ORDER BY 1, 2;
```

### Funnel Analysis

```sql
WITH funnel AS (
    SELECT user_id,
        MAX(CASE WHEN event = 'page_view' THEN 1 END) AS step_1_view,
        MAX(CASE WHEN event = 'add_to_cart' THEN 1 END) AS step_2_cart,
        MAX(CASE WHEN event = 'checkout' THEN 1 END) AS step_3_checkout,
        MAX(CASE WHEN event = 'purchase' THEN 1 END) AS step_4_purchase
    FROM events
    WHERE event_date BETWEEN '2024-01-01' AND '2024-01-31'
    GROUP BY user_id
)
SELECT
    COUNT(*) AS total_users,
    SUM(step_1_view) AS viewed,
    SUM(step_2_cart) AS added_to_cart,
    SUM(step_3_checkout) AS checked_out,
    SUM(step_4_purchase) AS purchased,
    ROUND(SUM(step_4_purchase)::NUMERIC / NULLIF(SUM(step_1_view), 0) * 100, 1) AS conversion_pct
FROM funnel;
```

### Deduplication

```sql
-- Keep latest record per key
-- Method 1: ROW_NUMBER (works everywhere)
DELETE FROM target WHERE id IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY dedup_key ORDER BY updated_at DESC) AS rn
        FROM target
    ) WHERE rn > 1
);

-- Method 2: QUALIFY (Snowflake, DuckDB, Databricks)
SELECT * FROM target
QUALIFY ROW_NUMBER() OVER (PARTITION BY dedup_key ORDER BY updated_at DESC) = 1;

-- Method 3: DISTINCT ON (PostgreSQL, DuckDB)
SELECT DISTINCT ON (dedup_key) *
FROM target
ORDER BY dedup_key, updated_at DESC;
```

### Pivot / Unpivot

```sql
-- Pivot (conditional aggregation — works everywhere)
SELECT
    user_id,
    SUM(CASE WHEN category = 'A' THEN amount END) AS category_a,
    SUM(CASE WHEN category = 'B' THEN amount END) AS category_b
FROM orders GROUP BY user_id;

-- DuckDB native PIVOT
PIVOT orders ON category USING SUM(amount) GROUP BY user_id;

-- Unpivot (DuckDB)
UNPIVOT tbl ON (col1, col2, col3) INTO NAME metric VALUE val;
```

## Error Handling & Debugging

### Diagnosing Silent Failures

```sql
-- Check for unexpected NULLs after join
SELECT
    COUNT(*) AS total_rows,
    COUNT(b.id) AS matched_rows,
    COUNT(*) - COUNT(b.id) AS unmatched_rows,
    ROUND((COUNT(*) - COUNT(b.id))::NUMERIC / COUNT(*) * 100, 1) AS pct_unmatched
FROM table_a a
LEFT JOIN table_b b ON a.key = b.key;

-- Detect join explosion (row count increases)
SELECT 'before' AS stage, COUNT(*) FROM table_a
UNION ALL
SELECT 'after', COUNT(*) FROM table_a a JOIN table_b b ON a.key = b.key;

-- Check for duplicates in join key
SELECT key, COUNT(*) AS n
FROM table_b
GROUP BY key
HAVING COUNT(*) > 1
ORDER BY n DESC
LIMIT 10;
```

### Data Quality Checks

```sql
-- Completeness profile
SELECT
    column_name,
    COUNT(*) AS total,
    COUNT(column_name) AS non_null,
    COUNT(*) - COUNT(column_name) AS nulls,
    ROUND((COUNT(*) - COUNT(column_name))::NUMERIC / COUNT(*) * 100, 1) AS pct_null,
    COUNT(DISTINCT column_name) AS distinct_values
FROM tbl
-- DuckDB: use UNPIVOT or COLUMNS(*) for all columns at once
-- PostgreSQL: use information_schema.columns + dynamic SQL
;

-- Distribution check
SELECT
    column_name,
    MIN(column_name), MAX(column_name),
    AVG(column_name::NUMERIC),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY column_name) AS median
FROM tbl;

-- Detect timezone issues
SELECT
    MIN(event_time), MAX(event_time),
    COUNT(DISTINCT date_trunc('hour', event_time)) AS distinct_hours
FROM events
WHERE event_date = '2024-03-10';  -- DST transition date
```

### Safe Type Casting

```sql
-- DuckDB: TRY_CAST returns NULL on failure
SELECT TRY_CAST(col AS INTEGER) FROM tbl;

-- PostgreSQL: no TRY_CAST, use CASE
SELECT CASE WHEN col ~ '^\d+$' THEN col::INTEGER END FROM tbl;

-- Snowflake: TRY_CAST or TRY_TO_NUMBER
SELECT TRY_CAST(col AS INTEGER) FROM tbl;
SELECT TRY_TO_NUMBER(col) FROM tbl;

-- BigQuery: SAFE_CAST
SELECT SAFE_CAST(col AS INT64) FROM tbl;
```
