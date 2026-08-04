# Design Proposal: Phase 3 -- Map Plugin Architecture

**Date:** 2026-04-23
**Status:** Proposed

---

## 1. Objective

**Objective:** Introduce a standardized map bundle format, a multi-source registry for discovering and loading map packs, comprehensive validation, rich metadata, and an export/import pipeline so that players and creators can share, download, and build custom maps as first-class distributable artifacts.

**Master Plan Reference:** Phase 3 -- Modernization / "Additional map plug-ins"

**Problem Statement:** Maps currently exist in three incompatible shapes:

1. **Hardcoded** -- `StarterMaps` (CLI) and `BuiltInMaps` (GameKit) duplicate `MapDefinition` literals in code.
2. **Legacy directory** -- `MapFileLoader` reads `Countries.json` + `Continents.json` from a flat directory; no metadata, no embedded rulesets, no assets.
3. **Unified single-file** -- `UnifiedMapFile` is a single `.json` with countries, continents, optional layouts, and an optional `defaultRuleset` filename reference.

None of these support preview images, author attribution, versioning, asset bundling, or discovery across multiple sources (app bundle, user documents, downloads). The Game Builder idea (IDEAS/mapBuilder.md) has no defined output format to target.

This proposal unifies all three into a single **Map Bundle** concept that is a directory on disk but behaves as a single distributable unit, with backward-compatible loading for all existing formats.

---

## 2. Proposed Architecture

### Module Placement

The map plugin system spans three modules. New types land in IconquerCore so that both the CLI and the SwiftUI app can use them without duplication.

**New Files (IconquerCore):**
- `Sources/IconquerCore/Map/MapBundle.swift` -- bundle model + metadata
- `Sources/IconquerCore/Map/MapRegistry.swift` -- multi-source discovery and loading
- `Sources/IconquerCore/Map/MapValidator.swift` -- comprehensive validation engine
- `Sources/IconquerCore/Map/MapBundleExporter.swift` -- export/import utilities

**Modified Files (IconquerCore):**
- `Sources/IconquerCore/Map/UnifiedMapFile.swift` -- add optional `metadata` field for backward compat

**Modified Files (IconquerCLI):**
- `Sources/IconquerCLILib/MapResolver.swift` -- delegate to `MapRegistry` instead of manual resolution
- `Sources/IconquerCLILib/StarterMaps.swift` -- convert built-ins to `MapBundle` wrappers

**Modified Files (IconquerGameKit):**
- `Sources/IconquerGameKit/BuiltInMaps.swift` -- convert built-ins to `MapBundle` wrappers

### Map Bundle Directory Structure

A map bundle is a directory with the extension `.iconquermap`:

```
my-custom-map.iconquermap/
  map.json             # UnifiedMapFile (countries, continents, layouts)
  ruleset.json         # Optional RulesetFile (default game rules for this map)
  metadata.json        # MapMetadata (author, version, tags, player counts)
  assets/              # Optional directory
    preview.png        # 800x600 preview image
    preview@2x.png     # Retina preview (optional)
    thumbnail.png      # 120x120 thumbnail for list views
    background.jpg     # Optional custom background image
    countries/         # Optional per-country images
      Alaska.png
      ...
```

The `.iconquermap` extension enables Spotlight indexing on macOS, UTType registration on iOS, and unambiguous directory identification.

---

## 3. API Surface

### MapBundle

```swift
/// A distributable map package containing the map definition, optional
/// ruleset, metadata, and asset references.
public struct MapBundle: Sendable, Identifiable {
    /// Stable identifier derived from metadata or directory name.
    public var id: String

    /// The map definition (countries, continents, layouts).
    public var mapFile: UnifiedMapFile

    /// Optional default ruleset shipped with the map.
    public var ruleset: RulesetFile?

    /// Metadata describing the map for discovery and display.
    public var metadata: MapMetadata

    /// Source the bundle was loaded from.
    public var source: MapSource

    /// Filesystem URL of the bundle directory, if loaded from disk.
    public var bundleURL: URL?

    /// The pure rules engine map, derived from mapFile.
    public var mapDefinition: MapDefinition { mapFile.mapDefinition }

    /// Select the best layout for a given terminal width.
    public func bestLayout(forWidth width: Int) -> MapLayout? {
        mapFile.bestLayout(forWidth: width)
    }
}
```

