# Design Proposal: Visual Console Map Renderer for IconquerCLI TUI

**Date:** 2026-04-10
**Status:** Proposed
**Scope:** Data-driven ASCII/Unicode map renderer for the Map tab in IconquerCLI

---

## 1. Objective

Add a visual, spatial map renderer to the IconquerCLI TUI that shows countries as colored, labeled rectangles positioned to approximate real-world geography, with lines connecting adjacent territories.

**Problems solved:**
1. **No spatial awareness.** The current Map tab is a tree view (continent > country list). Players cannot tell that Brazil borders Argentina, or that Alaska connects to Kamchatka across the Pacific.
2. **Cognitive load during attacks.** Choosing attack targets requires the player to mentally reconstruct geography from a flat list. A visual map makes adjacency obvious at a glance.
3. **Poor spectator experience.** When watching AI-vs-AI games or tournaments, a spatial map conveys the strategic situation far more effectively than a tree.

**Master Plan Reference:** Phase 2 -- TUI polish and playability. The Map tab is the primary game view; making it spatial is the single highest-impact UX improvement remaining.

---

## 2. Proposed Architecture

### New Files

| File | Purpose |
|------|---------|
| `Sources/IconquerCLILib/Support/MapLayout.swift` | `MapLayout` struct, `CountryPosition`, `Connection` types; JSON decoding |
| `Sources/IconquerCLILib/Support/MapRenderer.swift` | Renders `MapLayout` + `GameSnapshot` into a `Frame` |
| `Sources/IconquerCLILib/Support/MapAbbreviations.swift` | Country name abbreviation table and truncation logic |
| `Resources/Maps/world_layout.json` | Layout positions for the standard 42-country world map |
| `Resources/Maps/duel_layout.json` | Layout positions for the 2-country duel map |

### Modified Files

| File | Change |
|------|--------|
| `Sources/IconquerCLILib/Components/BoardComponent.swift` | `renderMapTab` gains a view-mode toggle; dispatches to either tree renderer (existing) or `MapRenderer` |
| `Sources/IconquerCLILib/App/GameModel.swift` | Add `mapViewMode: MapViewMode` enum field (`.tree` / `.spatial`) |
| `Sources/IconquerCLILib/App/GameUpdate.swift` | Handle `m` key to toggle `mapViewMode`; handle click-in-map-region selection |
| `Package.swift` | Add `Resources/Maps` to resource bundle (if using SPM resources) or embed as static strings |

### Module Placement

All new code lives in `IconquerCLILib/Support/`. No new modules. `MapLayout` is internal to the CLI; `IconquerCore` is not modified. The layout JSON files are bundled as SPM resources or compiled-in string constants.

---

## 3. API Surface

### MapLayout (Codable data model)

```swift
/// A data-driven layout defining where each country appears on the terminal grid.
///
/// Loaded from a JSON file. Each map definition (world, duel, custom) has a
/// corresponding layout file. The layout is independent of game state -- it
/// defines only spatial positions.
public struct MapLayout: Codable, Sendable {
    /// Total canvas width in terminal columns.
    public var width: Int
    /// Total canvas height in terminal rows.
    public var height: Int
    /// Per-country positions keyed by `CountryId.rawValue`.
    public var countries: [String: CountryPosition]
    /// Lines drawn between connected countries.
    public var connections: [Connection]

    /// Where a single country box appears on the canvas.
    public struct CountryPosition: Codable, Sendable {
        /// Left edge column.
        public var x: Int
        /// Top edge row.
        public var y: Int
        /// Box width in columns (including border).
        public var width: Int
        /// Box height in rows (including border).
        public var height: Int
        /// Optional offset within the box for the label. Defaults to centered.
        public var labelOffsetX: Int?
        public var labelOffsetY: Int?
    }

    /// A rendered connection line between two countries.
    public struct Connection: Codable, Sendable {
        /// Source country (`CountryId.rawValue`).
        public var from: String
        /// Destination country (`CountryId.rawValue`).
        public var to: String
        /// Visual style of the connection line.
        public var style: ConnectionStyle

        public enum ConnectionStyle: String, Codable, Sendable {
            /// Solid line for land-adjacent territories.
            case solid
            /// Dashed line for cross-ocean connections (e.g., Alaska to Kamchatka).
            case dashed
        }
    }
}
```

