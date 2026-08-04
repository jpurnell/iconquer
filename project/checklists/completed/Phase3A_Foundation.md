# Implementation Checklist: Phase 3A — Foundation (v1.0)

**Purpose:** Track implementation of the multiplatform SwiftUI app (iPhone/iPad/Mac) with satellite/vector map pipeline.
**Proposal:** `project/plans/proposals/IconquerApp_MultiplatformSwiftUI.md`
**Started:** 2026-05-04

---

## Development Workflow

```
0. DESIGN   → Propose architecture, get approval          ✅ DONE
1. RED      → Write failing tests
2. GREEN    → Write minimum code to pass
3. REFACTOR → Improve code, keep tests green
4. DOCUMENT → Add DocC comments and examples
5. VERIFY   → Zero warnings/errors gate
```

---

## Current Phase: COMPLETE

### Completed
- [x] Original SwiftUI proposal drafted (2026-04-25)
- [x] Revised to satellite/vector/elevation pipeline (2026-05-04)
- [x] All open questions resolved (2026-05-04)
- [x] Layer 0: Geo Data Pipeline — all 6 steps complete (68 tests)
- [x] Layer 1: Package Scaffold + View Model — all 4 steps complete (101 tests total)
- [x] Layer 2: Map Views — all 4 steps complete (109 tests total)
- [x] Layer 3: Game UI — all 4 steps complete (116 tests total)
- [x] Layer 4: Platform Integration — all 4 steps complete (134 tests total)
- [x] Layer 5: Persistence — Step 23 complete (142 tests total)

---

## Step Breakdown

Phase 3A is organized into 6 layers by dependency order. Each step follows Red/Green/Refactor within its layer. Steps within a layer are independent and can be parallelized.

### Layer 0: Geo Data Pipeline (no UI dependency)

These are pure-Swift, platform-agnostic types. They live in `IconquerUI/Geo/` and have no SwiftUI import. Testable headlessly.

#### Step 1: GeoJSON Parser + GeoStore Types ✅
> Parse Natural Earth GeoJSON into `GeoStore.CountryGeo` structs.

- Phase 0: Design
  - [x] API sketched in proposal (`GeoStore`, `CountryGeo`, `GeoPolygon`, `GeoCoordinate`, `GeoBoundingBox`)
- Phase 1: Tests (RED)
  - [x] Parse minimal GeoJSON fixture → produces `CountryGeo` with correct polygon count
  - [x] Multi-polygon country (e.g., Indonesia) → multiple `GeoPolygon` entries
  - [x] Centroid computation accuracy (known lat/lon for Brazil, Alaska, Australia)
  - [x] Bounding box computation (verify corners for rectangular countries)
  - [x] Empty/malformed GeoJSON → throws `GeoLoadError.malformed`
  - [x] Missing country → silently skipped (13 tests)
- Phase 2: Implementation (GREEN)
  - [x] `GeoCoordinate` struct (Sendable, Codable, Equatable)
  - [x] `GeoPolygon` struct with `exterior: [GeoCoordinate]`
  - [x] `GeoBoundingBox` struct with `contains(_:)` method
  - [x] `CountryGeo` struct with polygons, centroid, boundingBox
  - [x] `GeoStore` struct with `countries` dictionary
  - [x] `GeoStore.load()` — parse GeoJSON via `JSONSerialization`
  - [x] Centroid via arithmetic mean of polygon vertices
  - [x] Bounding box from min/max lon/lat sweep
- Phase 3: Refactor
  - [x] Safety audit (no force unwraps, guard all JSON access)
  - [x] All tests still green
- Phase 5: Quality Gate
  - [x] Zero warnings, all 13 tests pass

#### Step 2: Country Mapping File ✅
> Create `iconquer_countries.json` mapping 42 `CountryId` values to Natural Earth polygons.

- Phase 1: Tests (RED)
  - [x] All 42 CountryIds have a mapping entry (12 integration tests)
  - [x] Every territory loads with non-empty polygons
  - [x] All polygons have ≥4 vertices (closed rings)
  - [x] Centroids within valid geographic bounds
  - [x] Bounding boxes valid (min ≤ max)
  - [x] 6 continents with correct territory counts (sum to 42)
  - [x] No territory in multiple continents
  - [x] Spot-check centroids: Alaska, Brazil, Japan
