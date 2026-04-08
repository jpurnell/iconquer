# CURRENT: iConquer Phase 2 — IconquerMatch + IconquerAI + IconquerMCP + IconquerCLI (v0.2.0)

**Design proposals:**
- `02_IMPLEMENTATION_PLANS/UPCOMING/2026-04-08_iconquer_phase2_AI_CLI_SwiftUI.md` (master, Revision 4)
- `02_IMPLEMENTATION_PLANS/UPCOMING/MultiAgentPlayerBinding.md` (the IconquerMatch design — APPROVED 2026-04-08)

**Status:** APPROVED (Revision 4, 2026-04-08)
**Predecessor:** Phase 1 — `IconquerCore@v0.1.0` shipped 2026-04-08
**Workflow:** Design-First TDD (DESIGN → RED → GREEN → REFACTOR → DOCUMENT → VERIFY)

---

## Step 1 — `IconquerCore@v0.2.0`: GameMove + Game.apply ✅ DONE 2026-04-08

Adds the action enum we deferred from Phase 1 + a thin dispatcher. Purely additive — all 20 existing parity fixtures continue to pass unchanged.

- [x] **DESIGN:** Confirmed `GameMove` case set — one case per public mutating method, with player IDs elided in favor of `currentPlayerId`
- [x] **RED:** 3 focused tests in `GameMoveTests.swift`: apply parity for fixtures 03 + 05, plus Codable round-trip
- [x] **GREEN:** `Sources/IconquerCore/Rules/GameMove.swift` + `Game.apply(_:)` dispatcher
- [x] **VERIFY:** 23/23 tests passing, zero warnings
- [x] **DOCUMENT:** DocC on `GameMove` and `Game.apply(_:)`, DocC build still clean
- [x] **TAG:** `IconquerCore@v0.2.0` (tagged 2026-04-08)
- [x] **BONUS:** Fixed a Phase 1 latent bug in `pickCountry`'s rotation. New `rotateToNextPlayer` mirrors the TS reference's `selectNextAlivePlayer`.

---

## Step 2 — Bootstrap `IconquerAI` sibling repo ✅ DONE 2026-04-08

- [x] `git init` `../IconquerAI/`
- [x] `Package.swift` (Swift 6.2, OS 26 platforms, `IconquerCore` from local path, swift-docc-plugin)
- [x] Smoke test (2/2 passing — package version + IconquerCore reachability)
- [x] Vendored `development-guidelines/` (clean copy from IconquerCore)
- [x] `00_CORE_RULES/00_MASTER_PLAN.md` customised for IconquerAI
- [x] `.gitignore` for `.build/`, `.swiftpm/`, `Package.resolved`, etc.
- [x] Initial commit `IconquerAI@a6b0926`

---

## Step 3 — `PlayerStrategy` protocol + `RandomStrategy` ⚠️ SHIPPED but RESHAPED in Step 5b

Original Step 3 — async `PlayerStrategy` protocol with three batched methods, plus `RandomStrategy` actor — was completed and merged at `IconquerAI@e461f7d` (5/5 tests passing). However, the **MultiAgentPlayerBinding proposal** approved on 2026-04-08 supersedes `PlayerStrategy` with `PlayerAgent` (single-move-per-call, deadlined, audit-logged). This work is **reshaped**, not reverted — the internal logic (random valid move selection, sorted-for-determinism enumeration, local-Game-copy turn planning) is reusable. See Step 5b below.

- [x] **DESIGN:** async protocol with three methods returning `[GameMove]`
- [x] **RED:** 5 tests in `RandomStrategyTests.swift`
- [x] **GREEN:** `PlayerStrategy.swift` + `RandomStrategy.swift`
- [x] Deterministic under fixed seed (verified)
- [x] IconquerAI commit `e461f7d`
- [ ] **SUPERSEDED:** `PlayerStrategy.swift` will be deleted in Step 5b; `RandomStrategy.swift` will be rewritten as `RandomAgent.swift` conforming to `PlayerAgent`. Tests rewritten.

---

## Step 4 — `IconquerCore@v0.3.0`: GameSnapshot.hash() + Game.legalMoves ✅ DONE 2026-04-08

