# Design Proposal: Unified Map File Format

**Date:** 2026-04-10
**Status:** Proposed
**Scope:** Replace the legacy two-file map format with a single unified `.json` file containing the game tree and optional visual layouts

---

## 1. Objective

Replace the legacy two-file format (`Countries.json` + `Continents.json`) with a single unified `.json` file that contains the game tree AND zero or more optional visual layouts. This becomes the canonical iConquer map format.

**Problems solved:**
1. **Fragmented map data.** The current format splits a single logical map into two files in a directory. This makes sharing, copying, and validating maps error-prone.
2. **No layout coupling.** Visual layouts (from the ConsoleMap proposal) live in separate files with a naming convention. The unified format bundles layouts alongside the game definition, ensuring they stay in sync.
3. **No metadata.** The current format has no room for map name, version, description, or author. The unified format adds a metadata envelope.
4. **Multiple terminal sizes unsupported.** A single layout file cannot serve both 120-column and 80-column terminals. The unified format supports an array of layouts with size-based selection.

**Master Plan Reference:** Phase 2 -- TUI polish and playability. The unified format is foundational infrastructure for custom maps, visual rendering, and the format guide documentation.

---

## 2. Proposed Architecture

### New Files

| File | Module | Purpose |
|------|--------|---------|
| `Sources/IconquerCLILib/Map/UnifiedMapFile.swift` | IconquerCLILib | Top-level `UnifiedMapFile` struct; parses unified JSON into `MapDefinition` + `[MapLayout]` |
| `Sources/IconquerCLILib/Map/MapLayout.swift` | IconquerCLILib | `MapLayout`, `CountryPosition`, `ConnectionOverride` types for visual layout data |
| `Sources/IconquerCLILib/Map/UnifiedMapLoader.swift` | IconquerCLILib | File I/O: loads a `.json` file, decodes `UnifiedMapFile`, validates |
| `Sources/IconquerCLILib/Map/ConnectionRouter.swift` | IconquerCLILib | Derives visual connections from the neighbor graph; applies overrides |
| `Resources/Maps/world.json` | IconquerCLILib | Classic 42-country world map in unified format (replaces `Maps/world/` directory) |
| `Resources/Maps/duel.json` | IconquerCLILib | Two-country duel map in unified format |
| `Resources/Maps/line4.json` | IconquerCLILib | Four-country linear map in unified format |
| `Docs/iConquerMapFormat.md` | Project root | Comprehensive format guide for map authors |

### Modified Files

| File | Change |
|------|--------|
| `Sources/IconquerCLILib/StarterMaps.swift` | Load built-in maps from unified `.json` resources instead of `MapFileLoader` |
| `Sources/IconquerCLILib/MapResolver.swift` | Accept single `.json` files; resolve unified format; drop directory-based loading |
| `Sources/IconquerCLILib/MapFileLoader.swift` | Remove entirely (no existing user base for legacy format) |

### Module Placement

The split is intentional:
- **`IconquerCore`** is NOT modified. `MapDefinition` stays pure: countries + continents + neighbors. The core engine has no concept of visual positions.
- **`IconquerCLILib`** owns the unified format, including `MapLayout`. The unified file is parsed into a `MapDefinition` (passed to the engine) and `[MapLayout]` (used by the renderer).

This preserves the clean separation: IconquerCore is the rules engine; IconquerCLILib is the presentation layer that happens to bundle maps.

---

## 3. API Surface

### UnifiedMapFile (top-level parsed representation)

