# Design Proposal: AI Personality Registry & Model Selection

## 1. Objective

Replace the single bundled `.learned` AI strategy with a personality registry that discovers, loads, and presents trained GVN weight files as named AI opponents. Users select opponents by personality name (like the original iConquer's Julius Caesar, Hannibal, etc.) rather than by opaque strategy labels.

**Master Plan Reference:** Phase 2 (AI) → Phase 3A (App) bridge. The training pipeline produces versioned weights; the app needs a way to consume them as distinct characters.

## 2. Proposed Architecture

### Model Registry: discovers and caches weight files

**New Files:**
- `IconquerAI/Sources/IconquerAI/Registry/AIPersonality.swift` — Personality metadata model
- `IconquerAI/Sources/IconquerAI/Registry/PersonalityRegistry.swift` — Discovery, loading, caching

**Modified Files:**
- `IconquerApp/Sources/IconquerUI/Model/PlayerConfig.swift` — Replace `AIStrategy` enum with personality-aware selection
- `IconquerApp/Sources/IconquerUI/Views/Setup/PlayerSlotView.swift` — Personality picker UI
- `IconquerApp/Sources/IconquerUI/Views/Setup/GameSetupConfig.swift` — Inject registry
- `IconquerApp/Sources/IconquerUI/ViewModel/GameViewModel.swift` — `makeAgent` loads from registry

### Weight + Metadata Storage

Each personality is a pair of files in a known directory:

```
~/Library/Application Support/iconquer/models/
├── hannibal.weights          ← binary GVN weights (AGVN format)
├── hannibal.personality.json ← metadata sidecar
├── caesar.weights
├── caesar.personality.json
└── ...
```

Bundled personalities ship in `Resources/models/` and are copied to the
Application Support directory on first launch (don't overwrite if user has
modified them).

### Metadata Sidecar Format

```json
{
    "id": "gvn_v1_heuristic",
    "name": "GVN v1 (Heuristic Bootstrap)",
    "description": "Trained on 1000 heuristic self-play games. First generation.",
    "version": 1,
    "trainedDate": "2026-05-08T08:57:20Z",
    "sourceIteration": 1,
    "sourceGames": 1000,
    "mctsConfig": {
        "maxSimulations": 100,
        "maxWallTimeSeconds": 5.0,
        "cPuct": 1.5,
        "temperature": 0.1
    },
    "tags": ["generation-1", "heuristic-bootstrap"],
    "mapId": "world",
    "playerCount": 6,
    "rating": 1200
}
```

Fields `mapId` and `playerCount` are validated at load time against the
weights file's embedded hyperparameters. The `mctsConfig` override lets
different personalities play with different search parameters (deeper search
= more cautious, shallow + high temperature = more chaotic).

## 3. API Surface

### AIPersonality (IconquerAI)

```swift
public struct AIPersonality: Sendable, Codable, Identifiable, Equatable {
    public let id: String
    public var name: String
    public var description: String
    public var version: Int
    public var trainedDate: Date
    public var sourceIteration: Int
    public var sourceGames: Int
    public var mctsConfig: MCTSConfig
    public var tags: [String]
    public var mapId: String
    public var playerCount: Int
    public var rating: Int = 1200
}
```

### PersonalityRegistry (IconquerAI)

```swift
public final class PersonalityRegistry: Sendable {
    /// All discovered personalities. Thread-safe read access.
    public var personalities: [AIPersonality] { get }

    /// Personalities compatible with the given map.
    public func compatible(with map: MapDefinition) -> [AIPersonality]

    /// Scan the models directory and bundled resources for personalities.
    public func refresh() throws

    /// Load the AccelerateValueNetwork for a personality.
    /// Caches the result — subsequent calls return the same instance.
    public func loadNetwork(
        for personality: AIPersonality,
        map: MapDefinition
    ) throws -> AccelerateValueNetwork
}
```

### PlayerConfig Changes (IconquerApp)

```swift
public struct PlayerConfig: Identifiable, Sendable, Codable, Equatable {
    public enum AIStrategy: Sendable, Codable, Equatable {
        case random
        case greedy
        case strategic
        case personality(id: String)  // references AIPersonality.id
    }

    /// User overrides for MCTS search parameters. Only applies when
    /// strategy is `.personality`. `nil` fields use the personality's defaults.
    public var mctsOverrides: MCTSOverrides?
    // ...
}

public struct MCTSOverrides: Sendable, Codable, Equatable {
    public var maxSimulations: Int?
    public var maxWallTimeSeconds: Double?
    public var cPuct: Float?
    public var temperature: Float?
}
```

The `.learned` case is replaced by `.personality(id:)`. Existing saves
with `.learned` deserialize as `.personality(id: "default")` via a
custom `Decodable` implementation.

`MCTSOverrides` uses optionals so `nil` means "use the personality
default" — the UI shows the personality's value as placeholder text
and only stores an override when the user explicitly changes it.

### Heuristic Personalities (No Weights)

Random, Greedy, and Strategic are not registry entries — they remain
as enum cases. Only learned models go through the registry. This keeps
the system simple: heuristic agents have no weights, no metadata, no
versioning. They're code, not data.

## 4. UI Changes

### PlayerSlotView

The strategy picker changes from a flat menu of four items to a
two-level selection:

```
┌─ Strategy ──────────────────────┐
│  Random                          │
│  Greedy                          │
│  Strategic                       │
│  ─────────────────────────────── │
│  GVN v1 (Heuristic)  1200  🧠   │
│  GVN v2 (MCTS)       1350  🧠   │
│  Custom Import...                │
└──────────────────────────────────┘
```

The 🧠 indicator distinguishes learned personalities from heuristic
strategies. Elo rating shown next to each personality. Personalities
that aren't compatible with the current map are shown dimmed with a
tooltip explaining why.

When a learned personality is selected, an expandable disclosure group
reveals MCTS tuning controls:

```
┌─ Search Settings ───────────────┐
│  Simulations   [100      ] ▲ ▼  │
│  Time Limit    [5.0s     ] ▲ ▼  │
│  Exploration   [1.5      ] ▲ ▼  │
│  Temperature   [0.1      ] ▲ ▼  │
└─────────────────────────────────┘
```

Defaults come from the personality's `mctsConfig`. User overrides are
stored per-player in `PlayerConfig` and don't mutate the personality
metadata. A "Reset to Default" button restores the personality's
baked-in values.

### Document Picker Import

A "Custom Import..." option at the bottom of the personality picker
opens a `.fileImporter` sheet (on iOS/visionOS) or an `NSOpenPanel`
(on macOS) filtered to `.weights` files. On import:

1. Copy the `.weights` file to the models directory
2. Read hyperparameters from the binary header
3. Auto-generate a `.personality.json` sidecar with defaults
4. Present a brief edit sheet for the user to name the personality
5. Add to registry and select it for this player slot

### Watch AI Spectator Setup

`spectatorPlayers` draws from the registry to create a mixed field:

```swift
private static func spectatorPlayers(
    variant: GameVariant,
    registry: PersonalityRegistry,
    map: MapDefinition
) -> [PlayerConfig] {
    let heuristics: [PlayerConfig.AIStrategy] = [.strategic, .greedy]
    let learned = registry.compatible(with: map).prefix(4).map {
        PlayerConfig.AIStrategy.personality(id: $0.id)
    }
    let strategies = (heuristics + learned).prefix(6)
    // ...
}
```

## 5. MCP Schema

```json
{
    "name": "list_personalities",
    "description": "List available AI personalities",
    "input_schema": {
        "type": "object",
        "properties": {
            "mapId": { "type": "string", "description": "Filter by compatible map" }
        }
    }
}
```

```json
{
    "name": "import_personality",
    "description": "Import a trained weights file as a named personality",
    "input_schema": {
        "type": "object",
        "properties": {
            "weightsPath": { "type": "string" },
            "name": { "type": "string" },
            "description": { "type": "string" },
            "tags": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["weightsPath", "name"]
    }
}
```

## 6. Weight Migration Path

### From Training Pipeline to App

The pipeline already saves timestamped weights. A new CLI command
(or script) creates the `.personality.json` sidecar from a weights file:

```bash
swift run iconquer-train export-personality \
    --weights training_output_full/gvn_iter1_20260508_085720.weights \
    --name "Hannibal" \
    --description "Aggressive expansionist" \
    --tags aggressive,continent-focused \
    --output ~/Library/Application\ Support/iconquer/models/
```

This reads the hyperparameters from the binary header, generates the
metadata JSON, and copies both files to the models directory.

### Bundled Default

The app ships with one bundled personality (`default`) so it works
out of the box. As training improves, we update the bundled weights
in releases.

### Backward Compatibility

- `.learned` in saved `PlayerConfig` JSON → decodes as `.personality(id: "default")`
- Weight files without a `.personality.json` sidecar → auto-generate
  metadata from the binary header (name = filename stem, description = "Imported model")

## 7. Constraints & Compliance

- **Concurrency:** `PersonalityRegistry` is `Sendable`. Internal state
  protected by a lock (same pattern as `StatusWriter`). Cached networks
  are `@unchecked Sendable` (read-only after construction).
- **Swift 6:** All new types use `.v6` language mode with strict concurrency.
- **Safety:** No force unwraps. Weight loading failures surface as typed errors,
  never crashes. Map/player count mismatches caught at load time.
- **Platform:** `~/Library/Application Support/iconquer/models/` on macOS
  (also supports `.fileImporter` for drag-and-drop).
  On iOS/visionOS, bundled models ship in the app bundle; users can import
  additional models via `.fileImporter` (document picker), which copies
  them into the app's container directory.

## 8. Dependencies

**Internal Dependencies:**
- `IconquerAI` (AccelerateGVNWeights, AccelerateValueNetwork, MCTSConfig)
- `IconquerCore` (MapDefinition, for compatibility checks)

**External Dependencies:** None

## 9. Test Strategy

### Unit Tests (IconquerAITests)

| Test | What it validates |
|------|-------------------|
| `testPersonalityRoundTrip` | Encode/decode AIPersonality to/from JSON |
| `testRegistryDiscovery` | Registry finds `.weights` + `.personality.json` pairs in a temp dir |
| `testRegistryIgnoresOrphans` | `.weights` without sidecar gets auto-generated metadata |
| `testMapCompatibility` | `compatible(with:)` filters by territory count and map ID |
| `testNetworkCaching` | Second `loadNetwork` call returns same instance |
| `testBackwardCompatLearned` | `.learned` raw value decodes to `.personality(id: "default")` |
| `testEloDefault` | New personality starts at 1200 rating |
| `testEloRoundTrip` | Rating persists through save/load cycle |
| `testDocumentPickerImport` | Importing a `.weights` file generates sidecar and registers personality |

### Integration Tests (IconquerAppTests)

| Test | What it validates |
|------|-------------------|
| `testMakeAgentWithPersonality` | `makeAgent(.personality(id:))` produces an MCTSAgent with correct config |
| `testMakeAgentFallback` | Missing personality ID falls back to StrategicAgent with warning |

### Reference Truth

Round-trip: save weights + metadata → reload → forward pass on a known
state → same output value (within Float epsilon).

### Validation Trace

1. Create a temp directory with two `.weights` files and matching `.personality.json` sidecars
2. Initialize `PersonalityRegistry` pointing at that directory
3. Assert `personalities.count == 2`
4. Assert `compatible(with: worldMap).count == 2`
5. Assert `compatible(with: duelMap).count == 0`
6. Load network for personality[0], verify forward pass produces non-zero output
7. Load network again, verify same instance returned (cache hit)

## 10. Architecture Decision Review

**ADR Check:**
- [x] Reviewed existing `PlayerConfig.AIStrategy` enum
- [ ] Does this supersede an existing ADR? No
- [ ] Does this amend an existing ADR? No
- [x] New ADR required? No — this extends the existing AI strategy system,
  doesn't change architectural boundaries

## 11. Open Questions — RESOLVED

1. **Personality naming for early models:** **RESOLVED: Generic names.**
   Use descriptive names like "GVN v1 (heuristic bootstrap)" until
   K-Means clustering or tournament data reveals actual style differences.
   Character names come later when we can back them with behavioral data.

2. **MCTS config per personality:** **RESOLVED: User-exposed.**
   Surface search parameters in the UI. Users can tweak simulation count,
   time limit, temperature, and exploration constant per AI player. The
   personality metadata provides defaults, but the user can override.
   This gives advanced users control over AI behavior and lets casual
   users just pick a personality and go.

3. **Model directory on iOS/visionOS:** **RESOLVED: Bundled + document picker.**
   Ship bundled personalities that work out of the box. On iOS/visionOS,
   provide a document picker (`.fileImporter`) for users to import custom
   `.weights` files. Imported models are copied to the app's container.
   On macOS, also support the Application Support directory for power users.

4. **Tournament integration:** **RESOLVED: Yes, track Elo.**
   Add a `rating` field to `AIPersonality` (default 1200). The tournament
   infrastructure updates ratings after each tournament run. The metadata
   sidecar persists the current rating. The UI can display rating alongside
   the personality name to help users gauge relative strength.

## 12. Documentation Strategy

**Documentation Type:** API docs sufficient for the registry; narrative
article for "Adding a New AI Personality" workflow.

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (weights loading + registry + MCTS config)
- Does explanation require 50+ lines? Yes (the export workflow)
- Does it need theory/background context? No

**Article Name:**
- `AddingAIPersonalities.md` — Walkthrough: train → export → play against