- [x] **DESIGN:** `GameSnapshot.hash()` uses FNV-1a 64-bit over sorted-keys JSON. Zero new dependencies. Returns 16-char lowercase hex.
- [x] **DESIGN:** `Game.legalMoves(for:)` returns one canonical move per legal action; `placeArmies` count is always `unallocatedArmies` (no cross product).
- [x] **RED:** 5 tests in `SnapshotHashTests.swift` (determinism, hex format, Codable round-trip, mutation changes hash, structural equality)
- [x] **RED:** 7 tests in `LegalMovesTests.swift` (pickCountries, out-of-turn, initializeArmies, play.assignArmies, play.attack, forced card turn-in, victory)
- [x] **GREEN:** `Sources/IconquerCore/Model/SnapshotHash.swift` + `Game.legalMoves(for:)` in `Game.swift`
- [x] **VERIFY:** 35/35 tests passing (23 v0.2.0 + 12 new), zero warnings
- [x] **DOCUMENT:** DocC on both methods, DocC build clean
- [x] **TAG:** `IconquerCore@v0.3.0` (commit `d687916`)

---

## Step 5 — Bootstrap `IconquerMatch` sibling repo ✅ DONE 2026-04-08

- [x] `git init ../IconquerMatch/`
- [x] `Package.swift` (Swift 6.2, OS 26 platforms, IconquerCore@v0.3.0 from local path, swift-docc-plugin)
- [x] Smoke test (2/2 passing)
- [x] Vendored `development-guidelines/` (clean copy from IconquerCore)
- [x] Customised `00_MASTER_PLAN.md`
- [x] `.gitignore` (incl. Emacs lock file patterns)
- [x] Initial commit `IconquerMatch@17f84db`

---

## Step 5a — `IconquerMatch` core types ✅ DONE 2026-04-08

Per `MultiAgentPlayerBinding.md` §3. All six types + `MatchResult` landed in one focused pass with 15 new tests covering Codable round-trips, default values, value semantics, error case construction, a stub `PlayerAgent` conformance, and `SeatBinding` construction. 17/17 IconquerMatch tests passing. Commit: `IconquerMatch@72b0b0f`.

- [x] **`AgentIdentity`** (struct, Codable, Hashable) — kind / displayName / version / promptFingerprint / metadata
- [x] **`SeatBinding`** (struct, holds `agent: any PlayerAgent`, `timeout`, `fallback`) — `FallbackPolicy` enum: forfeitTurn / randomLegalMove(seed:) / abortMatch
- [x] **`MatchSettings`** (struct, all tunables, no magic numbers) — 8 fields
- [x] **`AgentError`** + **`MatchError`** enums (Sendable, Hashable)
- [x] **`MoveRecord`** (struct, Codable — turn, seat, agent identity, move, state-hash-before, latency, fallback flag, reasoning, reasoningTruncated)
- [x] **`PlayerAgent`** protocol (Sendable, async `requestMove(state:seat:deadline:)`, default-no-op `matchDidEnd(result:)`)
- [x] **`MatchResult`** (added — final outcome yielded after the last move; struct, Codable)

---

## Step 5b — `IconquerAI` reshape: `RandomAgent` + `GreedyAgent` as `PlayerAgent`

Per Revision 4 §4.0.5. Not a rewrite — internal logic reused.

- [ ] **Add `IconquerMatch` dependency** to `IconquerAI/Package.swift`
- [ ] **Delete** `Sources/IconquerAI/PlayerStrategy.swift`
- [ ] **Rewrite** `Sources/IconquerAI/RandomStrategy.swift` → `RandomAgent.swift`:
  - `actor RandomAgent: PlayerAgent` with internal `SeededRNG` and a cached move queue
  - `requestMove` plans one move at a time (or refills the queue once per turn)
  - Same internal "random valid move" logic as Step 3
- [ ] **Rewrite** `Tests/IconquerAITests/RandomStrategyTests.swift` → `RandomAgentTests.swift`:
  - Test that `requestMove` returns one move per call
  - Test that successive calls drain a turn correctly
  - Test that hitting `.finishTurn` advances the seat
  - Determinism under fixed seed
- [ ] **NEW:** `GreedyAgent.swift` — strongest-border-stack heuristic
- [ ] **NEW:** `GreedyAgentTests.swift`

---

## Step 6 — `IconquerMatch.MatchRunner` actor ✅ DONE 2026-04-08

The turn pump. Drives `[SeatBinding]` to completion.

