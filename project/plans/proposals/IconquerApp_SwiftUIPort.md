# Design Proposal: IconquerApp SwiftUI Port

**Date:** 2026-04-23
**Status:** Proposed
**Scope:** Full SwiftUI app shell for the iconquer Risk-style strategy game, targeting iOS 26 / iPadOS 26 / macOS 26

---

## 1. Objective

Build a native SwiftUI app that wraps the `IconquerCore` engine in a polished, touch-first game interface. The app renders the classic 42-country world map using the original art assets (Background.jpg + country PNGs), provides a two-tap interaction model for all turn phases, plugs AI agents into the engine via the existing `SeatBinding` architecture, and adopts iOS 26 Liquid Glass styling throughout.

**Problems solved:**
1. **No graphical frontend exists.** The engine runs headless or via a terminal TUI. A SwiftUI app delivers the flagship user experience the project was designed around.
2. **Original art assets are unused.** The preserved Background.jpg, 42 country PNGs, and Countries.json coordinate data have no consumer. The app renders them faithfully.
3. **Touch interaction is undefined.** The engine exposes `GameMove` actions but no UI interprets taps. The app defines a context-sensitive two-tap model that maps taps to engine actions per turn phase.
4. **AI opponents have no visual host.** AI strategies exist in IconquerCore but only the CLI exercises them. The app lets human players compete against AI opponents in a visual setting.

**Master Plan Reference:** Phase 2 (iOS App Shell) and Phase 3 (iOS 26+ Liquid Glass styling). This proposal merges both phases, since targeting iOS 26 as the minimum makes Liquid Glass available unconditionally.

---

## 2. Proposed Architecture

### New Files

| File | Purpose |
|------|---------|
| `App/iconquer/IconquerApp.swift` | `@main` app entry point with `WindowGroup` |
| `App/iconquer/Views/GameBoardView.swift` | Map rendering: Background.jpg + 42 country PNG overlays with GeometryReader scaling |
| `App/iconquer/Views/CountryOverlayView.swift` | Single country PNG positioned via Countries.json (x,y); tappable, tinted |
| `App/iconquer/Views/SetupView.swift` | Game setup screen: player config slots, map selection, start button |
| `App/iconquer/Views/GameHUDView.swift` | Heads-up display: current player, phase, army counts, action buttons |
| `App/iconquer/Views/CardTurnInSheet.swift` | Modal sheet for card turn-in selection |
| `App/iconquer/Views/CombatResultView.swift` | Dice roll result overlay with attacker/defender outcomes |
| `App/iconquer/Views/VictoryView.swift` | Victory celebration screen |
| `App/iconquer/Views/PlayerBadgeView.swift` | Compact player identity badge (color dot + name + country count) |
| `App/iconquer/ViewModels/GameViewModel.swift` | `@Observable @MainActor` bridge: owns engine, publishes `GameSnapshot`, translates taps |
| `App/iconquer/ViewModels/SetupViewModel.swift` | `@Observable` setup state: `PlayerConfig` slots, produces `Game` + `SeatBinding`s |
| `App/iconquer/Model/PlayerConfig.swift` | Setup-time player configuration (name, color, human/AI, strategy) |
| `App/iconquer/Model/MapAssetCatalog.swift` | Loads Countries.json coordinates and resolves PNG asset names for a map bundle |
| `App/iconquer/Model/SwiftUIHumanAgent.swift` | Wraps `HumanAgent` protocol with `AsyncStream` continuation for tap-driven input |
| `App/iconquer/Model/ColorMapping.swift` | Maps IconquerCore `Player.color` strings to SwiftUI `Color` values |
| `App/iconquer/Resources/` | Background.jpg, 42 country PNGs, Countries.json, Continents.json (copied from `public/maps/`) |
| `App/iconquer/Package.swift` | SPM manifest depending on `IconquerCore` (local path to sibling repo) |

### Modified Files

