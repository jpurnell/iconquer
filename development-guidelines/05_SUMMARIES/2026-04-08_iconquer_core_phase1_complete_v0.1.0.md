# Phase 1 Complete: IconquerCore v0.1.0 — Headless Rules Engine

| Date | Phase | Status |
| :--- | :--- | :--- |
| 2026-04-08 | IconquerCore Phase 1 | **DONE — tagged v0.1.0** |

## Tag

`IconquerCore@v0.1.0` (annotated tag on the sibling repo at `/Users/jpurnell/Dropbox/Computer/Development/Swift/IconquerCore`)

## Acceptance Criteria — All Met

| Criterion (from design proposal §9) | Result |
| :--- | :--- |
| `swift build` and `swift test` succeed with zero warnings | ✅ |
| ≥80% line coverage on `IconquerCore` | ✅ **88.32%** |
| All parity fixtures pass | ✅ **12/12 GREEN against TS oracle** |
| DocC builds with no warnings, public API fully documented | ✅ via `swift-docc-plugin` 1.4.0 |
| DocC article walks through "play one full game in code" | ✅ `PlayingAFullGame.md` |

Plus the implicit acceptance criterion from the engineering rules:
- ✅ Zero force unwraps, `try!`, force casts (audited via `grep`)
- ✅ Zero magic numbers in engine code (audited 2026-04-08)
- ✅ Sendable, value-typed, no shared mutable state

## What's in v0.1.0

### 12 parity fixtures GREEN

| # | Fixture | Coverage |
|---|---|---|
| 01 | `start_no_assign` | Game initialization, model layer |
| 02 | `start_random_assign` | RNG, deck init, country shuffle, first init drip |
| 03 | `initialize_armies_first_drip` | placeArmies, init rotation |
| 04 | `initialize_armies_complete` | Full init drain → Play, reinforcement income |
| 05 | `attack_until_win_or_lose` | Combat, capture sentinel, victory, elimination |
| 06 | `attack_once` | `.once` mode |
| 07 | `attack_until_losses_exceed` | `.untilLossesExceed` mode |
| 08 | `fortify_adjacent_with_tired_sentinel` | Fortify, `tiredArmies = -1` arithmetic |
| 09 | `card_draw_on_conquest` | finishTurn + takeCard |
| 10 | `card_turn_in_set_value_bump` | turnInCards, owned-country bonus |
| 11 | `forced_turn_in_after_elimination` | pendingInput, blocker guards, takeCards |
| 12 | `full_short_game` | End-to-end victory, every system |

### Test suite

- **5 test suites, 20 tests**, all passing
- `ParityTests` (12 fixtures), `CardHeuristicTests` (3 hands), `RandomTests` (RNG bit-parity), `MapLoaderTests` (source order), `Smoke` (1)
- Run time: ~10ms total (deterministic, no network, no flakiness)

### Engine surface

**Public state-machine API on `Game`:**
- `Game.start(seed:players:settings:map:)` (throws `GameError`)
- `pickCountry`, `placeArmies`, `attack`, `finishAttackPhase`, `beginFortifyFrom`, `finishTurn`, `turnInCards`, `resolveCardTurnIn`
- `canAttack`, `bestCardsToTurnIn`, `incomeForCountries`, `snapshot`
- 16 public read-only state fields (`phase`, `turnPhase`, `players`, `countries`, `pendingInput`, etc.)
- 2 test-only setup helpers (`testing_dealCard`, `testing_enterAssignArmies`) — public, prefixed, DocC-warned

**Public types:**
- `Game`, `GameSnapshot`, `Settings` (20 named fields, zero magic numbers)
- `MapDefinition`, `MapLoader`
- `GamePhase`, `TurnPhase`, `Player`, `PlayerId`, `Country`, `CountryId`, `Card` (with `Card.wildSuit`, `Card.isWild`)
- `AttackMode` (`.once`, `.untilLossesExceed`, `.untilWinOrLose`), `AttackResult`
- `PendingInput` (`.awaitingCardTurnIn`)
- `GameError`
- `SeededRNG` (mulberry32)

### Documentation

- `IconquerCore.docc/IconquerCore.md` — package landing page with Topics organisation
- `IconquerCore.docc/PlayingAFullGame.md` — end-to-end article
- `IconquerCore.docc/RulesMapping.md` — explicit catalog of where the engine matches RULES.md and where it deviates per the TS oracle (fortify-adjacent, capture sentinel, tired-armies sentinel, count<9 quirk)

## Key Engineering Decisions

| Decision | Rationale |
| :--- | :--- |
| Sibling repo, not nested package | Engine evolves independently from app shell |
| Vendor `development-guidelines/` as plain files | Project state inside, template stays clean |
| Mirror mulberry32 bit-for-bit (not SplitMix64) | Trivially reproducible; no need to swap both sides |
| TS oracle is authoritative — RULES.md is documentation drift | Mirror TS quirks (fortify-adjacent, sentinels, count<9) as-is |
| `Game` is a `struct` with `mutating` methods, NOT a class | Value semantics + `Sendable` for SwiftUI consumption |
| All randomness via injected `SeededRNG` | Determinism is the foundation of parity testing |
| **No magic numbers anywhere in engine code** | Every numeric and behavioural knob lives in `Settings` |
| `PendingInput?` enum replaces `mustTurnInCards`/`needsCardTurnIn` flags | Single source of truth for pause state; legacy flags derived in `snapshot()` |
| Public mutating methods early-return on bad input (no throws) | Mirrors TS oracle's silent no-op semantics; documented in DocC |
| Test-only setup helpers prefixed `testing_` and DocC-warned | Pre-stuff state without playing many turns; small blast radius |

