# Session Summary: iconquer kickoff through Phase 1 Step 3

| Date | Phase | Status |
| :--- | :--- | :--- |
| 2026-04-06 | IconquerCore Phase 1 (Headless Rules Engine) | PARTIAL — Steps 0–3 complete, Step 4 next |

## 1. Core Objective

Kick off the iconquer Swift modernization project: stand up the Design-First TDD workflow, draft and approve the Phase 1 design proposal for `IconquerCore` (a headless Swift game engine), bootstrap the sibling repo, read and document the TypeScript reference engine, and build deterministic parity-fixture infrastructure so the Swift port can be developed scenario-by-scenario against the existing TS oracle.

## 2. Design Decisions

- **Decision:** Two sibling repos. `IconquerCore` (engine) at `/Users/jpurnell/Dropbox/Computer/Development/Swift/IconquerCore`; `iconquer` (app shell + TS reference + assets) at `/Users/jpurnell/Dropbox/Computer/Development/Swift/iconquer`.
  - **Rationale:** Engine should evolve independently; cleaner separation than nested `Packages/`.
  - **Memory:** `feedback_repo_layout.md` — sibling repos are Justin's default for engine/app splits.

- **Decision:** Hard-require iOS 26 / iPadOS 26 / macOS 26 / tvOS 26 / visionOS 26.
  - **Rationale:** Justin: "We can handle those device targets separately." Forces SPM tools-version 6.2 for `.v26` platform constants.

- **Decision:** Vendor `development-guidelines/` as plain files inside each project (no nested `.git`).
  - **Rationale:** Project state lives inside `development-guidelines/` (so it stays out of the project root) AND the upstream template stays clean of project references (so dozens of projects can share it). The only layout that satisfies both is to strip the cloned `.git` and let the outer project repo track everything.
  - **Memory:** `feedback_vendor_dev_guidelines.md` — vendor as plain files for any project.
  - **Side effect:** A `setup.swift` improvement was contributed back to the canonical template at `/Users/jpurnell/Dropbox/Computer/Development/Swift/Tools/development-guidelines/`. Justin applied it as commit `aeed697`. End-to-end verified in a throwaway project.

- **Decision:** Mirror the TypeScript RNG (mulberry32) bit-for-bit in Swift `UInt32` arithmetic.
  - **Rationale:** Trivially reproducible; no need to swap to SplitMix64 on both sides. Swift sketch lives in §1 of the oracle notes.

- **Decision:** AI lives in a separate `IconquerAI` module as **free functions** (not `extension Game`).
  - **Rationale:** Keeps `IconquerCore` pure rules; lets Phase 2 modernize AI radically (LLM-driven `PlayerStrategy` is the dogfood target).
  - **Memory:** `project_iconquer_ai_modernization.md`.

