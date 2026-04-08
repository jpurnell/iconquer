# CURRENT: IconquerCore — Phase 1 (Headless Rules Engine)

**Design proposal:** `02_IMPLEMENTATION_PLANS/UPCOMING/2026-04-06_IconquerCore_Phase1.md`
**Started:** 2026-04-06
**Workflow:** Design-First TDD (DESIGN → RED → GREEN → REFACTOR → DOCUMENT → VERIFY)

---

## Step 0 — DESIGN
- [x] Draft proposal `2026-04-06_IconquerCore_Phase1.md`
- [x] Resolve open questions with Justin (sibling repo, OS 26 across all Apple platforms, hand-rolled xcodeproj, keep TS as live oracle, no licensing constraints)
- [x] Confirm TS reference is playable (`npm ci` / `npm run typecheck` / `npm run build` all clean as of 2026-04-06)
- [x] Move proposal `PROPOSALS/` → `UPCOMING/` and mark APPROVED

---

## Step 1 — Bootstrap the sibling repo
- [x] Create `../IconquerCore/` directory and `git init`
- [x] Add `Package.swift` (swift-tools-version: **6.2** — required for `.v26` platforms; OS 26 hard-required across iOS/iPadOS/macOS/tvOS/visionOS)
- [x] Add minimal `Sources/IconquerCore/IconquerCore.swift` placeholder so `swift build` succeeds
- [x] Add `Tests/IconquerCoreTests/SmokeTests.swift` with one Swift Testing smoke test
- [x] Verify: `swift build` and `swift test` both pass with zero warnings (commit ea5fc3e)
- [x] First commit: "Initial package skeleton"
- [ ] Add `IconquerCore/development-guidelines/` (clone) and run setup so the engine repo also follows the workflow
- [ ] Customize `IconquerCore`'s own `00_MASTER_PLAN.md` (engine-only scope)

---

## Step 2 — Read & document the TS oracle ✅
- [x] Full read of `iconquer/src/core/game.ts` — captured phase machine, action shapes, combat semantics, card lifecycle, fortify quirks
- [x] Full read of `iconquer/src/core/rng.ts` — confirmed it's mulberry32, bit-reproducible in Swift `UInt32`
- [x] Full read of `iconquer/src/core/defaults.ts` — settings table captured
- [x] Full read of `iconquer/src/types/game.ts` — type catalog mapped to Swift
- [x] Full read of `iconquer/src/plugins/maps/world.ts` — map loader contract captured
- [x] Noted RULES.md deviations (fortify adjacent-only, defender.armies=-1 sentinel for capture, 20 hardcoded initial armies, tiredArmies=-1 fresh sentinel) — all to be mirrored as-is, treating TS as the authoritative oracle
- [x] **RNG decision: mirror mulberry32 bit-for-bit.** No SplitMix64 swap needed.

Notes file: `development-guidelines/02_IMPLEMENTATION_PLANS/UPCOMING/2026-04-06_TS_oracle_notes.md`
Three non-blocking open questions for Justin captured at the bottom of that file.

---

## Step 3 — Parity fixture infrastructure ✅
- [x] Added `iconquer/scripts/dump-parity-fixtures.ts` that drives `src/core/game.ts` through scripted scenarios under fixed seeds and writes JSON snapshots
- [x] Loads the real world map from `public/maps/iconquer-world/{Countries,Continents}.json` via `fs` (no fetch dependency)
- [x] Deterministic JSON: keys sorted recursively before serialization (arrays preserve order — they encode semantics)
- [x] Initial 3 starter scenarios implemented:
  - `01_start_no_assign` — startGame with assignCountries=false → PickCountries phase, no owners
  - `02_start_random_assign` — startGame with assignCountries=true, seed=42 → InitializeArmies phase, P1 has 5/20 armies
  - `03_initialize_armies_first_drip` — place P1's first 5 armies, snapshot the transition
- [x] Determinism verified: re-ran twice, all 3 fixtures byte-identical
- [x] `npm run dump-fixtures` script added
- [x] Added `tsx` as devDep

Additional scenarios will be added incrementally during Step 4 as each engine phase reaches RED. The infrastructure is in place; new scenarios are just new entries in the `SCENARIOS` array.

---

## Step 4 — Engine port (RED → GREEN → REFACTOR, scenario by scenario)
For each scenario in this order, write the failing parity test first, then the minimum engine code to pass:

- [x] **RED/GREEN:** `Game.start(seed:)` enters `pickCountries`, players present, no countries owned (fixture 01 passing)
- [ ] **RED/GREEN:** Country picking distributes territories, transitions to `initializeArmies`
- [ ] **RED/GREEN:** Initial army placement, transitions to `play`
- [ ] **RED/GREEN:** Reinforcement: floor(territories/3), min 3, plus continent bonuses
- [ ] **RED/GREEN:** Attack — adjacency, ≥2 armies, hidden-dice resolution (1 die)
- [ ] **RED/GREEN:** Attack — multi-die (2, 3 dice) and `AttackMode` variants
- [ ] **RED/GREEN:** Capture & advance armies, including `advanceArmies` setting
- [ ] **RED/GREEN:** Player elimination + transfer
- [ ] **RED/GREEN:** Fortify — connectivity through owned countries, once per turn
- [ ] **RED/GREEN:** Cards — draw on conquest, turn-in values, `mustTurnInCards`
- [ ] **RED/GREEN:** Victory detection
- [ ] **RED/GREEN:** Full short-game scenario passes end-to-end against TS fixture

---

## Step 5 — REFACTOR
- [ ] Eliminate any duplication between phase handlers
- [ ] Confirm `Game` is `Sendable` and value-typed; no shared mutable state
- [ ] No force unwraps, no `try!`, no force casts
- [ ] All inputs validated at API boundaries with `GameError`

---

## Step 6 — DOCUMENT
- [ ] DocC comments on every public type and method
- [ ] DocC article: "Playing a full game in code"
- [ ] DocC article: "Mapping iConquer rules to IconquerCore" (cross-references RULES.md)
- [ ] `swift package generate-documentation` builds with zero warnings

---

## Step 7 — VERIFY (Quality Gate)
- [ ] `swift build` — zero warnings
- [ ] `swift test` — all tests pass, ≥80% line coverage on `IconquerCore`
- [ ] All parity fixtures pass
- [ ] DocC builds clean
- [ ] Tag `IconquerCore` v0.1.0
- [ ] Write session summary in `iconquer/05_SUMMARIES/05_00_PHASE_SUMMARIES/`
- [ ] Move this checklist to `04_99_COMPLETED/`

---

## Hygiene / Backlog (not blocking Phase 1)
- [ ] Resolve 2 high-severity npm audit warnings in TS reference deps
- [ ] Decide where Phase 2 Xcode app shell will live (this `iconquer` repo, or a third sibling repo)
