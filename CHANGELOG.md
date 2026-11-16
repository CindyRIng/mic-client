# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [1.0.8] - 2026-11-16

### Added / Fixed
- **Showroom fallback for broken mobile subdomains**: when the mobile subdomain resolves to
  `chrome-error://` (e.g. `sausageclips`), the batch browser fetcher retries
  `https://www.made-in-china.com/showroom/<account>` and parses the desktop page.
- **Duplicate-id cache guard**: accounts sharing the same numeric `company_id` or `encode_com_id`
  previously hit UNIQUE constraint errors and child-table FOREIGN KEY failures; a conflicting id is
  now written as `NULL` for that account so the parent/children always persist.
- Final full Hebei detail run completed: **5008 / 5008 successful, 0 failures, 5008 cached details**
  (mobile 1554 / desktop showroom 3454; diamond 1718 / gold 410 / unknown 2879 / free 1;
  main_products 5007, established_at 968, employees 884, audited=true 2079).
  Total wall ~2h33m including a resumed run after the 2.5h external timeout; avg 2.32s/company.
- README/docs/ADR evidence updated with final full-run coverage and availability numbers.

## [1.0.7] - 2026-11-16

### Added
- **Company-detail coverage for free members**: `parseAnyCompanyHtml()` falls back to desktop
  showroom pages (66% of Hebei suppliers have no mobile `ssrData`), extracting company name,
  address, `Account Registered in` → `since_year`, business type, main products, certifications,
  membership / Audited Supplier badges and `encodeComId`; employees/established date are not
  published there → `null` + `availability=not_provided_by_supplier` (ADR-0009).
- Mobile `ssrData` robustness: missing `comName`/`mainProducts`/`businessTypes` now fall back to
  `<title>` and body labels (real account `transoceanmetal` used to fail with `UPSTREAM_CHANGED`).
- `scripts/e2e/fetch-company-details.mjs`: resumable bulk detail fetcher — browser-direct with
  resource blocking, page reuse/tabs, `prefetched_html` service path, cache skip, one retry.
- `fetchCompanyHtmlBatch()` session helper + detail resource interception; `CompanyService.get`
  accepts internal `prefetched_html`; tests `tests/company/desktop-fallback.test.ts`.
- Docs: ADR-0009, REST/data/operations detail fallbacks and bulk numbers.

### Fixed
- `page.content()` navigation race after CAPTCHA redirect → `INTERNAL_ERROR` (now waits/retries).
- Desktop/free pages previously failed with `UPSTREAM_CHANGED` (no `ssrData`).
- `company_id=''` was written as `0`, causing `companies.company_id` UNIQUE conflicts and child-table
  FOREIGN KEY failures; empty ids now stay `NULL`.
- Batch navigation used `domcontentloaded`, hanging ~15–20s on desktop pages; switched to
  `commit` + content polling (desktop 2–3s, mobile ~1s).

### Measured (2026-11-16, real upstream)
- 40-company sample: `tabs=1` 1.82s/company, `tabs=2` 0.99s, `tabs=3` 0.83s; 100% success.
- 200-company random sample (`tabs=2`): **200/200 success**, 238s, **1.19s/company**,
  5008-company ETA ≈ **99 minutes**; cache replay 0s.
- Sample mix: mobile ssrData 68/200 (34%), desktop showroom 132/200 (66%).
  Availability: main_products 197/200, established_at 45/200, employees 40/200.
- Membership: diamond 82, gold 11, unknown 107.

## [1.0.6] - 2026-11-16

### Added
- **Hebei city dictionary completed**: `Chengde` (承德) added as the 11th verified prefecture-level city,
  so `mic regions --province 河北` / `search --city 承德` / `list_regions` now expose all 11 cities.
- `scripts/e2e/enumerate-province.mjs`: province full-coverage enumerator — sweeps the province keyword
  plus every city keyword (with server-side province filter), unions + dedupes accounts, writes
  `summary.json` / `union.ndjson`. Cache-first on rerun.
- README/docs performance sections updated with the real Hebei numbers.