### MapRenderer (stateless rendering engine)

```swift
/// Renders a visual map of the game board into a SwiftCLIKit Frame.
///
/// `MapRenderer` is a pure function with no mutable state. It reads the
/// layout, the game snapshot, and UI state, then writes colored characters
/// into the frame.
public enum MapRenderer {

    /// Render the full map into the given frame.
    ///
    /// - Parameters:
    ///   - layout: The spatial layout to use.
    ///   - snapshot: Current game state (owners, armies).
    ///   - selectedCountry: The country the user has highlighted (reverse video).
    ///   - attackSource: The country the user has committed to attack from (red border).
    ///   - theme: The active visual theme.
    ///   - viewport: The visible region if the map is larger than the terminal.
    ///   - frame: The frame to render into.
    public static func render(
        layout: MapLayout,
        snapshot: GameSnapshot,
        selectedCountry: CountryId?,
        attackSource: CountryId?,
        theme: GameTheme,
        viewport: Rect,
        into frame: inout Frame
    )
}
```

### MapAbbreviations

```swift
/// Provides short names for countries that don't fit in small boxes.
///
/// Uses a two-tier system:
/// 1. A static lookup table for known country names (e.g., "Northwest Territory" -> "NW Terr")
/// 2. A fallback truncation algorithm that preserves the first N characters
public enum MapAbbreviations {

    /// Returns an abbreviated name that fits within the given column width.
    ///
    /// - Parameters:
    ///   - name: The full country name.
    ///   - maxWidth: Maximum characters available.
    /// - Returns: A name that fits, possibly abbreviated.
    public static func abbreviate(_ name: String, maxWidth: Int) -> String
}
```

### GameModel addition

```swift
/// Controls whether the Map tab shows the tree view or the spatial map.
public enum MapViewMode: String, Sendable {
    /// The existing continent > country tree view.
    case tree
    /// The new spatial map renderer.
    case spatial
}

// Added to GameModel:
public var mapViewMode: MapViewMode = .tree
```

---

## 4. MCP Schema

The map layout files are static data, not an MCP tool. However, the spatial map enriches the game state that AI agents consume via MCP.

**Tool Description:** No new MCP tools required. The visual map is a presentation-layer feature. AI agents already receive the full `GameSnapshot` with country ownership, army counts, and neighbor lists -- they do not need spatial coordinates.

**Future consideration:** If an LLM agent wants to reason about the visual map, we could expose a `render_ascii_map` tool that returns a plain-text rendering. This is deferred.

**REQUIRED STRUCTURE (JSON) -- MapLayout file format:**
```json
{
  "width": 120,
  "height": 40,
  "countries": {
    "Alaska": { "x": 2, "y": 2, "width": 11, "height": 3 },
    "Northwest Territory": { "x": 14, "y": 1, "width": 11, "height": 3 },
    "Greenland": { "x": 42, "y": 0, "width": 11, "height": 3 },
    "Alberta": { "x": 14, "y": 4, "width": 11, "height": 3 },
    "Ontario": { "x": 26, "y": 4, "width": 11, "height": 3 },
    "Quebec": { "x": 38, "y": 4, "width": 11, "height": 3 },
    "Western US": { "x": 14, "y": 7, "width": 11, "height": 3 },
    "Eastern US": { "x": 26, "y": 7, "width": 11, "height": 3 },
    "Central America": { "x": 20, "y": 10, "width": 11, "height": 3 }
  },
  "connections": [
    { "from": "Alaska", "to": "Northwest Territory", "style": "solid" },
    { "from": "Alaska", "to": "Kamchatka", "style": "dashed" }
  ]
}
```