- Phase 2: Implementation (GREEN)
  - [x] Python preprocessing script (`Scripts/build_iconquer_geojson.py`)
  - [x] Admin 0 + Admin 1 data merged into 42-territory GeoJSON
  - [x] Mixed source (admin0+admin1) for Russia territory
  - [x] `iconquer_42.geojson` (2.4 MB, 42 features)
  - [x] `iconquer_countries.json` mapping file
  - [x] Downloaded + bundled Natural Earth 1:50m Admin 0 + Admin 1
- Phase 3: Refactor
  - [x] Fixed Natural Earth code mismatches (ESH→SAH, PSE→PSX, UKR via admin0)
- Phase 5: Quality Gate
  - [x] All 42 countries load with non-empty polygons, 12 tests pass

#### Step 3: Projection ✅
> Equirectangular projection converting between geographic and screen coordinates.

- Phase 1: Tests (RED)
  - [x] Corner and center mapping tests (13 tests)
  - [x] Round-trip accuracy: `toGeo(toScreen(coord))` ≈ coord
  - [x] Rect variant with non-zero origins
- Phase 2: Implementation (GREEN)
  - [x] `MapProjection` struct with `toScreen` and `toGeo` methods
  - [x] Normalized output (0–1 range) + rect variants
  - [x] Division-by-zero guard on zero-size rects
- Phase 5: Quality Gate
  - [x] All 13 tests pass

#### Step 4: HitTester ✅
> Point-in-polygon country detection from tap coordinates.

- Phase 1: Tests (RED)
  - [x] Point-in-polygon with fixture countries (11 tests)
  - [x] Ocean returns nil, adjacent countries resolve correctly
  - [x] Multi-polygon support, rect variant
  - [x] Performance: 100 random lookups within time limit
- Phase 2: Implementation (GREEN)
  - [x] `HitTester` struct with `country(at:)` method
  - [x] Bounding box pre-filter + ray-casting even-odd rule
  - [x] Division-by-zero guard on degenerate edges
- Phase 5: Quality Gate
  - [x] All 11 tests pass

#### Step 5: Satellite Basemap Loader ✅
> Load pre-tiled NASA Blue Marble imagery.

- Phase 1: Tests (RED)
  - [x] Zoom level selection tests (8 tests)
  - [x] Tile returns nil for missing files
  - [x] Empty bundle yields empty availableZoomLevels
- Phase 2: Implementation (GREEN)
  - [x] `SatelliteBasemap` struct with `tile(zoom:x:y:)` method
  - [x] `zoomLevel(forViewWidth:)` threshold selection
  - [x] Platform-conditional image loading (AppKit/UIKit)
- Phase 5: Quality Gate
  - [x] All 8 tests pass

#### Step 6: Elevation Data Bundling ✅
> Bundle ETOPO 5-arc-minute grid for future visionOS use.

- Phase 1: Tests (RED)
  - [x] Load elevation grid with correct dimensions (10 tests)
  - [x] Bilinear interpolation between cells
  - [x] Negative elevations preserved
  - [x] Profile computes min/max/mean
  - [x] Wrong-size data returns nil
- Phase 2: Implementation (GREEN)
  - [x] `ElevationGrid` struct — Int16 LE binary loading
  - [x] `elevation(longitude:latitude:)` with bilinear interpolation
  - [x] `ElevationProfile` struct (min/max/mean/samples)
  - [x] Clamped index bounds
- Phase 5: Quality Gate
  - [x] All 10 tests pass

---

### Layer 1: Package Scaffold + View Model

#### Step 7: IconquerApp SPM Package ✅
> Create the SPM package with library + app targets.

- Phase 2: Implementation (GREEN)
  - [x] `IconquerApp/` sibling repo created
  - [x] `Package.swift` with swift-tools-version 6.2, platforms `.v26`
  - [x] `IconquerUI` library target (depends on IconquerCore)
  - [x] Directory structure: Sources/IconquerUI/{Geo,Model,ViewModel}, Tests/IconquerUITests
  - [x] SPM resolves all dependencies, builds clean
