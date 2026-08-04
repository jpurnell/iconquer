# Design Proposal: Phase 3 — Save/Load Game State

## 1. Objective

**Objective:** Enable saving and restoring in-progress games across app launches, supporting both the TUI (iconquer-cli) and SwiftUI app (IconquerApp).

**Master Plan Reference:** Phase 3 — Save/Load Game State

Today, `Game.start(seed:players:settings:map:)` is the only way to create a `Game`. There is no `Game.restore(from:)` or equivalent. If a player quits mid-game, all progress is lost. This proposal adds:

- A `SaveGame` envelope format that captures everything needed to reconstruct a live `Game`
- A `Game.restore(from:)` factory method on `IconquerCore.Game`
- A `SaveManager` actor for platform-aware, thread-safe persistence with auto-save and save slots
- UI integration points for both the TUI and SwiftUI app
- Integrity validation and schema versioning with a migration path

---

## 2. Proposed Architecture

### Module Placement

Save/load is a cross-cutting concern touching three layers:

| Layer | Module | Responsibility |
|-------|--------|----------------|
| Core engine | `IconquerCore` | `SaveGame` type, `Game.restore(from:)`, validation |
| Persistence | `IconquerPersistence` (new) | `SaveManager` actor, platform directories, file I/O |
| UI | `IconquerCLI` / `IconquerApp` | Save/load commands, auto-save hooks, slot picker |

### New Files

```
IconquerCore/Sources/IconquerCore/
  Persistence/
    SaveGame.swift            — Codable save envelope
    SaveGameVersion.swift     — Schema version enum + migration
    SaveGameError.swift       — Typed errors for save/load failures

IconquerPersistence/Sources/IconquerPersistence/
  SaveManager.swift           — Actor: file I/O, auto-save, slots
  SaveDirectory.swift         — Platform directory resolution
  SaveSlot.swift              — Named save slot metadata
```

### Modified Files

```
IconquerCore/Sources/IconquerCore/
  Rules/Game.swift            — Add Game.restore(from:) factory method
  Rules/Settings.swift        — Add Codable conformance
  Map/MapDefinition.swift     — Add Codable conformance
  Random/SeededRNG.swift      — Add Codable conformance (state only)
```

---

## 3. API Surface

### 3.1 SaveGame (IconquerCore)

The save envelope captures full engine state plus metadata:

```swift
/// A complete, serialisable game save. Contains everything needed to
/// reconstruct a live ``Game`` from disk.
public struct SaveGame: Sendable, Codable {
    /// Schema version for forward-compatible migration.
    public let version: SaveGameVersion

    /// Human-readable save name (auto-generated or user-provided).
    public let name: String

    /// ISO 8601 timestamp of when the save was created.
    public let savedAt: Date

    /// Application version that created this save.
    public let appVersion: String

    /// Turn number at time of save (denormalised for UI display without
    /// full deserialisation).
    public let turnNumber: Int

    /// The active player at time of save (denormalised for UI display).
    public let currentPlayerId: PlayerId

    // ---- Full engine state ----

    /// Complete game snapshot (phase, countries, players, etc.).
    public let snapshot: GameSnapshot

    /// Settings in effect for this game.
    public let settings: Settings

    /// The map being played on.
    public let map: MapDefinition

    /// RNG state at time of save. Enables deterministic continuation
    /// of dice rolls and shuffles from the exact point of interruption.
    public let rngState: UInt32

    /// Draw pile order at time of save.
    public let drawPile: [Card]

    /// Discard pile at time of save.
    public let discardPile: [Card]

    /// Number of card sets turned in globally (drives card set value).
    public let cardSetsTurnedIn: Int

    /// Pending input state, if the engine was paused awaiting a decision.
    public let pendingInput: PendingInput?

    /// Active player rotation (may differ from snapshot.players.keys
    /// after eliminations).
    public let playersOrder: [PlayerId]

    /// Country being fortified from, if mid-fortify.
    public let fortifyFrom: CountryId?

    // ---- Replay / audit trail ----

    /// Original seed used to start the game. Informational only;
    /// restoration uses ``rngState`` not the original seed.
    public let originalSeed: UInt32

    /// Move history up to the save point. Optional; can be omitted for
    /// smaller save files.
    public let moveHistory: [MoveRecord]?

    /// FNV-1a hash of the snapshot at save time, for integrity checking.
    public let snapshotHash: String
}
```