### MapMetadata

```swift
/// Rich metadata for map discovery, display, and sharing.
public struct MapMetadata: Codable, Sendable, Hashable {
    /// Display name of the map.
    public var name: String

    /// Map format/content version (semver string).
    public var version: String

    /// Human-readable description.
    public var description: String?

    /// Map author or creator name.
    public var author: String?

    /// Author contact or profile URL.
    public var authorURL: String?

    /// Creation date (ISO 8601).
    public var createdDate: String?

    /// Last modified date (ISO 8601).
    public var lastModifiedDate: String?

    /// Supported player count range.
    public var supportedPlayerCounts: ClosedRange<Int>

    /// Subjective difficulty rating (1-5).
    public var difficultyRating: Int?

    /// Searchable tags for categorization.
    public var tags: [String]

    /// Relative path to the preview image within the bundle.
    public var previewImagePath: String?

    /// Relative path to the thumbnail within the bundle.
    public var thumbnailPath: String?

    /// SHA-256 hash of map.json for integrity verification.
    public var mapChecksum: String?

    /// License under which the map is distributed.
    public var license: String?

    public init(
        name: String,
        version: String = "1.0.0",
        description: String? = nil,
        author: String? = nil,
        authorURL: String? = nil,
        createdDate: String? = nil,
        lastModifiedDate: String? = nil,
        supportedPlayerCounts: ClosedRange<Int> = 2...6,
        difficultyRating: Int? = nil,
        tags: [String] = [],
        previewImagePath: String? = nil,
        thumbnailPath: String? = nil,
        mapChecksum: String? = nil,
        license: String? = nil
    ) { ... }
}
```

### MapSource

```swift
/// Where a map bundle was loaded from.
public enum MapSource: Sendable, Hashable, Codable {
    /// Compiled into the binary.
    case builtIn
    /// Bundled with the app (in the app's Resources).
    case appBundle
    /// In the user's documents directory.
    case userDocuments
    /// Downloaded from a remote gallery.
    case downloaded(galleryId: String?)
    /// Loaded from an arbitrary filesystem path.
    case filesystem(path: String)
}
```

### MapRegistry

```swift
/// Discovers and loads map bundles from multiple sources.
///
/// The registry searches in priority order: built-in maps, app bundle,
/// user documents, and any additional registered search paths.
public final class MapRegistry: Sendable {

    /// Configuration for registry search paths.
    public struct Configuration: Sendable {
        /// Additional directories to search for map bundles.
        public var searchPaths: [URL]
        /// Whether to include built-in starter maps.
        public var includeBuiltIns: Bool
        /// Whether to validate maps on load.
        public var validateOnLoad: Bool

        public static let `default` = Configuration(
            searchPaths: [],
            includeBuiltIns: true,
            validateOnLoad: true
        )
    }

    /// Create a registry with the given configuration.
    public init(configuration: Configuration = .default)

    /// All discovered map bundles, sorted by name.
    public func availableMaps() throws -> [MapBundle]

    /// Resolve a map by name or path.
    ///
    /// Resolution order:
    /// 1. Built-in maps (by name, case-insensitive)
    /// 2. Discovered bundles (by metadata name, case-insensitive)
    /// 3. Filesystem path (directory or .iconquermap bundle)
    ///
    /// - Parameter nameOrPath: A built-in name, bundle name, or filesystem path.
    /// - Returns: The resolved map bundle.
    /// - Throws: `MapRegistryError` if not found or invalid.
    public func resolve(_ nameOrPath: String) throws -> MapBundle

    /// Register an additional search path at runtime.
    public func addSearchPath(_ url: URL)

    /// Reload the registry, re-scanning all search paths.
    public func refresh() throws

    /// Metadata-only listing (does not fully parse map.json).
    /// Useful for building map picker UIs without loading all map data.
    public func availableMapMetadata() throws -> [MapMetadata]
}

/// Errors from map registry operations.
public enum MapRegistryError: Error, Sendable, CustomStringConvertible {
    case notFound(String, available: [String])
    case loadFailed(String, underlying: any Error)
    case validationFailed(String, errors: [MapValidationError])

    public var description: String { ... }
}
```