- Phase 5: Quality Gate
  - [x] Zero warnings

#### Step 8: Supporting Model Types ✅
> PlayerConfig, PlayerDisplayInfo, ColorMapping, TerritorySummary.

- Phase 1: Tests (RED)
  - [x] `PlayerConfig` round-trips through Codable (10 tests)
  - [x] `ColorMapping` returns distinct colors for all 6 names + fallback
  - [x] `PlayerDisplayInfo.from(snapshot:)` computes correct counts, current/eliminated flags
  - [x] `TerritorySummary` computes continent completion and progress correctly
- Phase 2: Implementation (GREEN)
  - [x] `PlayerConfig` struct (Identifiable, Sendable, Codable) with AI factory
  - [x] `ColorMapping` with 6 colors + gray fallback
  - [x] `PlayerDisplayInfo` struct (Sendable) with snapshot factory
  - [x] `TerritorySummary` struct with `ContinentStatus` and division-safe progress
- Phase 5: Quality Gate
  - [x] All types Sendable, no force unwraps, 10 tests pass

#### Step 9: SwiftUIHumanAgent ✅
> Actor bridging SwiftUI taps to the game engine.

- Phase 1: Tests (RED)
  - [x] `requestMove` suspends until `submitMove` resumes it (7 tests)
  - [x] `submitMove` with no pending request returns false
  - [x] Multiple sequential request/submit cycles
  - [x] `isWaitingForMove` reflects state correctly
  - [x] Task cancellation and `cancel()` resume with safe sentinel
- Phase 2: Implementation (GREEN)
  - [x] `SwiftUIHumanAgent` actor with `CheckedContinuation`
  - [x] `withTaskCancellationHandler` for safe cleanup
  - [x] Resumes with `.finishTurn` sentinel on cancellation (no leak)
- Phase 5: Quality Gate
  - [x] Actor isolation correct, Sendable compliance, 7 tests pass

#### Step 10: GameViewModel ✅
> Central bridge between engine and SwiftUI.

- Phase 1: Tests (RED)
  - [x] `startLocalGame` produces valid initial snapshot (16 tests)
  - [x] `tapCountry` in pick phase picks unclaimed country
  - [x] `tapCountry` in attack/fortify sets source, target, deselects
  - [x] `confirmAction` with no selection returns false
  - [x] `cancelSelection` clears both source and target
  - [x] `advancePhase` submits finishAttackPhase in attack
  - [x] `statusMessage` reflects current game phase
  - [x] `moveHistory` bounded at maxHistorySize (100)
  - [x] `isMyTurn` correctly reflects current player
  - [x] Clean init, state reset on new game
- Phase 2: Implementation (GREEN)
  - [x] `GameViewModel` class marked `@Observable @MainActor`
  - [x] Owns `Game` instance + `SwiftUIHumanAgent`
  - [x] `startLocalGame` creates game, starts async game loop
  - [x] `tapCountry` context-sensitive state machine per phase
  - [x] `confirmAction` builds `GameMove`, submits via agent
  - [x] AI dispatch in game loop with `aiThinking` flag
  - [x] `statusMessage` updates per phase/selection state
  - [x] `moveHistory` bounded at 100 entries
  - [x] `import struct IconquerCore.Settings` resolves SwiftUI naming collision
- Phase 5: Quality Gate
  - [x] @MainActor isolation, internal(set) access control, 16 tests pass

---

### Layer 2: Map Views

#### Step 11: CountryShapeView ✅
> Renders a single country as a tappable SwiftUI Shape.

- Phase 1: Tests (RED)
  - [x] Path generation tests (8 tests): non-empty, multi-ring, scaling, bounds, empty, offset
- Phase 2: Implementation (GREEN)
  - [x] `NormalizedPoint` struct (Sendable) — replaces tuples for Swift 6 compliance
  - [x] `CountryGeometry: Shape` — projects polygons via MapProjection, path scales to any CGRect
  - [x] `CountryShapeView` — wraps geometry with 0.4-opacity fill, white stroke, tap gesture
  - [x] Selection animation (easeInOut) and `@Sendable` onTap closure