### 3.2 SaveGameVersion

```swift
/// Schema version for save file format. Each case represents a
/// breaking change to the ``SaveGame`` layout.
public enum SaveGameVersion: Int, Sendable, Codable, Comparable {
    /// Initial save format (Phase 3 launch).
    case v1 = 1

    /// The current version. New saves always use this.
    public static let current: SaveGameVersion = .v1

    public static func < (lhs: Self, rhs: Self) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}
```

### 3.3 Game.restore(from:) (IconquerCore)

```swift
extension Game {
    /// Reconstruct a live ``Game`` from a ``SaveGame`` envelope.
    ///
    /// This is the inverse of ``snapshot()`` + save metadata. The
    /// restored game is fully playable: RNG state continues from the
    /// exact point of interruption, card piles are in their saved order,
    /// and all phase/turn state is restored.
    ///
    /// - Parameter save: A previously persisted ``SaveGame``.
    /// - Throws: ``SaveGameError`` if the save is corrupt, incompatible,
    ///   or references map/settings that cannot be validated.
    /// - Returns: A live ``Game`` ready for ``apply(_:)`` calls.
    public static func restore(from save: SaveGame) throws(SaveGameError) -> Game {
        // 1. Version gate
        guard save.version <= SaveGameVersion.current else {
            throw .unsupportedVersion(save.version)
        }

        // 2. Integrity check
        let computedHash = save.snapshot.hash()
        guard computedHash == save.snapshotHash else {
            throw .integrityCheckFailed(
                expected: save.snapshotHash,
                actual: computedHash
            )
        }

        // 3. Rebuild typed dictionaries from snapshot's String-keyed maps
        var countries: [CountryId: Country] = [:]
        for (name, country) in save.snapshot.countries {
            countries[CountryId(name)] = country
        }

        var players: [PlayerId: Player] = [:]
        for (name, player) in save.snapshot.players {
            players[PlayerId(name)] = player
        }

        // 4. Derive pendingInput from snapshot flags if save.pendingInput
        //    is nil (backward compat with early saves)
        let pending: PendingInput? = save.pendingInput ?? {
            if save.snapshot.mustTurnInCards {
                return .awaitingCardTurnIn(player: save.snapshot.currentPlayerId)
            }
            return nil
        }()

        // 5. Construct via the private init (requires internal access)
        return Game(
            phase: save.snapshot.phase,
            turnPhase: save.snapshot.turnPhase,
            turnNumber: save.snapshot.turnNumber,
            currentPlayerId: save.snapshot.currentPlayerId,
            currentCountryId: save.snapshot.currentCountryId,
            winnerId: save.snapshot.winnerId,
            settings: save.settings,
            map: save.map,
            players: players,
            playersOrder: save.playersOrder,
            countries: countries,
            fortifyFrom: save.fortifyFrom,
            drawPile: save.drawPile,
            discardPile: save.discardPile,
            cardSetsTurnedIn: save.cardSetsTurnedIn,
            pendingInput: pending,
            rng: SeededRNG(state: save.rngState)
        )
    }
}
```

**Note:** `Game.init` is currently `private`. Restoration requires one of:
- **(a)** Widen `Game.init` to `internal` (preferred; `restore(from:)` lives in the same module)
- **(b)** Add a second `internal` initializer specifically for restoration

Option (a) is sufficient since `Game.init` is already `private` to the module, and widening to `internal` keeps it invisible to external consumers.

`SeededRNG` needs a second initializer that accepts raw state (not a seed):

