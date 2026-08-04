# Design Proposal: World Map Layout Tuning for IconquerCLI TUI

**Date:** 2026-04-23
**Status:** Proposed
**Scope:** Layout validation, adaptive sizing, connection routing improvements, and systematic overlap fixes for the console map renderer

---

## 1. Objective

Add a layout validation and tuning system to the console map renderer that detects and prevents visual defects (overlapping country boxes, cramped spacing, out-of-bounds elements), supports multiple terminal sizes, and improves connection line routing for cross-continent and wrap-around connections.

**Problems solved:**
1. **No overlap detection.** The current `MapLayout` JSON format allows country boxes to overlap, but there is no compile-time or load-time validation. Overlapping boxes produce garbled output that is unreadable and confusing.
2. **Single fixed layout size.** The world layout targets 120x40, but many terminals run at 80x24 (the POSIX minimum). Players on small terminals get a scrolling viewport that shows only a fraction of the map, destroying spatial awareness.
3. **Naive connection routing.** The Console Map proposal draws connection lines using Bresenham's algorithm between box edge midpoints. Lines that pass through intermediate country boxes create visual clutter and make adjacency ambiguous.
4. **No wrap-around support.** The Alaska-Kamchatka connection crosses the Pacific -- the most iconic wrap-around in Risk. Drawing a straight line from the left edge to the right edge of the canvas crosses the entire map, obscuring everything in between.
5. **No systematic tuning methodology.** The initial layout was hand-authored by rough continental allocation. There is no repeatable process for detecting problems, measuring spacing quality, or validating fixes.

**Master Plan Reference:** Phase 2 -- TUI polish and playability. This proposal refines the Console Map Renderer (proposed in `IconquerCLI_ConsoleMap.md`) to production quality.

---

## 2. Proposed Architecture

### New Files

| File | Purpose |
|------|---------|
| `Sources/IconquerCLILib/Support/LayoutValidator.swift` | `LayoutValidator` enum with static analysis checks for `MapLayout` |
| `Sources/IconquerCLILib/Support/ConnectionRouter.swift` | Waypoint-based, obstacle-aware connection line routing |
| `Sources/IconquerCLILib/Support/AdaptiveLayout.swift` | Layout variant selection based on terminal dimensions |
| `Resources/Maps/world_layout_compact.json` | Compact layout for 80x24 terminals |
| `Resources/Maps/world_layout_standard.json` | Standard layout for 120x40 terminals (replaces `world_layout.json`) |

### Modified Files

| File | Change |
|------|--------|
| `Sources/IconquerCLILib/Support/MapLayout.swift` | Add `WrapConnection` type for split-edge wrap-around connections; add `LayoutMetrics` computed properties |
| `Sources/IconquerCLILib/Support/MapRenderer.swift` | Delegate connection drawing to `ConnectionRouter`; render split wrap-around connections at canvas edges |
| `Sources/IconquerCLILib/Components/BoardComponent.swift` | Select layout variant via `AdaptiveLayout` based on current terminal size |
| `Resources/Maps/world_layout.json` | Refined positions fixing known overlap/cramping issues (replaces initial draft) |

### Module Placement

All new code lives in `IconquerCLILib/Support/`. No new modules. `IconquerCore` is not modified. The layout validation runs at layout-load time and during tests; it is not a runtime rendering concern.

---

## 3. API Surface

### LayoutValidator (static analysis engine)

