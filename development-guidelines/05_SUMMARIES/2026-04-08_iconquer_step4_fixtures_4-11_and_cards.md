# Session Summary: IconquerCore Phase 1 Step 4 — fixtures 04–11, full card system, refactor

| Date | Phase | Status |
| :--- | :--- | :--- |
| 2026-04-08 | IconquerCore Phase 1 (Headless Rules Engine) | PARTIAL — Step 4 sub-steps 4.3 through 4.6 complete (8 new fixtures). 4.7 full short-game is next. |

## 1. Core Objective

Take `IconquerCore` from "3 starter fixtures green" (end of last session) all the way through reinforcement, full combat, fortification, and the entire card lifecycle including the long-deferred `PendingInput` design — all under deterministic seeded RNG against the TypeScript oracle.

## 2. Design Decisions

- **Decision:** For combat fixtures (05/06/07), use a contrived two-country `MapDefinition` (Atlantis ↔ Pacifica) constructed inline rather than the world map.
  - **Rationale:** Justin: "yeah, b is fine for fixtures." Decouples combat parity from random distribution geography. The same approach applied to fortify (line map North↔Middle↔South) and cards (3-player line for fixture 11).

- **Decision:** Add a public `Game.testing_dealCard(_:to:)` setup helper, prefixed `testing_` and DocC-warned, rather than driving multiple real conquest cycles to accumulate cards.
  - **Rationale:** Per the design proposal §9, the helper has small blast radius and is reused by both fixture 10 (turn-in) and fixture 11 (forced turn-in). Production callers must not use it.

- **Decision:** Approve and execute the *Cards & PendingInput* design proposal end-to-end in this session. Proposal lives at `02_IMPLEMENTATION_PLANS/UPCOMING/2026-04-07_IconquerCore_cards_and_pending_input.md`.
  - **Resolved §10 questions, all per the proposal's recommended defaults:**
    1. Test-only setup helper YES (`testing_dealCard`)
    2. `deckSignature` field on `GameSnapshot` YES (with one-time re-dump of fixtures 01–08) — *but not yet implemented; deferred until a future fixture truly needs it*
    3. Collapse `mustTurnInCards` / `needsCardTurnIn` into a single `pendingInput != nil` predicate
    4. `PendingInput` lives in its own file

- **Decision:** When `attack` triggers BOTH player elimination AND victory (only one player left), `pendingInput` is **NOT** set. "Victory supersedes any pending input — the game is over."
  - **Rationale:** TS distinguishes `mustTurnInCards: true, needsCardTurnIn: false` in this case (a quirk born from its boolean-pair scheme). Phase 1's collapsed `pendingInput` design treats them identically, so we must NOT set it on victory or the snapshot would diverge from intuition. Fixture 11 was redesigned around this — uses 3 players so the elimination isn't also a victory.

- **Decision:** Settings grew from 14 fields (start of session) to 20 (end of session). Every numeric and boolean knob from §14b of the oracle notes is now lifted, plus four new ones discovered in 4.6:
  - `incomeMinimumThreshold`, `incomeMinimumValue`, `incomeDivisor` (4.3, reinforcement)
  - `diceToRoll`, `lossesExceedValue`, `diceFaces`, `advanceArmies`, `defenderCapturedSentinel` (4.4, combat)
  - `cardSetSize`, `cardHandLimit`, `firstCardSetValue`, `cardValueIncrement`, `ownedCardCountryBonus`, `allowTurningInCards` (4.6, cards)
  - **Zero magic numbers in engine code.** Audited 2026-04-08.

- **Decision:** `Card.wildSuit` is a public static `Int` constant on `Card`, not a `Settings` field.
  - **Rationale:** It's an intrinsic property of the type, not a tunable. Adding `Card.isWild` as a convenience.

## 3. Work Completed

### Step 4.3 — Fixture 04 (full init → first reinforcement) ✅

Drives the engine through every player's full 20-army initialization, the transition to `.play`, and the first AssignArmies reinforcement income for P1.

