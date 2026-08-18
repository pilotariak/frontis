# Changelog

## [0.7.0](https://github.com/pilotariak/frontis/compare/frontis-v0.6.0...frontis-v0.7.0) (2026-08-18)


### 🚀 Features

* **agent-workflows:** remove repo assist ([#58](https://github.com/pilotariak/frontis/issues/58)) ([ca5e8a0](https://github.com/pilotariak/frontis/commit/ca5e8a0bce244cd772df04856494d3ea4d828768))
* **agentic-workflows:** Naming ([#61](https://github.com/pilotariak/frontis/issues/61)) ([a79f171](https://github.com/pilotariak/frontis/commit/a79f17187310563dc5eae05f44696d3912234d29))
* **ci:** harden github actions supply chain security ([#53](https://github.com/pilotariak/frontis/issues/53)) ([bc7a86c](https://github.com/pilotariak/frontis/commit/bc7a86cad631d4b4355f585ec9572a0fff695558)), closes [#32](https://github.com/pilotariak/frontis/issues/32)
* **gateway:** add categories subgraph to landing page ([#48](https://github.com/pilotariak/frontis/issues/48)) ([a0022ab](https://github.com/pilotariak/frontis/commit/a0022ab27d4baad7d2587d56ec973a53c5ab8c74))


### 🐛 Bug Fixes

* **agent-workflows:** compile workflows ([#57](https://github.com/pilotariak/frontis/issues/57)) ([3c8cd39](https://github.com/pilotariak/frontis/commit/3c8cd39bcaa69d7b73b6a8dc8c4e92a2eb88a6b9))
* **doc:** OpenSSF repository path ([#52](https://github.com/pilotariak/frontis/issues/52)) ([7f26ab1](https://github.com/pilotariak/frontis/commit/7f26ab104a3a9d0f3cf3098cf9553651a403e136))


### 📚 Documentation

* add AGENTS.md for AI agent context ([#64](https://github.com/pilotariak/frontis/issues/64)) ([5ac1f7c](https://github.com/pilotariak/frontis/commit/5ac1f7c32dbb22ef91bfcdc7cf249677a5fa012c))
* **architecture:** add categories subgraph and update gateway config ([#50](https://github.com/pilotariak/frontis/issues/50)) ([beb9db8](https://github.com/pilotariak/frontis/commit/beb9db8dea638a2fac3182039201b10949bcd13d))
* update CII Best Practices and Scorecards ([#51](https://github.com/pilotariak/frontis/issues/51)) ([a113fb7](https://github.com/pilotariak/frontis/commit/a113fb7985bf735b56873f333190b180ba8b061c))

## [0.6.0](https://github.com/pilotariak/frontis/compare/frontis-v0.5.0...frontis-v0.6.0) (2026-04-16)


### 🚀 Features

* add setup-league worker and league database management ([#41](https://github.com/pilotariak/frontis/issues/41)) ([eb28ab2](https://github.com/pilotariak/frontis/commit/eb28ab2aa4b79cbca671c1a8131a86e03506f843))
* bootstrap data with categories subgraph and competition schema ([#35](https://github.com/pilotariak/frontis/issues/35)) ([4f3ebac](https://github.com/pilotariak/frontis/commit/4f3ebacabe4221d5b7e0e5e765ce0eae6331424e))
* **ctpb:** add ctpb league support ([#43](https://github.com/pilotariak/frontis/issues/43)) ([f3f8364](https://github.com/pilotariak/frontis/commit/f3f83643e7524eaa31ddfbb8165e5bd2daefe279)), closes [#39](https://github.com/pilotariak/frontis/issues/39)
* **scheduler:** refactor scrape_results to use db ids and add no_color param ([#36](https://github.com/pilotariak/frontis/issues/36)) ([a4ea2d8](https://github.com/pilotariak/frontis/commit/a4ea2d80638a9dc3aaceb13aae6a10e244ddf18e))
* **setup-league:** add /version, /init, and /bootstrap endpoints ([#42](https://github.com/pilotariak/frontis/issues/42)) ([8061c0a](https://github.com/pilotariak/frontis/commit/8061c0ac3938ae7ab843963bc72f4748236e2eff))
* **workers:** add shared d1 state, scraper endpoints, and competitions schema ([#34](https://github.com/pilotariak/frontis/issues/34)) ([73378b0](https://github.com/pilotariak/frontis/commit/73378b09aaf13477479e63502b2d2ea62d06e776))


### 🐛 Bug Fixes

* **scheduler:** fix multi-set score parsing and refactor result output ([#45](https://github.com/pilotariak/frontis/issues/45)) ([f09193d](https://github.com/pilotariak/frontis/commit/f09193d1f10694a53b8b8cc2206bb638f1435912))
* **setup-league:** prime php session before scraping form options ([#44](https://github.com/pilotariak/frontis/issues/44)) ([484c377](https://github.com/pilotariak/frontis/commit/484c3774b55222c57fc0f4436f173b0b9ef2f6d9)), closes [#39](https://github.com/pilotariak/frontis/issues/39)


### 🚨 Maintenance

* update changelog ([936a5bb](https://github.com/pilotariak/frontis/commit/936a5bb993cdfc146429c187ba595180483d4473))


### 📚 Documentation

* update api docs and supergraph for scores field rename ([#46](https://github.com/pilotariak/frontis/issues/46)) ([342511a](https://github.com/pilotariak/frontis/commit/342511ac858f013d5373fece2bb9292a7a656058))

## [0.5.0](https://github.com/pilotariak/frontis/compare/frontis-v0.4.0...frontis-v0.5.0) (2026-03-17)


### 🚀 Features

* add federation subgraphs, gateway, and api documentation ([#1](https://github.com/pilotariak/frontis/issues/1)) ([04073f4](https://github.com/pilotariak/frontis/commit/04073f48f11ae8a9fd1902d5231e3b93cd747df2))
* add results and specialties subgraphs ([#7](https://github.com/pilotariak/frontis/issues/7)) ([8ae739f](https://github.com/pilotariak/frontis/commit/8ae739f714a37d3e45216bae57d6036aeaf1832e))
* **echo:** add echo subgraph with version query ([#2](https://github.com/pilotariak/frontis/issues/2)) ([cd98a9f](https://github.com/pilotariak/frontis/commit/cd98a9f94bdb0221c7192bc6aa00330fa243cb33))
* **gateway:** add query cost analysis for demand control ([#28](https://github.com/pilotariak/frontis/issues/28)) ([b9063a6](https://github.com/pilotariak/frontis/commit/b9063a6056e1bcdd6b50145afa66ee5bdeb1cb2b)), closes [#9](https://github.com/pilotariak/frontis/issues/9)
* **gateway:** add structured logging and error masking ([#27](https://github.com/pilotariak/frontis/issues/27)) ([7110ec8](https://github.com/pilotariak/frontis/commit/7110ec8c5b90b7446273e64c70572b3634b8a43d)), closes [#13](https://github.com/pilotariak/frontis/issues/13)
* **gateway:** configure hive registry and cloudflare service bindings ([#21](https://github.com/pilotariak/frontis/issues/21)) ([0e1c9f3](https://github.com/pilotariak/frontis/commit/0e1c9f3edf29bcf2fe6f739674af4e926032059a)), closes [#20](https://github.com/pilotariak/frontis/issues/20)
* **otel:** integrate OpenTelemetry observability across gateway and subgraphs ([#18](https://github.com/pilotariak/frontis/issues/18)) ([df0b583](https://github.com/pilotariak/frontis/commit/df0b58327bc7b52371d47a5e56eca58619dbe528)), closes [#14](https://github.com/pilotariak/frontis/issues/14)
* **scheduler:** add cloudflare workers scheduler with D1 scraping ([#5](https://github.com/pilotariak/frontis/issues/5)) ([8c038d4](https://github.com/pilotariak/frontis/commit/8c038d40012dce4fc2df118cabb1afa931fc84f0))


### 🐛 Bug Fixes

* **clubs:** remove city field not present in D1 schema ([#6](https://github.com/pilotariak/frontis/issues/6)) ([20698e6](https://github.com/pilotariak/frontis/commit/20698e65b23119d5026dfed2e9a7b325d2f82475))
* **release:** sync package version and use node release type ([#29](https://github.com/pilotariak/frontis/issues/29)) ([e7d7a46](https://github.com/pilotariak/frontis/commit/e7d7a46ed933834471fdcff249a62eab482afc6c))


### 🚨 Maintenance

* initial project setup ([9988c24](https://github.com/pilotariak/frontis/commit/9988c240a5db46cc69a742265cf0be6ed1856531))


### 📚 Documentation

* **docs:** add diataxis documentation structure ([#25](https://github.com/pilotariak/frontis/issues/25)) ([fb48cba](https://github.com/pilotariak/frontis/commit/fb48cba02a74e622dafea78f16d3a1704975a2e5))

## [0.4.0](https://github.com/pilotariak/frontis/compare/v0.3.0...v0.4.0) (2026-03-17)

### 🚀 Features

- **gateway:** add query cost analysis for demand control ([#28](https://github.com/pilotariak/frontis/issues/28)) ([b9063a6](https://github.com/pilotariak/frontis/commit/b9063a6056e1bcdd6b50145afa66ee5bdeb1cb2b)), closes [#9](https://github.com/pilotariak/frontis/issues/9)
- **gateway:** add structured logging and error masking ([#27](https://github.com/pilotariak/frontis/issues/27)) ([7110ec8](https://github.com/pilotariak/frontis/commit/7110ec8c5b90b7446273e64c70572b3634b8a43d)), closes [#13](https://github.com/pilotariak/frontis/issues/13)
- **gateway:** add per-field rate limiting to GraphQL gateway ([#26](https://github.com/pilotariak/frontis/pull/26) ([9db61e8](https://github.com/pilotariak/frontis/commit/9db61e8c2f9f80ed657b3c6ead17fe9b6028cf3b)), closes [#8](https://github.com/pilotariak/frontis/issues/8)
- **gateway** add query limits and KV supergraph cache ([#24](https://github.com/pilotariak/frontis/pull/24) ([54348a7](https://github.com/pilotariak/frontis/commit/54348a713bfd26cf2f3f7c1cc4d3f51e8d7a0c7d)), closes [#11](https://github.com/pilotariak/frontis/issues/11) [#12](https://github.com/pilotariak/frontis/issues/12)
- **gateway:** configure hive registry and cloudflare service bindings ([#21](https://github.com/pilotariak/frontis/issues/21)) ([0e1c9f3](https://github.com/pilotariak/frontis/commit/0e1c9f3edf29bcf2fe6f739674af4e926032059a)), closes [#20](https://github.com/pilotariak/frontis/issues/20)

### 📚 Documentation

- **docs:** add diataxis documentation structure ([#25](https://github.com/pilotariak/frontis/issues/25)) ([fb48cba](https://github.com/pilotariak/frontis/commit/fb48cba02a74e622dafea78f16d3a1704975a2e5))

## [0.3.0](https://github.com/pilotariak/frontis/compare/v0.2.0...v0.3.0) (2026-03-14)

### 🚀 Features

- **otel:** integrate OpenTelemetry observability across gateway and subgraphs ([#18](https://github.com/pilotariak/frontis/issues/18)) ([df0b583](https://github.com/pilotariak/frontis/commit/df0b58327bc7b52371d47a5e56eca58619dbe528)), closes [#14](https://github.com/pilotariak/frontis/issues/14)

## [0.2.0](https://github.com/pilotariak/frontis/compare/v0.1.0...v0.2.0) (2026-03-13)

### 🚀 Features

- add federation subgraphs, gateway, and api documentation ([#1](https://github.com/pilotariak/frontis/issues/1)) ([04073f4](https://github.com/pilotariak/frontis/commit/04073f48f11ae8a9fd1902d5231e3b93cd747df2))
- add results and specialties subgraphs ([#7](https://github.com/pilotariak/frontis/issues/7)) ([8ae739f](https://github.com/pilotariak/frontis/commit/8ae739f714a37d3e45216bae57d6036aeaf1832e))
- **echo:** add echo subgraph with version query ([#2](https://github.com/pilotariak/frontis/issues/2)) ([cd98a9f](https://github.com/pilotariak/frontis/commit/cd98a9f94bdb0221c7192bc6aa00330fa243cb33))
- **scheduler:** add cloudflare workers scheduler with D1 scraping ([#5](https://github.com/pilotariak/frontis/issues/5)) ([8c038d4](https://github.com/pilotariak/frontis/commit/8c038d40012dce4fc2df118cabb1afa931fc84f0))

### 🐛 Bug Fixes

- **clubs:** remove city field not present in D1 schema ([#6](https://github.com/pilotariak/frontis/issues/6)) ([20698e6](https://github.com/pilotariak/frontis/commit/20698e65b23119d5026dfed2e9a7b325d2f82475))

### 🚨 Maintenance

- initial project setup ([9988c24](https://github.com/pilotariak/frontis/commit/9988c240a5db46cc69a742265cf0be6ed1856531))
