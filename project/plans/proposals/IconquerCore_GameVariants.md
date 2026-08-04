# Design Proposal: Game Variant Support in iConquer

**Date:** 2026-04-10
**Status:** Proposed
**Scope:** Extend IconquerCore with official Risk game variants (Capital Risk, Mission Risk, Two-Player Neutral, card value modes, fortify modes, attack modes, territory card bonus)

---

## 1. Objective

Add configurable game variants to IconquerCore so that players can choose from the official Risk rule sets and common house rules, rather than being locked into a single ruleset.

**Problems solved:**
1. **Single ruleset only.** The engine currently implements only standard Risk (conquer all territories). Official Risk rules define multiple game modes (Capital Risk, Mission Risk, Two-Player with Neutral) that significantly change strategy and game length.
2. **Incorrect card progression.** The current linear card value system (`firstCardSetValue + N * cardValueIncrement`) does not match the official Risk card schedule (4, 6, 8, 10, 15, 20, 25, 30...), which has a non-linear jump at the 5th set.
3. **No fortify flexibility.** The engine only supports adjacent-territory fortification. The most common house rule (connected fortification via any chain of friendly territories) is not available.
4. **No attack variants.** Blitz mode (resolve entire battles at once) and balanced dice (ties to attacker) are popular variants with no support.
5. **Longer game times.** Capital Risk and Mission Risk produce substantially shorter games, which is important for AI tournaments and casual play. Without variant support, all games must run to total conquest.

**Master Plan Reference:** Phase 2+ -- gameplay depth and replayability. Variant support directly enables the LLM tournament vision where different rulesets test different strategic capabilities.

---

## 2. Proposed Architecture

### New Files

| File | Module | Purpose |
|------|--------|---------|
| `Sources/IconquerCore/Rules/GameVariant.swift` | IconquerCore | `GameVariant`, `CardValueMode`, `FortifyMode`, `AttackMode` enums |
| `Sources/IconquerCore/Rules/Mission.swift` | IconquerCore | `Mission` struct, `MissionCondition` enum, predefined mission pool |
| `Sources/IconquerCore/Rules/WinCondition.swift` | IconquerCore | Win condition checker dispatching on variant type |
| `Sources/IconquerCore/Rules/CardValueSchedule.swift` | IconquerCore | Card value calculation for each `CardValueMode` |
| `Sources/IconquerCore/Rules/FortifyRules.swift` | IconquerCore | Fortify validation logic per `FortifyMode` (adjacent, connected, multiple) |
| `Sources/IconquerCore/Rules/NeutralPlayer.swift` | IconquerCore | Neutral player setup and army placement logic for two-player mode |

### Modified Files

| File | Change |
|------|--------|
| `Sources/IconquerCore/Rules/Settings.swift` | Add `variant`, `cardValueMode`, `fortifyMode`, `attackMode`, `neutralArmyCount` fields |
| `Sources/IconquerCore/Game.swift` | Win condition check dispatches to `WinCondition`; card value lookup dispatches to `CardValueSchedule`; fortify validation dispatches to `FortifyRules` |
| `Sources/IconquerCore/Player.swift` | Add optional `capital: CountryId?` and `mission: Mission?` fields |
| `Sources/IconquerCore/Map/Country.swift` | No changes -- capitals are tracked on `Player`, not `Country` |

### Module Placement

All new code lives in `IconquerCore/Rules/`. No new modules are created. The variant system extends the existing `Settings`-driven engine configuration pattern. No UI code is added here -- presentation of variant options belongs in IconquerCLI (setup screen) and IconquerApp (SwiftUI).

### Data Flow

```
Settings.variant ──> Game.checkWinCondition() ──> WinCondition.check()
                                                     │
                              ┌───────────────────────┼────────────────┐
                              v                       v                v
                     .standard:              .capital:           .mission:
                     checkTotalConquest()     checkAllCapitals() checkMissionCompletion()

Settings.cardValueMode ──> CardValueSchedule.value(forSetNumber:) ──> army bonus

Settings.fortifyMode ──> FortifyRules.validate(from:to:game:) ──> Bool

Settings.attackMode ──> Game.attack() ──> dice resolution behavior
```

---

## 3. API Surface

### GameVariant