```swift
/// The complete parsed map file -- game rules + visual layouts.
///
/// A unified map file is a single JSON document containing countries,
/// continents, neighbor relationships, and zero or more terminal layouts.
/// The ``mapDefinition`` property extracts the pure game tree for the
/// rules engine; the ``layouts`` array provides visual rendering data.
public struct UnifiedMapFile: Codable, Sendable, Hashable {
    /// Human-readable map name (e.g., "Classic World").
    public var name: String
    /// Semantic version of this map definition.
    public var version: String?
    /// Optional description for display in map selection UI.
    public var description: String?

    /// The countries in this map with their neighbor relationships.
    public var countries: [CountryEntry]
    /// The continents with bonus army values and member countries.
    public var continents: [ContinentEntry]
    /// Optional visual layouts for terminal rendering.
    public var layouts: [MapLayout]?

    /// A country entry in the unified format.
    public struct CountryEntry: Codable, Sendable, Hashable {
        public var id: String
        public var neighbors: [String]
    }

    /// A continent entry in the unified format.
    public struct ContinentEntry: Codable, Sendable, Hashable {
        public var id: String
        public var armies: Int
        public var countries: [String]
    }

    /// Extract the pure game definition for the rules engine.
    public var mapDefinition: MapDefinition {
        MapDefinition(
            countries: countries.map {
                MapDefinition.Country(
                    id: CountryId($0.id),
                    neighbors: $0.neighbors.map { CountryId($0) }
                )
            },
            continents: continents.map {
                MapDefinition.Continent(
                    id: $0.id,
                    armies: $0.armies,
                    countries: $0.countries.map { CountryId($0) }
                )
            }
        )
    }

    /// Select the best layout for the given terminal width.
    ///
    /// Returns the layout with the largest `minTerminalWidth` that still
    /// fits within the given width. Returns `nil` if no layouts exist or
    /// none fit.
    public func bestLayout(forWidth width: Int) -> MapLayout? {
        guard let layouts = layouts, !layouts.isEmpty else { return nil }
        return layouts
            .filter { ($0.minTerminalWidth ?? 0) <= width }
            .max(by: { ($0.minTerminalWidth ?? 0) < ($1.minTerminalWidth ?? 0) })
    }
}
```

### MapLayout (visual position data)

```swift
/// Visual layout for rendering a map in a terminal of a specific size.
///
/// Each layout targets a minimum terminal width. The renderer selects
/// the best-fitting layout at runtime via ``UnifiedMapFile/bestLayout(forWidth:)``.
public struct MapLayout: Codable, Sendable, Hashable {
    /// Layout name for display in settings (e.g., "Standard", "Compact").
    public var name: String
    /// Optional description.
    public var description: String?
    /// Canvas width in terminal columns.
    public var width: Int
    /// Canvas height in terminal rows.
    public var height: Int
    /// Minimum terminal width for this layout to be selectable.
    public var minTerminalWidth: Int?
    /// Per-country positions keyed by country ID string.
    public var positions: [String: CountryPosition]
    /// Optional visual connection overrides (style, waypoints).
    public var connectionOverrides: [ConnectionOverride]?
}

/// Position and size of a country box on the layout canvas.
public struct CountryPosition: Codable, Sendable, Hashable {
    /// Left edge column.
    public var x: Int
    /// Top edge row.
    public var y: Int
    /// Box width in columns (including border).
    public var w: Int
    /// Box height in rows (including border).
    public var h: Int
}

/// Visual override for a specific connection between two countries.
public struct ConnectionOverride: Codable, Sendable, Hashable {
    /// Source country ID.
    public var from: String
    /// Destination country ID.
    public var to: String
    /// Visual style override.
    public var style: ConnectionStyle?
    /// Explicit waypoints for non-straight-line routing.
    public var waypoints: [Waypoint]?

    public enum ConnectionStyle: String, Codable, Sendable, Hashable {
        /// Solid line (default for land-adjacent).
        case solid
        /// Dashed line (e.g., cross-ocean connections).
        case dashed
        /// Hidden -- suppress the auto-derived connection line.
        case hidden
    }

    public struct Waypoint: Codable, Sendable, Hashable {
        public var x: Int
        public var y: Int
    }
}
```

### ConnectionRouter (derives visual connections)