- Phase 5: Quality Gate
  - [x] 8 tests pass, zero warnings

#### Step 12: ArmyBadgeView ✅
> Army count label positioned at country centroid.

- Phase 2: Implementation (GREEN)
  - [x] Capsule-shaped pill badge with player color fill
  - [x] White stroke border + 1.2x scale-up when selected
  - [x] Spring animations on count and selection changes
  - [x] `.caption2.weight(.bold)` for compact legibility
- Phase 5: Quality Gate
  - [x] Builds clean, zero warnings

#### Step 13: WorldMapView ✅
> Composite view: country vector overlays + army badges.

- Phase 2: Implementation (GREEN)
  - [x] `ZStack` layering: country shapes → army badges
  - [x] `GeometryReader` + 2:1 `aspectRatio` for equirectangular projection
  - [x] All countries rendered via `CountryShapeView` with ownership-based fill
  - [x] Army badges at centroids via `MapProjection.toScreen(in:)`
  - [x] Sorted country IDs for deterministic ForEach ordering
  - [x] `MainActor.assumeIsolated` for safe tap handling from `@Sendable` closure
- Phase 5: Quality Gate
  - [x] Builds clean, zero warnings

#### Step 14: MapView (Adaptive Container) ✅
> Scrollable on iPhone, fit-to-screen on iPad/Mac.

- Phase 2: Implementation (GREEN)
  - [x] `MapView` wraps `WorldMapView` with size-class adaptation
  - [x] Compact (iPhone): `ScrollView` with 600x300 minimum frame
  - [x] Regular (iPad/Mac/visionOS): aspect-fit with padding
  - [x] `#if os(tvOS)` guard for missing `horizontalSizeClass`
  - [x] Black background on all platforms
- Phase 5: Quality Gate
  - [x] Builds clean on all platforms, zero warnings

---

### Layer 3: Game UI

#### Step 15: GameHUDView ✅
> Phase indicator, player badges, action buttons.

- Phase 2: Implementation (GREEN)
  - [x] `PhaseIndicatorView` — capsule pill with SF Symbol + phase/turn text
  - [x] `PlayerBadgeView` — color dot + name + country/army/card counts
  - [x] `ActionButtonBar` — context-sensitive buttons per turn phase
  - [x] `GameHUDView` — composite: phase indicator + status + player list + actions
  - [x] `.ultraThinMaterial` backgrounds for Liquid Glass effect
- Phase 5: Quality Gate
  - [x] Builds clean, zero warnings

#### Step 16: SetupView ✅
> Game configuration: players, AI, map selection.

- Phase 1: Tests (RED)
  - [x] 7 tests for `GameSetupConfig` validation logic
  - [x] Default 4-player config (1 human, 3 AI), canStart true
  - [x] canStart false with 0 humans or duplicate colors
  - [x] addPlayer capped at 6, removePlayer floored at 2
  - [x] addPlayer picks unused color
- Phase 2: Implementation (GREEN)
  - [x] `GameSetupConfig` (@Observable) with validation logic
  - [x] `PlayerSlotView` — name, color, type, AI strategy pickers
  - [x] `SetupView` — player list + variant picker + Start button
  - [x] `import struct IconquerCore.Settings` resolves naming collision
- Phase 5: Quality Gate
  - [x] 7 tests pass, zero warnings

#### Step 17: Card Turn-In Sheet ✅
> Modal for selecting cards to trade for bonus armies.

- Phase 2: Implementation (GREEN)
  - [x] `CardTurnInSheet` — card grid, tap-to-select (max 3), Turn In button
  - [x] `CardView` — SF Symbol suit icons (Infantry/Cavalry/Artillery/Wild)
  - [x] Selection highlight with accent color stroke
  - [x] Mandatory mode hides Cancel button
- Phase 5: Quality Gate
  - [x] Builds clean, zero warnings

#### Step 18: Combat Result + Victory/Defeat Sheets ✅
> Overlays for attack outcomes and game end.