- [ ] **RED:** Test runner with 2 deterministic stub agents on a 2-country game
- [ ] **GREEN:** Implement `MatchRunner.run() -> AsyncThrowingStream<MoveRecord, Error>`
- [ ] **RED:** Test runner with mixed agents (1 scripted + 1 stub MCP-style)
- [ ] **GREEN:** Cross-agent dispatch
- [ ] **RED:** Timeout test using `SlowAgent` past deadline
- [ ] **GREEN:** Per-seat timeout enforcement + `FallbackPolicy.randomLegalMove`
- [ ] **RED:** Illegal move test using `CheatingAgent`
- [ ] **GREEN:** Move validation against `Game.legalMoves` + fallback or abort
- [ ] **RED:** State-hash staleness test
- [ ] **GREEN:** Reject stale-hash submissions
- [ ] **RED:** Replay test — feed recorded `[MoveRecord]` log into a stub-agent runner
- [ ] **GREEN:** Replay support

---

## Step 7 — `IconquerMatch.HumanAgent` reference impl

Backed by an `AsyncStream<GameMove>`. Tests can drive a "human" without an app layer.

- [ ] **RED:** Test feeds moves into the stream, asserts each is returned by `requestMove`
- [ ] **GREEN:** Implement
- [ ] DocC

---

## Step 8 — `IconquerMatch.MockLLMAgent` test helper

Returns scripted JSON-style responses parsed into `GameMove`. Used by IconquerMCP tests too.

- [ ] **RED:** Test that scripted responses produce the expected moves
- [ ] **GREEN:** Implement
- [ ] Re-export from test target so downstream packages can use it

---

## Step 9 — IconquerMatch round-trip integration test → tag `IconquerMatch@v0.1.0`

- [ ] **RED:** 4 scripted agents play a deterministic match; full `MoveRecord` log is byte-stable across runs with fixed seeds
- [ ] **GREEN:** Driver loop + golden JSON fixture
- [ ] DocC catalog with `MultiAgentMatchesGuide.md` article
- [ ] Tag `IconquerMatch@v0.1.0`

---

## Step 10 — `IconquerAI@v0.1.0` round-trip + tag

- [ ] **RED:** `RandomAgent` vs `RandomAgent` plays a full game to victory via `MatchRunner` under fixed seed
- [ ] **GREEN:** Driver loop in tests
- [ ] Snapshot the final state into a fixture
- [ ] Tag `IconquerAI@v0.1.0`

---

## Step 11 — Bootstrap `IconquerMCP` sibling repo

- [ ] `git init ../IconquerMCP/`
- [ ] `Package.swift` declaring `IconquerCore` (local) + `IconquerMatch` (local) + `SwiftMCPServer` (remote)
- [ ] Smoke test
- [ ] Vendored `development-guidelines/`
- [ ] Initial commit

---

## Step 12 — `GameSession` actor

Wraps a single `Game` + `MatchRunner` instance, provides actor-isolated reads and submission.

- [ ] **RED:** Test actor-isolated reads and mutations against a known `Game` state
- [ ] **GREEN:** Implement

---

## Step 13 — `PlayerIdentityStore` actor

Maps MCP session tokens (stdio peer ID or HTTP API key) to `PlayerId`. Persists via SwiftMCPServer's keystore.

- [ ] **RED:** Test session-token → `PlayerId` mapping with hand-crafted token/player pairs
- [ ] **GREEN:** Implement

---

## Step 14 — Read-only MCP tools

For each tool: RED → GREEN with a `MockMCPClient` test.

- [ ] `iconquer_get_state` (returns snapshot + hash + legal moves for the caller)
- [ ] `get_map`
- [ ] `get_my_player`
- [ ] `get_pending_input`
- [ ] `get_legal_moves`
- [ ] `get_best_cards_to_turn_in`
- [ ] `get_income_for_countries`

---

## Step 15 — Mutating MCP tools

For each tool: RED → GREEN, asserts both response shape and resulting `Game` state. Mutating tools include the state hash check from `MultiAgentPlayerBinding.md` §4.

- [ ] `iconquer_submit_move` (the unified tool — takes `move`, `state_hash`, `seat_id`, `match_id`, `turn`, optional `reasoning`)
- [ ] (If splitting) Per-action tools: `pick_country`, `place_armies`, `attack`, etc.

---

## Step 16 — `MCPAgent: PlayerAgent` adapter

The bridge between MCP and `IconquerMatch`. When `MatchRunner` asks an `MCPAgent` for a move, the agent waits for the next valid `iconquer_submit_move` tool call from the bound MCP session, validates it, and returns the parsed `GameMove`.