```swift
extension SeededRNG {
    /// Restore RNG to a previously captured state. Used by save/load;
    /// the state value comes from a prior ``SeededRNG/state`` read.
    internal init(state: UInt32) {
        self.state = state
    }
}
```

### 3.4 Game.saveGame() convenience

```swift
extension Game {
    /// Create a ``SaveGame`` envelope from the current game state.
    ///
    /// - Parameters:
    ///   - name: Human-readable save name.
    ///   - appVersion: Calling application's version string.
    ///   - originalSeed: The seed used at ``Game/start``.
    ///   - moveHistory: Optional move transcript.
    /// - Returns: A ``SaveGame`` ready for JSON encoding.
    public func saveGame(
        name: String,
        appVersion: String,
        originalSeed: UInt32,
        moveHistory: [MoveRecord]? = nil
    ) -> SaveGame {
        let snap = snapshot()
        return SaveGame(
            version: .current,
            name: name,
            savedAt: Date(),
            appVersion: appVersion,
            turnNumber: turnNumber,
            currentPlayerId: currentPlayerId,
            snapshot: snap,
            settings: settings,
            map: map,
            rngState: rng.state,
            drawPile: drawPile,
            discardPile: discardPile,
            cardSetsTurnedIn: cardSetsTurnedIn,
            pendingInput: pendingInput,
            playersOrder: playersOrder,
            fortifyFrom: fortifyFrom,
            originalSeed: originalSeed,
            moveHistory: moveHistory,
            snapshotHash: snap.hash()
        )
    }
}
```

**Note:** `rng` is `private`. Accessing `rng.state` from `saveGame()` requires the method to live inside `Game.swift` or widen `rng` to `internal`. Since `saveGame()` is an extension on `Game` within `IconquerCore`, making `rng` `internal` is appropriate. The `private(set)` read restriction already protects mutation.

### 3.5 SaveGameError

```swift
/// Errors that can occur during save/load operations.
public enum SaveGameError: Error, Sendable {
    /// The save file's schema version is newer than this build supports.
    case unsupportedVersion(SaveGameVersion)

    /// The snapshot hash does not match the recomputed hash.
    case integrityCheckFailed(expected: String, actual: String)

    /// The save file's JSON could not be decoded.
    case decodingFailed(underlying: any Error)

    /// The save file could not be written to disk.
    case writeFailed(path: String, underlying: any Error)

    /// The save file could not be read from disk.
    case readFailed(path: String, underlying: any Error)

    /// The save slot does not exist.
    case slotNotFound(String)

    /// Map validation failed (save references countries/continents
    /// not present in the saved map definition).
    case mapValidationFailed(detail: String)
}
```

### 3.6 SaveManager (IconquerPersistence)

```swift
/// Thread-safe persistence layer for save files.
///
/// `SaveManager` is an actor that handles all file I/O for save/load.
/// It resolves platform-appropriate directories, manages named save
/// slots, and supports auto-save on a configurable interval.
public actor SaveManager {
    /// Configuration for the save manager.
    public struct Config: Sendable {
        /// Whether auto-save is enabled.
        public var autoSaveEnabled: Bool

        /// Auto-save triggers after this many moves since the last save.
        public var autoSaveInterval: Int

        /// Maximum number of auto-save files to retain (FIFO rotation).
        public var maxAutoSaves: Int

        /// Maximum number of manual save slots.
        public var maxManualSaves: Int

        public init(
            autoSaveEnabled: Bool = true,
            autoSaveInterval: Int = 10,
            maxAutoSaves: Int = 3,
            maxManualSaves: Int = 20
        ) { ... }
    }

    private let config: Config
    private let directory: URL
    private var movesSinceLastSave: Int = 0

    public init(config: Config = Config()) throws

    /// Save to a named slot. Overwrites if the slot already exists.
    public func save(_ saveGame: SaveGame, slot: String) throws(SaveGameError)

    /// Load from a named slot.
    public func load(slot: String) throws(SaveGameError) -> SaveGame

    /// List all available save slots with metadata.
    public func listSlots() throws -> [SaveSlot]

    /// Delete a save slot.
    public func deleteSlot(_ slot: String) throws(SaveGameError)

    /// Notify the manager that a move was applied. Triggers auto-save
    /// if the interval threshold is reached.
    public func recordMove(_ saveGame: SaveGame) async throws

    /// Perform an auto-save, rotating old auto-saves beyond the limit.
    public func autoSave(_ saveGame: SaveGame) throws(SaveGameError)
}
```