| File | Change |
|------|--------|
| (none) | IconquerCore is consumed read-only as a package dependency; no modifications required |

### Module Placement

All new code lives in the `iconquer` app target within the `App/iconquer/` directory of this repo. The app imports `IconquerCore` from the sibling repo via a local SPM dependency. No new library modules are created; the app is a single executable target.

```
App/iconquer/
├── IconquerApp.swift
├── Package.swift
├── Views/
│   ├── GameBoardView.swift
│   ├── CountryOverlayView.swift
│   ├── SetupView.swift
│   ├── GameHUDView.swift
│   ├── CardTurnInSheet.swift
│   ├── CombatResultView.swift
│   ├── VictoryView.swift
│   └── PlayerBadgeView.swift
├── ViewModels/
│   ├── GameViewModel.swift
│   └── SetupViewModel.swift
├── Model/
│   ├── PlayerConfig.swift
│   ├── MapAssetCatalog.swift
│   ├── SwiftUIHumanAgent.swift
│   └── ColorMapping.swift
└── Resources/
    └── maps/iconquer-world/
        ├── Background.jpg
        ├── Alaska.png ... Yakutia.png (42 PNGs)
        ├── Countries.json
        └── Continents.json
```

---

## 3. API Surface

### GameViewModel (central bridge)

```swift
/// The primary bridge between IconquerCore's headless engine and the SwiftUI view layer.
///
/// Owns the `Game` instance and a `MatchRunner`. Publishes a `GameSnapshot` that views
/// observe for rendering. Translates user taps into `GameMove` actions submitted to the engine.
@Observable @MainActor
final class GameViewModel {
    // MARK: - Published State

    /// The latest snapshot of engine state, driving all view rendering.
    private(set) var snapshot: GameSnapshot

    /// The currently selected country (first tap), if any.
    private(set) var selectedCountry: CountryId?

    /// Whether a combat result overlay is being displayed.
    private(set) var showingCombatResult: Bool

    /// The most recent combat outcome for the overlay.
    private(set) var lastCombatResult: CombatResult?

    /// Whether the card turn-in sheet is presented.
    private(set) var showingCardSheet: Bool

    /// Whether the game has ended with a winner.
    var isGameOver: Bool { snapshot.winnerId != nil }

    /// Human-readable description of the current phase for the HUD.
    var phaseLabel: String

    // MARK: - Engine Internals (private)

    /// The live game engine instance.
    private var game: Game

    /// Runs the turn loop, dispatching to human or AI agents per seat.
    private var matchRunner: MatchRunner

    /// Seat bindings mapping player IDs to their agents (human or AI).
    private var seatBindings: [PlayerId: SeatBinding]

    /// The continuation used by SwiftUIHumanAgent to deliver tap-driven moves.
    private var humanContinuation: AsyncStream<GameMove>.Continuation?

    // MARK: - Initialization

    /// Creates a view model from a configured game and its seat bindings.
    ///
    /// - Parameters:
    ///   - game: A fully initialized `Game` from the setup screen.
    ///   - seatBindings: One `SeatBinding` per player, mapping to human or AI agents.
    init(game: Game, seatBindings: [PlayerId: SeatBinding])

    // MARK: - Tap Handling

    /// Handles a tap on a country. Behavior depends on the current turn phase:
    ///
    /// - **PickCountries / InitializeArmies / AssignArmies:** Places armies on the tapped country.
    /// - **Attack (no selection):** Selects the tapped country as the attacker (first tap).
    /// - **Attack (with selection):** Attacks from `selectedCountry` to the tapped country (second tap).
    /// - **Fortify (no selection):** Selects the source country (first tap).
    /// - **Fortify (with selection):** Fortifies from `selectedCountry` to the tapped country (second tap).
    ///
    /// If the tap is invalid (wrong owner, not adjacent, insufficient armies), the selection
    /// is cleared and no action is taken.
    ///
    /// - Parameter countryId: The country that was tapped.
    func handleTap(on countryId: CountryId)

    /// Clears the current selection without taking an action.
    func clearSelection()

    /// Advances from the Attack phase to the Fortify phase.
    func endAttackPhase()

    /// Ends the current player's turn (skips remaining fortification).
    func endTurn()

    /// Submits a card turn-in selection to the engine.
    ///
    /// - Parameter cards: The three cards to turn in.
    func turnInCards(_ cards: [Card])

    // MARK: - Engine Loop

    /// Starts the match runner loop. Called once after initialization.
    /// The runner alternates between AI and human agents; for human players,
    /// it awaits moves delivered via the `humanContinuation`.
    func startMatch() async
}
```