```swift
/// The primary game mode determining win conditions and setup rules.
///
/// Each variant changes how the game ends and may alter setup (e.g., capital
/// selection, mission assignment, neutral player creation).
public enum GameVariant: String, Codable, Sendable, CaseIterable, Hashable {
    /// Conquer all territories to win. The classic Risk experience.
    case standard

    /// Each player secretly selects a capital at game start.
    /// Win by capturing all opponent capitals.
    case capital

    /// Each player receives a secret mission card at game start.
    /// First to complete their mission wins.
    case mission

    /// Two human/AI players plus a neutral third player controlled
    /// by simple placement rules. Standard win condition applies.
    case twoPlayerNeutral
}
```

### CardValueMode

```swift
/// How card set trade-in values escalate over the course of the game.
///
/// The mode determines the army bonus granted when a player turns in
/// a valid set of territory cards.
public enum CardValueMode: String, Codable, Sendable, CaseIterable, Hashable {
    /// Official Risk progression: 4, 6, 8, 10, 15, 20, 25, 30, 35, 40...
    /// Non-linear jump at the 5th set, then +5 per set thereafter.
    case officialProgressive

    /// Current engine default: `firstCardSetValue + N * cardValueIncrement`.
    /// Produces a simple linear ramp configurable via Settings fields.
    case linear

    /// Every set is worth the same fixed value (e.g., 10 armies).
    /// Configured via `Settings.firstCardSetValue`.
    case fixed

    /// Steeper escalation: 4, 8, 12, 16, 20... (4 * setNumber).
    case escalating
}
```

### FortifyMode

```swift
/// Rules governing end-of-turn army movement (fortification).
public enum FortifyMode: String, Codable, Sendable, CaseIterable, Hashable {
    /// Standard: move armies to one adjacent friendly territory per turn.
    case adjacent

    /// House rule: move armies to any friendly territory reachable via
    /// a connected chain of friendly territories (BFS path validation).
    case connected

    /// Variant: multiple fortify moves per turn (each still requires
    /// adjacency or connectivity depending on base rule).
    case multiple
}
```

### AttackMode

```swift
/// Dice resolution rules for combat.
public enum AttackMode: String, Codable, Sendable, CaseIterable, Hashable {
    /// Standard: attacker rolls up to 3, defender up to 2. Ties go to defender.
    case standard

    /// Balanced: same dice counts as standard, but ties go to attacker.
    case balanced

    /// Blitz: resolve the entire battle in a single action (repeated dice
    /// rolls until attacker retreats or defender is eliminated).
    case blitz
}
```

### Mission

```swift
/// A secret objective assigned to a player in Mission Risk.
///
/// The mission is checked at the end of each turn. The first player
/// to satisfy their mission condition wins immediately.
public struct Mission: Codable, Sendable, Hashable {
    /// Human-readable description shown to the owning player.
    public var description: String

    /// The machine-checkable win condition.
    public var condition: MissionCondition

    /// Predefined mission conditions for Mission Risk.
    public enum MissionCondition: Codable, Sendable, Hashable {
        /// Conquer all territories in the named continents.
        case conquerContinents([String])

        /// Eliminate a specific player (destroy all their armies).
        /// If that player is already eliminated, the fallback is
        /// to control 24 territories.
        case destroyPlayer(PlayerId)

        /// Control at least `count` territories, each with at least
        /// `minArmies` armies stationed.
        case controlTerritories(count: Int, minArmies: Int)

        /// Control any `count` complete continents (player owns every
        /// territory in each).
        case controlContinentsAny(count: Int)
    }
}
```

### CardValueSchedule

```swift
/// Calculates the army bonus for card set trade-ins based on the active mode.
public enum CardValueSchedule {

    /// The official Risk card value progression.
    ///
    /// Sets 1-4: 4, 6, 8, 10. Set 5: 15. Set 6+: 20, 25, 30, 35...
    public static let officialSchedule: [Int] = [
        4, 6, 8, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60
    ]

    /// Returns the army bonus for the Nth card set trade-in (1-indexed).
    ///
    /// - Parameters:
    ///   - setNumber: The ordinal set number (1 = first trade-in).
    ///   - mode: The active card value mode.
    ///   - settings: Game settings (used for `linear` and `fixed` modes).
    /// - Returns: The number of bonus armies granted.
    public static func value(
        forSetNumber setNumber: Int,
        mode: CardValueMode,
        settings: Settings
    ) -> Int
}
```