### 3.7 SaveDirectory (Platform Resolution)

```swift
/// Resolves the platform-appropriate save directory.
public enum SaveDirectory {
    /// Returns the save directory for the current platform.
    ///
    /// - macOS: `~/Library/Application Support/iconquer/saves/`
    /// - iOS: App Group container `group.com.iconquer/saves/`
    /// - Linux: `$XDG_DATA_HOME/iconquer/saves/` (falls back to `~/.local/share/`)
    public static func resolve() throws -> URL
}
```

### 3.8 SaveSlot

```swift
/// Metadata for a save slot, loaded without deserialising the full save.
public struct SaveSlot: Sendable, Codable {
    public let name: String
    public let savedAt: Date
    public let turnNumber: Int
    public let currentPlayerId: PlayerId
    public let appVersion: String
    public let fileSizeBytes: Int
}
```

---

## 4. MCP Schema

**Tool Description:** Save or load an in-progress iconquer game.

### save_game

**REQUIRED STRUCTURE (JSON):**
```json
{
  "slot": "autosave-1",
  "name": "My Game Turn 12"
}
```

**Parameter Types:**
- slot (string): Named save slot. Required.
- name (string): Human-readable label. Optional; defaults to "Turn N".

### load_game

**REQUIRED STRUCTURE (JSON):**
```json
{
  "slot": "autosave-1"
}
```

**Parameter Types:**
- slot (string): Named save slot to load. Required.

### list_saves

**REQUIRED STRUCTURE (JSON):**
```json
{}
```

No parameters. Returns array of `SaveSlot` metadata.

---

## 5. Constraints & Compliance

**Concurrency:** `SaveManager` is an `actor` — thread-safe by construction. `SaveGame`, `SaveSlot`, `SaveGameVersion`, and `SaveGameError` are all `Sendable` value types.

**Determinism:** RNG state (`UInt32`) is persisted and restored exactly. Restored games produce the same dice/shuffle sequence as if they had never been interrupted. This is the key design decision: we save `rng.state` rather than the original seed, because the original seed only reproduces the stream from the start, not from an arbitrary mid-game point.

**No Force Unwraps:** All deserialization uses `try`/`throws`. No `!`, no `try!`, no `as!`.

**Guard Clauses:** All validation uses guard + early return/throw.

**Division Safety:** No division in save/load paths.

**DocC:** All public API has documentation comments.

**MCP Ready:** JSON schema defined for all save/load operations.

---

## 6. Backend Abstraction

Not applicable. Save/load is I/O-bound, not compute-intensive. No GPU/Accelerate backend needed.

---

## 7. Dependencies

**Internal Dependencies:**
- `IconquerCore/Model/GameSnapshot.swift` — snapshot type and hash
- `IconquerCore/Rules/Game.swift` — game state machine
- `IconquerCore/Rules/Settings.swift` — needs Codable conformance added
- `IconquerCore/Map/MapDefinition.swift` — needs Codable conformance added
- `IconquerCore/Random/SeededRNG.swift` — needs state-only init + Codable
- `IconquerCore/Model/Card.swift` — already Codable
- `IconquerCore/Rules/PendingInput.swift` — needs Codable conformance if not already present
- `IconquerMatch/MoveRecord.swift` — for optional move history in saves

**External Dependencies:** None. JSON encoding uses Foundation only.

**New Module:** `IconquerPersistence` (new SPM target, depends on `IconquerCore`).

---

## 8. Test Strategy

