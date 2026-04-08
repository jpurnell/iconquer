# Session Summary: Phase 2 Steps 1–3 + Revision 4 architectural pivot

| Date | Phase | Status |
| :--- | :--- | :--- |
| 2026-04-08 | Phase 2 | Steps 1–3 shipped; design pivoted to Revision 4 (IconquerMatch). Step 3 work survives but is reshaped in upcoming Step 5b. |

## 1. Core Objective

Carry Phase 2 forward from "design proposal approved" to "first code shipped" — and respond to a substantial mid-session architectural pivot when Justin's pre-existing `MultiAgentPlayerBinding.md` proposal surfaced and was approved as the canonical multi-agent design.

## 2. What Shipped (Code)

### `IconquerCore@v0.2.0` ✅ tagged

Phase 2 Step 1 — purely additive over v0.1.0. Commit `IconquerCore@9e41a82`, tag `v0.2.0`.

- **`Sources/IconquerCore/Rules/GameMove.swift`** — closed enum with 9 cases mirroring every public mutating method on `Game`. Player IDs are elided in favor of `currentPlayerId` because `GameMove` represents "the current player's next move."
- **`Game.apply(_: GameMove)`** — thin dispatcher over the existing direct mutating methods.
- **`AttackMode` and `AttackResult` now `Codable`** (required for `GameMove` transcript serialisation).
- **`IconquerCore.version`** bumped 0.0.1 → 0.2.0.
- **3 new `@Test`s** in `GameMoveTests.swift`: apply parity for fixtures 03 + 05, plus Codable round-trip across all 9 enum cases.
- **Phase 1 latent bug fixed in passing**: `pickCountry`'s rotation was using `nextAlivePlayer` (which skips empty-country players), getting stuck on player 0 forever during the `pickCountries` phase. New `rotateToNextPlayer` mirrors the TS reference's `selectNextAlivePlayer`. Surfaced by the new GameMove tests; fixed in the same commit.

23/23 tests passing, zero warnings, DocC builds clean.

### `IconquerAI` sibling repo bootstrapped + `RandomStrategy` shipped (will be reshaped)

Phase 2 Steps 2–3.

- **Step 2** (`IconquerAI@a6b0926`): `git init ../IconquerAI/`, `Package.swift` (Swift 6.2, OS 26 platforms, `IconquerCore` from local path, swift-docc-plugin), smoke test, vendored `development-guidelines/`, customised `00_MASTER_PLAN.md`, `.gitignore`.
- **Step 3** (`IconquerAI@e461f7d`): `PlayerStrategy.swift` (async protocol with three batched methods returning `[GameMove]`), `RandomStrategy.swift` (actor holding internal `SeededRNG`), `RandomStrategyTests.swift` (5 tests). 7/7 tests passing.

**⚠️ Step 3 is now marked SUPERSEDED in the checklist**, see §3 below.

## 3. The Mid-Session Architectural Pivot (the big deal)