### WinCondition

```swift
/// Evaluates whether any player has won the game under the active variant.
public enum WinCondition {

    /// Check win conditions for the current game state.
    ///
    /// - Parameter game: The current game state snapshot.
    /// - Returns: The winning player's ID, or nil if no winner yet.
    public static func check(game: Game) -> PlayerId?
}
```

### FortifyRules

```swift
/// Validates and executes fortification moves based on the active mode.
public enum FortifyRules {

    /// Check whether a fortify move from `source` to `destination` is legal.
    ///
    /// - Parameters:
    ///   - source: The country moving armies out.
    ///   - destination: The country receiving armies.
    ///   - game: The current game state (for ownership and adjacency).
    /// - Returns: `true` if the move is legal under the active fortify mode.
    public static func isValid(
        source: CountryId,
        destination: CountryId,
        game: Game
    ) -> Bool

    /// Find all friendly territories reachable from `source` via connected
    /// friendly territories (BFS). Used by `.connected` and `.multiple` modes.
    ///
    /// - Parameters:
    ///   - source: Starting territory.
    ///   - game: Current game state.
    /// - Returns: Set of reachable friendly CountryIds (excluding source).
    public static func reachableFriendlyTerritories(
        from source: CountryId,
        game: Game
    ) -> Set<CountryId>
}
```

### Settings Extensions

```swift
// Added to existing Settings struct:
public extension Settings {
    /// The game variant (win condition and setup rules).
    var variant: GameVariant  // default: .standard

    /// How card trade-in values escalate.
    var cardValueMode: CardValueMode  // default: .officialProgressive

    /// Fortification rules.
    var fortifyMode: FortifyMode  // default: .adjacent

    /// Attack/dice resolution rules.
    var attackMode: AttackMode  // default: .standard

    /// Army count for the neutral player in two-player mode.
    var neutralArmyCount: Int  // default: 40

    /// Whether the territory card bonus is active (official: +2 armies
    /// when trading in a card for a territory you own).
    /// Note: ownedCardCountryBonus already exists and controls the value.
    /// This field is already present as `ownedCardCountryBonus: Int`.
}
```

### Player Extensions

```swift
// Added to existing Player struct:
public extension Player {
    /// The player's capital territory (Capital Risk only).
    /// Set during setup, revealed when the territory is captured.
    var capital: CountryId?  // default: nil

    /// The player's secret mission (Mission Risk only).
    /// Assigned at game start from the mission pool.
    var mission: Mission?  // default: nil
}
```

---

## 4. MCP Schema

No new MCP tools. The variant configuration is part of `Settings` which is already exposed through the game initialization path. AI agents interact with the game engine the same way regardless of variant -- the engine enforces rules and checks win conditions internally.

**Future consideration:** An MCP `get_mission` tool could let an AI agent query its own secret mission. For now, the mission is accessible through the game state visible to the agent.

**REQUIRED STRUCTURE (JSON) -- Settings variant fields:**

```json
{
  "variant": "capital",
  "cardValueMode": "officialProgressive",
  "fortifyMode": "connected",
  "attackMode": "standard",
  "neutralArmyCount": 40
}
```

**Parameter Types:**
- `variant` (string): One of `"standard"`, `"capital"`, `"mission"`, `"twoPlayerNeutral"`.
- `cardValueMode` (string): One of `"officialProgressive"`, `"linear"`, `"fixed"`, `"escalating"`.
- `fortifyMode` (string): One of `"adjacent"`, `"connected"`, `"multiple"`.
- `attackMode` (string): One of `"standard"`, `"balanced"`, `"blitz"`.
- `neutralArmyCount` (integer): Armies for the neutral player in two-player mode (default 40).

---

## 5. Constraints & Compliance

**Concurrency:** All new types (`GameVariant`, `CardValueMode`, `FortifyMode`, `AttackMode`, `Mission`, `MissionCondition`) are `Sendable` enums or structs. `WinCondition`, `CardValueSchedule`, and `FortifyRules` are stateless enum namespaces with pure static functions. No shared mutable state.

