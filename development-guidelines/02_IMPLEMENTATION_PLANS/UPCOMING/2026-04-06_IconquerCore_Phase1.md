# Design Proposal: IconquerCore — Phase 1 (Headless Rules Engine)

**Status:** APPROVED (2026-04-06)
**Date:** 2026-04-06
**Author:** Justin (with Claude)

---

## 1. Goal

Stand up a pure-Swift, platform-agnostic package — `IconquerCore` — that faithfully reproduces the rules of iConquer as encoded in `RULES.md` and the working TypeScript reference at `src/core/game.ts`. No UI in this phase. Success is defined by behavior parity with the TS reference under deterministic seeded RNG.

## 2. Non-Goals (Phase 1)

- No SwiftUI, no app target, no rendering.
- No new gameplay features beyond what the TS reference does.
- No new asset production. Existing PNGs/JSON in `public/maps/iconquer-world/` are read as-is.
- No AI player ports yet (Phase 2). Phase 1 exposes the *protocol* and a single `ScriptedPlayer` test double.

## 3. Package Layout

`IconquerCore` is a **sibling repo** (`../IconquerCore/`). Layout:

```
IconquerCore/                       # sibling repo, separate git history
├── Package.swift                 # Swift 6, swift-tools-version:6.0
├── Sources/IconquerCore/
│   ├── Model/
│   │   ├── PlayerId.swift
│   │   ├── CountryId.swift
│   │   ├── Country.swift
│   │   ├── Continent.swift
│   │   ├── Player.swift
│   │   ├── Card.swift
│   │   └── GameSnapshot.swift
│   ├── Map/
│   │   ├── MapDefinition.swift
│   │   └── MapLoader.swift       # Reads Countries.json + Continents.json
│   ├── Rules/
│   │   ├── Game.swift            # Top-level state + action dispatch
│   │   ├── Phase.swift           # GamePhase, TurnPhase
│   │   ├── Reinforcement.swift
│   │   ├── Combat.swift          # Hidden-dice resolver
│   │   ├── Fortification.swift
│   │   └── Cards.swift
│   ├── AI/
│   │   └── PlayerStrategy.swift  # Protocol only in Phase 1
│   ├── Random/
│   │   └── SeededRNG.swift       # Deterministic, mirrors src/core/rng.ts
│   ├── Errors/
│   │   └── GameError.swift
│   └── IconquerCore.docc/
└── Tests/IconquerCoreTests/
    ├── ParityFixtures/            # JSON snapshots from TS reference
    ├── PhaseMachineTests.swift
    ├── CombatTests.swift
    ├── ReinforcementTests.swift
    ├── FortificationTests.swift
    └── ParityTests.swift
```

## 4. Key Type Sketches

```swift
public struct PlayerId: Hashable, Sendable, RawRepresentable { public let rawValue: String }
public struct CountryId: Hashable, Sendable, RawRepresentable { public let rawValue: String }

public enum GamePhase: Sendable { case pickCountries, initializeArmies, play, victory }
public enum TurnPhase: Sendable { case assignArmies, attack, fortify, done }

public enum AttackMode: Sendable {
    case once
    case untilLossesExceed(Int)
    case untilWinOrLose
}

public struct Settings: Sendable {
    public var assignCountries: Bool
    public var attacksPerClick: AttackMode
    public var diceToRoll: Int     // 1...3, validated
    public var cardValues: Int
    public var allowTurningInCards: Bool
    public var advanceArmies: Bool
}

public struct Game: Sendable {
    public private(set) var phase: GamePhase
    public private(set) var turnPhase: TurnPhase
    public private(set) var turnNumber: Int
    public private(set) var currentPlayerId: PlayerId
    public private(set) var winnerId: PlayerId?
    // ... countries, players, current selection, card state

    public mutating func apply(_ action: GameAction) throws(GameError)
    public func snapshot() -> GameSnapshot
}

public enum GameAction: Sendable {
    case pickCountry(CountryId)
    case placeArmies(CountryId, count: Int)
    case attack(from: CountryId, to: CountryId, mode: AttackMode)
    case fortify(from: CountryId, to: CountryId, count: Int)
    case turnInCards([Card])
    case endPhase
}
```