After Step 3 shipped, a stray file `MultiAgentPlayerBinding.md` (Justin's pre-existing draft, dated 2026-04-07, authored by an earlier Claude session) was discovered in the working directory, inadvertently committed, and then formally **approved**.

**Justin's intent:** *"I created it, and I think we should do it. With our MCP ambitions here, this is meant to enable multiple LLMs alongside humans at the same time."*

This is a substantive enhancement that **was missing from Phase 2 Revision 3**. The integration became Revision 4 (commit `iconquer@bce2939`).

### The architectural shift

| Before (Revision 3) | After (Revision 4) |
| :--- | :--- |
| `IconquerAI` exposes `PlayerStrategy` (async, three batched methods returning `[GameMove]`). CLI/App drive strategies directly. MCP server is a separate path. | New `IconquerMatch` sibling repo owns `PlayerAgent` (single-move-per-call, deadlined, audit-logged). `MatchRunner` actor holds `[SeatBinding]` and unifies humans, scripted strategies, and LLM-via-MCP players as the same kind of seat. CLI/App drive `MatchRunner`, never agents directly. |
| 4 sibling repos (IconquerAI, IconquerMCP, IconquerCLI, IconquerApp) | **5** sibling repos — adds `IconquerMatch` between `IconquerCore` and the consumers |
| `IconquerCore` stops at v0.2.0 in Phase 2 | `IconquerCore` bumps to **v0.3.0** to add `GameSnapshot.hash()` (FNV-1a, no new deps) + `Game.legalMoves(for:)`. Both additive. |
| LLM player = remote MCP client only, separate code path | LLM player = an `MCPAgent: PlayerAgent` adapter that shows up in `MatchRunner` as just another seat. Mixed humans + LLMs in one match. |
| `MoveRecord` doesn't exist | Every move gets an audit-log entry: turn, seat, agent identity, move, state-hash-before, latency, fallback flag, **inline LLM reasoning** (the Phase 3 strategy-doc fuel) |

### What survives, what changes

**Survives:**
- `IconquerCore@v0.2.0` (already tagged) — `GameMove` + `Game.apply(_:)` are needed by every layer above
- `IconquerAI` sibling repo — keeps Random/Greedy, gains `IconquerMatch` dependency
- `RandomStrategy` internal logic (random valid move selection, sorted-for-determinism enumeration, local-Game-copy turn planning) — fully reusable

**Changes:**
- `PlayerStrategy.swift` will be **deleted** in Step 5b (only used internally)
- `RandomStrategy.swift` will be **rewritten** to `RandomAgent.swift` conforming to `PlayerAgent` (single-move-per-call interface) — likely with internal move-queue caching so the planning code from Step 3 stays intact
- The 5 existing `RandomStrategyTests` will be **rewritten** as `RandomAgentTests`

## 4. Documents Updated

- **`UPCOMING/MultiAgentPlayerBinding.md`** — moved from PROPOSALS, status flipped to APPROVED 2026-04-08, added a "naming reconciliation" section mapping the proposal's generic types (`GameState`/`Move`/`SeatID`) to our existing `GameSnapshot`/`GameMove`/`PlayerId`.
- **`UPCOMING/2026-04-08_iconquer_phase2_AI_CLI_SwiftUI.md`** — Revision 4. New §4.0 introduces `IconquerMatch`. §3 repo layout shows 5 sibling repos with the new dep graph. §4.1 (the old `PlayerStrategy` API) marked SUPERSEDED. §7 release plan rewritten with `IconquerCore@v0.3.0`, `IconquerMatch@v0.1.0`, and the reshaped `IconquerAI@v0.1.0`.
- **`04_IMPLEMENTATION_CHECKLISTS/CURRENT_iconquer_phase2.md`** — completely rewritten. Was 25 steps, now **31 steps**. Steps 1–3 marked done (Step 3 noted as SHIPPED-but-RESHAPED-in-Step-5b). New steps 4 (`IconquerCore@v0.3.0`), 5 (bootstrap `IconquerMatch`), 5a (Match core types), 5b (reshape Step 3 work), 6 (`MatchRunner`), 7 (`HumanAgent`), 8 (`MockLLMAgent`), 9 (Match round-trip → tag), 10 (`IconquerAI@v0.1.0` round-trip → tag). Original IconquerMCP and IconquerCLI work shifted to steps 11–30.

## 5. Quality Gate

| Check | Status |
| :--- | :--- |
| `IconquerCore` build | ✅ zero warnings |
| `IconquerCore` test | ✅ 23/23 |
| `IconquerCore` DocC | ✅ clean |
| `IconquerCore` tag | ✅ `v0.2.0` annotated |
| `IconquerAI` build | ✅ zero warnings |
| `IconquerAI` test | ✅ 7/7 (will be rewritten in Step 5b) |

## 6. Next Session Handover (Context Recovery)

### Immediate Starting Point

**Step 4 — `IconquerCore@v0.3.0`: `GameSnapshot.hash()` + `Game.legalMoves(for:)`.**

Per the Phase 2 checklist Step 4:

1. **DESIGN:**
   - `GameSnapshot.hash()` uses **FNV-1a 64-bit** over a sorted-keys JSON encoding (`JSONEncoder.outputFormatting = .sortedKeys`). Returns a hex string. **No new dependencies.** No CryptoKit, no swift-crypto, no system libs. ~15 lines of pure Swift.
   - `Game.legalMoves(for:)` enumerates one canonical move per legal action:
     - **`pickCountries` phase:** `[.pickCountry(c) for c in unowned countries]`
     - **`initializeArmies` / `play.assignArmies` phase:** `[.placeArmies(c, count: unallocatedArmies) for c in player.countries]` — **NOT the cross product**. Agents that want partial placements call `requestMove` multiple times.
     - **`play.attack` phase:** `[.attack(from: f, to: t, mode: .untilWinOrLose) for each valid (f, t) pair]` + `.finishAttackPhase`
     - **`play.fortify` phase:** `[.beginFortifyFrom(c) for c in player.countries with movable armies]` + `.finishTurn` (skip fortify)
     - **Forced card turn-in (`pendingInput`):** `[.resolveCardTurnIn(game.bestCardsToTurnIn(for:))]`

2. **RED:** Two focused tests:
   - `hash()` test: encode/decode round-trip a known snapshot, verify the hash is stable across runs and identical for structurally-equal snapshots.
   - `legalMoves` test: against fixture 04's state (start of P1's first AssignArmies turn), assert the expected count and shape per phase.

