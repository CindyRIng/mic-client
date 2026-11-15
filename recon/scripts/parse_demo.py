#!/usr/bin/env python3
"""Demo: fetch MIC supplier list + company contact pages over HTTP (cookie session from cloakbrowser),
then normalize them into a clean JSON structure. Output: recon/artifacts/sample-normalized.json
"""
import json
import html as htmllib
import re
import urllib.request
import gzip
from pathlib import Path

ROOT = Path('/home/songqian/mic-client')
STATE = ROOT / 'recon/artifacts/probe8/storage-state.json'
OUT = ROOT / 'recon/artifacts/sample-normalized.json'
UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/146.0.7680.177.5 Safari/537.36')

ss = json.loads(STATE.read_text())
COOKIES = '; '.join(f"{c['name']}={c['value']}" for c in ss['cookies'])


COOKIE_JAR = {c['name']: c['value'] for c in ss['cookies']}


def _cookie_header():
    return '; '.join(f'{k}={v}' for k, v in COOKIE_JAR.items())


def fetch(url, referer='https://www.made-in-china.com/'):
    req = urllib.request.Request(url, headers={
        'User-Agent': UA,
        'Cookie': _cookie_header(),
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': referer,
    })
    with urllib.request.urlopen(req, timeout=40) as r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            raw = gzip.decompress(raw)
        for sc in r.headers.get_all('Set-Cookie') or []:
            m = re.match(r'\s*([^=]+)=([^;]*)', sc)
            if m:
                COOKIE_JAR[m.group(1).strip()] = m.group(2).strip()
        return r.geturl(), raw.decode('utf-8', 'ignore')


TAG_RE = re.compile(r'<[^>]+>')
WS_RE = re.compile(r'\s+')


def clean(s):
    s = TAG_RE.sub(' ', s)
    s = htmllib.unescape(s)
    return WS_RE.sub(' ', s).strip()


TIER_BY_CSLEVEL = {'50': 'diamond', '30': 'gold'}


def parse_list(html):
    parts = re.split(r'<div faw-module="suppliers_list" class="list-node">', html)[1:]
    rows = []
    for p in parts:
        row = {}
        m = re.search(r'<h2 class="company-name">\s*<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>', p, re.S)
        if not m:
            continue
        row['company_name'] = clean(m.group(2))
        row['minisite'] = ('https:' + m.group(1)) if m.group(1).startswith('//') else m.group(1)
        m = re.search(r'City/Province:</td>\s*<td>\s*(.*?)\s*</td>', p, re.S)
        if m:
            c = clean(m.group(1))
            if ',' in c:
                city, prov = [x.strip() for x in c.split(',', 1)]
                row['city'], row['province'] = city, prov
            else:
                row['city'], row['province'] = None, c
        m = re.search(r'Main Products:</td>\s*<td>\s*(.*?)</td>', p, re.S)
        row['main_products'] = clean(m.group(1)) if m else None
        row['audited'] = 'alt="Audited Supplier"' in p
        row['stars'] = p.count('icon-new/star-light.png') + p.count('icon-new/star-gray.png') or None
        row['capability_tags'] = [t for t in ['ODM', 'OEM', 'Own Brand'] if re.search(r'>\s*' + re.escape(t) + r'\s*<', p)]
        m = re.search(r'<script type="application/json" class="J-video-json">\s*(\{.*?\})\s*</script>', p, re.S)
        if m:
            try:
                d = json.loads(m.group(1))
                row['cs_level_raw'] = d.get('csLevel')
                row['membership_tier'] = TIER_BY_CSLEVEL.get(str(d.get('csLevel')), 'unknown')
                row['inquiry_url'] = d.get('inquiryUrl')
                row['about_us_url'] = ('https:' + d['aboutUsUrl']) if str(d.get('aboutUsUrl', '')).startswith('//') else d.get('aboutUsUrl')
                kws = json.loads(d.get('keyWordSearch') or '[]')
                row['product_keywords'] = [k.get('word', '').strip() for k in kws]
            except Exception:
                pass
        if 'membership_tier' not in row:
            row['membership_tier'] = 'unknown'
        host_m = re.search(r'https://([a-z0-9-]+)\.en\.made-in-china\.com', row['minisite'])
        row['company_host'] = host_m.group(1) if host_m else None
        rows.append(row)
    return rows


