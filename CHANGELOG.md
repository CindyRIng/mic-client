# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- M1: JSON-first supplier search (`POST m.made-in-china.com/search/supplier`), keyword/region/mixed modes,
  32-province dictionary (+ verified Hebei cities), client-side city/audited filtering, page stitching,
  SQLite cache (schema v1, WAL, TTL, stale-while-error), rate limiting + single-flight, CLI
  `search` / `regions` / `cache` / `version` / `config`.
- M2 (in progress): company detail (mobile SSR `ssrData` + HTML supplements), enrichment JSON
  (audit sections / reply rate / contacts / reviews), membership recognition (diamond/gold/unknown + audited).
- M3 (in progress): REST server, MCP server (tools + resources), browser session with Focus Captcha autosolve,
  `mic auth` / `mic serve` / `mic mcp` / `mic doctor`.
- M0: complete documentation baseline (`docs/01-08`, ADRs, research, review report) and GitHub repo.

## [1.0.0] - TBD

- First public release.
