from concurrent.futures import ThreadPoolExecutor
import requests

WORKERS = 16
HEADERS = {"User-Agent": "research bot admin@example.edu"}


def fetch(url):
    return requests.get(url, headers=HEADERS, timeout=30).text


def fetch_all(urls):
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        return list(pool.map(fetch, urls))
