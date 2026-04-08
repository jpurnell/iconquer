# Session Summary: IconquerCore Phase 1 Step 4 — fixtures 1–3 GREEN

| Date | Phase | Status |
| :--- | :--- | :--- |
| 2026-04-07 | IconquerCore Phase 1 (Headless Rules Engine) | PARTIAL — Step 4 sub-fixtures 01/02/03 GREEN; fixture 04 (full init → first reinforcement) is the next RED. |

## 1. Core Objective

Begin the engine port itself: drive the Swift `IconquerCore` package from a placeholder skeleton into a working rules-engine kernel that passes the first three deterministic parity fixtures dumped from the TypeScript oracle. Each fixture isolates a specific phase transition under seed 42 against the real world map.

## 2. Design Decisions

- **Decision:** Map JSON (`Countries.json` / `Continents.json`) is vendored under `IconquerCore/Tests/IconquerCoreTests/MapData/` as a Swift Package test resource, rather than reading the sibling `iconquer` repo's `public/maps/...` at runtime.
  - **Rationale:** Justin: "There's a world where we play with alternate maps, so better to have that clean." Self-contained tests, alt-map friendly, no cross-repo path coupling.

- **Decision:** Use a hand-rolled top-level JSON key scanner in `MapLoader` to recover JSON insertion order for the country list.
  - **Rationale:** `JSONDecoder` discards key order on Apple platforms — even `KeyedDecodingContainer.allKeys` with a `DynamicCodingKey` returns hash order, not source order. The TS engine seeds its country shuffle from `Object.keys(map.countries)` (insertion order), so source order is part of the parity contract.
  - **Memory:** `feedback_jsondecoder_key_order.md` — reusable across all Swift/JSON-determinism work.

- **Decision:** Mirror the TypeScript constructor's call to `initializeDeck()` *before* `startGame()` in `Game.start()`.
  - **Rationale:** The TS constructor builds a 44-card deck (42 country cards + 2 wilds) and shuffles it via `rng.shuffle`, consuming ~43 RNG draws *before* `startGame` runs. Without mirroring this, the country shuffle in `randomlyPickCountries` diverges immediately. Discovered the hard way when fixture 02's first attempt produced a totally different P1 country list.

- **Decision:** Settings now holds 6 rule knobs (no magic numbers):
  - `assignCountries`, `initialArmiesPerPlayer`, `initialArmyDripPerTurn`, `numberOfWildCards`, `cardSuitsPerCountry`, `freshArmiesSentinel`. All defaults match the TS reference exactly.

- **Decision:** Defer the public `apply(_: GameAction)` API surface from the design proposal in favor of direct mutating methods (`Game.placeArmies(_:on:count:)`) until at least 4–5 fixtures are GREEN. Reduces churn while the engine is still growing.

## 3. Work Completed

### Step 4.1 — Fixture 01 (no-assign start) ✅

Scaffolded the rules-engine model layer end-to-end and made `01_start_no_assign` GREEN:

- **Model:** `PlayerId`, `CountryId` (single-value `Codable` newtypes, `Comparable`), `Card`, `Country`, `Player`, `GameSnapshot` — all `Hashable`, `Sendable`, `Codable`, mirroring the TS field set so fixture JSON decodes directly into them.
- **Rules:** `GamePhase`/`TurnPhase` enums with `String` raw values matching TS lowercase; `Settings` with 3 initial fields.
- **Map:** `MapDefinition` (with `Country` and `Continent` sub-types), `MapLoader`.
- **Errors:** `GameError` enum (4 starter cases).
- **Engine:** `Game.start(seed:players:settings:map:)` covering only the no-assign branch; `Game.snapshot()`.
- **Tests:** `ParityFixtureSupport` helper, `ParityTests.swift` with the first `@Test`. `Countries.json` + `Continents.json` vendored under `Tests/.../MapData/` and declared as resources in `Package.swift`.

Commit: `IconquerCore@a7869ca`. Checklist tick: `iconquer@e1edf64`.

### Step 4.2 — Fixtures 02 + 03 (random distribution + first drips) ✅