```swift
/// Validates a MapLayout for visual defects before rendering.
///
/// All checks are pure functions that return structured diagnostics.
/// The validator never mutates the layout -- it reports problems for
/// the author to fix in the JSON file.
public enum LayoutValidator {

    /// A single validation finding.
    public struct Diagnostic: Sendable, CustomStringConvertible {
        /// Severity of the finding.
        public var severity: Severity
        /// Human-readable description of the problem.
        public var message: String
        /// The country or countries involved.
        public var countries: [String]

        public enum Severity: String, Sendable, Comparable {
            /// Will produce garbled output. Must fix.
            case error
            /// May produce poor visuals. Should fix.
            case warning
            /// Informational suggestion.
            case info
        }
    }

    /// Run all validation checks on a layout.
    ///
    /// - Parameter layout: The layout to validate.
    /// - Returns: All diagnostics found, sorted by severity (errors first).
    public static func validate(_ layout: MapLayout) -> [Diagnostic]

    /// Check for overlapping country boxes using AABB intersection.
    ///
    /// Two boxes overlap if their axis-aligned bounding boxes intersect.
    /// Adjacent boxes (sharing exactly one edge) are not considered overlapping.
    ///
    /// - Parameter layout: The layout to check.
    /// - Returns: One diagnostic per overlapping pair.
    public static func checkOverlaps(_ layout: MapLayout) -> [Diagnostic]

    /// Check that all country boxes have sufficient spacing.
    ///
    /// Minimum spacing is defined in `LayoutConfig.minimumBoxSpacing`.
    /// Boxes closer than this threshold produce a warning.
    ///
    /// - Parameter layout: The layout to check.
    /// - Returns: One diagnostic per pair below minimum spacing.
    public static func checkSpacing(_ layout: MapLayout) -> [Diagnostic]

    /// Check that all country boxes fit within the canvas bounds.
    ///
    /// A box that extends beyond `layout.width` or `layout.height` is an error.
    ///
    /// - Parameter layout: The layout to check.
    /// - Returns: One diagnostic per out-of-bounds box.
    public static func checkBounds(_ layout: MapLayout) -> [Diagnostic]

    /// Check that all connections reference countries that exist in the layout.
    ///
    /// - Parameter layout: The layout to check.
    /// - Returns: One diagnostic per dangling connection endpoint.
    public static func checkConnections(_ layout: MapLayout) -> [Diagnostic]

    /// Check that box dimensions meet minimum size requirements.
    ///
    /// Minimum width: `LayoutConfig.minimumBoxWidth` (default 5).
    /// Minimum height: `LayoutConfig.minimumBoxHeight` (default 3).
    ///
    /// - Parameter layout: The layout to check.
    /// - Returns: One diagnostic per undersized box.
    public static func checkMinimumSizes(_ layout: MapLayout) -> [Diagnostic]
}
```

### ConnectionRouter (obstacle-aware routing)

```swift
/// Routes connection lines between country boxes, avoiding intermediate obstacles.
///
/// Uses a waypoint-based approach: for each connection, compute a path from
/// source edge to destination edge that does not pass through any other
/// country box. Falls back to direct Bresenham lines when no obstacles
/// are in the way.
public enum ConnectionRouter {

    /// A routed path between two countries.
    public struct RoutedConnection: Sendable {
        /// The source country ID.
        public var from: String
        /// The destination country ID.
        public var to: String
        /// Ordered waypoints from source edge to destination edge.
        /// Each segment between consecutive waypoints is a straight line.
        public var waypoints: [Point]
        /// Visual style (solid or dashed).
        public var style: MapLayout.Connection.ConnectionStyle
    }

    /// A 2D point on the canvas.
    public struct Point: Sendable, Equatable {
        public var x: Int
        public var y: Int
    }

    /// Route all connections in a layout, avoiding country box obstacles.
    ///
    /// - Parameter layout: The layout containing countries and connections.
    /// - Returns: Routed connections with waypoints for rendering.
    public static func routeAll(layout: MapLayout) -> [RoutedConnection]

    /// Route a single connection between two countries.
    ///
    /// - Parameters:
    ///   - connection: The connection to route.
    ///   - countries: All country positions (used as obstacles).
    ///   - canvasWidth: The canvas width for wrap-around calculations.
    ///   - canvasHeight: The canvas height for bounds checking.
    /// - Returns: A routed connection with waypoints, or nil if either
    ///   endpoint country is missing from the layout.
    public static func route(
        connection: MapLayout.Connection,
        countries: [String: MapLayout.CountryPosition],
        canvasWidth: Int,
        canvasHeight: Int
    ) -> RoutedConnection?

    /// Route a wrap-around connection that splits at canvas edges.
    ///
    /// Used for connections like Alaska-Kamchatka that cross the map boundary.
    /// Produces two line segments: one from the source to the near edge,
    /// and one from the far edge to the destination.
    ///
    /// - Parameters:
    ///   - connection: The wrap-around connection.
    ///   - countries: All country positions.
    ///   - canvasWidth: The canvas width.
    /// - Returns: Two routed connections representing the split segments,
    ///   or nil if either endpoint is missing.
    public static func routeWrapAround(
        connection: MapLayout.Connection,
        countries: [String: MapLayout.CountryPosition],
        canvasWidth: Int
    ) -> (left: RoutedConnection, right: RoutedConnection)?
}
```