```swift
/// Derives visual connections from the neighbor graph and applies overrides.
///
/// The router inspects every neighbor pair in the map definition, computes
/// edge-to-edge connection lines between country boxes, and applies any
/// ``ConnectionOverride`` entries from the layout.
public enum ConnectionRouter {

    /// A resolved visual connection ready for rendering.
    public struct ResolvedConnection: Sendable, Hashable {
        public var from: String
        public var to: String
        public var style: ConnectionOverride.ConnectionStyle
        public var waypoints: [ConnectionOverride.Waypoint]
    }

    /// Derive all visual connections for the given map and layout.
    ///
    /// - Parameters:
    ///   - mapFile: The unified map file (provides the neighbor graph).
    ///   - layout: The selected layout (provides positions and overrides).
    /// - Returns: An array of resolved connections with routing and style.
    public static func resolve(
        mapFile: UnifiedMapFile,
        layout: MapLayout
    ) -> [ResolvedConnection]
}
```

### UnifiedMapLoader (file I/O)

```swift
/// Loads and validates unified map files from disk.
public enum UnifiedMapLoader {

    public enum LoadError: Error, CustomStringConvertible, Sendable {
        case fileNotFound(String)
        case decodeFailed(String)
        case validationFailed(String)

        public var description: String { /* ... */ }
    }

    /// Load a unified map from a file path.
    public static func load(path: String) throws -> UnifiedMapFile

    /// Load a unified map from raw JSON data.
    public static func load(data: Data) throws -> UnifiedMapFile

    /// Validate a loaded map file for internal consistency.
    ///
    /// Checks: all continent countries exist in the countries array;
    /// all neighbor references are valid; layout positions reference
    /// valid countries; no duplicate country IDs.
    public static func validate(_ mapFile: UnifiedMapFile) throws
}
```

---

## 4. MCP Schema

The unified map file is a data format, not an MCP tool. However, the format is machine-readable and could be consumed by AI agents for map generation.

**Tool Description:** No new MCP tools required for v1. The unified format is consumed by the CLI loader. Future consideration: an MCP `generate_map` tool that produces a valid unified JSON.

**REQUIRED STRUCTURE (JSON) -- Unified Map File Format:**

```json
{
  "name": "Classic World",
  "version": "1.0",
  "description": "The classic 42-country iConquer world map",

  "countries": [
    {
      "id": "Alaska",
      "neighbors": ["Northwest Territory", "Alberta", "Kamchatka"]
    },
    {
      "id": "Alberta",
      "neighbors": ["Alaska", "Northwest Territory", "Ontario", "Western United States"]
    }
  ],

  "continents": [
    {
      "id": "North America",
      "armies": 5,
      "countries": ["Alaska", "Alberta", "Central America", "Eastern United States",
                     "Greenland", "Northwest Territory", "Ontario", "Quebec",
                     "Western United States"]
    },
    {
      "id": "South America",
      "armies": 2,
      "countries": ["Argentina", "Brazil", "Peru", "Venezuela"]
    }
  ],

  "layouts": [
    {
      "name": "Standard",
      "description": "Full-size layout for 120+ column terminals",
      "width": 120,
      "height": 40,
      "minTerminalWidth": 100,
      "positions": {
        "Alaska": { "x": 5, "y": 2, "w": 12, "h": 3 },
        "Alberta": { "x": 18, "y": 4, "w": 12, "h": 3 },
        "Kamchatka": { "x": 108, "y": 2, "w": 12, "h": 3 }
      },
      "connectionOverrides": [
        {
          "from": "Alaska",
          "to": "Kamchatka",
          "style": "dashed",
          "waypoints": [{ "x": 0, "y": 3 }, { "x": 119, "y": 3 }]
        }
      ]
    },
    {
      "name": "Compact",
      "description": "Compact layout for 80-column terminals",
      "width": 80,
      "height": 24,
      "minTerminalWidth": 60,
      "positions": {
        "Alaska": { "x": 2, "y": 1, "w": 8, "h": 3 }
      }
    }
  ]
}
```

**Parameter Types:**
- `name` (string, required): Human-readable map name.
- `version` (string, optional): Semantic version of the map definition.
- `description` (string, optional): Map description for UI display.
- `countries` (array, required): Array of country objects.
  - `id` (string): Unique country identifier.
  - `neighbors` (array of strings): IDs of adjacent countries. Must be bidirectional.