- New `Settings` fields: `incomeMinimumThreshold`, `incomeMinimumValue`, `incomeDivisor` (defaults 9, 3, 3).
- `Game.beginTurnIfReady` learned the **Play branch**: opens AssignArmies, resets `hasWonThisTurn`, grants reinforcement income via the new `incomeForCountries(_:)` method.
- `Game.incomeForCountries(_:)` mirrors the TS `count<9?3:floor/3` quirk plus full per-continent bonus check (`continent.countries.allSatisfy { owned.contains($0) }`).
- `Game.advanceInitializationTurn` now actually calls `beginTurnIfReady` on the Play transition (was previously a TODO no-op).
- Commits: `IconquerCore@c963292`, `iconquer@5d7d413`.

### Step 4.4 — Fixtures 05/06/07 (combat, all 3 attack modes) ✅

Brings the engine through full combat: dice resolver, capture sentinel, army advance, player elimination, victory detection. Uses a contrived two-country duel map decoupled from random distribution geography.

- **New types:** `AttackMode` (`.once` / `.untilLossesExceed` / `.untilWinOrLose`), `AttackResult`. Both in `Sources/IconquerCore/Rules/Combat.swift`.
- **Combat helpers on `Game`:** `rollDice`, `attackOnce`, `attack(from:to:mode:)`, `canAttack(from:to:)`, `setCurrentCountry`, `removePlayer`.
- **Public state-machine entry points:** `pickCountry`, `startAttackPhase`.
- **`transferCountry` extended** to handle old-owner removal, victories/defeats bookkeeping, `hasWonThisTurn`, and reset of `tiredArmies` on capture.
- **`placeArmies`** auto-fires `startAttackPhase` when AssignArmies drains.
- **5 new `Settings` knobs** (no magic numbers): `diceToRoll`, `lossesExceedValue`, `diceFaces`, `advanceArmies`, `defenderCapturedSentinel`.
- **`AttackResult.conquered` quirk noted but not mirrored:** the TS reference returns `false` after a successful capture because it checks `defender.armies >= 0` AFTER setting it to `armiesToMove - 1`. The Swift port returns `true` (correctly checking before the assignment). This isn't snapshotted, so doesn't affect parity.
- Commits: `IconquerCore@3445816, @4f0711f`, `iconquer@42ce3a6, @1ff65f4`.

### Step 4.5 — Fixture 08 (fortify with `tiredArmies = -1` sentinel) ✅

Implements the fortify sub-phase end-to-end on a contrived three-country linear map (North ↔ Middle ↔ South).