### SetupViewModel (game configuration)

```swift
/// Manages the game setup screen state. Produces a configured `Game` and
/// `SeatBinding` array when the player taps "Start Game."
@Observable @MainActor
final class SetupViewModel {
    /// Configuration for each player slot (2-6 players).
    var playerConfigs: [PlayerConfig]

    /// The selected map bundle name.
    var selectedMap: String

    /// Whether the current configuration is valid for starting a game.
    var canStartGame: Bool

    /// Adds a new player slot (up to 6).
    func addPlayer()

    /// Removes a player slot (minimum 2).
    ///
    /// - Parameter index: The index of the player to remove.
    func removePlayer(at index: Int)

    /// Builds a `Game` and `SeatBinding` array from the current configuration.
    ///
    /// - Returns: A tuple of the initialized game and its seat bindings.
    /// - Throws: `MapLoadError` if the selected map cannot be loaded.
    func buildGame() throws -> (Game, [PlayerId: SeatBinding])
}
```

### PlayerConfig (setup-time model)

```swift
/// A single player slot on the setup screen.
struct PlayerConfig: Sendable, Identifiable {
    var id: UUID
    var name: String
    var color: PlayerColor
    var isHuman: Bool
    var aiStrategy: AIStrategyKind

    /// The available player colors, mapped to SwiftUI Color values.
    enum PlayerColor: String, CaseIterable, Sendable {
        case red, blue, green, yellow, purple, orange
    }

    /// The available AI strategy presets.
    enum AIStrategyKind: String, CaseIterable, Sendable {
        case aggressive, defensive, unpredictable, random
    }
}
```

### SwiftUIHumanAgent (async bridge)

```swift
/// Adapts the IconquerCore `HumanAgent` protocol for SwiftUI by using an
/// `AsyncStream` continuation. The view model writes taps into the continuation;
/// the match runner awaits moves from the stream.
///
/// This decouples the synchronous tap handler from the async match runner loop
/// without blocking the main actor.
final class SwiftUIHumanAgent: @unchecked Sendable {
    // Justification: continuation is only accessed from @MainActor-isolated GameViewModel.

    /// The stream that the match runner reads moves from.
    let moveStream: AsyncStream<GameMove>

    /// The continuation that the view model writes taps into.
    let continuation: AsyncStream<GameMove>.Continuation

    init()

    /// Called by GameViewModel when a valid tap produces a GameMove.
    ///
    /// - Parameter move: The move to deliver to the match runner.
    @MainActor func deliver(_ move: GameMove)

    /// Called when the game ends to terminate the stream.
    func finish()
}
```

### MapAssetCatalog (coordinate + asset resolver)

```swift
/// Loads the Countries.json coordinate file and resolves country PNG asset names
/// for a given map bundle. Provides the data needed by `GameBoardView` to position
/// country overlays on the background image.
struct MapAssetCatalog: Sendable {
    /// Per-country layout data parsed from Countries.json.
    struct CountryLayout: Sendable {
        var id: CountryId
        var x: CGFloat
        var y: CGFloat
        var dotOffsetX: CGFloat
        var dotOffsetY: CGFloat
        var width: CGFloat?
        var height: CGFloat?
    }

    /// All country layouts keyed by country ID.
    var layouts: [CountryId: CountryLayout]

    /// The original background image dimensions (used as the reference coordinate space).
    var referenceSize: CGSize

    /// Loads a map asset catalog from a named bundle in Resources.
    ///
    /// - Parameter mapName: The map bundle directory name (e.g., "iconquer-world").
    /// - Throws: `MapLoadError` if Countries.json is missing or malformed.
    static func load(mapName: String) throws -> MapAssetCatalog
}
```