### MapValidator

```swift
/// Comprehensive validation for map bundles beyond basic JSON decoding.
public enum MapValidator {

    /// Validate a map bundle and return all errors found.
    /// An empty array means the map is valid.
    public static func validate(_ bundle: MapBundle) -> [MapValidationError]

    /// Validate just the map file (without metadata or assets).
    public static func validate(_ mapFile: UnifiedMapFile) -> [MapValidationError]

    /// Quick check: is the map valid?
    public static func isValid(_ bundle: MapBundle) -> Bool
}

/// Validation errors with severity levels.
public struct MapValidationError: Error, Sendable, CustomStringConvertible {
    public enum Severity: Sendable, Comparable {
        case warning
        case error
    }

    public enum Kind: Sendable {
        // -- Graph integrity --
        case invalidNeighborReference(country: String, neighbor: String)
        case nonBidirectionalNeighbor(country: String, neighbor: String)
        case disconnectedGraph(components: [[String]])
        case selfNeighbor(country: String)
        case duplicateNeighbor(country: String, neighbor: String)
        case duplicateCountryId(String)

        // -- Continent integrity --
        case invalidContinentCountry(continent: String, country: String)
        case countryInMultipleContinents(country: String, continents: [String])
        case countryNotInAnyContinent(country: String)
        case emptyContinent(String)
        case negativeBonusArmies(continent: String, armies: Int)

        // -- Layout integrity --
        case invalidLayoutCountry(layout: String, country: String)
        case missingLayoutPosition(layout: String, country: String)
        case overlappingPositions(layout: String, countries: [String])

        // -- Player count --
        case insufficientCountriesForPlayerCount(countries: Int, maxPlayers: Int)
        case unbalancedContinents(ratio: Double)

        // -- Metadata --
        case missingRequiredMetadata(field: String)
        case invalidPlayerCountRange(range: ClosedRange<Int>)
        case missingPreviewImage
        case invalidDifficultyRating(Int)

        // -- Ruleset --
        case rulesetMissionReferencesUnknownContinent(mission: String, continent: String)
    }

    public var kind: Kind
    public var severity: Severity
    public var description: String { ... }
}
```

### MapBundleExporter

```swift
/// Creates and reads map bundle directories.
public enum MapBundleExporter {

    /// Load a map bundle from a `.iconquermap` directory.
    public static func load(from bundleURL: URL) throws -> MapBundle

    /// Load a map bundle from a legacy directory (Countries.json + Continents.json).
    public static func loadLegacy(from directoryURL: URL) throws -> MapBundle

    /// Load a map bundle from a single UnifiedMapFile JSON path.
    public static func loadUnified(from jsonURL: URL) throws -> MapBundle

    /// Export a map bundle to a `.iconquermap` directory.
    ///
    /// - Parameters:
    ///   - bundle: The map bundle to export.
    ///   - destination: The parent directory to write into.
    ///   - overwrite: Whether to overwrite an existing bundle.
    /// - Returns: The URL of the written `.iconquermap` directory.
    @discardableResult
    public static func export(
        _ bundle: MapBundle,
        to destination: URL,
        overwrite: Bool = false
    ) throws -> URL

    /// Create a compressed `.iconquermap.zip` archive for sharing.
    public static func archive(
        _ bundle: MapBundle,
        to destination: URL
    ) throws -> URL

    /// Import a `.iconquermap.zip` archive into the user's maps directory.
    public static func importArchive(
        from archiveURL: URL,
        into mapsDirectory: URL
    ) throws -> MapBundle
}
```

