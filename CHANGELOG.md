# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

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