**No force unwraps:** `CardValueSchedule` uses bounds-checked array access with fallback calculation for indices beyond the official schedule table. `WinCondition` returns `nil` (no winner) rather than force-unwrapping player lookups. BFS in `FortifyRules` uses safe set operations.

**No hardcoded constants:** The official card schedule is a named static constant (`officialSchedule`). The neutral army count is a `Settings` field. Mission parameters (territory counts, army thresholds) are embedded in the `MissionCondition` associated values, not scattered as magic numbers.

**Division safety:** `CardValueSchedule.value()` for `.linear` mode uses the existing `incomeDivisor` pattern with guard checks. No division occurs in other modes.

**Guard clauses:** `value(forSetNumber:)` guards `setNumber > 0`. `WinCondition.check()` guards against empty player lists. `FortifyRules.isValid()` guards ownership checks before pathfinding.

**Swift 6 strict concurrency:** All types are `Sendable`. BFS uses local `var visited: Set<CountryId>` -- no escaping closures or actor isolation needed.

**No `String(format:)`:** Mission descriptions use string interpolation.

**No forbidden patterns:** No force casts, no `try!`, no recursive inits. Enum-based dispatch replaces any potential for recursive condition checking.

---

## 6. Backend Abstraction (If Compute-Intensive)

The BFS pathfinding in `FortifyRules.reachableFriendlyTerritories()` is the only operation with non-trivial complexity. On the standard 42-territory world map, BFS visits at most 42 nodes -- negligible. On hypothetical large custom maps (hundreds of territories), BFS remains O(V + E) which is well within acceptable limits for a turn-based game.

No Accelerate/vDSP or background computation is needed. All operations are synchronous and complete in microseconds on any realistic map size.

---

## 7. Dependencies

**Internal Dependencies:**
- `IconquerCore/Rules/Settings.swift` -- extended with new fields (modified)
- `IconquerCore/Player.swift` -- extended with `capital` and `mission` fields (modified)
- `IconquerCore/Game.swift` -- win condition and card value dispatch (modified)
- `IconquerCore/Map/MapDefinition.swift` -- continent data for mission checking (read-only)
- `IconquerCore/Map/Country.swift` -- adjacency data for connected fortify BFS (read-only)

**External Dependencies:** None. All variant logic is pure computation over existing game state types.

**Platform Dependencies:** None. All code is platform-independent.

**Cross-Module Impact:**
- `IconquerCLI` setup screen must present variant selection UI (separate proposal update)
- `IconquerApp` SwiftUI settings must expose variant options (future work)
- `IconquerAI` agents should be variant-aware (e.g., target capitals in Capital Risk) but this is a strategy enhancement, not a requirement -- agents that ignore variant-specific strategy will still function correctly

---

## 8. Test Strategy

**Test Categories:**

| Category | Tests |
|----------|-------|
| **Standard variant: regression** | All existing tests pass unchanged when `variant == .standard` |
| **Capital Risk: setup** | Each player can set a capital; capitals are persisted in game state |
| **Capital Risk: win** | Player who owns all capitals is declared winner; owning all but one capital is not a win |
| **Capital Risk: eliminated player** | When a player is eliminated, their capital transfers to the conqueror |
| **Mission Risk: assignment** | Each player receives exactly one mission at game start; no two players share a mission |
| **Mission: conquerContinents** | Player who owns all territories in the specified continents satisfies the condition |
| **Mission: destroyPlayer** | Player who eliminates the target player satisfies the condition; fallback to 24 territories if target already eliminated |
| **Mission: controlTerritories** | Player with >= N territories, each with >= M armies, satisfies the condition |
| **Mission: controlContinentsAny** | Player who controls any N complete continents satisfies the condition |
| **Card value: officialProgressive** | Sets 1-14 match the official schedule exactly; set 15+ follows +5 continuation |
| **Card value: linear** | `firstCardSetValue + N * cardValueIncrement` for N = 0, 1, 2, ... |
| **Card value: fixed** | Every set returns `firstCardSetValue` regardless of set number |
| **Card value: escalating** | Set N returns `4 * N` |
| **Card value: zero guard** | `value(forSetNumber: 0)` returns 0 for all modes |
| **Fortify: adjacent** | Can fortify to adjacent friendly territory; cannot fortify to non-adjacent |
| **Fortify: connected** | Can fortify to distant friendly territory connected through chain; cannot reach through enemy territory |
| **Fortify: connected BFS** | `reachableFriendlyTerritories` returns correct set on world map with mixed ownership |
| **Fortify: multiple** | Multiple moves allowed per turn; each move individually validated |
| **Attack: standard** | Ties go to defender |
| **Attack: balanced** | Ties go to attacker |
| **Attack: blitz** | Battle resolves completely in one call; result matches iterative resolution |
| **Two-player: setup** | Neutral player created with correct army count from settings |
| **Two-player: neutral placement** | Non-active player places neutral armies according to rules |
| **Settings: defaults** | Default Settings has `variant == .standard`, `cardValueMode == .officialProgressive`, `fortifyMode == .adjacent`, `attackMode == .standard` |
| **Settings: Codable** | Settings with all variant fields round-trips through JSON encode/decode |