- New `Game.fortifyFrom: CountryId?` state.
- `Game.finishAttackPhase()`, `Game.beginFortifyFrom(_:)`, `Game.ownedNeighbors(of:)`.
- `Game.placeArmies` Fortify branch:
  - Gates destinations to `{source} ∪ ownedNeighbors(source)` — adjacent only, mirroring the TS oracle (not RULES.md's path-connected wording).
  - Bumps `tiredArmies` on non-source destinations by the placed amount. **The `-1` sentinel arithmetic is preserved**: `-1 + N → (N - 1)`.
  - On drain, clears `fortifyFrom` and `currentCountryId`.
- Verified Middle ends with `armies=23, tiredArmies=22` (exactly `-1 + 23`). The sentinel arithmetic gotcha is now locked into a parity test.
- Commits: `IconquerCore@6c0389c`, `iconquer@6e1ecba`.

### Step 4.6 — Cards & PendingInput (fixtures 09/10/11 + REFACTOR) ✅

Five sub-commits implementing the entire card lifecycle plus the long-deferred `PendingInput` blocker contract.

#### 4.6.0 — Plumbing (no behavior change)
- New `Sources/IconquerCore/Rules/PendingInput.swift` with one case: `.awaitingCardTurnIn(player: PlayerId)`.
- 5 new `Settings` fields (defaults from §14b): `cardSetSize` (3), `cardHandLimit` (4), `firstCardSetValue` (5), `cardValueIncrement` (1), `ownedCardCountryBonus` (2), `allowTurningInCards` (true). *(Note: `cardSetSize` was added later in 4.6.4 as part of the magic-number audit.)*
- New `Game` state: `currentCardSetValue: Int` (init from `settings.firstCardSetValue`), `pendingInput: PendingInput?`.
- 13/13 tests still pass.
- Commits: `IconquerCore@7b13b92`, `iconquer@d7118db`.

#### 4.6.1 — `takeCard` + `finishTurn` (fixture 09)
- `Game.takeCard()` (private): pops front of `drawPile`, reshuffles from discard if empty.
- `Game.finishTurn()` (public): clears every owned country's `tiredArmies`, draws a card if `hasWonThisTurn`, rotates to next alive player (bumping `turnNumber` on wrap), opens `TurnPhase.done`, calls `beginTurnIfReady()`. Honors the `pendingInput == nil` guard.
- `Game.nextAlivePlayerIndex(after:)` helper for wrap detection.
- Fixture 09 verifies P1 drew the "North" card after capturing Middle. 14/14.
- Commits: `IconquerCore@6fc8f57`, `iconquer@d479394`.

#### 4.6.2 — `turnInCards` + `bestCardsToTurnIn` (fixture 10)
- `Game.turnInCards(_:cards:)`: grants `currentCardSetValue` armies per group of 3, bumps `currentCardSetValue` by `cardValueIncrement`, applies `+ownedCardCountryBonus` per card whose country the player still owns, removes from hand, pushes onto discard.
- `Game.bestCardsToTurnIn(for:)`: ~80-LOC direct port of the TS heuristic. Soldiers/cannons/horses/wilds bookkeeping with owned-country prioritization (`insert(at: 0)` for owned, `append` for unowned).
- **Test-only helpers:** `Game.testing_dealCard(_:to:)`, `Game.testing_enterAssignArmies(for:)`. Public, prefixed `testing_`, DocC-warned.
- **`CardHeuristicTests.swift` (NEW):** 3 focused `@Test`s pinning `bestCardsToTurnIn` output bit-for-bit against the TS oracle for triple-same-suit, one-of-each, two-plus-wild hands. **Per the proposal §12 risk note, these were written BEFORE the parity test** to isolate the delicate algorithm.
- Fixture 10 (duel map): inject 3 cards into P1, `turnInCards`, verify P1.unallocatedArmies +5, Atlantis +2 (owned bonus), Pacifica unchanged. 18/18.
- Commits: `IconquerCore@d2ddc04`, `iconquer@92b1964`.

#### 4.6.3 — `pendingInput` blocker + fixture 11
- **Trigger logic in `Game.attack`:** after a successful capture that eliminates the defender player AND the attacker holds more than `cardHandLimit` cards AND `allowTurningInCards` AND it's not also a victory, set `pendingInput = .awaitingCardTurnIn(player: attackerPlayerId)`.
- `Game.takeCards(winner:loser:)`: transfers the eliminated player's cards to the attacker. Mirrors TS exactly.
- `Game.resolveCardTurnIn(_:cards:)`: public method that bypasses the `pendingInput` guard, calls `turnInCards`, clears `pendingInput`.
- **`pendingInput == nil` guards** added to every public mutating method that advances the state machine: `pickCountry`, `placeArmies`, `attack`, `finishAttackPhase`, `beginFortifyFrom`, `startAttackPhase`. (`finishTurn` already had it.)
- **`GameSnapshot.snapshot()` derives `mustTurnInCards` / `needsCardTurnIn`** from `pendingInput != nil` (collapsed per the proposal §4.2) instead of always emitting `false`.
- Fixture 11: 3-player line, P1 injected with 5 cards, captures Middle, eliminates P2 (P3 still alive → no victory). Verifies `pendingInput == .awaitingCardTurnIn(P1)` AND `mustTurnInCards`/`needsCardTurnIn` both flip to `true`. 19/19.
- Commits: `IconquerCore@52d77f5`, `iconquer@9edc5ae`.

#### 4.6.4 — REFACTOR pass
- Audit: zero force unwraps / `try!` / `as!` (`grep` clean).
- **Two genuine magic-number hits lifted:**
  - `Card.wildSuit = -1` → public static constant on `Card`. Adds `Card.isWild` convenience.
  - `bestCardsToTurnIn`'s `> 2` set-size checks → `Settings.cardSetSize` (default 3), used as `>= settings.cardSetSize`.
- `bestCardsToTurnIn`'s three near-identical "claim 3 from pile" branches collapsed via a local `claimFromPile(_:)` helper (~20 lines saved, no semantic change).
- **`Settings` now has 20 fields**, every one named, every default matching TS.
- 19/19 still passing, zero warnings.
- Commits: `IconquerCore@ebbff23`, `iconquer@9f7827f`.

### Tests Written

| Suite | New @Tests this session |
| :--- | :--- |
| `ParityTests` | 8 — fixtures 04, 05, 06, 07, 08, 09, 10, 11 |
| `CardHeuristicTests` (NEW) | 3 — triple, one-of-each, two-plus-wild |
| **Total session new** | **11** |

End-of-session totals: **19 tests in 5 suites, all passing, zero warnings.**

## 4. Mandatory Quality Gate

| Check | Status |
| :--- | :--- |
| **build** | ✅ zero warnings (`swift build`) |
| **test** | ✅ 19/19 (`swift test`) |
| **safety** | ✅ no force unwraps, no `try!`, no force casts (audited 2026-04-08) |
| **magic numbers** | ✅ none in engine code (audited 2026-04-08) |
| **doc-lint** | ✅ DocC comments on every new public type and method |
| **doc-coverage** | n/a (Step 6 — DocC build target not yet wired) |

## 5. Project State Updates

- ✅ Active checklist: every `Step 4` row through Cards is now ticked. Only **Victory detection** and **Full short-game scenario** remain in Step 4.
- ✅ Step 5 partial ticks (4 of 5 rows) added based on the 4.6.4 audit.
- ✅ Design proposal `2026-04-07_IconquerCore_cards_and_pending_input.md` moved to UPCOMING/ and marked APPROVED with all 4 §10 questions resolved.
- ✅ 11 atomic commits in `IconquerCore`, 11 matching commits in `iconquer`.
- ✅ No new feedback memories this session — the existing ones (sibling repos, no `String(format:)`, no hardcoded constants, JSONDecoder key order) all continue to pay off.

## 6. Next Session Handover (Context Recovery)

### Immediate Starting Point

**Begin Step 4.7 — fixture 12 (full short game to victory).**

Per the Phase 1 design proposal §9: *"a short DocC article walks through 'play one full game in code.'"* The acceptance-criterion fixture is a full game played end-to-end against the TS oracle. This is the last fixture before the formal Step 5 REFACTOR sweep.

**Sub-task:**

> Add scenario `12_full_short_game` to `dump-parity-fixtures.ts`. Use the world map (or a small custom map for speed — open question). Drive 3 players through pickCountries → init → multiple Play turns → eventual victory. The scenario should exercise: reinforcement (with at least one continent bonus on the world map, or just the count-based formula on a small map), attack (multiple captures across multiple turns), fortify, card draw on conquest, card turn-in (forced via the hand-limit trigger if possible, or voluntary via `bestCardsToTurnIn`), player elimination, victory. Snapshot at the moment `phase == .victory`.

**Open question for next session:** small custom map (5 countries, easier to drive scripted) or full world map (more realistic, exercises continent bonuses)? Recommendation: **small custom map**. The world map is hard to script deterministically end-to-end, and the goal is parity coverage, not realism — a 5-country pentagon `A-B-C-D-E-A` with two continents `Land1={A,B}` and `Land2={C,D,E}` would exercise the continent bonus naturally.

### Pending Tasks (Phase 1 remainder)

- [ ] Step 4.7: fixture 12 — full short game to victory (dump scenario, parity test, RED → GREEN)
- [ ] Step 5 — full REFACTOR sweep (mostly done; remaining row: input validation at API boundaries via `GameError` instead of silent early-returns)
- [ ] Step 6 — DOCUMENT (DocC articles, `swift package generate-documentation` clean)
- [ ] Step 7 — VERIFY (≥80% line coverage, tag v0.1.0, completion summary, move checklist to `04_99_COMPLETED/`)

### Context Loss Warning — Critical Items the Next Session Must Preserve

1. **`Card.wildSuit = -1` is now a public static constant**, NOT a magic literal. New wild cards must be constructed with `Card(name: "Wild N", countryId: nil, suit: Card.wildSuit)` — never with a bare `-1`. Same for any future wild detection: use `card.isWild`.

2. **Fixture 11's design depended on the elimination NOT being a victory.** With 2 players, eliminating one triggers victory and `pendingInput` is intentionally cleared (the game is over). With 3 players, P3 stays alive and the trigger fires correctly. **Fixture 12's design must account for this:** the final attack-to-victory will NOT trigger a forced turn-in even if the attacker is over the hand limit. If you want fixture 12 to also exercise forced turn-in, make sure the turn-in trigger fires on a *non-final* elimination.

3. **`pendingInput == nil` guards are now on every public mutating method.** Don't add a new public state-advancing method without the guard. New write `guard pendingInput == nil else { return }` as the FIRST line of any new mutating method that's not a `resolveX`.

4. **`testing_dealCard` and `testing_enterAssignArmies` are public test-only helpers.** Production callers must not use them. They're prefixed `testing_` and DocC-warned. If a future SwiftUI consumer accidentally calls one, that's a code review failure.

5. **`AttackResult.conquered` returns `true` on successful capture in Swift, but the TS reference returns `false`** (TS bug — checks `defender.armies >= 0` after the sentinel assignment). This isn't snapshotted, so doesn't affect parity. If a fixture ever asserts on `AttackResult` directly, the assertion needs to flip the bool when comparing across implementations.

6. **`incomeForCountries` uses `count / settings.incomeDivisor` (integer division) where TS uses `Math.floor(count / 3)`.** Equivalent for positive counts. The `count < settings.incomeMinimumThreshold ? settings.incomeMinimumValue : ...` quirk is preserved exactly even though `max(3, floor(count/3))` is algebraically equivalent.

7. **`Game.transferCountry` is no longer a "minimal version"** — it now bumps victories/defeats and `hasWonThisTurn`, removes from old owner's countries list, resets `tiredArmies`. Don't call it without thinking about whether `countVictory: true` is the right choice for the context.

8. **The `currentCardSetValue` field is private state on `Game` and is NOT in `GameSnapshot`.** It's verified indirectly through `unallocatedArmies` increments after a turn-in (5 → 6 bump shows up as a +5 to the player's army pool).

