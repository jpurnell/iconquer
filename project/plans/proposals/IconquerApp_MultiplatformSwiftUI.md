# Design Proposal: iConquer Multiplatform SwiftUI App

**Date:** 2026-05-04
**Status:** Proposed (Revised — satellite/vector map pipeline)
**Supersedes:** `IconquerApp_SwiftUIPort.md` (iOS/iPad/Mac only, no watchOS, no multiplayer)

---

## 1. Objective

Build a single SwiftUI codebase that delivers iConquer across **every Apple platform**: iPhone, iPad, Mac, and Apple Watch. The app renders the 42-country world map using **resolution-independent vector boundaries over satellite basemap imagery**, drives local and multiplayer games through the existing engine stack, and adopts iOS 26 Liquid Glass styling throughout. The watchOS companion enables asynchronous turn-based play via the existing `IconquerServer` WebSocket infrastructure. The map data pipeline is designed from day one to support **3D terrain extrusion** for the visionOS Phase 4 tabletop experience.

**Problems solved:**

1. **No graphical frontend.** The engine runs headless or via terminal TUI. This app is the flagship experience.
2. **Resolution-independent maps.** The original 2002-era PNGs were meant to look like satellite imagery but are far too low-resolution for modern Retina/ProMotion displays. Vector country boundaries (Natural Earth) + real satellite basemap tiles (NASA Blue Marble) provide crisp rendering from 38mm Apple Watch to 6K Pro Display XDR.
3. **visionOS terrain readiness.** By including real-world elevation data (ETOPO/SRTM) in the geo pipeline from Phase 3, the same country data drives 2D map rendering now and 3D extruded terrain meshes in Phase 4 — no second data pipeline needed.
4. **Multiplayer has no client UI.** `IconquerServer` and `IconquerClient` exist but have no visual consumer beyond the CLI.
5. **No mobile play.** A strategy game that fits in your pocket, scales to a 13" iPad, and runs natively on Mac.
6. **watchOS extends reach.** Async turn-based play on the wrist via server — take your turn in 10 seconds from a notification.

**Master Plan Reference:** Phase 3 (Multiplatform SwiftUI App) + Phase 4 (visionOS Immersive). Targeting iOS 26 minimum makes Liquid Glass unconditional. The geo data pipeline serves both phases.

---

## 2. Proposed Architecture

### Package Structure

The app ships as a **single SPM package** (`IconquerApp`) with **four executable targets** sharing a common library:

```
IconquerApp/
├── Package.swift
├── Sources/
│   ├── IconquerUI/                    # Shared library (all platforms)
│   │   ├── ViewModels/
│   │   │   ├── GameViewModel.swift        # @Observable game brain
│   │   │   ├── SetupViewModel.swift       # Game configuration
│   │   │   ├── MultiplayerViewModel.swift # Lobby + remote play
│   │   │   └── WatchTurnViewModel.swift   # watchOS turn submission
│   │   ├── Model/
│   │   │   ├── AppGameSession.swift       # Local GameSessionProvider
│   │   │   ├── SwiftUIHumanAgent.swift    # Tap → GameMove bridge
│   │   │   ├── ColorMapping.swift         # Player color → SwiftUI Color
│   │   │   └── PlayerConfig.swift         # Setup-time player slots
│   │   ├── Geo/
│   │   │   ├── GeoStore.swift             # Loads + caches all geo data
│   │   │   ├── CountryGeometry.swift      # GeoJSON → SwiftUI Shape per country
│   │   │   ├── ElevationGrid.swift        # ETOPO/SRTM tile → per-country Z data
│   │   │   ├── SatelliteBasemap.swift     # NASA Blue Marble tile provider
│   │   │   ├── HitTester.swift            # Point-in-polygon country detection
│   │   │   └── Projection.swift           # Equirectangular ↔ screen transforms
│   │   └── Views/
│   │       ├── Map/
│   │       │   ├── MapView.swift              # Adaptive map container
│   │       │   ├── WorldMapView.swift         # Satellite basemap + vector overlays
│   │       │   ├── CountryShapeView.swift     # Single country vector path (tappable)
│   │       │   ├── ArmyBadgeView.swift        # Army count indicator on country
│   │       │   └── CompactMapView.swift       # Simplified map for small screens
│   │       ├── HUD/
│   │       │   ├── GameHUDView.swift          # Phase, armies, action buttons
│   │       │   ├── PlayerBadgeView.swift      # Color dot + name + stats
│   │       │   ├── PhaseIndicatorView.swift   # Current turn phase banner
│   │       │   └── TurnSummaryView.swift      # What happened last turn
│   │       ├── Sheets/
│   │       │   ├── CardTurnInSheet.swift       # Card selection modal
│   │       │   ├── CombatResultSheet.swift     # Attack outcome overlay
│   │       │   ├── VictorySheet.swift          # Win celebration
│   │       │   └── DefeatSheet.swift           # Loss screen
│   │       ├── Setup/
│   │       │   ├── SetupView.swift            # Player config, map choice, AI
│   │       │   ├── PlayerSlotView.swift       # Single player config row
│   │       │   └── MapPickerView.swift        # Map thumbnail browser
│   │       ├── Multiplayer/
│   │       │   ├── LobbyView.swift            # Room browser + create
│   │       │   ├── RoomView.swift             # Pre-game lobby in a room
│   │       │   └── ConnectionStatusView.swift # Server connection indicator
│   │       └── Common/
│   │           ├── GlassCard.swift            # Liquid Glass card component
│   │           ├── PulseAnimation.swift       # Active country pulse
│   │           └── AdaptiveLayout.swift       # Size-class-aware layout
│   │
│   ├── iConquer/                      # iOS / iPadOS / macOS app target
│   │   ├── iConquerApp.swift              # @main WindowGroup
│   │   ├── ContentView.swift              # Navigation root
│   │   ├── GameBoardView.swift            # Full game screen (map + HUD)
│   │   ├── SidebarView.swift              # iPad/Mac sidebar navigation
│   │   └── SettingsView.swift             # App preferences
│   │
│   ├── iConquerWatch/                 # watchOS app target
│   │   ├── iConquerWatchApp.swift         # @main
│   │   ├── WatchContentView.swift         # Turn notification + action
│   │   ├── WatchTurnView.swift            # Compact turn submission UI
│   │   ├── WatchMapView.swift             # Miniature map overview
│   │   └── WatchComplicationView.swift    # Complication: whose turn
│   │
│   └── iConquerWidgets/               # Widget extension (iOS + watchOS)
│       ├── GameStatusWidget.swift         # Current game state at a glance
│       └── TurnReminderWidget.swift       # "It's your turn" widget
│
├── Resources/
│   ├── geo/
│   │   ├── ne_50m_admin_0.geojson        # Natural Earth 1:50m country boundaries
│   │   ├── iconquer_countries.json       # 42-country subset + CountryId mapping
│   │   ├── iconquer_continents.json      # Continent groupings + bonus values
│   │   ├── blue_marble_tiles/            # NASA Blue Marble (preprocessed tiles)
│   │   │   ├── 0/                        # Zoom level 0 (single 512×256 tile)
│   │   │   ├── 1/                        # Zoom level 1 (2×1 tiles)
│   │   │   └── 2/                        # Zoom level 2 (4×2 tiles, max for app)
│   │   └── elevation/
│   │       └── etopo_5min.bin            # 5-arc-minute grid (compact binary)
│   └── ui/
│       └── AppIcon/
│
└── Tests/
    ├── IconquerUITests/
    └── iConquerTests/
```