`Game` is a `struct` with mutating methods so that tests and (eventually) the SwiftUI layer can use value semantics + `@Observable` wrappers. All randomness is injected via `SeededRNG` for determinism.

## 5. Parity Testing Strategy

The TypeScript reference is the oracle. We will:

1. Add a small Node script (`scripts/dump-parity-fixtures.mjs`) that drives `src/core/game.ts` through scripted scenarios with a fixed seed and writes `GameSnapshot` JSON files into `Tests/IconquerCoreTests/ParityFixtures/`.
2. Each Swift parity test loads the same scripted scenario, runs it through `Game`, and asserts the resulting `GameSnapshot` decodes to a value structurally equal to the JSON fixture.
3. Scenarios cover: country pick, initial army placement, a battle the attacker wins, a battle the attacker loses, continent-bonus reinforcement, fortification across owned countries, card turn-in, player elimination, full short game to victory.

This pins behavior without requiring a literal line-by-line port. If the TS reference has bugs we want to keep, we keep them; if we want to fix them, we fix both sides and re-dump.

## 6. RNG Compatibility

`src/core/rng.ts` will be inspected and reimplemented bit-for-bit in `SeededRNG.swift` (same algorithm, same seed → same stream). This is the linchpin of parity testing.

## 7. Decisions (resolved 2026-04-06)

1. **Package location:** `IconquerCore` lives in a **sibling repo** at `../IconquerCore/` (its own git history). This `iconquer` repo will consume it as a Swift Package dependency once it exists. Cleaner separation of engine vs. app.
2. **Deployment targets:** Hard-require **iOS 26 / iPadOS 26 / macOS 26 / tvOS 26 / visionOS 26**. Per-device target tuning happens later; the engine itself is platform-agnostic.
3. **Xcode app shell:** Hand-rolled `.xcodeproj`, checked in.
4. **TS reference:** Keep `src/` building and playable as a live oracle. Confirmed working today: `npm ci` clean, `npm run typecheck` clean, `npm run build` produces a 35 KB dist bundle. Two transitive high-severity npm audit warnings noted as a hygiene task; not blocking.
5. **License/attribution:** Personal project, no constraints.

## 8. Risks

- **No original Obj-C source** — we are trusting the TS port's interpretation of the original. Mitigation: parity fixtures lock current behavior; rule deviations from RULES.md get filed as bugs in *both* implementations.
- **Hidden-dice RNG drift** — if the TS RNG can't be cleanly reimplemented in Swift (e.g., depends on JS number quirks), parity tests will be brittle. Mitigation: read `rng.ts` first; if needed, replace both sides with a known algorithm (e.g., SplitMix64) before dumping fixtures.
- **Asset licensing** — see open question 5.

## 9. Acceptance Criteria

- `swift build` and `swift test` succeed on `Packages/IconquerCore` with zero warnings.
- ≥80% line coverage on `IconquerCore`.
- All parity fixtures pass.
- DocC builds with no warnings; public API is fully documented.
- A short DocC article walks through "play one full game in code."

## 10. Next Steps if Approved

1. Create `04_IMPLEMENTATION_CHECKLISTS/CURRENT_iconquer_core_phase1.md` from `TEMPLATE.md`.
2. Read `src/core/game.ts` and `src/core/rng.ts` end-to-end and capture any rule ambiguities.
3. RED: write the first failing test — `Game.start(seed:)` enters `pickCountries` with the configured players and zero-owned countries.
4. GREEN: minimal `Game` to pass.
5. Iterate phase by phase, dumping parity fixtures as each scenario stabilizes.