- `continents` (array, required): Array of continent objects.
  - `id` (string): Unique continent identifier.
  - `armies` (integer): Bonus armies for controlling the entire continent. Must be >= 0.
  - `countries` (array of strings): IDs of countries in this continent.
- `layouts` (array, optional): Array of visual layout objects. Zero layouts = tree view only.
  - `name` (string): Layout name.
  - `description` (string, optional): Layout description.
  - `width` (integer): Canvas width in columns. Must be > 0.
  - `height` (integer): Canvas height in rows. Must be > 0.
  - `minTerminalWidth` (integer, optional): Minimum terminal width for selection.
  - `positions` (object): Map of country ID to position. Keys must exist in `countries`.
    - `x` (integer): Left edge column. Must be >= 0.
    - `y` (integer): Top edge row. Must be >= 0.
    - `w` (integer): Box width. Must be >= 5.
    - `h` (integer): Box height. Must be >= 3.
  - `connectionOverrides` (array, optional): Visual connection overrides.
    - `from` (string): Source country ID. Must exist in `countries`.
    - `to` (string): Destination country ID. Must exist in `countries`.
    - `style` (string, optional): `"solid"`, `"dashed"`, or `"hidden"`.
    - `waypoints` (array, optional): Array of `{ "x": int, "y": int }` route points.

---

## 5. Constraints & Compliance

**Concurrency:** All new types are `Codable & Sendable & Hashable` (immutable value types after decode). `UnifiedMapLoader` and `ConnectionRouter` are stateless enums with static functions.

**No force unwraps:** All dictionary lookups use optional binding. Missing countries in positions are reported by the validator, not by runtime crashes.

**No hardcoded constants:** Minimum box dimensions (`w >= 5`, `h >= 3`) are defined as named constants in a `MapFormatConfig` struct, not as magic numbers in validation logic.

**Division safety:** `bestLayout(forWidth:)` uses comparison only, no division. `ConnectionRouter` guards against zero-dimension boxes.

**Guard clauses:** All validation uses guard-let with early returns and descriptive error messages.

**Swift 6 strict concurrency:** All new types are `Sendable`. File I/O in `UnifiedMapLoader` is synchronous (called during startup on the main thread before any game state exists).

**No `String(format:)`:** All string construction uses interpolation.

**No forbidden patterns:** No force casts, no `try!`, no recursive inits.

---

## 6. Backend Abstraction (If Compute-Intensive)

Not applicable. JSON decoding and connection routing are trivial CPU operations. The world map has 42 countries and approximately 82 neighbor pairs -- routing all connections takes microseconds.

---

## 7. Dependencies

**Internal Dependencies:**
- `IconquerCore` -- `MapDefinition`, `MapDefinition.Country`, `MapDefinition.Continent`, `CountryId` (read-only, no changes)
- `Foundation` -- `JSONDecoder`, `Data`, `URL`, `FileManager`, `Bundle` (existing usage)

**External Dependencies:** None.

**Resource Dependencies:**
- `Resources/Maps/world.json` -- unified format, replacing `Maps/world/Countries.json` + `Maps/world/Continents.json`
- `Resources/Maps/duel.json` -- unified format (new, previously constructed in code)
- `Resources/Maps/line4.json` -- unified format (new, previously constructed in code)

**Removed Dependencies:**
- `MapFileLoader.swift` -- deleted (was the two-file loader)
- `Resources/Maps/world/Countries.json` + `Resources/Maps/world/Continents.json` -- replaced by `world.json`

---

## 8. Test Strategy

**Test Categories:**