### AdaptiveLayout (terminal-size-aware layout selection)

```swift
/// Selects the best pre-authored layout variant for the current terminal size.
///
/// Rather than dynamically scaling coordinates (which produces poor results
/// for text-based layouts), this system chooses from a set of hand-tuned
/// layout variants optimized for specific size ranges.
public enum AdaptiveLayout {

    /// A named layout variant with its target size range.
    public struct Variant: Sendable {
        /// Human-readable name (e.g., "compact", "standard").
        public var name: String
        /// Minimum terminal columns for this variant.
        public var minColumns: Int
        /// Minimum terminal rows for this variant.
        public var minRows: Int
        /// The layout data for this variant.
        public var layout: MapLayout
    }

    /// Select the best layout variant for the given terminal dimensions.
    ///
    /// Returns the largest variant that fits within the terminal. If no
    /// variant fits, returns the smallest available variant (the user
    /// will get a scrolling viewport).
    ///
    /// - Parameters:
    ///   - variants: Available layout variants, ordered smallest to largest.
    ///   - columns: Current terminal width in columns.
    ///   - rows: Current terminal height in rows.
    /// - Returns: The best-fit layout variant.
    public static func select(
        from variants: [Variant],
        columns: Int,
        rows: Int
    ) -> Variant

    /// Load all available layout variants for a given map name.
    ///
    /// Looks for files matching `{mapName}_layout_{variant}.json` in the
    /// resources bundle.
    ///
    /// - Parameter mapName: The base map name (e.g., "world").
    /// - Returns: All found variants, sorted by canvas area (smallest first).
    public static func loadVariants(for mapName: String) -> [Variant]
}
```

### MapLayout additions

```swift
// Added to MapLayout:

/// A connection that wraps around the canvas edge (e.g., Alaska-Kamchatka).
///
/// Wrap connections are rendered as two split segments: one exiting the
/// near edge and one entering from the far edge, with matching arrows
/// or labels to indicate continuity.
public struct WrapConnection: Codable, Sendable {
    /// Source country ID.
    public var from: String
    /// Destination country ID.
    public var to: String
    /// The edge where the connection exits the canvas.
    public var exitEdge: Edge
    /// The Y coordinate where the connection exits (for left/right edges).
    public var exitY: Int
    /// The Y coordinate where the connection enters (for left/right edges).
    public var entryY: Int

    public enum Edge: String, Codable, Sendable {
        case left
        case right
    }
}

/// Wrap-around connections that split at canvas edges.
public var wrapConnections: [WrapConnection]
```

### LayoutConfig (tuning constants)

```swift
/// Configuration constants for layout validation and tuning.
///
/// All layout-related magic numbers live here. No numeric literals
/// appear in validation or routing logic.
public struct LayoutConfig: Sendable {
    /// Minimum horizontal gap between adjacent country boxes (columns).
    public var minimumBoxSpacing: Int = 1
    /// Minimum box width in columns (border + 3-char label minimum).
    public var minimumBoxWidth: Int = 5
    /// Minimum box height in rows (top border + content + bottom border).
    public var minimumBoxHeight: Int = 3
    /// Padding around country boxes for connection routing (columns).
    public var routingPadding: Int = 1
    /// Maximum waypoints per routed connection before falling back to direct.
    public var maxWaypoints: Int = 4
    /// Standard layout canvas dimensions.
    public var standardWidth: Int = 120
    public var standardHeight: Int = 40
    /// Compact layout canvas dimensions.
    public var compactWidth: Int = 80
    public var compactHeight: Int = 24
}
```