---

## 4. MCP Schema

Not applicable. The SwiftUI app is a standalone client that consumes `IconquerCore` directly. No MCP tools are involved.

**Future consideration:** If the app is extended to support remote AI opponents via MCP, the `GameViewModel` would gain an `MCPSeatBinding` variant that proxies moves over the network. This is out of scope for the initial port.

---

## 5. Constraints & Compliance

**Concurrency:**
- `GameViewModel` is `@Observable @MainActor`, ensuring all UI state mutations happen on the main thread. Views read properties directly without wrappers.
- `SwiftUIHumanAgent` is marked `@unchecked Sendable` with a `// Justification:` comment explaining that its continuation is only accessed from the `@MainActor`-isolated `GameViewModel`.
- The `MatchRunner` loop runs as a detached `Task` that hops back to `@MainActor` to update `snapshot`. AI agents run their strategies off the main actor to avoid blocking the UI.
- `PlayerConfig`, `MapAssetCatalog`, and `CountryLayout` are `Sendable` value types.

**No force unwraps:** All dictionary lookups (`snapshot.countries[id]`, `snapshot.players[id]`, `layouts[countryId]`) use optional binding with `guard let`. Missing data causes the country to be rendered without tinting or the tap to be silently ignored.

**No hardcoded constants:** All layout and timing values are defined in configuration structs:

```swift
/// Layout and interaction configuration for the game board.
struct GameBoardConfig: Sendable {
    /// Minimum scale factor for country overlays on small screens.
    var minimumScaleFactor: CGFloat = 0.3
    /// Maximum scale factor for country overlays.
    var maximumScaleFactor: CGFloat = 1.0
    /// Duration of selection highlight animation.
    var selectionPulseDuration: Duration = .milliseconds(800)
    /// Duration of combat result overlay display.
    var combatResultDisplayDuration: Duration = .seconds(2)
    /// Opacity of unowned countries.
    var unownedCountryOpacity: Double = 0.5
    /// Opacity of countries not belonging to the current player during their turn.
    var inactiveCountryOpacity: Double = 0.7
    /// Army badge font size relative to the country image width.
    var armyBadgeFontScale: CGFloat = 0.35
}
```

**Division safety:** `GeometryReader` scale calculations use `max(referenceSize.width, 1)` and `max(referenceSize.height, 1)` as denominators to guard against zero-sized reference images.

**Guard clauses:** All tap handling uses guard-let for player ownership, adjacency checks, and army counts. Early returns when the tap is invalid, with no state mutation.

**Swift 6 strict concurrency:** All new types comply with strict concurrency. `@Observable` requires Swift 5.9+ and is fully compatible with Swift 6 isolation rules. The `@MainActor` annotation on `GameViewModel` provides the required isolation.

**No String(format:):** All numeric displays (army counts, turn numbers) use string interpolation or `.formatted()`.

**DocC:** All public types, methods, and properties have documentation comments.

---

## 6. Backend Abstraction (If Compute-Intensive)

Not applicable. The game engine is turn-based with negligible computation per action. Map rendering uses standard SwiftUI image compositing with no custom Metal or Accelerate code.

The only potentially expensive operation is loading 42 PNG images at startup. These are cached by SwiftUI's `Image` view and the asset catalog. No explicit caching layer is needed.

---

## 7. Dependencies