### Measured (2026-11-16, real upstream)
- Province keyword `hebei`: **1101** (56 pages) — *not* the full province: the JSON search requires a
  `word` and only matches profiles mentioning it.
- 11 prefecture-city keywords: totals **4403** (227 pages).
- **Union after dedupe: 5008 unique suppliers** (4954 non-ad, 54 ad accounts); 605 only in the
  province query, 496 matched multiple city keywords.
- City distribution: Shijiazhuang 1526, Cangzhou 723, Xingtai 593, Baoding 536, Hengshui 508,
  Tangshan 317, Handan 289, Langfang 270, Qinhuangdao 192, Zhangjiakou 27, Chengde 27.
- Time: city queries ~557s cold with `--concurrency 6`; full cold ≈12 min; all-cached replay ~0.2s.

### Changed
- CLI/README/docs examples clarify that single-province "all companies" needs city-keyword splitting;
  `--pages all` / `--concurrency` behavior unchanged.

## [1.0.5] - 2026-11-16

### Added
- **Bulk performance mode** for NDJSON search:
  - `--concurrency <1-8>` pipelines page fetches: the rate limiter still spaces request *starts*
    by 1.5–2.5s, but response waits overlap; pages are emitted in order and `summary.items`
    always matches the emitted `items`. Measured on the full Hebei province (1101 records, 56 pages):
    **311s serial → 147s with `--concurrency 6` (2.1×)**, 113s with tuned rate (800–1200ms).
  - `--pages all` now follows the real `total_page` (≤100) instead of the old 10-page cap.
- NDJSON pages now include ad items by default (`include_ads=true`, consistent with REST/JSON and the
  `summary.items` count); `--exclude-ads` filters them and emits `ADS_FILTERED`.
- README and docs/07 gained a performance section with measured numbers and commands; docs/04
  documents `--concurrency` / dynamic `--pages all`.

### Fixed
- `summary.items` in NDJSON previously counted unfiltered items while `page` events filtered ads
  (1101 vs 1062); now both are consistent.

## [1.0.4] - 2026-11-16

### Added
- `GET /` now redirects (`302`) to `/docs`, so opening the bare base URL
  (`http://127.0.0.1:8899`) shows the API documentation instead of a 404 envelope.
- `mic serve` startup output (human stderr + `--json` event) now includes a `docs_url`;
  operations manual gained a "browser cannot open 8899" troubleshooting entry
  (foreground process must be running; use 127.0.0.1 vs localhost/IPv6; nohup/systemd).

### Changed
- README quick start clarifies that `mic serve` is a foreground process and documents
  background/persistent running (`nohup`, systemd --user).

## [1.0.3] - 2026-11-16

### Changed
- **Default REST port moved from `8787` to `8899`**, because `8787` is commonly occupied by a
  local service (e.g. `tanji`). The port remains configurable via `mic serve --port <n>` /
  `MIC_REST_PORT` / `rest.port`; `--port 0` picks a random free port.
- OpenAPI `servers` URLs, README badges/architecture/examples, all contract docs and ADR links
  now reference `127.0.0.1:8899`; `PORT_IN_USE` still suggests `--port 0`/another port.
- Tests: added a regression assertion for the default port (8899) and the OpenAPI server URL.

## [1.0.2] - 2026-11-16

### Added
- **Self-describing REST docs** (ADR-0008, docs/03 §2.3):
  - `GET /openapi.json` — OpenAPI 3.1 document for the 8 business endpoints (envelopes, schemas,
    parameter enums, error responses), generated in-process from the adapter definitions;
  - `GET /docs` — self-contained HTML documentation page (no CDN/fonts/external scripts, offline-friendly):
    endpoint list, parameter/response tables, generated request examples, filter box, and browser **Try it**
    (relative fetch against the running loopback server);
  - auxiliary endpoints only: no envelope, read-only, no upstream calls, loopback + Host guard applies.
- Docs screenshot in README (`assets/rest-docs.png`), ADR index entry, operations manual notes.

### Changed
- Test suite 244 → 248 (`tests/adapters/openapi.test.ts`: 8-path contract, `$ref` resolution,
  self-contained HTML, Host guard).