---

## 4. MCP Schema

No new MCP tools required. Layout validation and adaptive sizing are internal presentation-layer concerns. AI agents interact with `GameSnapshot` via MCP and have no need for layout coordinates or visual tuning data.

**Future consideration:** A `validate_layout` MCP tool could allow custom map authors to check their layout files programmatically. This is deferred until the custom map authoring workflow is defined.

**Layout JSON schema extension -- WrapConnection:**
```json
{
  "wrapConnections": [
    {
      "from": "Alaska",
      "to": "Kamchatka",
      "exitEdge": "left",
      "exitY": 3,
      "entryY": 5
    }
  ]
}
```

**Parameter Types:**
- `wrapConnections` (array): Connections that cross the canvas boundary.
  - `from` (string): Source country ID. Must exist in `countries`.
  - `to` (string): Destination country ID. Must exist in `countries`.
  - `exitEdge` (string): `"left"` or `"right"`. The edge where the line exits the source side.
  - `exitY` (integer): Row where the line exits the canvas. Must be >= 0 and < `height`.
  - `entryY` (integer): Row where the line enters the canvas on the opposite edge. Must be >= 0 and < `height`.

---

## 5. Constraints & Compliance

**Concurrency:** All new types are `Codable & Sendable` value types or stateless enums with static functions. No shared mutable state. `LayoutValidator` and `ConnectionRouter` are pure functions.

**No force unwraps:** All dictionary lookups use optional binding. Missing countries cause the validator to emit a diagnostic or the router to skip the connection. Never crash on malformed input.

**No hardcoded constants:** All numeric thresholds live in `LayoutConfig`. Canvas dimensions come from the layout JSON. Box sizes come from the layout JSON. Routing padding and spacing thresholds are configurable.

**Division safety:** AABB intersection calculations use only addition, subtraction, and comparison -- no division. The router's slope calculations guard against zero-length segments.

**Guard clauses:** All validation and routing functions use guard-let with early returns for missing data.

**Swift 6 strict concurrency:** All new types are `Sendable`. Static functions with no escaping closures. No actors or async code needed -- layout validation and routing are synchronous, deterministic computations.

**No `String(format:)`:** All diagnostic messages use string interpolation.

**Coding rules compliance:**
- Generic where appropriate (validator checks are protocol-extensible)
- All public APIs have DocC documentation
- No force casts or force unwraps

---

## 6. Backend Abstraction (If Compute-Intensive)

Not applicable. Layout validation is O(n^2) for n countries (pairwise overlap checks). With 42 countries, that is 861 pair comparisons -- trivial. Connection routing uses simple geometric tests (AABB intersection, edge midpoint calculations) -- no GPU, Metal, or Accelerate involvement.

The only potentially expensive operation is obstacle-aware routing with many waypoints. The `LayoutConfig.maxWaypoints` cap (default 4) ensures the router terminates quickly. For 80-100 connections, total routing time is sub-millisecond.

---

## 7. Dependencies

**Internal Dependencies:**
- `SwiftCLIKit` -- `Frame`, `Cell`, `Color`, `Rect` (existing, no changes needed)
- `IconquerCore` -- `MapDefinition`, `CountryId` (read-only, no changes)
- `IconquerCLILib/Support/MapLayout.swift` -- the layout data model (from Console Map proposal, must be implemented first)
- `IconquerCLILib/Support/MapRenderer.swift` -- modified to use `ConnectionRouter` (from Console Map proposal)

**External Dependencies:** None.

**Ordering Dependencies:**
1. The Console Map Renderer proposal (`IconquerCLI_ConsoleMap.md`) must be implemented first. This proposal extends `MapLayout` and `MapRenderer` with validation, routing, and adaptive sizing.
2. `LayoutValidator` and `ConnectionRouter` can be implemented and tested independently of each other.
3. `AdaptiveLayout` requires at least two layout JSON files to be authored (compact and standard).