**Parameter Types:**
- `width` (integer): Total canvas width in terminal columns. Must be > 0.
- `height` (integer): Total canvas height in terminal rows. Must be > 0.
- `countries` (object): Map of `CountryId.rawValue` to position object.
  - `x` (integer): Left edge column. Must be >= 0.
  - `y` (integer): Top edge row. Must be >= 0.
  - `width` (integer): Box width including borders. Must be >= 5 (minimum for a 3-char label).
  - `height` (integer): Box height including borders. Must be >= 3 (top border, content, bottom border).
  - `labelOffsetX` (integer, optional): Column offset for label within box.
  - `labelOffsetY` (integer, optional): Row offset for label within box.
- `connections` (array): Lines drawn between countries.
  - `from` (string): Source country ID. Must exist in `countries`.
  - `to` (string): Destination country ID. Must exist in `countries`.
  - `style` (string): `"solid"` or `"dashed"`.

---

## 5. Constraints & Compliance

**Concurrency:** `MapLayout` is `Codable & Sendable` (immutable value type after decode). `MapRenderer` is a stateless enum with a static function -- no concurrency concerns.

**No force unwraps:** All dictionary lookups use optional binding. Missing countries in the layout are silently skipped (logged to debug history).

**No hardcoded constants:** Canvas dimensions, box sizes, and positions come from the JSON layout file. Rendering constants (border characters, padding) are defined in a `RenderingConfig` struct within `MapRenderer`.

**Division safety:** Viewport offset calculations guard against zero-width/height frames.

**Guard clauses:** All validation uses guard-let with early returns.

**Swift 6 strict concurrency:** All new types are `Sendable`. `MapRenderer.render` takes `inout Frame` -- no escaping closures, no shared mutable state.

**Coding rules compliance:**
- Generic where possible (MapRenderer could accept any layout conforming to a protocol, but the concrete type is sufficient for now)
- No `String(format:)` -- all text formatting uses interpolation
- All public APIs have DocC documentation

---

## 6. Backend Abstraction (If Compute-Intensive)

Not applicable. Map rendering is a simple character-grid write operation. A 120x40 grid is 4,800 cells -- trivial for any CPU. No GPU, Metal, or Accelerate involvement.