---

## 4. MCP Schema

**Tool Description:** Discover, validate, and manage map bundles for iconquer games.

### list_maps

**REQUIRED STRUCTURE (JSON):**
```json
{
  "tool": "list_maps",
  "parameters": {
    "source": "all",
    "tags": ["classic", "small"],
    "minPlayers": 2,
    "maxPlayers": 6
  }
}
```

**Parameter Types:**
- source (string): Filter by source. One of: "all", "builtIn", "appBundle", "userDocuments", "downloaded". Default: "all".
- tags (array of string): Filter maps that have all specified tags. Optional.
- minPlayers (integer): Minimum supported player count. Optional.
- maxPlayers (integer): Maximum supported player count. Optional.

### validate_map

**REQUIRED STRUCTURE (JSON):**
```json
{
  "tool": "validate_map",
  "parameters": {
    "nameOrPath": "my-custom-map"
  }
}
```

**Parameter Types:**
- nameOrPath (string): Map name or filesystem path. Required.

**Response:**
```json
{
  "valid": false,
  "errors": [
    { "kind": "disconnectedGraph", "severity": "error", "message": "..." }
  ],
  "warnings": [
    { "kind": "missingPreviewImage", "severity": "warning", "message": "..." }
  ]
}
```

### export_map

**REQUIRED STRUCTURE (JSON):**
```json
{
  "tool": "export_map",
  "parameters": {
    "nameOrPath": "my-custom-map",
    "destination": "/path/to/output",
    "format": "bundle"
  }
}
```

**Parameter Types:**
- nameOrPath (string): Map name or path. Required.
- destination (string): Output directory path. Required.
- format (string): One of "bundle" (directory) or "archive" (zip). Default: "bundle".

---

## 5. Constraints & Compliance

**Concurrency:**
- `MapBundle`, `MapMetadata`, `MapSource`, `MapValidationError` are all value types conforming to `Sendable`.
- `MapRegistry` is a `final class` marked `Sendable`. Internal state is protected by a lock (not an actor, because the public API is synchronous and does not require `await` at call sites). If async discovery is needed later, an actor wrapper can be added without breaking the synchronous API.

**Safety:**
- No force unwraps. All file I/O uses `throws`.
- Guard clauses for directory existence, file presence, and JSON decoding.
- Division safety: continent balance ratio checks guard against zero-country continents.

**Determinism:**
- Map loading is deterministic -- same bundle produces the same `MapDefinition`.
- Validation results are ordered deterministically (by country/continent ID).

**Naming Conventions:**
- All public types use DocC documentation.
- File names match type names (`MapBundle.swift`, `MapRegistry.swift`, etc.).

**Backward Compatibility:**
- `UnifiedMapLoader.validate()` continues to work unchanged; `MapValidator` is a superset.
- `MapResolver` delegates to `MapRegistry` but preserves the same public API.
- Legacy `Countries.json` + `Continents.json` directories are auto-detected and wrapped in a `MapBundle` with synthesized metadata.

---

## 6. Backend Abstraction (If Compute-Intensive)

Not applicable. Map loading and validation are I/O-bound string processing, not compute-intensive. No GPU or Accelerate backends are needed.

---

## 7. Dependencies

**Internal Dependencies:**
- `IconquerCore/Map/UnifiedMapFile.swift` -- the map file format
- `IconquerCore/Map/MapDefinition.swift` -- the pure rules engine model
- `IconquerCore/Map/MapLayout.swift` -- visual layout data
- `IconquerCore/Rules/RulesetFile.swift` -- companion ruleset format
- `IconquerCore/Map/MapLoader.swift` -- legacy JSON loader (for backward compat)

**External Dependencies:** None. Uses only Foundation (FileManager, JSONDecoder, Data).