**Internal Dependencies:**
- `IconquerCore` (sibling repo) -- `Game`, `GameSnapshot`, `GameMove`, `Player`, `Country`, `CountryId`, `PlayerId`, `Card`, `MapDefinition`, `MapLoader`, `GamePhase`, `TurnPhase`, `PendingInput`, `SeatBinding`, `PlayerStrategy`, `CombatResult`, `SeededRNG`, `Settings`
- Map assets from `public/maps/iconquer-world/` -- copied into `App/iconquer/Resources/` at project setup time

**External Dependencies:**
- None. SwiftUI, Foundation, and the Swift standard library are sufficient.

**SPM Manifest:**

```swift
// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "iconquer",
    platforms: [
        .iOS(.v26),
        .macOS(.v26),
    ],
    dependencies: [
        .package(path: "../../IconquerCore"),
    ],
    targets: [
        .executableTarget(
            name: "iconquer",
            dependencies: ["IconquerCore"],
            path: "App/iconquer",
            resources: [
                .copy("Resources/maps"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
    ]
)
```

**Ordering dependency:** `IconquerCore` must expose `Game`, `MatchRunner`, `SeatBinding`, and `GameSnapshot` as public API. These types already exist or are on the Phase 1 roadmap. The app cannot be built until the engine's public surface is stable.

---

## 8. Test Strategy

**Test Categories:**

| Category | Tests |
|----------|-------|
| **GameViewModel tap routing** | Tap during assignArmies places army on owned country; tap on enemy country during assignArmies is rejected; first tap during attack selects own country; second tap attacks adjacent enemy; second tap on non-adjacent clears selection; tap during fortify follows same two-tap model |
| **SetupViewModel validation** | Cannot start with fewer than 2 players; cannot start with duplicate colors; `buildGame()` produces correct player count and AI bindings; removing a player updates `canStartGame` |
| **SwiftUIHumanAgent delivery** | `deliver(_:)` yields the move from the `AsyncStream`; `finish()` terminates the stream; multiple delivers are buffered in order |
| **MapAssetCatalog loading** | Loads all 42 countries from Countries.json; all countries have valid (x,y) coordinates; missing file throws `MapLoadError.missingFile`; malformed JSON throws `MapLoadError.malformed` |
| **ColorMapping** | All 6 player color strings map to distinct SwiftUI `Color` values; unknown color string falls back to `.gray` |
| **Phase label** | `phaseLabel` returns correct human-readable string for each `GamePhase`/`TurnPhase` combination |
| **Selection state** | `clearSelection()` resets `selectedCountry` to nil; `endAttackPhase()` transitions `turnPhase` to `.fortify`; `endTurn()` clears selection and advances turn |
| **Card turn-in** | `turnInCards(_:)` with valid set submits to engine and dismisses sheet; invalid set is rejected; `showingCardSheet` is true when `pendingInput` is `.awaitingCardTurnIn` |
| **GeometryReader scaling** | Scale factor calculation produces correct result for known reference size and container size; zero-width reference does not crash (division guard) |
| **Country tinting** | `.colorMultiply()` applies correct player color; unowned countries use neutral tint; selected country pulses |

**Reference Truth:**
- Tap routing correctness: verified against `GameSnapshot` state transitions. A tap on country X during assignArmies increases `snapshot.countries["X"].armies` by 1.
- Coordinate accuracy: verified against Countries.json. `MapAssetCatalog.layouts["Alaska"]` returns `x: 8, y: 696`.
- Phase labels: verified against a static mapping of all `GamePhase` x `TurnPhase` pairs.

**Validation Trace (REQUIRED):**
1. Create `SetupViewModel` with 3 players (1 human, 2 AI).
2. Call `buildGame()` -- assert game has 3 players, 2 AI seat bindings.
3. Create `GameViewModel` with the resulting game.
4. Assert `snapshot.phase == .pickCountries`.
5. Call `handleTap(on: "Alaska")` -- assert `snapshot.countries["Alaska"]?.ownerId` equals the human player's ID.
6. Advance to `.play` / `.attack` phase via engine.
7. Call `handleTap(on: ownedCountry)` -- assert `selectedCountry == ownedCountry`.
8. Call `handleTap(on: adjacentEnemy)` -- assert combat result is produced and `selectedCountry` is cleared.
9. Assert: no force unwraps triggered at any step.

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [ ] Does this supersede an existing ADR? No
- [ ] Does this amend an existing ADR? No
- [x] New ADR required? Yes -- draft below