---

## 8. Test Strategy

**Test Categories:**

| Category | Tests |
|----------|-------|
| **AABB overlap detection** | Two boxes with clear overlap detected; adjacent boxes (shared edge) not flagged; diagonal-only contact not flagged; identical boxes detected as overlap |
| **Known overlap pairs** | Regression tests for specific country pairs that overlapped in the initial layout draft (e.g., Ontario/Quebec cramping, Scandinavia/Ukraine overlap, Siam/India crowding) |
| **Spacing checks** | Boxes at exactly minimum spacing pass; boxes below minimum spacing produce warning; boxes with zero gap produce error |
| **Bounds validation** | Box fully within canvas passes; box extending past right edge flagged; box extending past bottom edge flagged; negative coordinates flagged |
| **Connection integrity** | Connection referencing existing countries passes; connection referencing missing country flagged; duplicate connections flagged |
| **Minimum size** | Box at minimum dimensions passes; box below minimum width flagged; box below minimum height flagged |
| **Full layout validation** | Load `world_layout_standard.json` and assert zero errors; load `world_layout_compact.json` and assert zero errors |
| **Connection routing** | Direct route between two boxes with no obstacles produces two-point path; route between boxes with obstacle in between produces waypoint path that avoids the obstacle |
| **Wrap-around routing** | Alaska-Kamchatka connection produces two split segments; left segment exits at canvas column 0; right segment enters at canvas column `width - 1` |
| **Adaptive selection** | 80x24 terminal selects compact variant; 120x40 terminal selects standard variant; 60x20 terminal selects compact (smallest available) with viewport scrolling |
| **Edge cases** | Empty layout (no countries) validates without crash; single-country layout passes; layout with no connections passes |

**Reference Truth:**
- AABB overlap is verified by constructing two known-overlapping rectangles and asserting the validator detects them
- Routing correctness is verified by asserting no waypoint segment intersects any country box AABB (excluding source and destination)
- Wrap-around correctness is verified by asserting the exit point is at column 0 or `width - 1` and the entry point is at the opposite edge

**Validation Trace (REQUIRED):**
- Create layout with Alaska at `{ x: 2, y: 2, width: 11, height: 3 }` and Northwest Territory at `{ x: 8, y: 2, width: 11, height: 3 }`
- These boxes overlap: Alaska spans columns 2-12, NW Territory spans columns 8-18, intersection at columns 8-12
- Call `LayoutValidator.checkOverlaps(layout)`
- Assert: returns exactly one diagnostic with severity `.error`
- Assert: diagnostic message contains both "Alaska" and "Northwest Territory"
- Fix: move NW Territory to `{ x: 14, y: 1, width: 11, height: 3 }` (no overlap)
- Call `LayoutValidator.checkOverlaps(layout)` again
- Assert: returns empty array (no overlaps)

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
title: Pre-authored adaptive layout variants over dynamic scaling
context: |
  The console map targets 120x40 but must work on 80x24 terminals.
  Options: (a) dynamically scale all coordinates by a ratio,
  (b) use a single layout with viewport scrolling, (c) pre-author
  separate layout variants optimized for each size tier.
decision: |
  Pre-author layout variants for each supported size tier (compact
  80x24, standard 120x40). AdaptiveLayout selects the best-fit
  variant at layout-load time. Each variant is a complete, hand-tuned
  MapLayout JSON file with positions optimized for that canvas size.
rationale: |
  - Dynamic scaling produces fractional coordinates, uneven spacing,
    and truncated labels in a character-grid renderer. Text cannot be
    smoothly scaled -- a 7-column box scaled to 4 columns loses
    readability.
  - Viewport scrolling (ADR-001 fallback) works but destroys spatial
    awareness on small terminals -- the main benefit of the map view.
  - Pre-authored variants let the designer optimize each size tier
    independently: compact layouts use smaller boxes, shorter
    abbreviations, and tighter continental groupings.
  - Adding a new size tier (e.g., ultra-wide 200x50) requires only a
    new JSON file, no code changes.