- **Decision:** **No hardcoded constants anywhere.** Every magic number from the TS source becomes a named field on `Settings` (or domain sub-config).
  - **Rationale:** Justin: "I don't want anything hard coded." Aligns with `00_CORE_RULES/11_NO_HARDCODED_CONSTANTS.md`.
  - **Memory:** `feedback_no_hardcoded_constants.md` (reusable across all Justin's projects).
  - **Catalog of 15 magic numbers to lift** lives in §14b of the oracle notes file.

- **Decision:** Model human-input pauses as a `PendingInput` enum instead of `mustTurnInCards`/`needsCardTurnIn` booleans on `Game`.
  - **Rationale:** Keeps `Game` as pure rules. AI ignores `pendingInput`; SwiftUI drives input resolution.

- **Decision:** Mirror two TS quirks that diverge from `RULES.md`, treating TS as the authoritative oracle:
  1. **Fortify is adjacent-only**, not arbitrary owned-path connectivity.
  2. **`defender.armies = -1` sentinel** for capture in the combat loop (`while defender.armies > -1`).
  3. **`tiredArmies = -1` fresh-army sentinel.**

## 3. Work Completed

### Step 0 — DESIGN ✅
- Phase 1 design proposal drafted, all open questions resolved with Justin, marked APPROVED, moved from PROPOSALS/ to UPCOMING/. Lives at `02_IMPLEMENTATION_PLANS/UPCOMING/2026-04-06_IconquerCore_Phase1.md`.

### Step 1 — Bootstrap ✅
- `IconquerCore` sibling repo created (`git init`, no remote).
- `Package.swift` (swift-tools-version 6.2, OS 26 platforms, Swift 6 strict concurrency).
- `Sources/IconquerCore/IconquerCore.swift` placeholder + `Tests/IconquerCoreTests/SmokeTests.swift` Swift Testing smoke test.
- `swift build` and `swift test` both green, zero warnings.
- Initial commit `ea5fc3e Initial package skeleton`.
- `development-guidelines/` vendored into both `iconquer` and `IconquerCore` (commits `ffd5bbb` and `832f52c`).
- Engine-scoped master plan customized in `IconquerCore/development-guidelines/00_CORE_RULES/00_MASTER_PLAN.md`.

### Step 2 — Read & document the TS oracle ✅
- Full read of `iconquer/src/core/{game.ts, rng.ts, defaults.ts}`, `iconquer/src/types/game.ts`, `iconquer/src/plugins/maps/world.ts`.
- Notes file at `02_IMPLEMENTATION_PLANS/UPCOMING/2026-04-06_TS_oracle_notes.md` covering:
  - RNG algorithm (mulberry32) with Swift mirror sketch
  - Phase machine transitions
  - Reinforcement formula and the `count < 9 ? 3 : floor(count/3)` quirk
  - Combat semantics including the `-1` sentinel
  - Card lifecycle and `bestCardsToTurnIn` heuristic
  - Fortify (adjacent-only)
  - Player elimination rotation logic
  - State layout to mirror in Swift
  - AI plugin surface (deferred to Phase 2)
  - Settings catalog of 15 magic numbers to lift into named config

### Step 3 — Parity fixture infrastructure ✅
- `iconquer/scripts/dump-parity-fixtures.ts` written.
- Loads the real world map from `public/maps/iconquer-world/{Countries,Continents}.json` via `fs` (no fetch dependency).
- Deterministic JSON: keys sorted recursively before serialization (arrays preserve order — they encode game semantics).
- 3 starter scenarios implemented:
  1. `01_start_no_assign` — startGame with `assignCountries: false` → PickCountries phase, no owners
  2. `02_start_random_assign` — startGame with `assignCountries: true`, seed 42 → InitializeArmies phase, P1 receives first 5-army drip
  3. `03_initialize_armies_first_drip` — place P1's first 5 armies, snapshot the transition
- `npm run dump-fixtures` script + `tsx` devDep added.
- **Determinism verified:** ran the script twice, all 3 fixtures are byte-identical via `diff -q`.
- Sanity checks confirm the engine semantics we documented (turnNumber=1, P1 at 5/15 unallocated armies, others at 0/20, etc.).

### Tests Written (RED phase)
- None yet. Step 4 starts the engine port.

### Implementation (GREEN phase)
- None yet. The Swift engine is still just the placeholder `IconquerCore.swift` from Step 1.

## 4. Mandatory Quality Gate

**`IconquerCore`:** `swift build` and `swift test` both pass with zero warnings as of commit `ea5fc3e`. Only the smoke test exists; no engine code yet to gate.

| Check | Status |
| :--- | :--- |
| **build** | ✅ (placeholder package) |
| **test** | ✅ (1/1 smoke test) |
| **safety** | ✅ (no engine code yet) |
| **doc-lint** | n/a |
| **doc-coverage** | n/a (no public API beyond `IconquerCore.version`) |

## 5. Project State Updates

- ✅ Active checklist updated through Step 3: `development-guidelines/04_IMPLEMENTATION_CHECKLISTS/CURRENT_iconquer_core_phase1.md`
- ✅ `00_MASTER_PLAN.md` customized in both repos
- ✅ Three reusable feedback memories saved (sibling repos, vendor guidelines, no hardcoded constants, no `String(format:)`)
- ✅ One project memory (iconquer AI modernization)
- ✅ Patch applied upstream by Justin: canonical `Tools/development-guidelines` commit `aeed697`

## 6. Next Session Handover (Context Recovery)

### Immediate Starting Point

**Begin Step 4 — Engine port (RED → GREEN, scenario by scenario), starting with the first failing test in `IconquerCore`.**

The very first sub-task:

> Decode `Tests/IconquerCoreTests/ParityFixtures/01_start_no_assign.json` into a Swift `GameSnapshot` struct, then run `Game.start(seed: 42, players: [...P1, P2, P3...], settings: Settings(assignCountries: false))` and assert the resulting snapshot equals the decoded fixture.

To make that test even compile, you'll need to scaffold (as empty stubs initially):
1. `Sources/IconquerCore/Model/PlayerId.swift`, `CountryId.swift` — `Hashable, Sendable, RawRepresentable<String>` newtypes
2. `Sources/IconquerCore/Model/Country.swift` — `Country` struct mirroring `CountryState` from `iconquer/src/types/game.ts` (id, ownerId?, armies, tiredArmies, reserveArmies, selected)
3. `Sources/IconquerCore/Model/Player.swift` — `Player` struct (id, name, color, isComputer, countries, cards, unallocatedInitialArmies, unallocatedArmies, hasWonThisTurn, victories, defeats)
4. `Sources/IconquerCore/Model/Card.swift` — `Card` struct (name, countryId?, suit)
5. `Sources/IconquerCore/Model/GameSnapshot.swift` — `GameSnapshot` struct with the same field set as the JSON fixture (phase, turnPhase, turnNumber, currentPlayerId, currentCountryId?, countries: [String: Country], players: [String: Player], winnerId?, mustTurnInCards, needsCardTurnIn). Make it `Codable` so JSON decode just works.
6. `Sources/IconquerCore/Rules/Phase.swift` — `GamePhase` and `TurnPhase` enums with `String` raw values matching the TS lowercase strings (`"pickCountries"`, `"initializeArmies"`, `"play"`, `"victory"`, `"assignArmies"`, `"attack"`, `"fortify"`, `"done"`)
7. `Sources/IconquerCore/Rules/Settings.swift` — `Settings` struct with **all 15 fields** from §14b of the oracle notes, default values matching the TS reference exactly. **No magic numbers in the engine code.** This is a hard rule.
8. `Sources/IconquerCore/Errors/GameError.swift` — `GameError` enum (start with the 4 cases in the master plan error registry; add as needed)
9. `Sources/IconquerCore/Random/SeededRNG.swift` — mulberry32 implementation per §1 of the oracle notes. Write a focused unit test BEFORE the parity test that asserts the first 10 values of `SeededRNG(seed: 42)` match what `tsx -e 'import {Rng} from "./src/core/rng.js"; const r = new Rng(42); for (let i = 0; i < 10; i++) console.log(r.next());'` produces.
10. `Sources/IconquerCore/Rules/Game.swift` — `Game` struct stub. Just enough to compile: `init(seed:players:settings:)`, `func snapshot() -> GameSnapshot`. The first failing test only needs `snapshot()` to return a struct that decodes equal to fixture 01.

**Order of operations:**
1. Stand up the model stubs and `Settings` (no behavior, just types). Build green.
2. Write the failing parity test for fixture 01. RED.
3. Implement just enough of `Game` to make fixture 01 pass. GREEN.
4. Move to fixture 02. The RNG is required here (mulberry32) plus `randomlyPickCountries` plus the first `beginTurnIfReady` drip. Substantial step.
5. Move to fixture 03. Implements `placeArmies` for InitializeArmies phase plus `advanceInitializationTurn`.
6. Add a 4th scenario to the dump script for the next behavior we want to pin (probably an attack), and continue.

### Pending Tasks (Step 4 high-level)

- [ ] Model stubs (10 files above)
- [ ] `SeededRNG` with focused unit tests
- [ ] Parity test infrastructure (JSON loader helper, `assertSnapshotMatchesFixture` helper)
- [ ] Fixture 01 RED → GREEN
- [ ] Fixture 02 RED → GREEN (RNG + random pick)
- [ ] Fixture 03 RED → GREEN (placeArmies + drip transition)
- [ ] Add fixtures 04+ as additional behaviors are pinned

### Blockers

None. All open questions resolved. The TS reference is playable and reproducible. Fixtures are deterministic. Engine work is unblocked.

### Context Loss Warning

Several non-obvious items the next session **must** preserve:

1. **`tiredArmies = -1` is a sentinel meaning "fresh," not "negative."** When the engine sets `country.tiredArmies = -1` it means "no armies are tired this turn." When `placeArmies` adds N armies to a non-source country during fortify, it does `tiredArmies += N`, taking the value from `-1` to `(N - 1)`. Don't "fix" this to use `0` as the fresh value — it would break parity.

2. **`defender.armies = -1` is the capture sentinel.** The combat loop is `while attacker.armies > 0 && defender.armies > -1`. The country falls when defender hits `-1`. After capture, `defender.armies = armiesToMove - 1` (the new owner's army count). Don't refactor this to use a separate `captured: Bool` flag — it would break parity unless you very carefully replicate every state transition.

3. **The TS reference `incomeForCountries` formula is `count < 9 ? 3 : floor(count / 3)`**, which is mathematically equivalent to `max(3, floor(count / 3))`. Either form is fine in Swift; pick one and document the equivalence in DocC.

4. **Fortify is adjacent-only**, not arbitrary connected paths through owned territories. RULES.md is documentation drift; trust the TS implementation.

5. **`unallocatedInitialArmies` is NOT hardcoded to 20 in Swift.** It's `Settings.initialArmiesPerPlayer` with default 20. Same goes for the 5-army drip (`Settings.initialArmyDripPerTurn`), the 4-card hand limit (`Settings.cardHandLimit`), the starting set value (`Settings.firstCardSetValue`), and the income threshold (`Settings.incomeMinimumThreshold` / `Settings.incomeMinimumValue`). See §14b of the oracle notes for the full catalog. **Hard rule: no magic numbers in engine code.**

6. **AI helpers (`attackRandomCountries`, `mostVulnerableNeighbor`, `threat`, etc.) DO NOT belong on `Game` in Swift.** They will live in a separate `IconquerAI` module in Phase 2. Phase 1 only ports the rules engine. If you find yourself wanting to add `func threat(_:)` to `Game`, stop — that's Phase 2 work.

7. **The TS engine is a class with mutation. The Swift port is a struct with `mutating func`s.** Do not introduce a class. Value semantics + `Sendable` are non-negotiable per `01_CODING_RULES.md` and Phase 1's design.

8. **Use Swift Testing (`@Test`, `#expect`), not XCTest.** The smoke test already does so.

9. **`needsCardTurnIn` and `mustTurnInCards` boolean flags from the TS engine should be replaced with a `PendingInput?` enum on `Game`.** This was decided in the oracle notes — don't faithfully port the booleans even though parity tests will need to handle the difference. The fixture JSON files include `needsCardTurnIn: false` and `mustTurnInCards: false` from the TS snapshots, so the parity helper needs to translate `pendingInput == nil` to those two booleans both being false.

10. **Mulberry32 RNG: `Math.imul(a, b)` in JS = signed 32-bit multiplication. In Swift `UInt32`, use `&*` (wrapping multiply). The bit pattern is identical.** Verify the first 10 values match before trusting the parity tests.

### File Locations Quick Reference

| What | Where |
| :--- | :--- |
| Active checklist | `iconquer/development-guidelines/04_IMPLEMENTATION_CHECKLISTS/CURRENT_iconquer_core_phase1.md` |
| Phase 1 design proposal | `iconquer/development-guidelines/02_IMPLEMENTATION_PLANS/UPCOMING/2026-04-06_IconquerCore_Phase1.md` |
| TS oracle notes (READ FIRST) | `iconquer/development-guidelines/02_IMPLEMENTATION_PLANS/UPCOMING/2026-04-06_TS_oracle_notes.md` |
| TS reference engine | `iconquer/src/core/game.ts` |
| TS RNG (mulberry32) | `iconquer/src/core/rng.ts` |
| Fixture dump script | `iconquer/scripts/dump-parity-fixtures.ts` |
| Parity fixtures | `IconquerCore/Tests/IconquerCoreTests/ParityFixtures/*.json` |
| Engine package | `IconquerCore/` (sibling repo) |
| iconquer master plan | `iconquer/development-guidelines/00_CORE_RULES/00_MASTER_PLAN.md` |
| IconquerCore master plan | `IconquerCore/development-guidelines/00_CORE_RULES/00_MASTER_PLAN.md` |

### Recent Commits

**iconquer:**
```
e88aaea Add parity fixture dump tooling for IconquerCore Swift port
ffd5bbb Adopt development-guidelines workflow (vendored)
dbe760e Implemented game!  ← pre-Swift TS reference work
```

**IconquerCore:**
```
ef16be7 Add 3 parity fixtures from the TypeScript oracle
832f52c Adopt development-guidelines workflow (vendored)
ea5fc3e Initial package skeleton
```

**Tools/development-guidelines (canonical):**
```
aeed697 Scaffold project state inside development-guidelines/  ← applied by Justin
```

---

**Session Duration:** ~one long session
**AI Model Used:** Claude Opus 4.6 (1M context)