**New ADR Draft:**

```yaml
id: ADR-003
date: 2026-04-23
status: proposed
category: architecture
title: "@Observable @MainActor GameViewModel as SwiftUI-to-engine bridge"
context: |
  The SwiftUI app needs a bridge between IconquerCore's headless Game engine
  and the view layer. Options considered: (a) @ObservableObject with @Published
  properties and Combine, (b) @Observable with @MainActor isolation, (c) a
  Redux-style store with actions and reducers, (d) direct Game ownership in
  views via @State.
decision: |
  A single GameViewModel class marked @Observable @MainActor owns the Game
  instance and MatchRunner. It publishes a GameSnapshot that views read for
  rendering. Taps are translated into GameMove values and delivered to a
  SwiftUIHumanAgent via AsyncStream continuation. AI agents run off the main
  actor and hop back to update the snapshot.
rationale: |
  - @Observable (not @ObservableObject) gives granular per-property invalidation
    without @Published boilerplate, reducing unnecessary view redraws when only
    one field changes (e.g., selectedCountry vs. snapshot)
  - @MainActor isolation guarantees all state mutations happen on the main thread,
    satisfying Swift 6 strict concurrency without manual dispatch
  - AsyncStream continuation cleanly decouples synchronous tap handlers from the
    async MatchRunner loop without blocking the UI
  - Single ownership of Game prevents split-brain state across multiple view models
  - The pattern scales: additional UI state (combat overlay, card sheet) is just
    more @Observable properties on the same view model
consequences: |
  + Views are simple: they read snapshot properties and call tap handlers
  + AI agents run concurrently without blocking the UI
  + No Combine dependency; pure Swift Concurrency
  + GameSnapshot is Sendable, so it can cross isolation boundaries safely
  - Single view model may grow large; mitigated by extracting sub-view-models
    later if needed
  - AsyncStream adds one layer of indirection for human input; acceptable for
    the clean concurrency boundary it provides
alternatives_rejected:
  - "@ObservableObject + Combine: requires @Published on every property, coarser invalidation, Combine is legacy"
  - "Redux store: over-engineered for a turn-based game with a single source of truth (Game already is one)"
  - "Direct @State Game in views: violates separation of concerns, makes testing impossible"
affected_files:
  - App/iconquer/ViewModels/GameViewModel.swift
  - App/iconquer/ViewModels/SetupViewModel.swift
  - App/iconquer/Model/SwiftUIHumanAgent.swift
supersedes: null
amends: null
superseded_by: null
```

---

## 10. Open Questions

1. **Should the app use an Xcode project or a pure SPM executable target?** The Master Plan says "Xcode app shell wrapping a SPM library." However, starting with a pure SPM `executableTarget` is simpler for CI and avoids Xcode project file merge conflicts. **Proposed answer:** Start with a pure SPM executable using `@main` and `WindowGroup`. Migrate to an Xcode project only if needed for entitlements (Game Center, iCloud) in Phase 3.

2. **How should country PNG hit-testing work?** The PNGs have irregular shapes with transparent regions. Tapping a transparent pixel should not register as a tap on that country. **Proposed answer:** Use the PNG's alpha channel for hit testing. SwiftUI's `.contentShape()` can be combined with a custom `Shape` that samples the image bitmap, or we can fall back to a simplified polygon per country derived from the PNG bounds. For v1, use the bounding rect from Countries.json (x, y, width, height) as the tap target -- it is "good enough" and avoids bitmap sampling complexity.

3. **Should army counts be rendered as text overlays or as part of the country PNG?** **Proposed answer:** Text overlays. Each `CountryOverlayView` renders a small badge at the `dotOffset` position showing the army count in a circle. This matches the original iConquer behavior and avoids modifying the asset PNGs.