consequences: |
  + Each size tier has a purpose-built, visually optimized layout
  + No runtime scaling math or rounding errors
  + Easy to add new tiers without code changes
  - Each new map requires N layout files (one per tier) instead of one
  - Layout files must be kept in sync when country lists change
  - Initial authoring effort is higher (mitigated by using the
    standard layout as a template for compact)
alternatives_rejected:
  - "Dynamic coordinate scaling: Produces poor results in character grids, fractional positions"
  - "Single layout with mandatory scrolling: Defeats the purpose of spatial awareness on small terminals"
  - "Auto-layout algorithm: Non-deterministic, geography-unaware, worse results than hand-tuning"
affected_files:
  - Sources/IconquerCLILib/Support/AdaptiveLayout.swift
  - Sources/IconquerCLILib/Components/BoardComponent.swift
  - Resources/Maps/world_layout_compact.json
  - Resources/Maps/world_layout_standard.json
supersedes: null
amends: null
superseded_by: null
```

---

## 10. Open Questions

1. **How many size tiers?** The proposal defines two (compact 80x24, standard 120x40). Should there be a third "large" tier for wide terminals (160x50+)? **Proposed answer:** Start with two. A large tier can be added later by authoring another JSON file -- no code changes needed. The standard layout with viewport scrolling handles oversized terminals adequately.

2. **Should the validator run at startup or only in tests?** Running at startup adds load-time cost and produces diagnostics that the player cannot act on. **Proposed answer:** Run in tests only. The validator is a development-time tool for layout authors. Ship only validated layouts. Add a `--validate-layout` CLI flag for custom map authors.

3. **Obstacle-aware routing complexity?** Full A* pathfinding on a character grid is correct but expensive and complex. **Proposed answer:** Use a simplified approach: for each connection, check if the direct line intersects any country box AABB. If it does, insert one or two waypoints that route around the obstacle's corners (adding `routingPadding` margin). This handles the common case (one obstacle between two countries) without the complexity of a full pathfinding algorithm. Connections that would require 3+ detours fall back to direct lines -- visual overlap is acceptable in dense regions.

4. **Wrap-around for which connections?** Only Alaska-Kamchatka in the standard world map. Should wrap-around be general-purpose for custom maps? **Proposed answer:** Yes. The `WrapConnection` type is general-purpose. Any connection can be declared as wrap-around in the layout JSON. The renderer handles the split rendering. Custom maps with unusual topologies (e.g., cylindrical worlds) can use this freely.

5. **Should compact layout omit connections?** On an 80x24 canvas, connection lines add significant visual noise between tightly packed boxes. **Proposed answer:** The compact layout can set `connections: []` and `wrapConnections: []` to omit lines entirely, relying on box adjacency and the tree view fallback for neighbor information. Alternatively, it can include only cross-continent connections (dashed ocean lines) for geographic orientation. This is a layout-authoring decision, not a code decision.

6. **Layout tuning workflow?** How should a developer iterate on layout positions? **Proposed answer:** A three-step loop: (1) edit the JSON file, (2) run the validator test suite to check for overlaps/spacing/bounds, (3) render the map in a test terminal to visually inspect. The validator catches mechanical errors; visual inspection catches aesthetic issues. A future `--preview-layout` CLI mode could render the map with dummy data for faster iteration.

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (LayoutValidator, ConnectionRouter, AdaptiveLayout, WrapConnection, LayoutConfig)
- Does explanation require 50+ lines? Yes (AABB math, routing algorithm, adaptive selection logic, wrap-around rendering)
- Does it need theory/background context? Yes (AABB intersection, obstacle avoidance geometry, terminal size detection)

**Article Name:** `MapLayoutTuningGuide.md`
(Placed in `.docc` catalog if/when IconquerCLI adds documentation. Must NOT match any Swift symbol name.)

**Article Outline:**
1. Overview -- what layout tuning solves and why it matters
2. LayoutValidator -- running checks, interpreting diagnostics, fixing common problems
3. Connection routing -- how waypoint routing avoids obstacles, when fallback occurs
4. Wrap-around connections -- Alaska-Kamchatka split rendering, authoring custom wraps
5. Adaptive layout variants -- size tiers, selection logic, authoring a new variant
6. Layout tuning workflow -- the edit/validate/preview iteration loop
7. Known issues and fixes -- catalog of overlap/cramping problems found in the initial layout and how they were resolved

---

## Layout Tuning Methodology

This section describes the systematic approach for fixing known layout problems.

### Step 1: Identify problems via validator

Run `LayoutValidator.validate(layout)` on the current `world_layout.json`. The validator produces diagnostics for:
- **Overlaps (error):** Two country boxes whose AABBs intersect. These must be fixed -- overlapping boxes produce garbled rendering.
- **Cramped spacing (warning):** Two boxes closer than `minimumBoxSpacing`. Readable but visually tight.
- **Out of bounds (error):** Boxes extending past the canvas edge. These are clipped during rendering, hiding content.
- **Undersized boxes (warning):** Boxes too small to display a readable abbreviation.

### Step 2: Continental region budgeting

Each continent has a budget of canvas area. When fixing overlaps, do not simply push boxes apart -- this cascades into neighboring regions. Instead:

1. Count the countries per continent.
2. Divide the canvas into continental regions (as defined in the Console Map proposal).
3. For each region, compute the total box area (sum of width * height for all countries).
4. If total box area exceeds the region area minus required spacing, the region needs expansion or the boxes need shrinking.
5. Adjust region boundaries first, then reposition boxes within regions.

### Step 3: Priority ordering

Fix problems in this order:
1. **Out-of-bounds errors** -- move boxes inward.
2. **Overlaps within a continent** -- spread boxes within the continental region.
3. **Overlaps between continents** -- adjust region boundaries.
4. **Cramped spacing** -- fine-tune positions for visual breathing room.
5. **Connection routing** -- re-route after all box positions are finalized.

### Step 4: Regression locking

After fixing each problem, add a regression test that asserts the specific pair no longer overlaps. This prevents future edits from reintroducing the problem:

```swift
func testOntarioQuebecNoOverlap() {
    let layout = loadWorldLayout()
    guard let ontario = layout.countries["Ontario"],
          let quebec = layout.countries["Quebec"] else {
        XCTFail("Missing country in layout")
        return
    }
    XCTAssertFalse(
        LayoutValidator.boxesOverlap(ontario, quebec),
        "Ontario and Quebec must not overlap"
    )
}
```

### Known Problem Areas (Initial Layout Draft)

Based on the continental allocations in the Console Map proposal:

| Problem | Region | Countries | Root Cause |
|---------|--------|-----------|------------|
| Horizontal cramping | North America | Ontario, Quebec, Greenland | Three boxes in columns 26-52 with only 2-column gaps |
| Vertical stacking | Europe | Southern/Western/Northern Europe | Seven countries in 25 columns and 10 rows is very tight |
| Diagonal overlap | Asia | Siam, India, China | Large continent (12 countries) in a triangular shape |
| Cross-continent bleed | Africa/Europe | North Africa, Southern Europe | Continental boundary at row 10-11 with boxes straddling the line |
| Wrap-around clutter | Pacific | Alaska, Kamchatka | Direct line crosses entire canvas width |

Each of these will have a dedicated regression test after resolution.

### Compact Layout (80x24) Authoring Strategy

The compact layout uses these size reductions:
- **Box width:** 7-9 columns (down from 11) -- uses 2-3 character abbreviations
- **Box height:** 3 rows (unchanged minimum)
- **Continental regions:** Proportionally scaled to 80x24 canvas
- **Connections:** Omitted or reduced to cross-continent only
- **Spacing:** 1 column minimum (down from 2)

The compact layout is authored by:
1. Taking the standard layout positions.
2. Scaling all coordinates by (80/120, 24/40) = (0.667, 0.6).
3. Rounding to integers.
4. Running the validator to detect problems introduced by rounding.
5. Hand-adjusting positions to fix overlaps and cramping.
6. Reducing box widths to fit the tighter grid.