#### SeededRNG (mulberry32)

Implemented `Sources/IconquerCore/Random/SeededRNG.swift` mirroring `iconquer/src/core/rng.ts` bit-for-bit using `UInt32` with `&*` (wrapping multiply). Includes `next()`, `int(_:)`, `pick(_:)`, `shuffle(_:)`, `die()`. Modulus is `0x1p32` (algorithmic constant of mulberry32, not a tunable, so it stays in the file rather than `Settings`).

Three focused parity tests verify against the TS oracle:
- `next() x10` for seed 42 — exact `Double` equality
- `int(42) x10` — integer equality
- `shuffle([0..<10])` — array equality

#### MapLoader source-order preservation

Discovered `JSONDecoder` doesn't preserve key order on Apple platforms. Wrote `TopLevelKeyScanner` (~100 LOC, brace/bracket/string/escape state machine, scoped to top-level keys only — purpose-built, not a general JSON parser). The decoder still handles values; the scanner only recovers the key sequence. `MapLoader` then zips them.

`MapLoaderTests` verifies the loaded country order matches the dumped TS `Object.keys(Countries.json)` order exactly (42 entries, embedded in the test).

#### Game engine additions

- `Settings` grew 3 new fields: `initialArmyDripPerTurn`, `numberOfWildCards`, `cardSuitsPerCountry` (all from §14b of the oracle notes).
- `Game.initializeDeck()` + `shuffleDeck()` mirror the TS constructor's pre-`startGame` deck setup.
- `Game.randomlyPickCountries()` shuffles `map.countries.map(\.id)` (source order!), pops from end, round-robin assigns to `playersOrder[i % count]`.
- `Game.transferCountry(_:to:)` minimal version (no card-discard, no notification of old owner — added when a fixture demands it).
- `Game.donePickingCountries()` → `turnNumber += 1`, `phase = .initializeArmies`, `currentPlayerId = playersOrder[0]`, `beginTurnIfReady()`.
- `Game.beginTurnIfReady()` — InitializeArmies branch only: grants `min(initialArmyDripPerTurn, unallocatedInitialArmies)` to current player.
- `Game.placeArmies(_:on:count:)` (public): adds armies to country, decrements player allocation, calls `advanceInitializationTurn` when player runs out.
- `Game.advanceInitializationTurn()`: if any player still has initial armies, advance to next alive player and grant their drip; otherwise begin Play phase. **Note:** the `phase = .play` branch is structurally in place but its `beginTurnIfReady` (Play branch) is still a no-op pending fixture 04.
- `Game.nextAlivePlayer(after:)`: walks `playersOrder` skipping eliminated (zero-country) players.

Commit: `IconquerCore@1515c53`. Checklist tick: `iconquer@b3308e7`.

### Tests Written (RED phase)

- `RandomTests.swift` — 3 `@Test`s pinning mulberry32 parity (next, int, shuffle).
- `MapLoaderTests.swift` — 1 `@Test` pinning JSON source-order preservation.
- `ParityTests.swift` — 3 `@Test`s for fixtures 01, 02, 03.

### Implementation (GREEN phase)

All 8 tests passing as of `IconquerCore@1515c53`.

## 4. Mandatory Quality Gate

| Check | Status |
| :--- | :--- |
| **build** | ✅ zero warnings (`swift build`) |
| **test** | ✅ 8/8 (`swift test`) |
| **safety** | ✅ no force unwraps, no `try!`, no force casts. All optionals guarded; `transferCountry` and `placeArmies` early-return on missing keys. |
| **doc-lint** | ✅ DocC comments on every new public type and method. |
| **doc-coverage** | n/a (no DocC build target yet — Step 6) |

## 5. Project State Updates

- ✅ Active checklist updated through Step 4 sub-bullets 1 and 2: `04_IMPLEMENTATION_CHECKLISTS/CURRENT_iconquer_core_phase1.md` (the 3rd `RED/GREEN` row — country picking — and the 4th — initial army placement — are now ticked, but with annotation that fixture 03 only exercises the rotation, not the full transition to `.play` end-to-end).
- ✅ New feedback memory: `feedback_jsondecoder_key_order.md` (added to MEMORY.md).
- ✅ Two clean atomic commits in `IconquerCore` (`a7869ca`, `1515c53`) and two matching checklist-tick commits in `iconquer` (`e1edf64`, `b3308e7`).