4. **How should the background image coordinate system map to SwiftUI?** Countries.json uses a pixel coordinate system where (0,0) is bottom-left (or top-left -- needs verification against the original). **Proposed answer:** Use `GeometryReader` to get the container size, compute `scaleX = containerWidth / referenceWidth` and `scaleY = containerHeight / referenceHeight`, then position each country at `(layout.x * scaleX, layout.y * scaleY)`. The reference dimensions are the Background.jpg pixel dimensions. Y-axis direction will be validated against the original rendering.

5. **Should the MatchRunner run turns automatically for AI players, or should the human explicitly advance?** **Proposed answer:** AI turns run automatically with a brief delay (configurable, default 0.5s per action) so the human can follow the action. A "speed up" button allows skipping AI animation delays.

6. **Should the app support landscape and portrait on iPhone?** **Proposed answer:** Landscape only on iPhone (the world map is 16:9-ish). iPad and Mac support both orientations. Enforced via `Info.plist` supported orientations.

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (GameViewModel, SetupViewModel, SwiftUIHumanAgent, MapAssetCatalog, GameBoardView, CountryOverlayView)
- Does explanation require 50+ lines? Yes (tap routing logic, coordinate scaling, async agent bridge, setup-to-game flow)
- Does it need theory/background context? Yes (two-tap interaction model, GeometryReader coordinate mapping, AsyncStream continuation pattern)

**Article Name:** `IconquerAppArchitectureGuide.md`
(Placed in a `.docc` catalog if/when the app adds documentation. Must NOT match any Swift symbol name.)

**Article Outline:**
1. Overview -- what the app does and how it relates to IconquerCore
2. Setup flow -- SetupViewModel, PlayerConfig, building a Game
3. Game loop -- GameViewModel, MatchRunner, human/AI agent dispatch
4. Map rendering -- Background.jpg, country PNG overlays, GeometryReader scaling, Countries.json coordinates
5. Touch interaction -- two-tap model, context-sensitive per phase, selection state
6. Human agent bridge -- SwiftUIHumanAgent, AsyncStream continuation, tap-to-move pipeline
7. State management -- @Observable, per-property invalidation, snapshot-driven rendering
8. Liquid Glass styling -- toolbar, sheets, NavigationSplitView sidebar
9. Adding new maps -- MapAssetCatalog, asset bundle structure, coordinate format

---

## Map Rendering Detail

### Coordinate System

Countries.json provides `(x, y)` pixel coordinates for each country PNG relative to the Background.jpg canvas. The background image serves as the reference coordinate space. Each country entry also provides optional `dotOffsetX` and `dotOffsetY` values that position the army count badge relative to the country's origin.

### GeometryReader Scaling

```swift
/// Renders the game board: Background.jpg with 42 country PNG overlays.
///
/// Uses GeometryReader to scale the original pixel coordinates to the
/// available container size while preserving aspect ratio.
struct GameBoardView: View {
    let snapshot: GameSnapshot
    let assetCatalog: MapAssetCatalog
    let onTap: (CountryId) -> Void

    var body: some View {
        GeometryReader { geometry in
            let scale = min(
                geometry.size.width / max(assetCatalog.referenceSize.width, 1),
                geometry.size.height / max(assetCatalog.referenceSize.height, 1)
            )

            ZStack(alignment: .topLeading) {
                Image("Background")
                    .resizable()
                    .aspectRatio(contentMode: .fit)

                ForEach(assetCatalog.sortedLayouts, id: \.id) { layout in
                    CountryOverlayView(
                        layout: layout,
                        country: snapshot.countries[layout.id.rawValue],
                        scale: scale,
                        isSelected: false, // driven by GameViewModel.selectedCountry
                        onTap: { onTap(layout.id) }
                    )
                }
            }
        }
    }
}
```

### Country Tinting