### Test Categories

**Round-trip verification (golden path):**
- Start a game, play several moves, save, load, verify `snapshot()` hashes match
- Start a game, play to mid-fortify with pending state, save, load, verify all state fields match
- After restore, apply the same next move and verify the resulting snapshot matches what a never-interrupted game would produce

**RNG continuity:**
- Start a game with seed X, play N moves, capture `rng.state`, save. Start a fresh game with seed X, replay the same N moves, verify `rng.state` matches. Load the save, play 5 more moves. Replay the fresh game through N+5 moves. Verify final snapshots are identical. This proves restored games are bit-identical to uninterrupted ones.

**Integrity validation:**
- Corrupt a saved JSON file (flip a byte), attempt load, verify `SaveGameError.integrityCheckFailed`
- Save with version `.v1`, artificially set version to `.v99`, attempt load, verify `SaveGameError.unsupportedVersion`

**Edge cases:**
- Save/load a game in `pickCountries` phase (pre-start)
- Save/load a game in `victory` phase (post-game)
- Save/load a game with `pendingInput` (forced card turn-in mid-attack)
- Save/load with empty draw pile (all cards in hands)
- Save/load with eliminated players (playersOrder shorter than players dict)

**SaveManager actor tests:**
- Auto-save triggers after configured interval
- Auto-save rotation evicts oldest beyond limit
- Slot CRUD: create, overwrite, list, delete
- Concurrent save/load calls do not corrupt

**Platform directory tests:**
- `SaveDirectory.resolve()` returns a writable path on macOS
- `SaveDirectory.resolve()` uses XDG on Linux

**Codable conformance tests:**
- `Settings` round-trips through JSON encode/decode
- `MapDefinition` round-trips through JSON encode/decode
- `SeededRNG` state round-trips correctly
- `PendingInput` round-trips correctly

### Reference Truth

The reference truth for round-trip verification is the existing `GameSnapshot.hash()` function (FNV-1a). A save-load cycle must produce an identical hash. For RNG continuity, the reference truth is the mulberry32 algorithm itself: same state input must produce the same output stream.

### Validation Trace (REQUIRED)

1. Start game with seed `12345`, 3 players, default settings, classic map.
2. Play through country picking and initial army placement (auto-assigned).
3. Play 5 full turns of attack/fortify.
4. Capture `snapshot().hash()` = H1, `rng.state` = S1.
5. Call `saveGame(name: "test", appVersion: "1.0", originalSeed: 12345)`.
6. Encode to JSON, decode back to `SaveGame`.
7. Call `Game.restore(from: decodedSave)`.
8. Capture restored game's `snapshot().hash()` = H2.
9. Assert H1 == H2.
10. Apply one more move to both the original and restored game.
11. Assert both produce identical `snapshot().hash()` values.

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions (file does not exist yet)
- [ ] Does this supersede an existing ADR? No
- [ ] Does this amend an existing ADR? No
- [x] New ADR required? Yes

**New ADR Draft:**
- Title: Save/Load uses full engine state capture, not replay-from-seed
- Category: storage
- Key decision: We persist the complete engine state (RNG position, card piles, pending input) rather than replaying moves from the original seed, because replay requires the full move history and is O(N) in game length, while state capture is O(1) and guaranteed to restore exactly.

**New ADR Draft (secondary):**
- Title: SaveManager is a separate IconquerPersistence module
- Category: architecture
- Key decision: File I/O and platform directory logic live in a dedicated `IconquerPersistence` module rather than in `IconquerCore`, keeping the engine free of Foundation file-system dependencies and testable with in-memory fakes.

---

## 10. Open Questions

1. **Should `Settings` and `MapDefinition` gain `Codable` conformance directly, or should we use wrapper types?** Recommendation: add `Codable` directly. Both types are already simple value types with all-Codable fields. The only concern is that `MapDefinition` is not currently `Codable`; adding it is straightforward since all its nested types (`Country`, `Continent`, `CountryId`) are already `Codable`.