| Category | Tests |
|----------|-------|
| **Decode: valid file** | Load unified JSON with countries, continents, and layouts; assert all fields decode correctly |
| **Decode: minimal file** | Load JSON with only countries and continents (no layouts, no version); assert layouts is nil |
| **MapDefinition extraction** | `mapFile.mapDefinition` produces correct `MapDefinition` with all `CountryId` values |
| **bestLayout selection** | Terminal width 120 selects "Standard"; width 70 selects "Compact"; width 30 returns nil |
| **bestLayout: no layouts** | File with no layouts array returns nil for any width |
| **bestLayout: single layout** | File with one layout (no minTerminalWidth) always returns that layout |
| **Validation: valid** | Fully valid world map passes validation with no errors |
| **Validation: missing neighbor** | Country references neighbor that does not exist in countries array; validation fails |
| **Validation: asymmetric neighbors** | A lists B as neighbor but B does not list A; validation fails |
| **Validation: continent references invalid country** | Continent lists country not in countries array; validation fails |
| **Validation: duplicate country ID** | Two countries with same ID; validation fails |
| **Validation: layout references invalid country** | Layout positions key not in countries array; validation fails |
| **Validation: box too small** | Position with w < 5 or h < 3; validation fails |
| **ConnectionRouter: basic** | 3-country triangle produces 3 connections with default solid style |
| **ConnectionRouter: override applied** | Override changes Alaska-Kamchatka to dashed style with waypoints |
| **ConnectionRouter: hidden override** | Override with style "hidden" suppresses the connection |
| **ConnectionRouter: missing position** | Country in neighbor graph but not in layout positions; connection skipped |
| **Round-trip encoding** | Encode a `UnifiedMapFile` to JSON, decode it back; assert equality |
| **File I/O** | Load from file path; file not found throws `fileNotFound`; corrupt JSON throws `decodeFailed` |
| **StarterMaps migration** | `StarterMaps.world`, `.duel`, `.line4` load successfully from unified format; country counts match expected values |

**Reference Truth:**
- The classic world map has 42 countries and 6 continents with known bonus values (North America: 5, South America: 2, Europe: 5, Africa: 3, Asia: 7, Australia: 2)
- Country/neighbor relationships validated against the existing `Countries.json` + `Continents.json` bundled resources
- No external reference needed -- this is a format migration, not a calculation

**Validation Trace (REQUIRED):**
- Load `duel.json`: `{ "name": "Duel", "countries": [{"id":"Atlantis","neighbors":["Pacifica"]}, {"id":"Pacifica","neighbors":["Atlantis"]}], "continents": [{"id":"Ocean","armies":0,"countries":["Atlantis","Pacifica"]}] }`
- Assert: `mapFile.name == "Duel"`
- Assert: `mapFile.countries.count == 2`
- Assert: `mapFile.mapDefinition.countries[0].id == CountryId("Atlantis")`
- Assert: `mapFile.mapDefinition.continents[0].armies == 0`
- Assert: `mapFile.layouts == nil`
- Assert: `mapFile.bestLayout(forWidth: 120) == nil`

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [ ] Does this supersede an existing ADR? No
- [ ] Does this amend an existing ADR? No
- [x] New ADR required? Yes -- draft below

**New ADR Draft:**

```yaml
id: ADR-002
date: 2026-04-10
status: proposed
category: architecture
title: Unified single-file map format with optional layouts
context: |
  iConquer maps were stored as two JSON files (Countries.json, Continents.json)
  in a directory. Visual layouts were in separate files. This fragmented format
  made maps hard to share, validate, and extend with metadata.
decision: |
  Adopt a single unified .json file format containing: metadata (name, version,
  description), the game tree (countries with neighbors, continents with bonuses),
  and an optional array of visual layouts. The file is parsed into a pure
  MapDefinition (for IconquerCore) and an array of MapLayout structs (for the CLI
  renderer). The legacy two-file format is removed with no migration path
  (no existing external users).
rationale: |
  - Single file is easier to share, validate, and version-control
  - Layouts bundled with game data ensures they stay in sync
  - Optional layouts preserve backward compatibility (tree view fallback)
  - Multiple layouts per map enables responsive terminal sizing
  - Clean module boundary: MapDefinition stays in IconquerCore, MapLayout in CLI
consequences: |
  + One file per map instead of a directory with two files
  + Metadata (name, version, description) enables UI map selection
  + Multiple layouts per map for different terminal sizes
  + Format guide document helps community map creation
  - Requires converting all built-in maps to new format (one-time)
  - Slightly larger file size (layouts add ~50% to file size)
alternatives_rejected:
  - "Keep two-file format + add separate layout file: Three files to manage per map"
  - "Embed layouts in IconquerCore MapDefinition: Violates module boundary, core should not know about visual positions"
  - "Use YAML instead of JSON: Adds external dependency, Swift's Codable prefers JSON"
affected_files:
  - Sources/IconquerCLILib/Map/UnifiedMapFile.swift (new)
  - Sources/IconquerCLILib/Map/MapLayout.swift (new)
  - Sources/IconquerCLILib/Map/UnifiedMapLoader.swift (new)
  - Sources/IconquerCLILib/Map/ConnectionRouter.swift (new)
  - Sources/IconquerCLILib/StarterMaps.swift (modified)
  - Sources/IconquerCLILib/MapResolver.swift (modified)
  - Sources/IconquerCLILib/MapFileLoader.swift (removed)
  - Resources/Maps/world.json (new, replaces directory)
supersedes: null
amends: null
superseded_by: null
```