### Platform Adaptation Strategy

| Concern | iPhone | iPad | Mac | Watch |
|---------|--------|------|-----|-------|
| **Map rendering** | Satellite + vector, scrollable + zoomable | Full satellite + vector, no scroll | Full satellite + vector in window | Continent-level list (no map) |
| **Country selection** | Tap on map or list fallback | Tap on map | Click on map | List of owned countries |
| **HUD placement** | Bottom sheet (Liquid Glass) | Sidebar panel | Toolbar + inspector | Inline in scroll |
| **Turn actions** | Bottom action bar | Sidebar actions | Toolbar buttons | Single-screen actions |
| **Multiplayer** | Full lobby + game | Full lobby + game | Full lobby + game | Turn-only (notification-driven) |
| **Navigation** | NavigationStack | NavigationSplitView | NavigationSplitView | TabView / NavigationStack |

### Dependency Graph

```
iConquer (app)  ─────────┐
iConquerWatch (app) ──────┤
iConquerWidgets (ext) ────┤
                          ▼
                    IconquerUI (library)
                     ├── IconquerCore     (rules engine)
                     ├── IconquerAI       (AI agents)
                     ├── IconquerMatch    (match runner)
                     └── IconquerClient   (multiplayer WebSocket)
```

### Modified Files

| File | Change |
|------|--------|
| `IconquerGameKit/` | **Deprecated.** Absorbed into `IconquerUI`. The existing `GameViewModel` moves here with enhancements. |
| `IconquerCore` | No changes. Consumed as read-only dependency. |
| `IconquerClient` | No changes. Used for multiplayer sessions. |

---

## 3. API Surface

### GameViewModel (Central Bridge)

