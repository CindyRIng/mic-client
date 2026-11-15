# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

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