This ADR also relates to ADR-001 (proposed in the ConsoleMap proposal) -- the unified format subsumes the standalone layout file concept. If both proposals are accepted, ADR-001's layout file approach is superseded by the unified format's embedded layouts.

---

## 10. Open Questions

1. **Where does `UnifiedMapFile` live -- IconquerCLILib or a shared module?** If IconquerApp (SwiftUI) also needs to load maps, `UnifiedMapFile` should live in a shared module. For now, IconquerApp uses IconquerCore's `MapDefinition` directly and does not need layout data. **Proposed answer:** Keep it in IconquerCLILib for now. Extract to a shared module if/when IconquerApp needs visual layouts.

2. **Should the format support map inheritance/includes?** For example, a layout-only file that references a base map. **Proposed answer:** No. Keep v1 simple. One file = one complete map. Composition can be added later if needed.

3. **Should neighbor relationships be validated as bidirectional on load, or is that a lint-time check?** If A lists B as neighbor, must B also list A? **Proposed answer:** Validate on load. Asymmetric neighbors are always a bug. The loader should throw a descriptive error.

4. **Connection derivation: should ConnectionRouter live in IconquerCLILib or in SwiftCLIKit?** It depends on MapLayout which is CLI-specific, so it should stay in IconquerCLILib. **Proposed answer:** IconquerCLILib. The router is specific to iConquer's map format, not a general-purpose TUI utility.

5. **Should the format guide (`iConquerMapFormat.md`) live in the project root, in `Docs/`, or in development-guidelines?** **Proposed answer:** `Docs/iConquerMapFormat.md` in the IconquerCLI repo. It is user-facing documentation for map authors, not an internal development document.

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (UnifiedMapFile, MapLayout, UnifiedMapLoader, ConnectionRouter, validation, bestLayout selection)
- Does explanation require 50+ lines? Yes (file format specification, validation rules, layout selection algorithm, connection routing)
- Does it need theory/background context? Yes (map format design rationale, connection routing concepts, terminal sizing)

**Article Name:** `iConquerMapFormatGuide.md`
(Placed in `Docs/` in the IconquerCLI repo. Must NOT match any Swift symbol name.)

**Article Outline:**
1. Overview -- what the unified map format is and why it exists
2. File structure -- top-level fields, countries, continents, layouts
3. Countries and neighbors -- ID conventions, bidirectional neighbor requirement
4. Continents and bonuses -- bonus army values, country membership
5. Layouts (optional) -- positions, dimensions, minTerminalWidth
6. Connection overrides -- style (solid/dashed/hidden), waypoints for routing
7. Layout selection algorithm -- how the CLI picks the best layout for the terminal
8. Creating custom maps -- step-by-step guide with a minimal example
9. Validation rules -- what the loader checks and common error messages
10. Examples -- minimal map (2 countries, no layout), full world map with layouts
11. Migration from legacy format -- how to convert old two-file maps (for developers)