The only performance consideration is connection line rendering (Bresenham's line algorithm for drawing lines between country centers), which is O(max(dx, dy)) per connection -- negligible for 80-100 connections.

---

## 7. Dependencies

**Internal Dependencies:**
- `SwiftCLIKit` -- `Frame`, `Cell`, `Color`, `Rect`, `CellAttributes` (existing, no changes needed)
- `IconquerCore` -- `MapDefinition`, `GameSnapshot`, `CountryId`, `PlayerId` (read-only, no changes)
- `IconquerCLILib/Support/GameTheme.swift` -- player colors and theme values (existing)
- `IconquerCLILib/Support/GameTreeDataSource.swift` -- country node data (existing, used by tree view fallback)

**External Dependencies:** None.

**Resource Dependencies:**
- `Resources/Maps/world_layout.json` -- hand-authored layout for 42-country world map
- `Resources/Maps/duel_layout.json` -- layout for 2-country duel map

These JSON files are authored once and versioned alongside the source. They may be embedded as Swift string literals via a build step or loaded from SPM's `Bundle.module` resource system.

---

## 8. Test Strategy

**Test Categories:**

| Category | Tests |
|----------|-------|
| **Layout loading** | `MapLayout` decodes from valid JSON; all 42 countries present in world layout; no overlapping boxes |
| **Validation** | Rejects layout with negative coordinates; rejects boxes smaller than minimum size; rejects connections referencing missing countries |
| **Rendering: country boxes** | Each country box appears at the correct (x, y) in the frame; border characters are `box-drawing` Unicode |
| **Rendering: labels** | Country name (or abbreviation) appears inside the box; army count appears inside the box |
| **Rendering: owner colors** | Country box filled with owner's player color from snapshot |
| **Rendering: selection** | Selected country has reverse-video attribute; attack source has red/bold border |
| **Rendering: connections** | Solid connections draw continuous lines between adjacent box edges; dashed connections use `dash` characters |
| **Rendering: dimming** | During placement phase, enemy countries render with `.dim` attribute |
| **Abbreviations** | Known names abbreviate correctly; unknown names truncate gracefully; names that fit are returned unchanged |
| **Viewport** | When map is larger than frame, only the visible portion renders; scroll offset correctly shifts all coordinates |
| **Edge cases** | Empty layout (no countries) renders without crash; single-country layout works; country at canvas edge clips gracefully |

**Reference Truth:**
- Box-drawing correctness validated by reading back `Cell` characters at known coordinates from the frame
- No external reference needed -- this is a presentation feature, not a calculation
- Golden path: load `world_layout.json`, render with a known snapshot, assert that "Alaska" appears at the expected (x, y) coordinates in the frame's cell buffer

**Validation Trace (REQUIRED):**
- Load world layout JSON with Alaska at `{ x: 2, y: 2, width: 11, height: 3 }`
- Render with snapshot where Alaska is owned by Player1 (color "#e06c75") with 5 armies
- Assert: `frame.cell(x: 2, y: 2).character == "+"` (top-left corner)
- Assert: `frame.cell(x: 3, y: 3).character == "A"` (start of "Alaska" or abbreviation)
- Assert: `frame.cell(x: 8, y: 3).character == "5"` (army count)
- Assert: `frame.cell(x: 3, y: 3).fg == Color.truecolor(r: 224, g: 108, b: 117)` (player color)

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [ ] Does this supersede an existing ADR? No (no existing ADRs)
- [ ] Does this amend an existing ADR? No
- [x] New ADR required? Yes -- draft below

**New ADR Draft:**

```yaml
id: ADR-001
date: 2026-04-10
status: proposed
category: architecture
title: Data-driven map layout via JSON position files
context: |
  The TUI needs a visual map renderer that positions countries spatially.
  Country positions could be hardcoded in Swift, computed algorithmically
  (force-directed graph layout), or loaded from external data files.
decision: |
  Map layouts are defined in JSON files with explicit (x, y, width, height)
  for each country. The renderer loads the layout at startup and uses it
  as a pure data source. Each MapDefinition can have zero or more
  corresponding layout files; if no layout exists, the Map tab falls back
  to the tree view.
rationale: |
  - Hand-authored layouts produce better results than algorithmic placement
    for well-known maps (the world map has a canonical shape)
  - JSON is human-editable, version-controllable, and trivially decodable
  - Decouples map data (IconquerCore) from presentation (IconquerCLI)
  - Supports custom user maps: users can author a layout file alongside
    their MapDefinition JSON
  - Force-directed layout is complex, non-deterministic, and produces
    suboptimal results for geographically-motivated graphs
consequences: |
  + Clean separation of concerns (data vs. presentation)
  + Easy to iterate on layout without recompiling
  + Custom maps get visual rendering for free if a layout file is provided
  - Each new map needs a hand-authored layout file (one-time effort)
  - Layout files must be kept in sync with MapDefinition country lists
alternatives_rejected:
  - "Hardcoded Swift positions: Not extensible to custom maps, clutters source"
  - "Force-directed graph layout: Non-deterministic, poor results for geography, complex to implement"
  - "ASCII art template: Fragile, hard to parse, doesn't support truecolor"
affected_files:
  - Sources/IconquerCLILib/Support/MapLayout.swift
  - Sources/IconquerCLILib/Support/MapRenderer.swift
  - Resources/Maps/world_layout.json
  - Resources/Maps/duel_layout.json
supersedes: null
amends: null
superseded_by: null
```

---

## 10. Open Questions

1. **Tab vs. toggle?** Should the spatial map be a separate tab, or a view mode toggle within the existing Map tab? **Proposed answer:** View mode toggle (`m` key) within the Map tab. This avoids adding a 6th tab and keeps tree view available for data-dense scenarios.

2. **Terminal width < 120 columns?** The world map layout targets 120x40. Options: (a) horizontal/vertical scrolling with arrow keys, (b) auto-scale to fit by shrinking boxes, (c) fall back to tree view. **Proposed answer:** Scrolling viewport. The map renders into a virtual canvas at full size; the viewport shows the portion that fits. Arrow keys pan. This is simpler than scaling and preserves readability.

3. **Connection line routing?** Straight lines between country centers may cross through other country boxes. Options: (a) accept visual overlap (simplest), (b) route lines around boxes (complex), (c) only draw connections at box edges (moderate). **Proposed answer:** Draw connections at box edges only. Find the closest edge points between two boxes and draw a line between them. If the line passes through a third box, accept the overlap for v1 -- orthogonal routing is a future polish item.

4. **Custom map layouts?** Should users be able to provide layout files for custom maps? **Proposed answer:** Yes, by convention. If a map is loaded from `foo.json`, the renderer looks for `foo_layout.json` in the same directory. If not found, the Map tab stays in tree view. This requires no code beyond a file-lookup convention.

5. **Army count display for large numbers?** Countries can accumulate 50+ armies. A 3-digit number may not fit in a small box. **Proposed answer:** Use compact notation: `99` for two digits, `1k` for 1000+. The box minimum width of 5 columns guarantees space for a 2-character label + space + 2-digit army count.

6. **Connection lines during attack animation?** Should the connection between attacker and defender flash or highlight during combat? **Proposed answer:** Deferred to a future animation system. For v1, the attack source has a red border and the selected target has reverse video -- this is sufficient to convey the attack pair.

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (MapLayout, MapRenderer, MapAbbreviations, viewport scrolling, GameModel integration)
- Does explanation require 50+ lines? Yes (rendering algorithm, layout format, viewport math)
- Does it need theory/background context? Yes (Bresenham line drawing, box-drawing character set, viewport clipping)

**Article Name:** `ConsoleMapRendererGuide.md`
(Placed in `.docc` catalog if/when IconquerCLI adds documentation. Must NOT match any Swift symbol name.)

**Article Outline:**
1. Overview -- what the console map does and why
2. Layout file format -- JSON schema with annotated example
3. Rendering pipeline -- country boxes, labels, connections, coloring
4. Viewport and scrolling -- how panning works when the map exceeds terminal size
5. Creating custom layouts -- how to author a layout file for a custom map
6. Keyboard controls -- `m` toggle, arrow-key panning, click selection

---

## Rendering Algorithm Detail

This section expands on the rendering pipeline for implementation clarity.

### Phase 1: Clear canvas

Fill the frame region with the theme background color. This ensures no stale characters from a previous render bleed through.

### Phase 2: Draw connections (back layer)

Connections render first so that country boxes draw on top of them, providing a clean z-ordering.

For each connection in `layout.connections`:
1. Compute the center point of the `from` box and the `to` box.
2. Find the closest edge midpoints between the two boxes.
3. Draw a line between the two edge midpoints using Bresenham's algorithm.
4. Character selection per line segment:
   - Horizontal segments: `"solid"` -> `\u2500` (BOX DRAWINGS LIGHT HORIZONTAL), `"dashed"` -> `\u254C` (BOX DRAWINGS LIGHT DOUBLE DASH HORIZONTAL)
   - Vertical segments: `"solid"` -> `\u2502` (BOX DRAWINGS LIGHT VERTICAL), `"dashed"` -> `\u254E` (BOX DRAWINGS LIGHT DOUBLE DASH VERTICAL)
   - Diagonal segments: `\u2571` (BOX DRAWINGS LIGHT DIAGONAL UPPER RIGHT TO LOWER LEFT) or `\u2572` (BOX DRAWINGS LIGHT DIAGONAL UPPER LEFT TO LOWER RIGHT)
5. Connection color: theme `muted` for all connections (they are background context, not foreground information).

### Phase 3: Draw country boxes (mid layer)

For each country in `layout.countries`:
1. Look up the country in `snapshot.countries` to get owner and army count.
2. Determine the fill color:
   - If owned: the owner's player color (from `snapshot.players[ownerId].color`)
   - If unowned: theme `muted`
   - If enemy during placement phase: theme `muted` with `.dim` attribute
3. Draw the box border using box-drawing characters:
   - Corners: `\u250C` (top-left), `\u2510` (top-right), `\u2514` (bottom-left), `\u2518` (bottom-right)
   - Horizontal: `\u2500`
   - Vertical: `\u2502`
4. Fill the interior with space characters in the owner's background color (or use foreground-colored block characters `\u2588` for a filled appearance -- theme-dependent).
5. Write the country label:
   - Abbreviate the name using `MapAbbreviations.abbreviate(name, maxWidth: box.width - 2)`
   - Center the label horizontally within the box interior
   - Place it on the `labelOffsetY` row (default: row 1 of interior, i.e., `y + 1`)
6. Write the army count:
   - Format: plain integer, or `"Xk"` for 1000+
   - Right-align within the box interior on the same row as the label (or the row below for height >= 4)

### Phase 4: Apply selection overlays (top layer)

After all boxes are drawn:
1. **Selected country:** Apply `CellAttributes.reverse` to all cells within the selected country's box.
2. **Attack source:** Redraw the box border using `theme.error` color with `CellAttributes.bold`.
3. **Attack target (selectedCountry when attackSource is set):** Redraw the box border using `theme.info` color with `CellAttributes.bold`.

### Phase 5: Viewport clipping

If the layout canvas (`layout.width x layout.height`) exceeds the available frame area:
1. Maintain a `viewportOffset: (x: Int, y: Int)` in `GameModel`.
2. During rendering, subtract `viewportOffset` from all coordinates.
3. Skip any cell writes that fall outside the frame's bounds.
4. Draw scroll indicators at the frame edges: arrows showing which directions have off-screen content.

### Country Box Examples

**Standard box (width >= 11, height >= 3):**
```
+---Alaska---+
|  P1    5a  |
+------------+
```

**Medium box (width 8-10, height 3):**
```
+-Alaska-+
| P1  5a |
+--------+
```

**Compact box (width 5-7, height 3):**
```
+----+
|AK 5|
+----+
```

**Tall box (width >= 11, height >= 4):**
```
+---Alaska---+
|    Player1 |
|      5a    |
+------------+
```

### World Map Layout Regions

The 120x40 canvas is divided into continental regions:

```
 Col:  0         20        40        60        80        100       120
 Row 0 |--N.AMERICA--|-------EUROPE-------|--------ASIA---------|
     5 |             |                    |                     |
    10 |             |                    |                     |
    15 |--S.AMERICA--|------AFRICA--------|                     |
    20 |             |                    |                     |
    25 |             |                    |------AUSTRALIA------|
    30 |             |                    |                     |
    35 |-------------|--------------------|--------------------- |
    40
```

Approximate per-continent allocations:
- **North America (9 countries):** columns 0-30, rows 0-12
- **South America (4 countries):** columns 10-35, rows 13-26
- **Europe (7 countries):** columns 40-65, rows 0-10
- **Africa (6 countries):** columns 40-65, rows 11-26
- **Asia (12 countries):** columns 66-118, rows 0-22
- **Australia (4 countries):** columns 85-118, rows 23-35

These are approximate guides for authoring `world_layout.json`. The exact positions will be refined during implementation by visually testing the output.
