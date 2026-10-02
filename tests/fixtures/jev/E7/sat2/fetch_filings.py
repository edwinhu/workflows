from concurrent.futures import ThreadPoolExecutor
import time
import requests

# SEC fair access: at most 10 requests/second per host, documented at
# https://www.sec.gov/os/accessing-edgar-data
SEC_CEILING_RPS = 10
WORKERS = 4
SLEEP_S = 0.5
EFFECTIVE_RPS = WORKERS / SLEEP_S  # 8 req/s, under the ceiling
HEADERS = {"User-Agent": "research bot admin@example.edu"}


def fetch(url):
    r = requests.get(url, headers=HEADERS, timeout=30)
    if r.status_code == 429:
        time.sleep(int(r.headers.get("Retry-After", 60)))
        r = requests.get(url, headers=HEADERS, timeout=30)
    time.sleep(SLEEP_S)
    return r.text


def fetch_all(urls):
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        return list(pool.map(fetch, urls))