3. **GREEN:** Implement both methods.

4. **VERIFY:** All 23 existing tests + 2 new tests pass. Zero warnings.

5. **DOCUMENT:** DocC on both methods. DocC build clean.

6. **TAG:** `IconquerCore@v0.3.0`.

### Pending Phase 2 Sub-Steps (29 of 31 remaining)

- [ ] Step 4: `IconquerCore@v0.3.0`
- [ ] Step 5: bootstrap `IconquerMatch` sibling repo
- [ ] Step 5a: `IconquerMatch` core types (PlayerAgent, MatchRunner, MoveRecord, SeatBinding, MatchSettings, AgentIdentity, error enums)
- [ ] Step 5b: reshape Step 3 work — delete `PlayerStrategy.swift`, rewrite `RandomStrategy` → `RandomAgent`, rewrite tests
- [ ] Steps 6–9: `MatchRunner` actor, `HumanAgent`, `MockLLMAgent`, round-trip integration test → tag `IconquerMatch@v0.1.0`
- [ ] Step 10: `IconquerAI@v0.1.0` round-trip → tag `IconquerAI@v0.1.0`
- [ ] Steps 11–21: `IconquerMCP` (SwiftMCPServer-based) — `GameSession`, `PlayerIdentityStore`, read-only tools, mutating tools, `MCPAgent: PlayerAgent` adapter, validation, resources, executable wrapper, end-to-end fixture, HTTP smoke test → tag `IconquerMCP@v0.1.0`
- [ ] Steps 22–30: `IconquerCLI` (`CLISettings`, `Renderer`, parser, `simulate`, `play`, `replay`, `tournament`, DocC, README, `--version`) → tag `IconquerCLI@v0.1.0` = **Phase 2 v0.2.0 ship**
- [ ] Step 31: Phase 2 completion summary + checklist move to `04_99_COMPLETED/`

### Critical Context-Loss Warnings

These are the things the next session **must not forget**:

1. **`PlayerStrategy` is SUPERSEDED.** The `PlayerStrategy.swift` and `RandomStrategy.swift` files in `IconquerAI` are working code with passing tests, but they will be **deleted** and **rewritten** in Step 5b once `IconquerMatch.PlayerAgent` exists. Do NOT add new strategies to this protocol. Do NOT extend it. The internal RandomStrategy *logic* (random valid move selection, sorted enumeration, local-Game-copy turn planning) is the part that survives.

2. **`IconquerCore@v0.3.0` is additive.** When implementing `GameSnapshot.hash()` and `Game.legalMoves(for:)`, do NOT modify any existing public API. All 23 v0.2.0 tests must continue to pass byte-for-byte. If a test breaks, it's a regression in v0.2.0 surface, not an intentional v0.3.0 change.

3. **`hash()` does NOT use CryptoKit, swift-crypto, or any new dependency.** FNV-1a 64-bit is ~15 lines of pure Swift over the sorted-keys JSON bytes. The use case (replay-staleness detection) doesn't need cryptographic strength. If tempted to "use a real hash," resist — staying dependency-free is a hard constraint per Justin's "blast radius of a fan" guidance.

4. **`legalMoves` for `placeArmies` returns ONE canonical move per owned country**, NOT the `(country × count)` cross product. The free `count` parameter is canonicalised to `unallocatedArmies`. Agents (especially LLMs) that want to split allocation across countries call `requestMove` multiple times.

5. **`IconquerMatch.PlayerAgent.requestMove` returns ONE move per call**, with a deadline. This is the critical shape difference from the old `PlayerStrategy`. When reshaping `RandomAgent` in Step 5b, the cleanest pattern is: maintain an internal move queue, plan one full turn's worth of moves at once (using the local-Game-copy from Step 3's logic), and dequeue one per `requestMove` call. Re-plan when the queue is empty.

6. **`MoveRecord.reasoning` is a first-class field**, intentionally retained inline (not in a side log). This is the foundation of the Phase 3 LLM-tournament strategy-doc vision. `MatchSettings.maxReasoningLength` bounds individual entries; longer ones are truncated with an explicit `reasoningTruncated: Bool` flag. **Do not move reasoning to a side log "to save space"** — that fragments the most valuable artifact for Phase 3.

7. **The naming reconciliation:** the `MultiAgentPlayerBinding.md` proposal uses generic names. We use our existing IconquerCore vocabulary. Map: `GameState` → `GameSnapshot`, `Move` → `GameMove`, `SeatID` → `PlayerId`.