## [1.0.1] - 2026-11-16

### Added
- Installed `mic` command: `bin/mic` thin launcher (auto-runs through `~/cloak-env/bin/cloak-run`,
  falls back to plain node with a warning); `npm run build` now sets the executable bit; README/docs
  troubleshooting for `mic: command not found`.

### Fixed
- **Pagination clamp**: `page > total_page` now actually refetches and returns the last-page items
  (`page_clamped=true`), while `pagination.page` keeps echoing the requested page (docs/03 §1.7).
- **Regions JSON**: `mic regions --province X --json` now returns `ProvinceDetailResult`
  (`{province, cities[]}`) like REST/MCP; region data builders are shared by all three entry points.
- **Cache command** now follows docs/04 §2.7.4: `stats --scope`, `clear --scope <list|detail|regions|raw|all>`
  with `--older-than/--key/--dry-run`, and a real `refresh --scope list|detail|regions` (identity args,
  browsers fallback for detail) returning `RefreshResult` data; stats data is byte-compatible with
  `GET /api/cache/stats`.
- **Global option validation**: invalid `--format`, `--verbose + --quiet`, `--no-cache + --refresh`,
  and `--format ndjson` on non-search commands now return `INVALID_PARAM` (exit 2).
- `--timeout` accepts durations (`500ms`/`15s`/`2m`/`1h`/`7d`); `--profile name` resolves under
  `~/.config`-style profiles root; `--no-color` accepted.
- Single-page `mic search --format ndjson` (start/page/summary) implemented per docs/04 §2.5.4.
- **Captcha reliability**: after a wrong puzzle answer the solver reloads to fetch a fresh image and
  retries (live-verified: attempt1 6114 -> reload -> attempt2 0000); company detail now prefers the
  verified browser-rendered HTML fallback when the HTTP path is challenged (no double-solve path).
- CLI no longer crashes with an EPIPE stack trace when piped into `head`/`jq`.
- Tests updated for the corrected contracts (244 still green); live-smoke 7/7 and MCP smoke (15 checks) pass.

## [1.0.0] - 2026-11-16

### Added
- **Search**: JSON-first supplier search (`POST m.made-in-china.com/search/supplier`); keyword / region /
  mixed modes; 32-province dictionary + verified Hebei cities; structured filters (membership, audited,
  business type, revenue, R&D, certification, category); page stitching; client-side city/audited filtering;
  NDJSON streaming (`--pages 1-5`); canonical 22 warning codes.
- **Company detail**: mobile SSR `ssrData` + HTML supplements (employees, address, certifications,
  established year); enrichment JSON (SGS audit sections, reply rate, TradeMessenger contacts, reviews);
  membership recognition (diamond/gold/free/unknown + audited + evidence/confidence); availability reasons;
  SQLite caching with TTL + stale-while-error.
- **Entries**: CLI (10 commands), REST (Fastify, 8 endpoints, loopback-only), MCP stdio (4 tools + 2 resources),
  all sharing one core and the same envelope/error/warning contracts.
- **Resilience**: cookie jar, rate limiting with jitter, single-flight, retries, 302/captcha detection;
  browser session with Focus Captcha autosolve (Sobel/alpha template matching + humanized drag);
  verified-browser HTML fallback when the HTTP path stays challenged; `mic auth` manual fallback;
  `mic doctor` diagnostics.
- **Quality**: 244 automated tests (core/integration/company/adapters), golden fixtures, `live-smoke`
  and `mcp-smoke` scripts; complete documentation baseline (requirements, architecture, REST/CLI/MCP
  contracts, data/cache, tests, operations, roadmap, research, 7 ADRs).
- **Docs & assets**: detailed bilingual-friendly README with AI-generated illustrations (logo/hero/
  architecture/workflow), MIT license, changelog.

### Notes
- First public release. Anonymous public data only; phone/email/WhatsApp are not public on the platform.
- Upstream totals above 2000 and pages above 100 are non-exhaustive by design (explicitly flagged).
- City dictionary currently verified for Hebei (10 cities); other provinces pass through with warnings.