**Reference Truth:**
- Official card schedule: 4, 6, 8, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60 (from ultraboardgames.com/risk/game-rules.php)
- Standard world map: 42 territories, 6 continents
- BFS pathfinding verified against hand-traced paths on the world map

**Validation Trace (REQUIRED):**

Card value validation:
- Create Settings with `cardValueMode = .officialProgressive`
- Assert `CardValueSchedule.value(forSetNumber: 1, ...)` == 4
- Assert `CardValueSchedule.value(forSetNumber: 5, ...)` == 15
- Assert `CardValueSchedule.value(forSetNumber: 10, ...)` == 40
- Assert `CardValueSchedule.value(forSetNumber: 15, ...)` == 65

Capital Risk validation:
- Create 3-player game with `variant = .capital`
- Set capitals: P1 -> Alaska, P2 -> Brazil, P3 -> Egypt
- P1 conquers Brazil (P2's capital) and Egypt (P3's capital)
- Assert `WinCondition.check(game:)` returns P1

Connected fortify validation:
- Create game on world map; P1 owns Alaska, Alberta, Ontario (connected chain)
- Enemy owns Northwest Territory (breaks direct Alaska-Ontario adjacency)
- With `.connected` mode: assert fortify Alaska -> Ontario is valid (path through Alberta)
- With `.adjacent` mode: assert fortify Alaska -> Ontario is invalid (not adjacent)

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [ ] Does this supersede an existing ADR? No
- [ ] Does this amend an existing ADR? No
- [x] New ADR required? Yes -- draft below

**New ADR Draft:**

```yaml
id: ADR-004
date: 2026-04-10
status: proposed
category: engine
title: Game variant support via Settings enum fields and dispatched rule modules
context: |
  IconquerCore implements a single game mode (standard Risk: conquer all
  territories). Official Risk rules define Capital Risk, Mission Risk, and
  Two-Player with Neutral variants. Card value progression, fortification
  rules, and attack resolution also have official and house-rule variants.
  Supporting these requires making the engine's rule evaluation configurable
  without polluting Game.swift with variant-specific branching.
decision: |
  Add enum fields to Settings (GameVariant, CardValueMode, FortifyMode,
  AttackMode) and dispatch rule evaluation to dedicated static-function
  modules (WinCondition, CardValueSchedule, FortifyRules). Each module
  switches on the relevant enum and applies variant-specific logic.
  Player gains optional capital and mission fields. New types and modules
  live in IconquerCore/Rules/.
rationale: |
  - Enum-based dispatch keeps Game.swift clean (one switch, not scattered ifs)
  - Static function modules are trivially testable (pure input -> output)
  - Settings remains the single source of truth for all game configuration
  - Existing games are unaffected (all defaults match current behavior)
  - New variants can be added by extending the enums and adding a case
consequences: |
  + Multiple official game modes available to players
  + Official card value schedule corrects the current linear-only system
  + Connected fortify enables the most popular house rule
  + AI tournament system can test strategies across variant combinations
  + Settings Codable conformance automatically includes new fields
  - Settings init gains 5 new parameters (mitigated by defaults)
  - Player struct grows with optional capital/mission fields
  - Game.swift gains dispatch points (but each is a single switch)
  - TS parity diverges further (TS engine has no variant support)
alternatives_rejected:
  - "Subclass Game per variant: violates value-type architecture"
  - "Protocol-based rule injection: over-abstracted for 4 variants"
  - "Separate game engines per variant: massive duplication"
  - "Runtime plugin system: unnecessary complexity for known variant set"
affected_files:
  - Sources/IconquerCore/Rules/Settings.swift (modified)
  - Sources/IconquerCore/Rules/GameVariant.swift (new)
  - Sources/IconquerCore/Rules/Mission.swift (new)
  - Sources/IconquerCore/Rules/WinCondition.swift (new)
  - Sources/IconquerCore/Rules/CardValueSchedule.swift (new)
  - Sources/IconquerCore/Rules/FortifyRules.swift (new)
  - Sources/IconquerCore/Rules/NeutralPlayer.swift (new)
  - Sources/IconquerCore/Player.swift (modified)
  - Sources/IconquerCore/Game.swift (modified)
supersedes: null
amends: null
superseded_by: null
```