8. **`IconquerMCP` depends on BOTH `IconquerCore` AND `IconquerMatch`** (not just Core). The MCP server ships an `MCPAgent: PlayerAgent` adapter that lives in IconquerMCP and consumes IconquerMatch's protocol.

9. **`IconquerCLI` and `IconquerApp` both drive `MatchRunner` directly.** They never instantiate `RandomAgent` and call its methods. They build a `[SeatBinding]` and hand it to `MatchRunner.run()`, then consume the `AsyncThrowingStream<MoveRecord>`.

10. **The `.gitignore` now excludes Emacs auto-save / lock files** (`**/.#*`, `**/#*#`, `**/*~`). Before this session, two stray Emacs files were swept into a commit and had to be untracked. The pattern is now in place, but watch for similar editor cruft from other tools.

11. **The Phase 2 checklist is now 31 steps** (was 25). Use it as the source of truth — the original Steps 4–25 from Revision 3 are interleaved with new IconquerMatch steps and their numbering shifted.

12. **Don't try to run `MCPServer.builder()` in tests without a MockMCPClient.** SwiftMCPServer is a real network-capable server framework. Tests should drive the MCP path via `MockMCPClient` (in IconquerMCP's test target) which speaks JSON-RPC frames in-memory. Live HTTP transport gets ONE smoke test in v0.1.0, not pervasive coverage.

### File Locations Quick Reference

| What | Where |
| :--- | :--- |
| Active checklist | `iconquer/development-guidelines/04_IMPLEMENTATION_CHECKLISTS/CURRENT_iconquer_phase2.md` |
| Phase 2 master proposal (Revision 4, APPROVED) | `iconquer/development-guidelines/02_IMPLEMENTATION_PLANS/UPCOMING/2026-04-08_iconquer_phase2_AI_CLI_SwiftUI.md` |
| MultiAgentPlayerBinding (APPROVED) | `iconquer/development-guidelines/02_IMPLEMENTATION_PLANS/UPCOMING/MultiAgentPlayerBinding.md` |
| Phase 1 v0.1.0 completion summary | `iconquer/development-guidelines/05_SUMMARIES/2026-04-08_iconquer_core_phase1_complete_v0.1.0.md` |
| Phase 2 design + Step 1 summary | `iconquer/development-guidelines/05_SUMMARIES/2026-04-08_phase2_design_and_step1.md` |
| This summary (Phase 2 Steps 1–3 + Revision 4 pivot) | `iconquer/development-guidelines/05_SUMMARIES/2026-04-08_phase2_revision4_pivot.md` |
| `IconquerCore` package (v0.2.0 tagged) | `~/Dropbox/Computer/Development/Swift/IconquerCore/` |
| `IconquerAI` package (initial commit only — Step 3 shipped) | `~/Dropbox/Computer/Development/Swift/IconquerAI/` |
| SwiftMCPServer (Justin's MCP framework) | `github.com/jpurnell/SwiftMCPServer` |

### Recent Commits

**iconquer:**
```
4822d8a Untrack Emacs auto-save / lock files; add .gitignore rules
bce2939 Phase 2 design proposal Revision 4 — integrate IconquerMatch
ff93dc8 Tick Phase 2 Step 3 — PlayerStrategy + RandomStrategy
083bff8 Tick Phase 2 Step 2 — IconquerAI sibling repo bootstrapped
228bb4a Add Phase 2 design + Step 1 session summary
```

**IconquerCore:** (tagged `v0.2.0` at HEAD)
```
9e41a82 Phase 2 Step 1: GameMove + Game.apply(_:) — IconquerCore@v0.2.0
f394366 Phase 1 Steps 5 & 6: REFACTOR audit complete + DocC catalog GREEN
6573577 Phase 1 Step 4.7: fixture 12 full short game GREEN
```

**IconquerAI:**
```
e461f7d Phase 2 Step 3: PlayerStrategy + RandomStrategy GREEN
a6b0926 Initial package skeleton
```

### Sibling Repo State of the World

```
~/Dropbox/Computer/Development/Swift/
├── iconquer/                  ← TS reference + Phase 1/2 design docs (HEAD: 4822d8a)
├── IconquerCore/              ← v0.2.0 tagged, 23/23 tests, DocC clean
├── IconquerAI/                ← initial commit + Step 3 shipped (will be reshaped in Step 5b)
└── (planned) IconquerMatch/   ← Step 5
└── (planned) IconquerMCP/     ← Step 11
└── (planned) IconquerCLI/     ← Step 22
└── (planned) IconquerApp/     ← Phase 2 v0.3.0
```

---

**Session Duration:** one focused working session
**AI Model Used:** Claude Opus 4.6 (1M context)