9. **`drawPile` and `discardPile` are still NOT in `GameSnapshot`.** The proposal §10 question 2 mentioned a `deckSignature: String` for verifying pile movement, but this was deferred since fixture 10 verifies the visible state changes are sufficient. If a future fixture genuinely needs to assert on pile contents, this is the moment to add `deckSignature`.

10. **CWD drift in Bash tool calls.** Running `npm run dump-fixtures` from `IconquerCore/` fails — must `cd /Users/jpurnell/.../iconquer && npm run dump-fixtures`. Same `swift test` issue: always `cd /Users/jpurnell/.../IconquerCore && swift test` as a single command.

11. **Fixture 11's `pendingInput` is set on the engine but NOT on victory.** If you need a fixture that asserts `pendingInput == nil` AFTER a victory, fixture 11's pattern (3 players, partial elimination) is the template.

### File Locations Quick Reference

| What | Where |
| :--- | :--- |
| Active checklist | `iconquer/development-guidelines/04_IMPLEMENTATION_CHECKLISTS/CURRENT_iconquer_core_phase1.md` |
| TS oracle notes | `iconquer/development-guidelines/02_IMPLEMENTATION_PLANS/UPCOMING/2026-04-06_TS_oracle_notes.md` |
| Phase 1 design proposal | `iconquer/development-guidelines/02_IMPLEMENTATION_PLANS/UPCOMING/2026-04-06_IconquerCore_Phase1.md` |
| Cards & PendingInput design proposal (APPROVED) | `iconquer/development-guidelines/02_IMPLEMENTATION_PLANS/UPCOMING/2026-04-07_IconquerCore_cards_and_pending_input.md` |
| Previous session summary | `iconquer/development-guidelines/05_SUMMARIES/2026-04-07_iconquer_step4_fixtures_1-3.md` |
| TS reference engine | `iconquer/src/core/game.ts` |
| TS RNG (mulberry32) | `iconquer/src/core/rng.ts` |
| Fixture dump script | `iconquer/scripts/dump-parity-fixtures.ts` |
| Parity fixtures | `IconquerCore/Tests/IconquerCoreTests/ParityFixtures/*.json` |
| Engine package | `IconquerCore/` (sibling repo) |
| Vendored map data (test bundle) | `IconquerCore/Tests/IconquerCoreTests/MapData/{Countries,Continents}.json` |
| `Game.swift` (now ~1000 lines) | `IconquerCore/Sources/IconquerCore/Rules/Game.swift` |
| `PendingInput.swift` | `IconquerCore/Sources/IconquerCore/Rules/PendingInput.swift` |
| `Combat.swift` (`AttackMode`, `AttackResult`) | `IconquerCore/Sources/IconquerCore/Rules/Combat.swift` |
| `Settings.swift` (20 fields) | `IconquerCore/Sources/IconquerCore/Rules/Settings.swift` |