- [ ] **RED:** Test using `MockMCPClient` simulating an LLM submitting moves
- [ ] **GREEN:** Implement

---

## Step 17 — Out-of-turn validation + state-hash staleness

- [ ] **RED:** Test `iconquer_submit_move` from the wrong session → JSON-RPC error
- [ ] **RED:** Test stale `state_hash` → JSON-RPC error
- [ ] **GREEN:** Implement guards in the dispatcher

---

## Step 18 — MCP resources

- [ ] `iconquer://game/state`
- [ ] `iconquer://game/map`
- [ ] `iconquer://game/history`
- [ ] `iconquer://game/rules`

---

## Step 19 — `iconquer-mcp` executable wrapper

- [ ] **RED:** End-to-end test that wires `MCPServer.builder()` and runs a tool via `MockMCPClient`
- [ ] **GREEN:** Implement

---

## Step 20 — End-to-end MCP fixture (stdio)

- [ ] Scripted MCP session driving a full short game (mirrors Phase 1 fixture 12 but via MCP tool calls)
- [ ] Snapshot locked into fixture file

---

## Step 21 — HTTP transport smoke test → tag `IconquerMCP@v0.1.0`

- [ ] **RED:** Boot server on a random port, generate API key, connect with it, call read-only tool, refuse wrong key
- [ ] **GREEN:** Verify SwiftMCPServer wiring
- [ ] Tag `IconquerMCP@v0.1.0`

---

## Step 22 — Bootstrap `IconquerCLI` sibling repo

- [ ] `git init ../IconquerCLI/`
- [ ] `Package.swift` with `IconquerCore` + `IconquerMatch` + `IconquerAI` + `IconquerMCP` + `swift-argument-parser`
- [ ] Homebrew provisions (stable binary product name, `--version`, `Formula/iconquer-cli.rb` template)
- [ ] Vendored `development-guidelines/`
- [ ] Initial commit

---

## Step 23 — `CLISettings` + `config` subcommand

- [ ] **RED:** Test settings file round-trip + `config get/set/reset/path`
- [ ] **GREEN:** Implement
- [ ] XDG-compliant location

---

## Step 24 — `Renderer` + `--width` flag

- [ ] **RED:** Given a fixed `GameSnapshot`, the renderer produces a known stable string
- [ ] **GREEN:** Implement width-parameterised ANSI renderer
- [ ] Auto-detect via `TIOCGWINSZ` when `width == 0`
- [ ] `--ascii` and `--no-color` opt-outs

---

## Step 25 — Command grammar parser

- [ ] **RED:** Every command grammar example parses correctly; garbage produces good errors
- [ ] **GREEN:** Implement

---

## Step 26 — `simulate` subcommand

Drives a `MatchRunner` with `[SeatBinding]` of two scripted agents.

- [ ] **RED:** `simulate --p1 random --p2 random --seed 42` produces a byte-stable transcript
- [ ] **GREEN:** Implement
- [ ] Transcript fixture locked into tests

---

## Step 27 — `play` subcommand

Drives a `MatchRunner` with `[SeatBinding]` of `HumanAgent` + scripted agents.

- [ ] **RED:** Scripted stdin via piped input drives a known game outcome
- [ ] **GREEN:** Implement interactive REPL backed by `HumanAgent`'s `AsyncStream`

---

## Step 28 — `replay` subcommand

- [ ] **RED:** Reading a transcript file (`[MoveRecord]`) reproduces the simulated game state at each step
- [ ] **GREEN:** Implement

---

## Step 29 — `tournament` subcommand

- [ ] **RED:** `tournament --strategies random,greedy --rounds 100 --seed-base 42` produces a known win matrix
- [ ] **GREEN:** Implement aggregation logic

---

## Step 30 — DocC + README + `--version` → tag `IconquerCLI@v0.1.0`

- [ ] DocC catalog with `Playing the CLI` and `Tournament Mode` articles
- [ ] README with quickstart
- [ ] `--version` prints versions of all linked packages
- [ ] Tag `IconquerCLI@v0.1.0` = **Phase 2 v0.2.0 ship**

---

## Step 31 — Phase 2 v0.2.0 completion summary

- [ ] Write summary in `iconquer/development-guidelines/05_SUMMARIES/`
- [ ] Move this checklist to `04_99_COMPLETED/`
- [ ] Begin separate Phase 2 v0.3.0 work (`IconquerApp` SwiftUI shell + certified networked-multiplayer)