**Platform Note:** `CryptoKit` (Apple-only) will be used for SHA-256 checksums in `MapMetadata.mapChecksum`. On Linux, the checksum field is left nil unless a cross-platform hash is available (Swift Crypto could be added as an optional dependency later).

---

## 8. Test Strategy

**Test Categories:**

### Unit Tests (IconquerCoreTests)

**MapBundle loading:**
- Golden path: Load a valid `.iconquermap` bundle with all files present.
- Load bundle with no ruleset (optional field).
- Load bundle with no assets directory.
- Load bundle with no metadata.json (synthesize defaults from map.json name).

**MapRegistry discovery:**
- Discover built-in maps returns duel, line4, world.
- Discover maps from a test directory containing two `.iconquermap` bundles.
- Resolve by name (case-insensitive).
- Resolve by path (absolute directory path).
- Resolve unknown name throws `.notFound` with available list.
- `addSearchPath` followed by `refresh` discovers newly added bundles.
- Metadata-only listing does not fully parse map data.

**MapValidator:**
- Valid map returns empty errors array.
- Disconnected graph detected (two isolated country groups with no path between them).
- Self-neighbor detected.
- Duplicate neighbor detected.
- Duplicate country ID detected.
- Country in multiple continents flagged as warning.
- Country not in any continent flagged as warning.
- Empty continent flagged.
- Negative bonus armies flagged.
- Layout references unknown country.
- Layout has overlapping positions.
- Insufficient countries for declared max player count.
- Mission references unknown continent in ruleset.
- All existing `UnifiedMapLoader.validate()` cases still pass (superset guarantee).

**MapBundleExporter:**
- Round-trip: export a bundle, load it back, compare equality.
- Export with overwrite=false fails if directory exists.
- Archive creates a valid zip, import extracts and loads correctly.
- Legacy directory import synthesizes metadata.

**Backward compatibility:**
- `MapResolver.resolve("world")` still returns the classic world map.
- `MapResolver.resolve("/path/to/legacy/dir")` still works with Countries.json + Continents.json.
- `UnifiedMapLoader.validate()` results are a subset of `MapValidator.validate()` results.

**Reference Truth:**
- The three built-in maps (duel, line4, world) serve as golden fixtures.
- Validation test fixtures are hand-crafted JSON files with known errors.
- Graph connectivity is verified against manually computed components (e.g., a 6-country map split into two components of 3 each).

**Validation Trace (REQUIRED):**
- duel map: 2 countries, 1 continent, fully connected, valid for 2 players -> zero validation errors.
- line4 map: 4 countries in a line, 1 continent, connected graph, valid for 2-4 players -> zero validation errors.
- Disconnected fixture: `{A-B, C-D}` with no cross-link -> `disconnectedGraph(components: [["A","B"],["C","D"]])`.
- Self-neighbor fixture: `{A neighbors [A, B]}` -> `selfNeighbor(country: "A")`.

### Integration Tests (IconquerCLITests / IconquerAppTests)

- CLI `--map my-custom-map.iconquermap` loads and plays a full game.
- SwiftUI map picker displays `availableMapMetadata()` and launches a game with the selected bundle.

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [ ] Does this supersede an existing ADR? No
- [ ] Does this amend an existing ADR? No
- [x] New ADR required? Yes -- draft entry below

**New ADR Draft:**