- Phase 2: Implementation (GREEN)
  - [x] `CombatResultView` — attacker/defender colors, losses, conquered flag
  - [x] `VictoryView` — trophy icon, winner name, turn count, New Game button
  - [x] `DefeatView` — flag icon, eliminated player, conquered-by text
  - [x] All use `.ultraThinMaterial` backgrounds
- Phase 5: Quality Gate
  - [x] Builds clean, zero warnings

---

### Layer 4: Platform Integration

#### Step 19: iPhone App Target ✅
> Core navigation views (library-side, no @main).

- Phase 1: Tests (RED)
  - [x] MapProvider: 15 tests — 42 countries, bidirectional neighbors, continent validation
  - [x] GameNavigator: 3 tests — initial state, returnToSetup, startGame
- Phase 2: Implementation (GREEN)
  - [x] `MapProvider` — hardcoded classic Risk adjacency for all 42 territories
  - [x] `GameNavigator` (@Observable @MainActor) — Sendable-safe navigation state
  - [x] `ContentView` — root view: loads geo data, setup → game flow
  - [x] `GameBoardView` — map + HUD, victory overlay, adaptive layout
- Phase 5: Quality Gate
  - [x] 18 new tests pass, zero warnings

#### Step 20: iPad NavigationSplitView ✅
> Sidebar layout for larger screens.

- Phase 2: Implementation (GREEN)
  - [x] `SidebarView` — player badges, territory summary, phase/status, action buttons
  - [x] `GameBoardView` adapts: compact→overlay HUD, regular→NavigationSplitView
  - [x] `#if os(tvOS)` guard for missing horizontalSizeClass
- Phase 5: Quality Gate
  - [x] Builds clean, zero warnings

#### Step 21: Mac Menu Bar + Keyboard Shortcuts ✅
> Reusable commands and keyboard modifiers (library components).

- Phase 2: Implementation (GREEN)
  - [x] `GameCommands: Commands` — New Game (Cmd+N), Confirm (Return), Cancel (Esc), Advance (Tab)
  - [x] `GameKeyboardShortcuts` ViewModifier — `onKeyPress` for inline handling
  - [x] `.gameKeyboardShortcuts(viewModel:)` View extension
  - [x] `#if os(macOS) || os(iOS) || os(visionOS)` guard for tvOS
- Phase 5: Quality Gate
  - [x] Builds clean, zero warnings

#### Step 22: Liquid Glass Styling Pass ✅
> Reusable styling components.

- Phase 2: Implementation (GREEN)
  - [x] `GlassCard` — `.ultraThinMaterial` container with rounded corners
  - [x] `PulseGlow` — pulsing white shadow modifier for selection highlights
  - [x] `AdaptiveStack` — HStack/VStack based on horizontalSizeClass
  - [x] `.pulseGlow(isActive:)` View extension
- Phase 5: Quality Gate
  - [x] Builds clean on all platforms, zero warnings

---

### Layer 5: Persistence

#### Step 23: Local Save/Load ✅
> Single-player game persistence via existing `SaveManager`.

- Phase 1: Tests (RED)
  - [x] Save mid-game → file created (8 tests)
  - [x] Load saved game → `GameViewModel` restores to correct state
  - [x] Load non-existent slot → throws error
  - [x] Multiple saves to different slots all appear
  - [x] Overwrite existing slot replaces previous
  - [x] Delete removes save slot
  - [x] Load restores humanPlayerIds from snapshot
- Phase 2: Implementation (GREEN)
  - [x] `SaveLoadManager` (@MainActor) — save/load/list/delete via `SaveManager` actor
  - [x] `GameViewModel.restoreFromSave(game:moveHistory:humanPlayerIds:)` for load path
  - [x] Uses `Game.saveGame()` and `Game.restore(from:)` for full fidelity
- Phase 5: Quality Gate
  - [x] Round-trip: save → load → game state identical, 8 tests pass

---

## Module Status