## Lessons Learned (4 reusable feedback memories saved)

1. **Sibling repos for engine/app splits.** `feedback_repo_layout.md`
2. **Vendor `development-guidelines/` as plain files** (strip `.git`). `feedback_vendor_dev_guidelines.md`
3. **`String(format:)` is forbidden in Swift.** `feedback_no_string_format.md`
4. **No hardcoded constants in Swift code** — every magic number lives in a named config field. `feedback_no_hardcoded_constants.md`
5. **JSONDecoder discards key order on Apple platforms.** `feedback_jsondecoder_key_order.md` (caught during fixture 02)
6. **TS oracle Settings is a strict subset** of Swift's. Passing extras to TS dump scripts is silently ignored → parity divergence. `feedback_iconquer_ts_settings_drift.md` (caught during fixture 12)

Plus one project memory:
- **`iconquer Phase 2 AI is the modernization target`** — IconquerCore stays pure rules; AI lives in a separate `IconquerAI` module; LLM-driven strategies are the dogfood goal. `project_iconquer_ai_modernization.md`

## Phase 1 Commit Trail

### iconquer (this repo)
```
4b4eae2 Phase 1 Steps 5 + 6: tick REFACTOR + DOCUMENT rows in checklist
7bda4a2 Phase 1 Step 4.7: fixture 12 dump scenario + checklist tick
9f7827f Phase 1 Step 4.6.4: REFACTOR audit ticks in Step 5 checklist
9edc5ae Phase 1 Step 4.6.3: fixture 11 + Cards row tick
92b1964 Phase 1 Step 4.6.2: fixture 10 dump scenario
d479394 Phase 1 Step 4.6.1: fixture 09 dump scenario
d7118db Phase 1 Step 4.6: approve Cards & PendingInput design proposal
6e1ecba Phase 1 Step 4.5: fixture 08 + checklist tick
1ff65f4 Phase 1 Step 4.4b/c: fixtures 06 + 07 + checklist tick
42ce3a6 Phase 1 Step 4.4: fixture 05 + checklist tick
5d7d413 Phase 1 Step 4.3: fixture 04 + checklist tick
bf861b7 Add session summary for Phase 1 Step 4 fixtures 04–11
3e43bdd Add session summary for Phase 1 Step 4 fixtures 01–03
b3308e7 Tick Phase 1 Step 4.2 (fixtures 02 + 03 parity GREEN)
e1edf64 Tick Phase 1 Step 4.1 (fixture 01 parity GREEN)
e88aaea Add parity fixture dump tooling for IconquerCore Swift port
ffd5bbb Adopt development-guidelines workflow (vendored)
```

### IconquerCore (sibling repo) — tagged `v0.1.0` at HEAD
```
f394366 Phase 1 Steps 5 & 6: REFACTOR audit complete + DocC catalog GREEN
6573577 Phase 1 Step 4.7: fixture 12 full short game GREEN
ebbff23 Phase 1 Step 4.6.4: REFACTOR pass — magic numbers + heuristic dedup
52d77f5 Phase 1 Step 4.6.3: pendingInput blocker + fixture 11 GREEN
d2ddc04 Phase 1 Step 4.6.2: turnInCards + bestCardsToTurnIn GREEN
6fc8f57 Phase 1 Step 4.6.1: fixture 09 card-draw-on-conquest GREEN
7b13b92 Phase 1 Step 4.6.0: Cards & PendingInput plumbing (no behavior change)
6c0389c Phase 1 Step 4.5: fixture 08 fortify parity GREEN
4f0711f Phase 1 Step 4.4b/c: fixtures 06 + 07 attack-mode parity GREEN
3445816 Phase 1 Step 4.4: fixture 05 combat parity GREEN
c963292 Phase 1 Step 4.3: fixture 04 parity GREEN
1515c53 Phase 1 Step 4.2: fixtures 02 + 03 parity GREEN
a7869ca Phase 1 Step 4.1: fixture 01 parity (no-assign start) GREEN
ef16be7 Add 3 parity fixtures from the TypeScript oracle
832f52c Adopt development-guidelines workflow (vendored)
ea5fc3e Initial package skeleton
```

## What's Next — Phase 2

Per the project memory `project_iconquer_ai_modernization.md`, the Phase 2 target is:

1. **`IconquerAI` module** — separate package (or sibling repo) consuming `IconquerCore` as a dependency. AI strategies (`PlayerStrategy` protocol + concrete implementations) live here, including the LLM-driven dogfood target from `SPEC.md`'s "cognition fabric" experiment.

2. **SwiftUI app shell** — consumes `IconquerCore` for state and `IconquerAI` for computer players. Where to host: open question (this `iconquer` repo, or a third sibling repo). The hand-rolled `.xcodeproj` decision from Phase 1 still stands.

3. **Phase 1 hygiene backlog (non-blocking):**
   - 2 high-severity npm audit warnings in TS reference deps
   - `apply(_: GameAction)` enum API surface — deferred from Phase 1, may or may not be wanted in Phase 2 once SwiftUI reveals the right shape
   - `Game.swift` is ~1000 lines and could be split into `Game+Combat.swift`, `Game+Cards.swift`, `Game+Fortify.swift` if it gets larger in Phase 2
   - `deckSignature` field on `GameSnapshot` for verifying card-pile movement in tests — open question from the Cards design proposal §10, deferred since visible state was sufficient for fixtures 10/11

---

**Total Phase 1 work:** 2 sessions over 2 days, ~33 atomic commits across both repos, 12 deterministic parity fixtures, 20 tests, ~88% line coverage, **shipped v0.1.0**.

**AI Model Used:** Claude Opus 4.6 (1M context)