2. **Should move history be required or optional in `SaveGame`?** Recommendation: optional. The move history can be large for long games and is not needed for restoration. The `moveHistory` field should be `[MoveRecord]?` with a default of `nil`. Callers that want replay audit trails can populate it.

3. **Should `rng` access be widened from `private` to `internal`?** Recommendation: yes. The `saveGame()` method needs to read `rng.state`, and `restore(from:)` needs to set it. Widening to `internal` keeps it invisible to external module consumers while enabling save/load within `IconquerCore`. Alternatively, expose only `var rngState: UInt32 { rng.state }` as a computed read-only property.

4. **Should the `Game.init` access level change?** Recommendation: widen from `private` to `internal`. This is the simplest path. `restore(from:)` lives in `IconquerCore` and needs to call the memberwise init. External consumers still cannot construct a `Game` directly; they must use `start()` or `restore()`.

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (SaveGame, Game.restore, SaveManager, SaveDirectory)
- Does explanation require 50+ lines? Yes
- Does it need theory/background context? Yes (RNG continuity, integrity validation, platform directories)

**Article Name:** SaveLoadGuide.md

The article should cover:
- How to save a game (with code example)
- How to load a game (with code example)
- Auto-save configuration
- Platform-specific save locations
- Save format versioning and migration strategy
- Troubleshooting corrupt saves

---

## Key Technical Decision: RNG Continuity

The most important design decision in this proposal is **how to handle RNG state**.

### The Problem

`Game` uses a `SeededRNG` (mulberry32) that is consumed by deck shuffles, random country assignment, and dice rolls. A restored game must produce the same future random sequence as if it had never been saved.

### Options Considered

| Approach | Pros | Cons |
|----------|------|------|
| **(A) Save RNG state** | O(1) restore, exact continuity, small payload | Requires exposing `rng.state` internally |
| **(B) Replay from seed** | No new state to persist | O(N) restore time, requires full move history, fragile if engine changes |
| **(C) New seed on restore** | Simplest | Games diverge from pre-save trajectory, breaks determinism contract |

### Decision: Option (A) — Save RNG state

Mulberry32's entire state is a single `UInt32`. Persisting it gives exact RNG continuity with zero overhead. This means a restored game is indistinguishable from one that was never interrupted: same dice rolls, same card draws, same shuffles. This is critical for the parity-fixture test strategy and for the tournament replay system.

### What This Means for Replays

The existing replay system (`MoveRecord` transcripts) replays from the original seed. Save/load does NOT replace replay. The two systems coexist:

- **Replay** = deterministic reproduction of a complete game from seed + moves (for audit, tournament analysis)
- **Save/load** = mid-game persistence and restoration (for player convenience)

A saved game optionally includes its `moveHistory` so that the replay system can still reconstruct the game up to the save point. Moves applied after restoration append to a new transcript.

---

## Migration Strategy

### Save Format Versioning

Every `SaveGame` includes a `version: SaveGameVersion` field. The decoder checks this first:

```swift
// Pseudocode in Game.restore(from:)
guard save.version <= SaveGameVersion.current else {
    throw .unsupportedVersion(save.version)
}
if save.version < .current {
    save = try migrate(save, from: save.version, to: .current)
}
```

### Migration Rules

- **Adding new optional fields:** No migration needed. `decodeIfPresent` handles absent keys.
- **Adding new required fields:** Bump version. Migration function supplies a default.
- **Removing fields:** Bump version. Old version's decoder ignores extra keys.
- **Changing field types:** Bump version. Migration function transforms the value.

### Forward Compatibility

Saves from a newer version than the running app will be rejected with `SaveGameError.unsupportedVersion`. This is intentional: blindly dropping unknown fields could produce a corrupt game state. Users must update their app to load newer saves.

### Backward Compatibility

Saves from an older version will be migrated up to `SaveGameVersion.current` on load. The migration chain is linear: v1 -> v2 -> v3 -> ... -> current. Each step is a pure function.
