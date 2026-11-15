#!/usr/bin/env python3
"""HTTP recon matrix using cookies exported from the cloakbrowser session.

Usage: python3 recon/scripts/http_matrix.py
"""
import json
import gzip
import re
import sys
import urllib.request
import urllib.error

ROOT = '/home/songqian/mic-client'
STATE = f'{ROOT}/recon/artifacts/probe5/storage-state.json'
UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/146.0.7680.177.5 Safari/537.36')

ss = json.load(open(STATE))
COOKIES = '; '.join(f"{c['name']}={c['value']}" for c in ss['cookies'])

BASE = 'https://www.made-in-china.com/companysearch.do?subaction=hunt&style=b&mode=and&code=0&order=0&isOpenCorrection=1'

URLS = [
    # city filter guesses on companysearch.do
    ('province-only', f'{BASE}&comProvince=Hebei&word=glass'),
    ('city-guess-comCity', f'{BASE}&comProvince=Hebei&comCity=Langfang&word=glass'),
    ('city-guess-comCity2', f'{BASE}&comProvince=Hebei&city=Langfang&word=glass'),
    ('province-with-city-value', f'{BASE}&comProvince=Langfang&word=glass'),
    ('pure-region', f'{BASE}&comProvince=Hebei&word='),
    ('page2', f'{BASE}&comProvince=Hebei&word=glass&page=2'),
    # company site pages
    ('company-home', 'https://relianceindustry.en.made-in-china.com/'),
    ('company-profile', 'https://relianceindustry.en.made-in-china.com/company-QINGDAO-RISING-STAR-GLASS-CO-LTD.html'),
    ('company-contact', 'https://relianceindustry.en.made-in-china.com/contact-info.html'),
    ('audited-report', 'https://relianceindustry.en.made-in-china.com/audited-supplier-reports/report.html'),
    # SEO search page
    ('seo-province', 'https://www.made-in-china.com/company-search/glass/C1--CP_Hebei/1.html'),
]


def fetch(url, referer='https://www.made-in-china.com/', timeout=40):
    req = urllib.request.Request(url, headers={
        'User-Agent': UA,
        'Cookie': COOKIES,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': referer,
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            if r.headers.get('Content-Encoding') == 'gzip':
                raw = gzip.decompress(raw)
            return r.status, r.geturl(), raw.decode('utf-8', 'ignore')
    except urllib.error.HTTPError as e:
        try:
            body = e.read()
            if e.headers.get('Content-Encoding') == 'gzip':
                body = gzip.decompress(body)
            return e.code, url, body.decode('utf-8', 'ignore')
        except Exception:
            return e.code, url, ''
    except Exception as e:
        return 'ERR', url, str(e)


def analyze(html):
    title = re.search(r'<title>(.*?)</title>', html, re.S)
    cities = re.findall(r'<td class="subject">City/Province:</td>\s*<td>\s*(.*?)\s*</td>', html, re.S)
    cities = [re.sub(r'\s+', ' ', c).strip() for c in cities]
    markers = {
        'captcha_page': bool(re.search(r'Swipe right|not a robot', html)),
        'js_challenge': '__tst_status' in html,
        'list_nodes': html.count('class="list-node"'),
        'province_region_filter': 'Province & Region' in html or 'Province &amp; Region' in html,
        'member_since': 'shop-sign__member-since' in html,
        'diamond_32': 'diamond_32.png' in html,
        'gold_32': 'gold_32.png' in html,
        'year_establishment': bool(re.search(r'Year of Establishment|Year Established', html)),
        'business_type': 'Business Type' in html,
        'employees': 'No. of Employees' in html,
        'main_products': 'Main Products' in html,
    }
    return (title.group(1).strip()[:80] if title else ''), len(html), cities, markers


for name, url in URLS:
    status, final, html = fetch(url)
    title, ln, cities, markers = analyze(html)
    print(f'\n=== {name} [{status}] len={ln} final={final[:100]}')
    print(f'    title: {title}')
    print(f'    cities({len(cities)}): {cities[:8]}')
    print(f'    markers: {markers}')
    if name.startswith('company-') or name in ('seo-province', 'pure-region', 'city-guess-comCity'):
        safe = name
        open(f'{ROOT}/recon/artifacts/probe8/{safe}.html', 'w', encoding='utf-8').write(html)