## 6. Next Session Handover (Context Recovery)

### Immediate Starting Point

**Begin Step 4.3 — fixture 04 (full InitializeArmies completion → first AssignArmies turn).**

The very first sub-task:

> Extend `iconquer/scripts/dump-parity-fixtures.ts` with a 4th scenario that, after random distribution and the first drip, drives `placeArmies` repeatedly until *all* initial armies are spent for *all* players. Snapshot at the moment Play begins for P1 (i.e. `phase=play`, `turnPhase=assignArmies`, P1's `unallocatedArmies` = `incomeForCountries(P1.countries)`). Run `npm run dump-fixtures` to materialise `04_initialize_armies_complete.json` (or similar name) into `IconquerCore/Tests/IconquerCoreTests/ParityFixtures/`. Verify byte-determinism by re-running.

Then, on the Swift side:

1. Add a parity test for fixture 04 in `ParityTests.swift`. RED.
2. Implement the **Play branch** of `Game.beginTurnIfReady()` (TS lines 264–285):
   - `turnPhase = .assignArmies`
   - `player.hasWonThisTurn = false`
   - `if player.unallocatedArmies <= 0 { player.unallocatedArmies = incomeForCountries(player.countries) }`
   - The card-hand-limit branch (`cards.length > 4`) is dead code at this point (no cards drawn yet) — either implement it as a no-op or guard with a `// TODO: fixture 0X` marker.
3. Implement `Game.incomeForCountries(_:)`:
   - Lift the TS quirk's bare numbers into `Settings`: `incomeMinimumThreshold` (default 9), `incomeMinimumValue` (default 3). The catalog is in §14b of the oracle notes.
   - Formula: `count == 0 ? 0 : (count < threshold ? minValue : floor(count / 3))`. **Pick *one* form** (the `<` quirk or `max(3, floor(count/3))` — they're algebraically equivalent) and document the equivalence in DocC.
   - Continent bonus: for each continent in `map.continents`, if `continent.countries.allSatisfy { player.countries.contains($0) }`, add `continent.armies`. Use the existing `MapDefinition.continents` array.
4. Wire up the divisor itself. The TS uses `Math.floor(count / 3)`. The `3` is the **divisor**, not the same as the threshold. Lift that into Settings too — call it `incomeDivisor` (default 3) — to honour the no-magic-numbers rule.
5. Re-run `swift test`. GREEN.
6. Commit. Tick the checklist's "Reinforcement" row.

### Pending Tasks

- [ ] Fixture 04 RED → GREEN (full init → first AssignArmies turn, exercises `incomeForCountries`)
- [ ] Fixture 05 RED → GREEN (single attack capture — needs the dice resolver and `defender.armies = -1` capture sentinel)
- [ ] Fixture 06 RED → GREEN (single attack lose)
- [ ] Fixtures 07–10 per the oracle notes §15
- [ ] Eventually: introduce `apply(_: GameAction)` once the surface is concrete enough that the enum doesn't churn (Step 5 REFACTOR).
- [ ] Step 6 DOCUMENT — DocC articles + `swift package generate-documentation` clean.

### Blockers

None. The TS oracle is reproducible, RNG parity is locked in, and the engine state shape is stable.

### Context Loss Warning

Several non-obvious items the next session **must** preserve:

1. **`JSONDecoder` does NOT preserve key order on Apple platforms.** `MapLoader.TopLevelKeyScanner` is the workaround for the iConquer map files. If you ever decode another order-sensitive JSON file, reach for the same pattern (don't try `DynamicCodingKey.allKeys` again). See `feedback_jsondecoder_key_order.md`.

2. **`Game.start()` calls `initializeDeck()` BEFORE the assign-countries branch.** This is not optional — the TS constructor consumes ~43 RNG draws here. Removing the call (or moving it after `randomlyPickCountries`) will silently break parity for every fixture that uses random distribution.

3. **`Game.transferCountry` is currently a minimal version** — no old-owner notification, no card discard, no card-on-conquest, no `hasWonThisTurn` flag. These get added one at a time when a fixture demands them. Don't speculatively port the full TS version.

4. **`Game.placeArmies` does NOT yet enforce destinations/runtime guards.** The TS engine has `runtime.destinations.has(countryId)` and a `needsCardTurnIn` short-circuit. Both are deferred. When a fixture exercises an illegal placeArmies, those guards land — not before.

5. **The RNG state lives privately on `Game`.** `Game` has a `private var rng: SeededRNG`. It is *not* surfaced through `GameSnapshot` (yet). Future fixtures that need to compare RNG advancement should add a hash-of-state field to `GameSnapshot`, not expose the raw seed.

6. **`drawPile`/`discardPile` are public-`private(set)` on `Game` but NOT in `GameSnapshot`.** When the first card-related fixture lands, decide whether the TS reference snapshots them and (if so) add them to `GameSnapshot`'s field set.

7. **`needsCardTurnIn` and `mustTurnInCards` are still hardcoded `false` in `Game.snapshot()`** because the `PendingInput?` field doesn't exist yet on `Game`. The first card fixture is the moment to introduce that type and translate it in `snapshot()`.

8. **No public `apply(_: GameAction)` API yet.** The design proposal called for one; for now there's just `Game.start(...)` + `Game.placeArmies(_:on:count:)`. Keep adding direct mutating methods until ~5 fixtures pass, then introduce the action enum in a REFACTOR step.

9. **Bash `cwd` drifts between tool calls in this session.** Always `cd /Users/jpurnell/Dropbox/Computer/Development/Swift/IconquerCore && swift test` as a single command — running `swift test` after a separate `cd` ran into "no tests found" errors twice when the working directory had silently moved to another package.

### File Locations Quick Reference

| What | Where |
| :--- | :--- |
| Active checklist | `iconquer/development-guidelines/04_IMPLEMENTATION_CHECKLISTS/CURRENT_iconquer_core_phase1.md` |
| TS oracle notes | `iconquer/development-guidelines/02_IMPLEMENTATION_PLANS/UPCOMING/2026-04-06_TS_oracle_notes.md` |
| Phase 1 design proposal | `iconquer/development-guidelines/02_IMPLEMENTATION_PLANS/UPCOMING/2026-04-06_IconquerCore_Phase1.md` |
| TS reference engine | `iconquer/src/core/game.ts` |
| TS RNG (mulberry32) | `iconquer/src/core/rng.ts` |
| Fixture dump script | `iconquer/scripts/dump-parity-fixtures.ts` |
| Parity fixtures | `IconquerCore/Tests/IconquerCoreTests/ParityFixtures/*.json` |
| Engine package | `IconquerCore/` (sibling repo) |
| Vendored map data (test bundle) | `IconquerCore/Tests/IconquerCoreTests/MapData/{Countries,Continents}.json` |
| `Game` engine | `IconquerCore/Sources/IconquerCore/Rules/Game.swift` |
| `SeededRNG` | `IconquerCore/Sources/IconquerCore/Random/SeededRNG.swift` |
| `MapLoader` + key scanner | `IconquerCore/Sources/IconquerCore/Map/MapLoader.swift` |

### Recent Commits

**iconquer:**
```
b3308e7 Tick Phase 1 Step 4.2 (fixtures 02 + 03 parity GREEN)
e1edf64 Tick Phase 1 Step 4.1 (fixture 01 parity GREEN)
e88aaea Add parity fixture dump tooling for IconquerCore Swift port
```

**IconquerCore:**
```
1515c53 Phase 1 Step 4.2: fixtures 02 + 03 parity GREEN
a7869ca Phase 1 Step 4.1: fixture 01 parity (no-assign start) GREEN
ef16be7 Add 3 parity fixtures from the TypeScript oracle
```

---

**Session Duration:** one focused working session
**AI Model Used:** Claude Opus 4.6 (1M context)