```yaml
id: ADR-001
date: 2026-04-23
status: proposed
category: architecture
title: Map bundles as the canonical distributable map format
context: |
  Maps exist in three incompatible formats (hardcoded, legacy directory,
  unified JSON). A standardized bundle format is needed for sharing,
  discovery, metadata, and asset bundling. The Game Builder needs a
  defined output format.
decision: |
  Adopt `.iconquermap` directory bundles as the canonical distributable
  format. A bundle contains map.json (UnifiedMapFile), optional
  ruleset.json, optional metadata.json, and optional assets/.
  MapRegistry discovers bundles from multiple sources. Legacy formats
  are auto-wrapped into MapBundle at load time for backward compatibility.
rationale:
  - Single format unifies three existing approaches
  - Directory bundles allow co-located assets without embedding in JSON
  - Metadata enables rich discovery UIs and sharing
  - UTType registration enables iOS/macOS document handling
  - Backward compatible -- existing code continues to work
consequences: |
  + One format for all map distribution
  + Game Builder has a clear output target
  + Rich metadata enables map picker UIs and galleries
  - Slightly more complex loading path (registry vs direct decode)
  - Need to maintain backward compat shims for legacy formats
alternatives_rejected:
  - "Single ZIP file: Harder to inspect/edit, no Spotlight indexing"
  - "Embed everything in JSON (base64 images): Bloats the file, hard to edit assets"
  - "Database-backed registry: Over-engineered for the number of maps expected"
affected_files:
  - Sources/IconquerCore/Map/MapBundle.swift
  - Sources/IconquerCore/Map/MapRegistry.swift
  - Sources/IconquerCore/Map/MapValidator.swift
  - Sources/IconquerCore/Map/MapBundleExporter.swift
  - Sources/IconquerCLILib/MapResolver.swift
  - Sources/IconquerCLILib/StarterMaps.swift
  - Sources/IconquerGameKit/BuiltInMaps.swift
supersedes: null
amends: null
superseded_by: null
```

---

## 10. Open Questions

1. **UTType registration:** Should we register `com.iconquer.mapbundle` as a UTType now, or defer until the SwiftUI app needs document import/export? (Recommendation: defer to Phase 3 app work, but reserve the identifier now in metadata.json format.)

2. **Gallery server:** The export/import pipeline is local-only in this proposal. Should the MCP schema include a `download_map` tool that fetches from a remote gallery? (Recommendation: defer gallery server to a separate proposal; this proposal covers the local format and tooling that a gallery would build on.)

3. **Map checksums:** Should integrity verification be mandatory or advisory? (Recommendation: advisory -- compute on export, verify on import, but allow bundles without checksums.)

4. **Built-in map duplication:** `StarterMaps` (CLI) and `BuiltInMaps` (GameKit) define the same maps independently. Should we move built-in bundles to IconquerCore so both consumers share one source of truth? (Recommendation: yes, move built-in `MapBundle` definitions to IconquerCore and deprecate the module-specific enums.)

5. **Async loading:** Should `MapRegistry` use async/await for I/O, or keep synchronous throws? (Recommendation: start synchronous since map files are small and few. Add an async wrapper if profiling shows UI jank in the SwiftUI map picker.)

6. **Map bundle versioning:** If a user downloads v1.1 of a map they already have at v1.0, should the registry detect the conflict? (Recommendation: yes, compare `metadata.version` and `metadata.mapChecksum`; surface as a warning in the UI, let the user choose.)

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (MapBundle, MapRegistry, MapValidator, MapBundleExporter)
- Does explanation require 50+ lines? Yes
- Does it need theory/background context? Yes (bundle format spec, discovery order, validation rules)

**Article Name:** MapPluginGuide.md (in IconquerCore.docc)

The article will cover:
- The `.iconquermap` bundle format specification
- How to create a map bundle (by hand or with the Game Builder)
- How to register and discover maps in the CLI and SwiftUI app
- The full validation rule set and how to fix common errors
- How to export and share maps

---

## Appendix A: Migration and Backward Compatibility

### How Existing Formats Coexist

| Current Format | What Happens | Migration Path |
|---|---|---|
| `StarterMaps.duel/line4/world` (hardcoded) | Wrapped in `MapBundle` with `source: .builtIn` and synthesized `MapMetadata` | Move to IconquerCore as `BuiltInBundles` |
| Legacy directory (`Countries.json` + `Continents.json`) | `MapBundleExporter.loadLegacy()` wraps in `MapBundle` with synthesized metadata | Optional: run `export()` to create a proper `.iconquermap` bundle |
| `UnifiedMapFile` (single .json) | `MapBundleExporter.loadUnified()` wraps in `MapBundle` | Optional: run `export()` to create a proper `.iconquermap` bundle |
| `.iconquermap` bundle | Loaded natively by `MapBundleExporter.load()` | N/A (canonical format) |

