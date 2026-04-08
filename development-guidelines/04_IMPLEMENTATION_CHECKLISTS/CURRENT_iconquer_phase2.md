# CURRENT: iConquer Phase 2 — IconquerAI + IconquerMCP + IconquerCLI (v0.2.0)

**Design proposal:** `02_IMPLEMENTATION_PLANS/UPCOMING/2026-04-08_iconquer_phase2_AI_CLI_SwiftUI.md`
**Status:** APPROVED (Revision 3, 2026-04-08)
**Predecessor:** Phase 1 — `IconquerCore@v0.1.0` shipped 2026-04-08
**Workflow:** Design-First TDD (DESIGN → RED → GREEN → REFACTOR → DOCUMENT → VERIFY)

---

## Step 1 — `IconquerCore@v0.2.0`: GameMove + Game.apply ✅ DONE 2026-04-08

Adds the action enum we deferred from Phase 1 + a thin dispatcher. Purely additive — all 20 existing parity fixtures must continue to pass unchanged.

- [x] **DESIGN:** Confirmed `GameMove` case set — one case per public mutating method, with player IDs elided in favor of `currentPlayerId`
- [x] **RED:** 3 focused tests in `GameMoveTests.swift`: apply parity for fixtures 03 + 05, plus Codable round-trip
- [x] **GREEN:** `Sources/IconquerCore/Rules/GameMove.swift` + `Game.apply(_:)` dispatcher
- [x] **VERIFY:** 23/23 tests passing (20 Phase 1 fixtures + 3 new GameMove tests), zero warnings
- [x] **DOCUMENT:** DocC on `GameMove` and `Game.apply(_:)`, DocC build still clean
- [x] **TAG:** `IconquerCore@v0.2.0` (tagged 2026-04-08)
- [x] **BONUS:** Fixed a Phase 1 latent bug in `pickCountry`'s rotation (was using `nextAlivePlayer` which skips empty-country players, getting stuck on player 0 during pickCountries phase). New `rotateToNextPlayer` mirrors the TS reference's `selectNextAlivePlayer`. Surfaced by the new GameMove tests; fixed in the same commit.

---

## Step 2 — Bootstrap `IconquerAI` sibling repo

- [ ] `git init` `../IconquerAI/`
- [ ] `Package.swift` (Swift 6.2, OS 26 platforms, `IconquerCore` from local path)
- [ ] Smoke test
- [ ] Vendored `development-guidelines/`
- [ ] Initial commit

---

## Step 3 — `PlayerStrategy` protocol + `RandomStrategy`

- [ ] **RED:** Test that `RandomStrategy(seed: 42)` produces a known `[GameMove]` for a given `Game` state
- [ ] **GREEN:** Implement `PlayerStrategy` (async) + `RandomStrategy`
- [ ] Deterministic under fixed seed

---

## Step 4 — `GreedyStrategy`

- [ ] **RED:** Test that `GreedyStrategy` picks the strongest border country for income placement
- [ ] **GREEN:** Implement
- [ ] Deterministic under fixed seed

---

## Step 5 — Round-trip integration test → tag `IconquerAI@v0.1.0`

- [ ] **RED:** `RandomStrategy` vs `RandomStrategy` plays a full game to victory under fixed seed
- [ ] **GREEN:** Driver loop in tests
- [ ] Snapshot the final state into a fixture
- [ ] Tag `IconquerAI@v0.1.0`

---

## Step 6 — Bootstrap `IconquerMCP` sibling repo

- [ ] `git init` `../IconquerMCP/`
- [ ] `Package.swift` declaring `IconquerCore` (local) + `SwiftMCPServer` (remote)
- [ ] Smoke test
- [ ] Vendored `development-guidelines/`
- [ ] Initial commit

---

## Step 7 — `GameSession` actor

- [ ] **RED:** Test actor-isolated reads and mutations against a known `Game` state
- [ ] **GREEN:** Implement

---

## Step 8 — `PlayerIdentityStore` actor

- [ ] **RED:** Test session-token → `PlayerId` mapping with hand-crafted token/player pairs
- [ ] **GREEN:** Implement

---

## Step 9 — Read-only MCP tools

For each tool: RED → GREEN with a `MockMCPClient` test.

- [ ] `get_game_state`
- [ ] `get_map`
- [ ] `get_my_player`
- [ ] `get_pending_input`
- [ ] `get_legal_moves`
- [ ] `get_best_cards_to_turn_in`
- [ ] `get_income_for_countries`

---