Each country PNG is rendered with `.colorMultiply()` to tint it to the owning player's color. Unowned countries use a neutral gray tint at reduced opacity. The selected country receives a pulsing highlight animation using `.opacity()` with a repeating animation.

```swift
struct CountryOverlayView: View {
    let layout: MapAssetCatalog.CountryLayout
    let country: Country?
    let scale: CGFloat
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        ZStack {
            Image(layout.id.rawValue)
                .resizable()
                .colorMultiply(tintColor)
                .opacity(ownerOpacity)

            // Army badge at dot offset position
            if let country, country.armies > 0 {
                ArmyBadge(count: country.armies, color: tintColor)
                    .offset(
                        x: layout.dotOffsetX * scale,
                        y: layout.dotOffsetY * scale
                    )
            }
        }
        .position(
            x: layout.x * scale,
            y: layout.y * scale
        )
        .onTapGesture(perform: onTap)
    }
}
```

---

## Touch Interaction Detail

### Two-Tap Model

All multi-target actions (attack, fortify) use a two-tap model:

| Phase | First Tap | Second Tap |
|-------|-----------|------------|
| PickCountries | Claims the tapped unclaimed country | N/A |
| InitializeArmies | Places one army on the tapped owned country | N/A |
| AssignArmies | Places one army on the tapped owned country | N/A |
| Attack | Selects an owned country with 2+ armies as attacker | Attacks the tapped adjacent enemy country |
| Fortify | Selects an owned country with 2+ armies as source | Moves armies to the tapped adjacent owned country |

**Tap validation rules:**
- During placement phases, only countries owned by the current player accept taps.
- During attack, the first tap must be on a country the player owns with at least 2 armies.
- During attack, the second tap must be on an adjacent country owned by a different player.
- During fortify, both taps must be on countries the player owns, and they must be adjacent.
- Any invalid second tap clears the selection (does not perform an action).
- Tapping the already-selected country deselects it.

### Context-Sensitive HUD Buttons

The HUD provides phase-appropriate action buttons:

| Phase | Buttons |
|-------|---------|
| Attack | "End Attacks" (advances to Fortify) |
| Fortify | "End Turn" (skips fortification) |
| Card turn-in required | "Turn In Cards" (opens sheet) |

---

## Liquid Glass Styling

The app targets iOS 26+ exclusively, making Liquid Glass available unconditionally.

**Toolbar:** `.toolbarStyle(.liquidGlass)` on the main `NavigationSplitView`.

**Sheets:** Card turn-in and combat result overlays use `.presentationBackground(.ultraThinMaterial)` for a frosted glass effect.

**Sidebar:** On iPad and Mac, a `NavigationSplitView` with a sidebar shows the player list, turn log, and game settings. The sidebar uses glass morphism via the system-provided sidebar styling.

**Player badges:** `.glassEffect()` modifier (if available in iOS 26) on player badge backgrounds for a frosted appearance.

**Setup screen:** Glass-style grouped list sections for player configuration using `.listStyle(.insetGrouped)` with the system material.

```swift
@main
struct IconquerApp: App {
    @State private var setupVM = SetupViewModel()
    @State private var gameVM: GameViewModel?

    var body: some Scene {
        WindowGroup {
            if let gameVM {
                NavigationSplitView {
                    PlayerSidebar(snapshot: gameVM.snapshot)
                } detail: {
                    GameBoardView(
                        snapshot: gameVM.snapshot,
                        assetCatalog: gameVM.assetCatalog,
                        onTap: gameVM.handleTap
                    )
                    .overlay(alignment: .bottom) {
                        GameHUDView(viewModel: gameVM)
                    }
                }
                .toolbarStyle(.liquidGlass)
            } else {
                SetupView(viewModel: setupVM) { game, bindings in
                    gameVM = GameViewModel(game: game, seatBindings: bindings)
                    Task { await gameVM?.startMatch() }
                }
            }
        }
    }
}
```