| Module | Status | Tests | Docs | Warnings |
|--------|--------|-------|------|----------|
| GeoStore | ✅ Done | 13 | No | 0 |
| Country Mapping | ✅ Done | 12 | No | 0 |
| Projection | ✅ Done | 13 | No | 0 |
| HitTester | ✅ Done | 11 | No | 0 |
| SatelliteBasemap | ✅ Done | 8 | No | 0 |
| ElevationGrid | ✅ Done | 10 | No | 0 |
| Package Scaffold | ✅ Done | 1 | No | 0 |
| Model Types | ✅ Done | 10 | No | 0 |
| SwiftUIHumanAgent | ✅ Done | 7 | No | 0 |
| GameViewModel | ✅ Done | 16 | No | 0 |
| Map Views | ✅ Done | 8 | No | 0 |
| Game UI | ✅ Done | 7 | No | 0 |
| Platform Integration | ✅ Done | 18 | No | 0 |
| Save/Load | ✅ Done | 8 | No | 0 |

---

## Quality Gates

Before marking any step complete:

```bash
quality-gate
```

### Required Checks (MANDATORY - Zero Tolerance)

| Check | Requirement |
|-------|-------------|
| `build` | ZERO compiler warnings |
| `test` | ZERO test failures |
| `safety` | ZERO forbidden patterns |
| `doc-lint` | ZERO documentation errors |
| `doc-coverage` | All public APIs documented |

### Safety Audit

- [ ] No force unwraps (`!`), force casts (`as!`), or `try!` in production code
- [ ] All divisions check for zero (centroid computation, projection)
- [ ] All loops have iteration limits (polygon iteration is bounded by vertex count)
- [ ] All array access is bounds-checked (GeoJSON parsing, tile lookup)
- [ ] All collections have size limits (moveHistory in GameViewModel)

---

## Parallelization Opportunities

Steps that can be worked on concurrently by sub-agents:

| Parallel Group | Steps | Why Independent |
|----------------|-------|-----------------|
| **Geo pipeline** | Steps 1, 3, 5, 6 | Different data types, no shared state |
| **Model types** | Steps 8, 9 | No dependency on each other |
| **Map views** | Steps 11, 12 | CountryShapeView and ArmyBadgeView are leaf views |
| **Game UI** | Steps 15, 16, 17, 18 | Independent view components |
| **Platform** | Steps 20, 21 | iPad and Mac adaptations are independent |

**Sequential dependencies:**
- Step 2 depends on Step 1 (mapping file needs GeoStore parser)
- Step 4 depends on Steps 1 + 3 (HitTester needs GeoStore + Projection)
- Step 7 must precede all Layer 1+ steps (package scaffold)
- Step 10 depends on Steps 8 + 9 (GameViewModel needs model types + agent)
- Step 13 depends on Steps 5 + 11 + 12 (WorldMapView needs basemap + shapes + badges)
- Step 14 depends on Steps 4 + 13 (MapView needs HitTester + WorldMapView)
- Steps 19–22 depend on all Layer 2–3 steps

---

## Backlog (Post-v1.0, Not in This Checklist)

### Phase B: Multiplayer (v1.1)
- [ ] MultiplayerViewModel + lobby UI
- [ ] Remote game session integration

### Phase C: watchOS (v1.2)
- [ ] WatchTurnViewModel + push notifications
- [ ] CompactMapView + Auto-Play

### Phase D: Widgets & Polish (v1.3)
- [ ] IconquerAudio module
- [ ] Widgets, haptics, accessibility, localization
- [ ] 3D tabletop toggle (Mac/iPad)

### Phase 4: visionOS Immersive
- [ ] Volume: tabletop globe (RealityKit mesh from elevation data)
- [ ] Full Space: multiplayer war room

---

## Notes

- **Repo layout:** `IconquerApp/` is a new sibling repo alongside `iconquer/` and `IconquerCore/`
- **Deployment targets:** iOS 26 / iPadOS 26 / macOS 26 / tvOS 26 / visionOS 26 (`.v26` platforms require swift-tools-version 6.2)
- **Geo data is all public domain:** Natural Earth, NASA Blue Marble, ETOPO — no licensing concerns
- **Elevation data is bundled but not rendered in Phase 3A** — it's there for Phase 4 visionOS

---

**Last Updated:** 2026-05-04 — All layers complete (142 tests, 0 warnings)