```swift
/// The primary bridge between IconquerCore's headless engine and SwiftUI.
///
/// Owns the `Game` instance and a `MatchRunner`. Publishes a `GameSnapshot`
/// that views observe. Translates user taps into `GameMove` actions.
/// Supports both local and remote (server-backed) sessions.
@Observable @MainActor
final class GameViewModel {
    // MARK: - Published State

    /// Current game snapshot (drives all rendering).
    private(set) var snapshot: GameSnapshot

    /// Active map definition (topology, coordinates, continents).
    private(set) var map: MapDefinition

    /// Currently selected country (first tap).
    private(set) var selectedCountry: CountryId?

    /// Target country for attack/fortify (second tap).
    private(set) var targetCountry: CountryId?

    /// Legal moves for the current player.
    private(set) var legalMoves: [GameMove]

    /// True while an AI agent is computing its move.
    private(set) var aiThinking: Bool

    /// Human-readable status message for the HUD.
    private(set) var statusMessage: String

    /// The seat assigned to the local human player.
    let humanSeat: PlayerId

    /// Move history for replay and turn summary.
    private(set) var moveHistory: [MoveEntry]

    /// Game phase (derived from snapshot for convenience).
    var gamePhase: GamePhase { snapshot.phase }

    /// Turn phase within the play phase.
    var turnPhase: TurnPhase { snapshot.turnPhase }

    /// Whether it is the human player's turn.
    var isMyTurn: Bool { snapshot.currentPlayerId == humanSeat }

    // MARK: - Lifecycle

    /// Start a local game against AI opponents.
    ///
    /// - Parameters:
    ///   - config: Player slots with names, colors, and AI types.
    ///   - mapBundle: Map bundle to play on.
    ///   - seed: RNG seed for deterministic games.
    func startLocalGame(config: [PlayerConfig], mapBundle: MapBundle, seed: UInt32)

    /// Join a remote game via the server.
    ///
    /// - Parameter session: A connected `RemoteGameSession` from `IconquerClient`.
    func joinRemoteGame(session: RemoteGameSession) async throws

    // MARK: - Input

    /// Handle a tap on a country.
    ///
    /// Context-sensitive: in pick phase selects the country, in attack phase
    /// sets source (first tap) then target (second tap), etc.
    ///
    /// - Parameter countryId: The tapped country.
    func tapCountry(_ countryId: CountryId)

    /// Submit the currently composed action (attack, fortify, place armies).
    ///
    /// - Returns: True if the move was legal and applied.
    @discardableResult
    func confirmAction() -> Bool

    /// Cancel the current selection and reset tap state.
    func cancelSelection()

    /// Advance to the next turn phase (e.g., end attacks, begin fortify).
    func advancePhase()

    /// Turn in a set of cards for bonus armies.
    ///
    /// - Parameter cards: The card indices to turn in.
    func turnInCards(_ cards: [Int]) throws

    // MARK: - Queries

    /// Countries owned by a player, sorted for display.
    func countries(ownedBy player: PlayerId) -> [Country]

    /// Neighbors of a country from the map definition.
    func neighbors(of country: CountryId) -> [CountryId]

    /// Player info including color, army count, country count.
    func playerInfo(for seat: PlayerId) -> PlayerDisplayInfo

    /// All countries sorted by name for list views.
    var sortedCountries: [Country] { get }
}
```

### MultiplayerViewModel (Lobby + Remote Play)

```swift
/// Manages the multiplayer lobby lifecycle: connecting to a server,
/// browsing rooms, creating games, and joining matches.
@Observable @MainActor
final class MultiplayerViewModel {
    /// Connection state to the game server.
    private(set) var connectionState: ConnectionState

    /// Available rooms from the server.
    private(set) var rooms: [RoomInfo]

    /// The room the player is currently in, if any.
    private(set) var currentRoom: RoomInfo?

    /// Error message from the last failed operation.
    private(set) var errorMessage: String?

    /// Connect to a game server.
    ///
    /// - Parameters:
    ///   - url: WebSocket URL (e.g., ws://roseclub.org:8080).
    ///   - token: Authentication token.
    func connect(url: URL, token: String) async throws

    /// Refresh the room list from the server.
    func refreshRooms() async

    /// Create a new game room.
    ///
    /// - Parameter config: Room settings (map, max players, AI slots).
    /// - Returns: The created room info.
    func createRoom(config: RoomConfiguration) async throws -> RoomInfo

    /// Join an existing room.
    ///
    /// - Parameter roomId: Room to join.
    /// - Returns: A `RemoteGameSession` ready for `GameViewModel.joinRemoteGame`.
    func joinRoom(_ roomId: String) async throws -> RemoteGameSession

    /// Disconnect from the server.
    func disconnect()
}
```

### WatchTurnViewModel (watchOS Turn Submission)

```swift
/// Lightweight view model for watchOS turn-based play.
///
/// Receives push notifications when it's the player's turn,
/// fetches the current game state from the server, and presents
/// a simplified action interface for submitting a single turn.
@Observable @MainActor
final class WatchTurnViewModel {
    /// Current game snapshot (fetched from server).
    private(set) var snapshot: GameSnapshot?

    /// Suggested moves computed locally (top 3 by simple heuristic).
    private(set) var suggestedMoves: [SuggestedMove]

    /// Whether a turn submission is in progress.
    private(set) var isSubmitting: Bool

    /// Summary of owned territories and armies.
    private(set) var territorySummary: TerritorySummary

    /// Connect to the server and fetch current game state.
    func fetchGameState() async throws

    /// Submit a suggested move.
    ///
    /// - Parameter move: The move to submit.
    func submitMove(_ move: SuggestedMove) async throws

    /// Let the AI play this turn on the player's behalf.
    func autoPlayTurn() async throws
}

/// A pre-computed move suggestion with a human-readable description.
struct SuggestedMove: Identifiable, Sendable {
    let id: UUID
    let moves: [GameMove]
    let description: String  // e.g., "Attack Brazil from North Africa (8 vs 3)"
    let confidence: Double   // 0.0-1.0 from simple heuristic
}
```

### GeoStore (Geo Data Pipeline)