def parse_info_items(html):
    items = {}
    for m in re.finditer(
        r'<div class="info-label">\s*(?:<i[^>]*></i>)?\s*([^<:]+?)\s*:?\s*</div>\s*'
        r'<div class="info-fields">\s*(.*?)\s*</div>', html, re.S):
        label = clean(m.group(1))
        value = clean(m.group(2))
        if label and value:
            items[label] = value
    return items


def parse_contact(html):
    d = {'info': parse_info_items(html)}
    m = re.search(r'class="[^"]*sign-item-text[^"]*">\s*(Diamond|Gold) Member', html)
    if not m:
        m = re.search(r'icon-(diamond|gold)[^>]*>\s*(?:</i>\s*)?(?:<span[^>]*>)?\s*(Diamond|Gold) Member', html)
    tier = None
    if m:
        tier = (m.group(1) or m.group(2)).lower()
    d['membership_tier'] = {'diamond': 'diamond', 'gold': 'gold'}.get(tier or '', 'unknown')
    m = re.search(r'<span class="txt-year">\s*Since (\d{4})', html)
    d['member_since_year'] = int(m.group(1)) if m else None
    m = re.search(r'rating-score-title[^>]*>\s*Rating:\s*</div>\s*<span>.*?(\d+(?:\.\d+)?)/5', html, re.S)
    d['rating'] = float(m.group(1)) if m else None
    m = re.search(r'response-time-title">\s*Average Response Time:\s*</span>.*?J-response-time-data[^>]*>(.*?)</div>', html, re.S)
    d['avg_response_time'] = clean(m.group(1)) or None if m else None
    d['audited'] = 'alt="Audited Supplier"' in html or 'Audited Supplier' in html
    return d


def main():
    query = {
        'keyword': 'glass',
        'province': 'Hebei',
        'city': None,
        'page': 1,
        'url': ('https://www.made-in-china.com/companysearch.do?subaction=hunt&style=b&mode=and'
                '&code=0&comProvince=Hebei&order=0&isOpenCorrection=1&word=glass&page=1'),
    }
    final_url, html = fetch(query['url'])
    rows = parse_list(html)
    print(f'list: {len(rows)} rows from {final_url}')

    # pick demo details: 1 diamond, 1 gold
    picks = []
    for r in rows:
        if r.get('cs_level_raw') == '50' and not any(p.get('cs_level_raw') == '50' for p in picks):
            picks.append(r)
        if r.get('cs_level_raw') == '30' and not any(p.get('cs_level_raw') == '30' for p in picks):
            picks.append(r)
    details = []
    for r in picks:
        contact_url = r['minisite'].rstrip('/') + '/contact-info.html'
        try:
            # warm the company mini-site first: subdomain-scoped cookies are required
            fetch(r['minisite'].rstrip('/') + '/', referer='https://www.made-in-china.com/')
            _, chtml = fetch(contact_url, referer=r['minisite'] + '/')
            d = parse_contact(chtml)
        except Exception as e:
            d = {'error': str(e)}
        d['company_name'] = r['company_name']
        d['company_host'] = r.get('company_host')
        d['list_tier'] = r.get('membership_tier')
        d['contact_url'] = contact_url
        details.append(d)
        print(f"detail: {r['company_name']} -> tier={d.get('membership_tier')} since={d.get('member_since_year')} fields={list(d.get('info', {}).keys())}")

    result = {
        'meta': {
            'source': 'made-in-china.com',
            'captured_at': '2026-11-15T22:40+08:00',
            'note': 'demo normalized output from recon; HTTP session cookies bootstrapped by cloakbrowser',
        },
        'query': query,
        'total_rows_on_page': len(rows),
        'companies': rows,
        'company_details': details,
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print('saved:', OUT)


if __name__ == '__main__':
    main()