### MapResolver Migration

The existing `MapResolver.resolve(_:)` API in IconquerCLI will delegate to `MapRegistry`:

```swift
// Before (current)
public static func resolve(_ nameOrPath: String) throws -> MapDefinition

// After (Phase 3) -- same signature, different implementation
public static func resolve(_ nameOrPath: String) throws -> MapDefinition {
    let registry = MapRegistry.shared
    let bundle = try registry.resolve(nameOrPath)
    return bundle.mapDefinition
}
```

A new overload returns the full bundle for consumers that need metadata:

```swift
public static func resolveBundle(_ nameOrPath: String) throws -> MapBundle
```

### Game Builder Integration

The Game Builder (IDEAS/mapBuilder.md) targets the `.iconquermap` bundle as its output format:

1. The builder constructs a `UnifiedMapFile` (countries, continents, layouts) through its visual editor.
2. The builder constructs a `RulesetFile` (variant, missions, card values) through its rules form.
3. The builder constructs a `MapMetadata` (author, description, player counts, tags) through its metadata form.
4. On save, the builder calls `MapBundleExporter.export()` to write the `.iconquermap` directory.
5. On share, the builder calls `MapBundleExporter.archive()` to create a `.iconquermap.zip`.

The builder also uses `MapValidator.validate()` as a live lint pass, displaying errors inline as the user edits.

---

## Appendix B: SwiftUI App Integration

### Map Picker View

```swift
struct MapPickerView: View {
    let registry: MapRegistry

    @State private var maps: [MapMetadata] = []
    @State private var selectedMapId: String?

    var body: some View {
        List(maps, id: \.name, selection: $selectedMapId) { meta in
            MapPickerRow(metadata: meta)
        }
        .task {
            maps = (try? registry.availableMapMetadata()) ?? []
        }
    }
}
```

### Document Import (iOS)

With UTType registration, the app can handle `.iconquermap` and `.iconquermap.zip` files via the system share sheet or Files app:

```swift
// Info.plist UTType declaration (deferred to app implementation)
// com.iconquer.mapbundle -> .iconquermap directory
// com.iconquer.maparchive -> .iconquermap.zip
```

### CLI Integration

```
iconquer-cli play --map classic-world.iconquermap
iconquer-cli play --map ~/Downloads/custom-europe.iconquermap
iconquer-cli maps list                    # list all discovered maps
iconquer-cli maps validate my-map.iconquermap
iconquer-cli maps export my-map --format archive --output ~/Desktop/
```

---

## Proposal Review Checklist

### Architecture
- [x] **Module placement** follows existing project structure (new types in IconquerCore/Map/)
- [x] **API design** follows naming conventions from Coding Rules
- [x] **Concurrency model** is Swift 6 compliant (all new types are Sendable)
- [x] **Generic constraints** -- not applicable (domain-specific types, not generic)
- [x] **No forbidden patterns** in proposed implementation
- [x] **Usage examples reviewed** -- MapResolver API preserved

### MCP Readiness
- [x] **MCP JSON schema** defined with REQUIRED STRUCTURE example
- [x] **All parameter types** mapped to JSON Schema types
- [x] **Stochastic functions** -- not applicable (deterministic)
- [x] **Nested objects** fully documented
- [x] **Enum values** listed exhaustively
- [x] **Date formats** specified as ISO 8601

### Testing & Dependencies
- [x] **Test strategy** covers required categories (golden path, edge, invalid, determinism)
- [x] **Reference truth** identified (built-in maps as golden fixtures, hand-crafted error fixtures)
- [x] **Dependencies** are acceptable (Foundation only, optional CryptoKit)
- [x] **Open questions** listed explicitly with recommendations