```swift
/// Loads, caches, and serves all geographic data for map rendering.
///
/// Provides three layers: (1) vector country boundaries from Natural Earth
/// GeoJSON, (2) satellite basemap tiles from NASA Blue Marble, and
/// (3) elevation data from ETOPO for future visionOS terrain extrusion.
/// All data is public domain and bundled with the app.
struct GeoStore: Sendable {
    /// Vector boundary + metadata for one country.
    struct CountryGeo: Sendable {
        let id: CountryId
        let polygons: [GeoPolygon]      // One or more closed rings (multi-polygon)
        let centroid: GeoCoordinate      // Label / army badge placement
        let boundingBox: GeoBoundingBox  // Fast rejection for hit testing
    }

    /// A single closed polygon ring in geographic coordinates.
    struct GeoPolygon: Sendable {
        let exterior: [GeoCoordinate]    // Lon/lat pairs, CCW winding
    }

    /// Geographic coordinate (WGS84).
    struct GeoCoordinate: Sendable, Codable {
        let longitude: Double            // -180...180
        let latitude: Double             // -90...90
    }

    /// Elevation sample for a country (aggregated from grid).
    struct ElevationProfile: Sendable {
        let min: Float                   // Meters below sea level (negative OK)
        let max: Float                   // Peak elevation in meters
        let mean: Float                  // Average elevation
        let samples: [Float]             // Per-vertex Z values for mesh extrusion
    }

    /// All 42 iConquer countries with vector boundaries.
    let countries: [CountryId: CountryGeo]

    /// Continent groupings (same structure as engine, for display).
    let continents: [ContinentId: [CountryId]]

    /// Elevation profiles keyed by country (loaded lazily for visionOS).
    func elevation(for country: CountryId) -> ElevationProfile?

    /// Load all geo data from the app bundle.
    ///
    /// - Throws: `MapLoadError` if GeoJSON or mapping files are missing/malformed.
    static func load() throws -> GeoStore
}
```

### CountryGeometry (Vector → SwiftUI Shape)

```swift
/// Converts a `GeoStore.CountryGeo` into a resolution-independent
/// SwiftUI `Shape` via equirectangular projection.
///
/// The projection maps longitude to X and latitude to Y within
/// the view's coordinate space. The resulting path scales cleanly
/// from Watch to 6K display with no rasterization artifacts.
struct CountryGeometry: Shape {
    let country: GeoStore.CountryGeo
    let projection: MapProjection

    func path(in rect: CGRect) -> Path
}
```

### HitTester (Point-in-Polygon Country Detection)

```swift
/// Resolves screen tap coordinates to a `CountryId` via
/// point-in-polygon testing against vector boundaries.
///
/// Uses the `GeoStore` bounding boxes for fast rejection,
/// then ray-casting on the polygon rings for precise hits.
/// Thread-safe and stateless — can be called from any actor.
struct HitTester: Sendable {
    let geoStore: GeoStore
    let projection: MapProjection

    /// Resolve a tap point to a country.
    ///
    /// - Parameter point: Tap location in view coordinates (0–1 normalized).
    /// - Returns: The `CountryId` under the tap, or nil if ocean/unclaimed.
    func country(at point: CGPoint) -> CountryId?
}
```

### SwiftUIHumanAgent (Tap-to-Move Bridge)

```swift
/// Bridges SwiftUI tap events to the `PlayerAgent` protocol.
///
/// When the `MatchRunner` calls `requestMove`, this agent suspends
/// until the human submits a move via the UI. The `GameViewModel`
/// pushes moves through the `continuation`.
actor SwiftUIHumanAgent: PlayerAgent {
    let identity: AgentIdentity

    /// Submit a move from the UI layer.
    ///
    /// - Parameter move: The human's chosen move.
    func submitMove(_ move: GameMove)

    /// Called by `MatchRunner` — suspends until the human acts.
    func requestMove(
        state: GameSnapshot,
        seat: PlayerId,
        deadline: ContinuousClock.Instant
    ) async throws -> GameMove
}
```

### Key Supporting Types

```swift
/// Configuration for one player slot in game setup.
struct PlayerConfig: Identifiable, Sendable {
    let id: UUID
    var name: String
    var color: PlayerColor
    var type: PlayerType  // .human, .ai(difficulty:), .remote

    enum PlayerType: Sendable {
        case human
        case ai(AIStrategy)
        case remote
    }

    enum AIStrategy: String, CaseIterable, Sendable {
        case random, greedy, strategic, montecarlo, learned
    }
}

/// Lightweight display info derived from GameSnapshot for a player.
struct PlayerDisplayInfo: Sendable {
    let name: String
    let color: Color
    let countryCount: Int
    let armyCount: Int
    let unallocatedArmies: Int
    let cardCount: Int
    let isEliminated: Bool
    let isCurrentTurn: Bool
}

/// watchOS territory overview — continent-level summary.
struct TerritorySummary: Sendable {
    struct ContinentStatus: Sendable {
        let name: String
        let owned: Int
        let total: Int
        let bonus: Int
        let isComplete: Bool
    }
    let continents: [ContinentStatus]
    let totalCountries: Int
    let ownedCountries: Int
    let totalArmies: Int
}
```

---

## 4. Interaction Model

### Two-Tap Context-Sensitive Input

The same `tapCountry(_:)` call handles every phase. The `GameViewModel` determines context:

| Phase | First Tap | Second Tap | Confirm |
|-------|-----------|------------|---------|
| **Pick Countries** | Selects unclaimed country | — | Auto-submits pick |
| **Assign Armies** | Selects owned country | — | Places 1 army (tap again for more) |
| **Attack** | Selects owned country (source) | Selects enemy neighbor (target) | Submits attack |
| **Fortify** | Selects owned country (source) | Selects owned neighbor (dest) | Submits fortify |

### watchOS Interaction

watchOS doesn't render the full map. Instead:

1. **Push notification:** "It's your turn in World Domination"
2. **Open app → WatchTurnView:** Shows continent summary, suggested moves
3. **Tap a suggestion** or tap "Auto-Play" to let the AI handle it
4. **Confirmation haptic** → done in under 10 seconds

### Keyboard & Pointer (Mac/iPad)

| Input | Action |
|-------|--------|
| Click country | Same as tap |
| Right-click country | Context menu (attack from here, fortify from here) |
| Space | Confirm current action |
| Escape | Cancel selection |
| Tab | Cycle through owned countries |
| N | Next phase |
| ⌘+Z | Undo last placement (assign phase only) |

---

## 5. Map Rendering Architecture

### Data Sources (All Public Domain)

| Layer | Source | Resolution | Bundle Size | License |
|-------|--------|-----------|-------------|---------|
| **Country boundaries** | [Natural Earth](https://www.naturalearthdata.com/) 1:50m Admin 0 | ~2km coastline detail | ~2 MB GeoJSON | Public domain |
| **Satellite basemap** | [NASA Blue Marble](https://visibleearth.nasa.gov/collection/1484/blue-marble) | Up to 21600×10800 px | ~8 MB (tiled, 3 zoom levels) | Public domain |
| **Elevation** | [ETOPO 2022](https://www.ncei.noaa.gov/products/etopo-global-relief-model) 5-arc-minute | ~10 km grid cells | ~4 MB (binary) | Public domain |

The 42 iConquer countries are a curated subset of Natural Earth's sovereign states. A mapping file (`iconquer_countries.json`) maps each `CountryId` from `IconquerCore` to the corresponding Natural Earth `ADM0_A3` code, handling name differences (e.g., `"NorthAfrica"` → `"DZA"+"LBY"+"EGY"` merged polygon) and the game's simplified geography (e.g., the original game's "Middle East" spans multiple real countries).

### Rendering Pipeline

```
  GeoJSON                  Satellite Tiles           Elevation Grid
  (Natural Earth)          (Blue Marble)             (ETOPO)
       │                        │                        │
       ▼                        ▼                        │
  GeoStore.load()         SatelliteBasemap               │ (lazy, visionOS)
       │                        │                        │
       ▼                        ▼                        ▼
  CountryGeometry ──→  SwiftUI Shape    Image tiles    ElevationProfile
  (per country)         .fill(playerColor)              ▼
       │                        │               RealityKit Mesh
       ▼                        ▼               (Phase 4)
  ┌──────────────────────────────────┐
  │         WorldMapView             │
  │  ┌────────────────────────────┐  │
  │  │  Satellite basemap (Image) │  │
  │  │  ┌─────┐ ┌──────┐ ┌────┐  │  │
  │  │  │Alas-│ │Green-│ │Ice-│  │  │
  │  │  │ ka  │ │ land │ │land│  │  │
  │  │  │[5]  │ │ [12] │ │[3] │  │  │
  │  │  └─────┘ └──────┘ └────┘  │  │
  │  │  Vector shapes filled with │  │
  │  │  player color (semi-alpha) │  │
  │  │  over satellite basemap    │  │
  │  └────────────────────────────┘  │
  └──────────────────────────────────┘
```

### WorldMapView (iPhone/iPad/Mac)

The map composites three layers via `ZStack`:

1. **Satellite basemap** — Pre-tiled Blue Marble imagery rendered as an `Image`, aspect-fit to the view. Tiles are selected by zoom level: level 0 for Watch/Widget, level 2 for full-screen iPad/Mac.
2. **Country vector overlays** — Each country rendered as a `CountryGeometry` `Shape`, filled with the owning player's color at ~40% opacity so satellite detail shows through. Unowned countries get a subtle neutral border only. Selected countries pulse with a highlight animation.
3. **Army badges** — Text labels positioned at each country's centroid (from `GeoStore`). Uses `Font.system(.caption, design: .rounded)` with a glass-pill background for legibility over any terrain.

**Projection:** Equirectangular (Plate Carrée) — longitude maps linearly to X, latitude to Y. Simple, fast, and sufficient for a game map. The `Projection` struct converts between geographic coordinates and normalized view coordinates (0–1), letting `GeometryReader` handle final scaling.

**Hit testing:** `HitTester` converts tap coordinates back to lon/lat via the inverse projection, checks country bounding boxes for fast rejection, then does ray-casting point-in-polygon on the GeoJSON rings. This replaces the old approach of detecting taps on PNG alpha channels.

**Tinting:** Each `CountryGeometry` shape uses `.fill(playerColor.opacity(0.4))` over the satellite basemap. This gives each player's territory a visible color wash while preserving the photorealistic satellite detail underneath — the modern equivalent of the original game's colored country overlays. Borders between countries use a thin `.stroke()` for clarity.

### CompactMapView (watchOS + iPhone Widget)

A simplified continent-level view using SF Symbols or colored rectangles:

```
┌─────────────────────┐
│ 🟢 N.America  7/9   │
│ 🟢 S.America  4/4 ✓ │
│ 🔴 Europe     2/7   │
│ 🟡 Africa     1/6   │
│ 🔴 Asia       3/12  │
│ 🟢 Australia  4/4 ✓ │
└─────────────────────┘
```

### visionOS Terrain Preview (Phase 4 Forward Design)

The same `GeoStore` data feeds Phase 4's 3D tabletop view:

- **Country polygons** → RealityKit `MeshResource` via triangulation
- **Elevation grid** → per-vertex Y displacement on the mesh (axonometric "war room" view)
- **Satellite tiles** → texture mapped onto the terrain mesh
- **Player colors** → material tint per country mesh entity

No additional data pipeline is needed — `GeoStore.elevation(for:)` provides the Z-axis values that Phase 3 ignores but Phase 4 consumes directly. This is the primary reason we invest in the elevation data now rather than bolting it on later.

---

## 6. Platform-Specific Screens

### iPhone (Compact)

```
┌────────────────────┐
│ ● You  ● AI  ● AI │  ← PlayerBadgeView row
├────────────────────┤
│                    │
│   WorldMapView     │  ← Scrollable + pinch-to-zoom
│   (aspect-fit)     │
│                    │
├────────────────────┤
│  ◀ Phase ▶         │  ← PhaseIndicatorView
│ [Attack Brazil]    │  ← Action button (Liquid Glass)
│  from N.Africa     │
│  8 armies vs 3     │
└────────────────────┘
```

### iPad (Regular)

```
┌──────────┬─────────────────────────────────────┐
│ Players  │                                     │
│ ● You    │         WorldMapView                │
│ ● AI 1   │         (full, no scroll)            │
│ ● AI 2   │                                     │
│          │                                     │
│ Phase    │                                     │
│ Attack   │                                     │
│          │                                     │
│ Cards: 3 │                                     │
│ [Turn In]│                                     │
│          ├─────────────────────────────────────┤
│ Actions  │ Status: Select a country to attack  │
│ [End Atk]│ from, then tap an enemy neighbor    │
│ [Fortify]│                                     │
└──────────┴─────────────────────────────────────┘
```

### Mac (Window)

Same as iPad but with:
- Menu bar integration (Game → New, Save, Load)
- Keyboard shortcuts throughout
- Right-click context menus on countries
- Resizable window with minimum size constraint
- Toolbar buttons for phase control

### watchOS

```
┌──────────────────┐
│  Your Turn!      │
│                  │
│ You: 15 countries│
│     42 armies    │
│                  │
│ ┌──────────────┐ │
│ │Attack Brazil │ │
│ │from N.Africa │ │
│ │  8 vs 3  ★★★ │ │
│ └──────────────┘ │
│ ┌──────────────┐ │
│ │Fortify Congo │ │
│ │  move 5 here │ │
│ │          ★★  │ │
│ └──────────────┘ │
│                  │
│ [ Auto-Play  ]   │
└──────────────────┘
```

---

## 7. Liquid Glass Design Language

iOS 26 Liquid Glass is used as the primary visual vocabulary:

| Component | Treatment |
|-----------|-----------|
| **HUD panels** | `.glassEffect()` background with vibrancy |
| **Action buttons** | Liquid Glass button style with depth |
| **Phase indicator** | Glass pill shape at top of screen |
| **Player badges** | Glass cards with player color tint |
| **Card turn-in sheet** | Glass-backed `.sheet` presentation |
| **Combat result** | Glass overlay with dice outcome |
| **Map country labels** | Glass pill labels on hover/selection |
| **watchOS cards** | Rounded glass cards for suggested moves |
| **Sidebar (iPad/Mac)** | Glass sidebar with `.ultraThinMaterial` |

### Animations

| Event | Animation |
|-------|-----------|
| **Country conquered** | Color tint transition (0.3s ease) |
| **Armies placed** | Badge scale bounce (spring) |
| **Player eliminated** | Badge fade out with scale |
| **Turn change** | Phase indicator slide transition |
| **Attack** | Source country pulse → target flash |
| **Victory** | Confetti particle effect overlay |
| **Your turn (watch)** | Haptic notification + badge highlight |

---

## 8. Constraints & Compliance

```
Concurrency:      All ViewModels are @MainActor. GameViewModel
                  dispatches AI work via Task { }. SwiftUIHumanAgent
                  is an actor. All published types are Sendable.

Determinism:      Local games accept a UInt32 seed. Multiplayer games
                  use server-assigned seeds.

Safety:           No force unwraps. Guard all snapshot access.
                  Country tap resolves via dictionary lookup, not
                  array indexing.

Generics:         Not applicable (UI layer, no numeric generics).

Swift 6:          Strict concurrency throughout. @Observable replaces
                  ObservableObject (no Combine dependency).

Liquid Glass:     iOS 26+ minimum. No fallback required.

Platform gates:   #if os(watchOS) for watch-specific code.
                  #if os(macOS) for menu bar and keyboard shortcuts.
                  Shared code uses no platform-specific APIs.
```

---

## 9. Dependencies

**Internal Dependencies:**

| Package | Used For |
|---------|----------|
| `IconquerCore` | `Game`, `GameSnapshot`, `GameMove`, `MapDefinition`, `Settings` |
| `IconquerAI` | `GreedyAgent`, `StrategicAgent`, `MonteCarloAgent`, `LearnedPolicyAgent` |
| `IconquerMatch` | `MatchRunner`, `PlayerAgent`, `SeatBinding`, `HumanAgent` |
| `IconquerClient` | `RemoteGameSession`, `ServerConnection` (multiplayer only) |

**External Dependencies:** None beyond Apple frameworks.

**Additional Internal Dependency:**

| Package | Used For |
|---------|----------|
| `IconquerAudio` | Sound effects module — dice rolls, conquest fanfares, turn notifications. Injected at app target level, not linked by IconquerUI. Iterable independently. |

**watchOS note:** `IconquerClient` is the only networking dependency. `IconquerAI` is needed for the "Auto-Play" feature. `IconquerMatch` is not needed on watchOS — the server runs the match. `IconquerAudio` is not used on watchOS (haptics only).

---

## 10. Test Strategy

### Test Categories

| Category | Coverage |
|----------|----------|
| **GameViewModel** | Start game, tap sequences, phase transitions, AI turn completion, move legality |
| **GeoStore** | Parse GeoJSON, validate 42-country mapping, centroid computation, bounding boxes |
| **HitTester** | Point-in-polygon accuracy for all 42 countries, ocean rejection, border cases |
| **CountryGeometry** | Shape path generation, projection correctness, multi-polygon countries |
| **SatelliteBasemap** | Tile loading, zoom level selection, missing tile fallback |
| **SwiftUIHumanAgent** | Move submission, timeout handling, cancellation |
| **MultiplayerViewModel** | Connect, room operations, error handling, disconnection |
| **WatchTurnViewModel** | Fetch state, suggested move generation, submission |
| **Interaction sequences** | Full game: pick → assign → attack → fortify → next turn |
| **Platform adaptation** | Size class layout decisions render correctly |

### Reference Truth

- **Game logic correctness:** Validated by IconquerCore's 180 existing tests
- **Map coordinates:** Visual verification against satellite basemap + GeoJSON boundaries; centroid placement validated per country
- **Multiplayer protocol:** Validated by IconquerServer's 26 + IconquerClient's 12 existing tests
- **AI behavior:** Validated by IconquerAI's 84 existing tests

### Golden Path Tests

```swift
@Test("Tap sequence produces attack move")
func tapToAttack() {
    let vm = GameViewModel.forTesting(map: .duel, seed: 42)
    // Advance to attack phase
    vm.tapCountry(CountryId("Atlantis"))   // source
    vm.tapCountry(CountryId("Pacifica"))   // target
    #expect(vm.selectedCountry == CountryId("Atlantis"))
    #expect(vm.targetCountry == CountryId("Pacifica"))
    let submitted = vm.confirmAction()
    #expect(submitted)
}

@Test("watchOS suggested moves are legal")
func watchSuggestedMovesAreLegal() async throws {
    let vm = WatchTurnViewModel.forTesting(snapshot: .sampleMidGame)
    await vm.computeSuggestions()
    for suggestion in vm.suggestedMoves {
        for move in suggestion.moves {
            #expect(vm.snapshot?.legalMoves.contains(move) == true)
        }
    }
}
```

### Edge Cases

- Tap on unowned country during attack phase (should ignore)
- Tap same country twice (should deselect)
- AI thinking interrupted by app backgrounding
- Server disconnect during multiplayer game
- watchOS receives turn notification for a game that ended
- iPad multitasking size class change mid-game
- Mac window resize below minimum during combat animation

---

## 11. Performance Considerations

| Concern | Mitigation |
|---------|-----------|
| **GeoJSON parsing** | Parse once at app launch into `GeoStore` (~2 MB GeoJSON, <100ms on A15+). Cache the parsed `CountryGeo` structs in memory for the session. |
| **Satellite tile memory** | Three zoom levels total ~8 MB on disk. Only the active zoom level's tiles are in memory (~1–2 MB). watchOS uses level 0 only (one 512×256 tile). |
| **Elevation data** | Loaded lazily — only when visionOS terrain is requested. 5-arc-minute ETOPO grid is ~4 MB. Not loaded on iOS/macOS/watchOS at all in Phase 3. |
| **Vector shape rendering** | 42 `Shape` instances with `Path` from pre-parsed polygons. SwiftUI caches rendered paths; re-fill only changes color, not geometry. Natural Earth 1:50m has ~10K vertices total for all 42 countries — trivial for GPU. |
| **Hit testing** | Bounding box rejection eliminates ~90% of countries per tap. Ray-casting on the remaining 1–3 candidates is <1ms. |
| **Map scrolling (iPhone)** | Use `ScrollView` with `MagnifyGesture`. Vector paths scale perfectly with zoom — no pixelation at any level. |
| **AI turn computation** | AI runs on background Task. UI shows spinner. Deadline timeout prevents hang. |
| **Multiplayer latency** | Optimistic UI: show move immediately, reconcile with server state update. |
| **watchOS memory** | No vector map or satellite tiles on watch. Continent summary only. Keep under 30MB. |
| **Animation frame rate** | Country fill color changes use `.animation(.easeInOut)` on the shape modifier, not full path re-computation. |
| **Total bundle size** | ~14 MB for geo data (GeoJSON + tiles + elevation). Comparable to the original 42 PNGs + Background.jpg, with far higher quality. |

---

## 12. Architecture Decision Review

```
ADR Check:
- [x] Reviewed architecture_decisions.md
- [x] Supersedes IconquerApp_SwiftUIPort.md (iOS-only, no watch, no multiplayer)
- [ ] Does not amend any existing ADR
- [x] New ADR required

New ADR Draft:
- Title: Multiplatform App via Shared IconquerUI Library
- Category: architecture
- Key decision: All view models and shared views live in a platform-agnostic
  IconquerUI library target. Platform-specific app targets import IconquerUI
  and add only platform-specific entry points and layout adapters. This
  replaces the previous single-target iOS-only design.
```

---

## 13. Resolved Design Decisions

1. **Watch connectivity:** Server-only for v1. No `WatchConnectivity` pairing — simpler, works without iPhone nearby, and the server infrastructure already exists.

2. **Offline play on watchOS:** Deferred to v2. The watch app's value proposition is "quick turn from your wrist" which requires an existing server game. Local AI play on watch is a v2 stretch goal.

3. **Map zoom on iPhone:** Both pinch-to-zoom (primary) and a list-view toggle for accessibility/preference.

4. **Save/load on device:** Both. Local saves for single-player via existing `SaveManager`, server persistence for multiplayer.

5. **Sound effects:** Separate `IconquerAudio` module — decoupled from the view layer so we can iterate on audio independently. Dice rolls, conquest fanfares, turn notifications. The core view layer stays silent and composable; audio is injected at the app target level.

6. **3D tabletop view on Mac/iPad:** Deferred to post-v1.0. Once the geo pipeline and visionOS mesh code exist, reusing them via SceneKit on Mac/iPad is low incremental cost. Not on the critical path for a playable v1.0.

### visionOS Experience Model (Phase 4 Forward Design)

The visionOS experience targets two presentation modes:

- **Volume:** The default — a tabletop-scale 3D globe rendered in a bounded volume. Players see the game map as a physical object on their desk/table. Rotate with gestures, gaze at countries to inspect, pinch to act. This is the single-player and spectator mode.
- **Full Space:** An immersive multiplayer war room. When a server-backed game has multiple human players, each sees the shared globe in a Full Space with spatial presence. Player avatars or indicators show who controls what. Server-side game state drives all clients — the same `IconquerServer` WebSocket infrastructure backs the spatial experience.

The elevation pipeline built in Phase 3 (ETOPO data → `ElevationProfile` → per-vertex Z) feeds directly into RealityKit `MeshResource` generation for both modes. No additional data work is needed in Phase 4.

---

## 14. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold:**
- Combines 10+ APIs across 4 platforms: Yes
- Explanation requires 50+ lines: Yes
- Needs theory/background context (map rendering, interaction model): Yes

**Articles Required:**
- `GettingStartedWithiConquer.md` — Setup, first game, AI opponents
- `MultiplayerGuide.md` — Connecting to servers, creating rooms
- `WatchPlayGuide.md` — Turn-based play from the wrist
- `MapRenderingArchitecture.md` — Geo pipeline: GeoJSON → vector shapes → satellite basemap → elevation (visionOS)

---

## 15. Implementation Phases

### Phase A: Foundation (v1.0)

Single-player local game on iPhone/iPad/Mac.

- [ ] **Geo data pipeline:** `GeoStore`, `CountryGeometry`, `HitTester`, `Projection`
- [ ] **Satellite basemap:** NASA Blue Marble tile preprocessing + `SatelliteBasemap` loader
- [ ] **Country mapping:** `iconquer_countries.json` — 42 CountryId ↔ Natural Earth polygon mapping
- [ ] `IconquerUI` library with `GameViewModel`
- [ ] `WorldMapView` with satellite basemap + vector country overlays
- [ ] Two-tap interaction model for all turn phases (hit testing via `HitTester`)
- [ ] `SetupView` with player config and AI opponent selection
- [ ] `GameHUDView` with phase controls and player badges
- [ ] Card turn-in sheet
- [ ] Victory/defeat screens
- [ ] Liquid Glass styling throughout
- [ ] iPad `NavigationSplitView` layout
- [ ] Mac menu bar and keyboard shortcuts
- [ ] **Elevation data bundling:** ETOPO 5-arc-minute grid (loaded lazily, not rendered in Phase A — prepares for Phase 4 visionOS)

### Phase B: Multiplayer (v1.1)

Server-backed games on iPhone/iPad/Mac.

- [ ] `MultiplayerViewModel` with lobby UI
- [ ] `LobbyView` and `RoomView`
- [ ] Connection status indicator
- [ ] Remote game session integration with `GameViewModel`
- [ ] Reconnection handling

### Phase C: watchOS (v1.2)

Turn-based play from the wrist.

- [ ] `WatchTurnViewModel` with server integration
- [ ] `WatchTurnView` with suggested moves
- [ ] Push notification for turn reminders
- [ ] `CompactMapView` continent overview
- [ ] "Auto-Play" via AI agent
- [ ] Complication showing game status

### Phase D: Widgets & Polish (v1.3)

- [ ] `GameStatusWidget` (iOS + watchOS)
- [ ] `TurnReminderWidget`
- [ ] `IconquerAudio` module — separate package, injected at app target level
- [ ] Haptic feedback
- [ ] Accessibility (VoiceOver labels for countries, dynamic type)
- [ ] Localization (leverage existing 7 localization bundles)
- [ ] **3D tabletop toggle** (Mac/iPad) — reuse visionOS mesh pipeline via SceneKit

---

*A single codebase, five platforms (iPhone/iPad/Mac/Watch/visionOS-ready), Liquid Glass throughout, real satellite imagery with vector boundaries, elevation-ready terrain pipeline, async multiplayer on the wrist, and AI opponents trained via a 750,000-game self-play pipeline.*