---

## 10. Open Questions

1. ~~**Should missions be predefined or randomized from a pool?**~~ **RESOLVED:** Define a `MissionPool` with the standard set; deal randomly at game start. Custom missions supported in map files via the Game Builder app (see IDEAS/mapBuilder.md).

2. ~~**Should capital selection happen during setup or in-game?**~~ **RESOLVED:** Yes, capital selection occurs as an additional game phase after `initializeArmies` and before the first player turn. The setup screen shows a note: "Select your capital after placing armies."

3. ~~**Should we support custom missions defined in the map file?**~~ **RESOLVED:** Yes. The unified map file format will be extended with an optional `missions` array. The Game Builder app (see IDEAS/mapBuilder.md) provides the authoring UI for creating custom missions, mission pools, and scenario setups. The `MissionCondition` enum is designed to be extensible.

4. ~~**For connected fortify, how is the path validated?**~~ **RESOLVED:** BFS from the source territory through adjacent friendly territories. Standard algorithm for digital Risk.

5. ~~**Should blitz mode use actual dice rolls or statistical shortcuts?**~~ **RESOLVED:** Use actual repeated dice rolls. Not slow on modern hardware, and provides the dice log for display/replay.

6. ~~**How does `CardValueMode.linear` interact with existing Settings fields?**~~ **RESOLVED:** No backward compatibility concern — we are pre-release and taking the opportunity to make Settings more abstract, flexible, and customizable. The `CardValueMode` enum fully owns its schedule computation. The old `firstCardSetValue`/`cardValueIncrement` fields are replaced by the enum.

7. ~~**Should the neutral player in two-player mode be a real Player?**~~ **RESOLVED:** Yes. The neutral player has a real `PlayerId`, is a regular `Player` entry with `isNeutral: Bool = true`. Keeps the engine uniform — no special cases for ownership/elimination.

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (GameVariant, CardValueMode, FortifyMode, AttackMode, Mission, WinCondition, CardValueSchedule, FortifyRules, NeutralPlayer)
- Does explanation require 50+ lines? Yes (8 variant dimensions, setup rules, win conditions, card schedules, fortify pathfinding)
- Does it need theory/background context? Yes (official Risk rules, BFS for connected fortify, card value schedule rationale)

**Article Name:** `GameVariantsGuide.md`
(Placed in IconquerCore `.docc` catalog. Must NOT match any Swift symbol name.)

**Article Outline:**
1. Overview -- what variants are and how they interact with Settings
2. Standard Risk -- default behavior, no configuration needed
3. Capital Risk -- setup flow, capital selection phase, win condition
4. Mission Risk -- mission pool, assignment, per-turn checking, edge cases (target already eliminated)
5. Two-Player with Neutral -- neutral player creation, army placement rules, gameplay differences
6. Card value modes -- official schedule vs linear vs fixed vs escalating, with value tables
7. Fortify modes -- adjacent vs connected (with BFS explanation) vs multiple
8. Attack modes -- standard vs balanced vs blitz, dice resolution details
9. Combining variants -- which settings are independent (card mode + fortify mode) vs coupled (variant determines win condition)
10. Adding custom variants -- how to extend the enum and add a new case (developer guide)