### Recent Commits

**iconquer:**
```
9f7827f Phase 1 Step 4.6.4: REFACTOR audit ticks in Step 5 checklist
9edc5ae Phase 1 Step 4.6.3: fixture 11 + Cards row tick
92b1964 Phase 1 Step 4.6.2: fixture 10 dump scenario
d479394 Phase 1 Step 4.6.1: fixture 09 dump scenario
d7118db Phase 1 Step 4.6: approve Cards & PendingInput design proposal
6e1ecba Phase 1 Step 4.5: fixture 08 + checklist tick
1ff65f4 Phase 1 Step 4.4b/c: fixtures 06 + 07 + checklist tick
42ce3a6 Phase 1 Step 4.4: fixture 05 + checklist tick
5d7d413 Phase 1 Step 4.3: fixture 04 + checklist tick
3e43bdd Add session summary for Phase 1 Step 4 fixtures 01–03
```

**IconquerCore:**
```
ebbff23 Phase 1 Step 4.6.4: REFACTOR pass — magic numbers + heuristic dedup
52d77f5 Phase 1 Step 4.6.3: pendingInput blocker + fixture 11 GREEN
d2ddc04 Phase 1 Step 4.6.2: turnInCards + bestCardsToTurnIn GREEN
6fc8f57 Phase 1 Step 4.6.1: fixture 09 card-draw-on-conquest GREEN
7b13b92 Phase 1 Step 4.6.0: Cards & PendingInput plumbing (no behavior change)
6c0389c Phase 1 Step 4.5: fixture 08 fortify parity GREEN
4f0711f Phase 1 Step 4.4b/c: fixtures 06 + 07 attack-mode parity GREEN
3445816 Phase 1 Step 4.4: fixture 05 combat parity GREEN
c963292 Phase 1 Step 4.3: fixture 04 parity GREEN
```

### Phase 1 Progress Snapshot (end of session)

| # | Fixture | Coverage |
|---|---|---|
| 01 | start_no_assign | Game initialization, model layer |
| 02 | start_random_assign | RNG, deck init, country shuffle, first init drip |
| 03 | initialize_armies_first_drip | placeArmies, init rotation |
| 04 | initialize_armies_complete | Full init drain → Play, reinforcement income |
| 05 | attack_until_win_or_lose | Combat, capture sentinel, victory, elimination |
| 06 | attack_once | `.once` mode |
| 07 | attack_until_losses_exceed | `.untilLossesExceed` mode |
| 08 | fortify_adjacent_with_tired_sentinel | Fortify, `tiredArmies` arithmetic, adjacent-only |
| 09 | card_draw_on_conquest | finishTurn + takeCard |
| 10 | card_turn_in_set_value_bump | turnInCards, owned-country bonus |
| 11 | forced_turn_in_after_elimination | pendingInput, blocker guards, takeCards |
| **12 (next)** | **full_short_game** | **End-to-end victory, every system** |

---

**Session Duration:** one long focused session (4.3 → 4.6.4)
**AI Model Used:** Claude Opus 4.6 (1M context)