## Step 10 — Mutating MCP tools

For each tool: RED → GREEN, asserts both response shape and resulting `Game` state.

- [ ] `pick_country`
- [ ] `place_armies`
- [ ] `attack`
- [ ] `finish_attack_phase`
- [ ] `begin_fortify_from`
- [ ] `finish_turn`
- [ ] `turn_in_cards`
- [ ] `resolve_card_turn_in`

---

## Step 11 — Out-of-turn validation

- [ ] **RED:** Test that calling `place_armies` from the wrong player returns JSON-RPC error `-32000 "not your turn"`
- [ ] **GREEN:** Implement turn-validation guard in the dispatcher

---

## Step 12 — MCP resources

- [ ] `iconquer://game/state`
- [ ] `iconquer://game/map`
- [ ] `iconquer://game/history`
- [ ] `iconquer://game/rules`

---

## Step 13 — `iconquer-mcp` executable wrapper

- [ ] **RED:** End-to-end test that wires `MCPServer.builder()` and runs a tool via `MockMCPClient`
- [ ] **GREEN:** Implement the wrapper

---

## Step 14 — End-to-end MCP fixture (stdio)

- [ ] Scripted MCP session driving a full short game (mirrors Phase 1 fixture 12 but via MCP tool calls)
- [ ] Snapshot locked into fixture file

---

## Step 15 — HTTP transport smoke test → tag `IconquerMCP@v0.1.0`

- [ ] **RED:** Boot server on a random port, generate API key, connect with it, call read-only tool, refuse wrong key
- [ ] **GREEN:** Verify SwiftMCPServer wiring
- [ ] Tag `IconquerMCP@v0.1.0`

---

## Step 16 — Bootstrap `IconquerCLI` sibling repo

- [ ] `git init` `../IconquerCLI/`
- [ ] `Package.swift` with `IconquerCore` + `IconquerAI` + `swift-argument-parser`
- [ ] Homebrew provisions §5.7 (stable binary product name, `--version`, `Formula/iconquer-cli.rb` template, release-mode build verified)
- [ ] Vendored `development-guidelines/`
- [ ] Initial commit

---

## Step 17 — `CLISettings` + `config` subcommand

- [ ] **RED:** Test settings file round-trip + `config get/set/reset/path`
- [ ] **GREEN:** Implement
- [ ] XDG-compliant location (`~/.config/iconquer-cli/settings.json`)

---

## Step 18 — `Renderer` + `--width` flag

- [ ] **RED:** Given a fixed `GameSnapshot`, the renderer produces a known stable string
- [ ] **GREEN:** Implement width-parameterised ANSI renderer
- [ ] Auto-detect via `TIOCGWINSZ` when `width == 0`
- [ ] `--ascii` and `--no-color` opt-outs

---

## Step 19 — Command grammar parser

- [ ] **RED:** Every command grammar example parses correctly; garbage produces good errors
- [ ] **GREEN:** Implement

---

## Step 20 — `simulate` subcommand

- [ ] **RED:** `simulate --p1 random --p2 random --seed 42` produces a byte-stable transcript
- [ ] **GREEN:** Implement
- [ ] Transcript fixture locked into tests

---

## Step 21 — `play` subcommand

- [ ] **RED:** Scripted stdin via piped input drives a known game outcome
- [ ] **GREEN:** Implement interactive REPL

---

## Step 22 — `replay` subcommand

- [ ] **RED:** Reading a transcript file reproduces the simulated game state at each step
- [ ] **GREEN:** Implement

---

## Step 23 — `tournament` subcommand

- [ ] **RED:** `tournament --strategies random,greedy --rounds 100 --seed-base 42` produces a known win matrix
- [ ] **GREEN:** Implement aggregation logic
- [ ] §6.5 sanity gates checked during implementation; raise issue if violated

---

## Step 24 — DocC + README + `--version` → tag `IconquerCLI@v0.1.0`

- [ ] DocC catalog with `Playing the CLI` and `Tournament Mode` articles
- [ ] README with quickstart
- [ ] `--version` prints versions of all linked packages
- [ ] Tag `IconquerCLI@v0.1.0` = **Phase 2 v0.2.0 ship**

---

## Step 25 — Phase 2 v0.2.0 completion summary

- [ ] Write summary in `iconquer/development-guidelines/05_SUMMARIES/`
- [ ] Move this checklist to `04_99_COMPLETED/`
- [ ] Begin separate Phase 2 v0.3.0 work (`IconquerApp` SwiftUI shell + certified networked-multiplayer)
