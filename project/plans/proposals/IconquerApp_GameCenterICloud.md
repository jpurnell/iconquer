# Design Proposal: Phase 3 -- Game Center Integration & iCloud Save

**Date:** 2026-04-23
**Status:** Proposed
**Scope:** Game Center leaderboards, achievements, and turn-based multiplayer; iCloud CloudKit save sync; local on-device persistence
**Depends on:** IconquerApp SwiftUI Port (Phase 2)

---

## 1. Objective

Add three persistence and social layers to the IconquerApp:

1. **Local Save/Load** -- On-device persistence of in-progress and completed games to the App Group container. This is the prerequisite for both iCloud sync and Game Center multiplayer, since serialised game state is the atomic unit all three systems exchange.

2. **iCloud Save** -- CloudKit-backed sync of saved games across the player's devices. A game saved on iPhone appears on iPad and Mac. Conflict resolution uses latest-writer-wins with a user prompt for divergent saves.

3. **Game Center** -- Leaderboards (most games won, fastest victory, highest Elo), achievements (first win, continent collector, world domination streak), and turn-based multiplayer using `GKTurnBasedMatch` for async play.

**Problems solved:**
- Games are ephemeral: closing the app loses all progress. Local save fixes this.
- Players with multiple Apple devices cannot resume a game on a different device. iCloud sync fixes this.
- There is no competitive or social layer. Game Center leaderboards, achievements, and async multiplayer fix this.

**Master Plan Reference:** Phase 3 -- Game Center Integration & iCloud Save

---

## 2. Proposed Architecture

### New Files

| File | Purpose |
|------|---------|
| `App/iconquer/Model/SaveGame.swift` | `SaveGame` struct wrapping snapshot + settings + map + player config + metadata |
| `App/iconquer/Model/SaveGameMetadata.swift` | Lightweight metadata for save list UI (no full snapshot) |
| `App/iconquer/Persistence/SaveManager.swift` | `actor SaveManager` -- thread-safe local read/write/delete |
| `App/iconquer/Persistence/CloudSaveManager.swift` | `actor CloudSaveManager` -- CloudKit upload/download/conflict resolution |
| `App/iconquer/Persistence/SaveError.swift` | Error types for persistence operations |
| `App/iconquer/GameCenter/GameCenterManager.swift` | `actor GameCenterManager` -- authentication, leaderboards, achievements |
| `App/iconquer/GameCenter/LeaderboardDefinitions.swift` | Leaderboard ID constants and score formatting |
| `App/iconquer/GameCenter/AchievementDefinitions.swift` | Achievement ID constants, progress tracking, unlock conditions |
| `App/iconquer/GameCenter/TurnBasedMatchManager.swift` | `actor TurnBasedMatchManager` -- GKTurnBasedMatch lifecycle |
| `App/iconquer/GameCenter/TurnBasedMatchData.swift` | Codable wrapper for match exchange data |
| `App/iconquer/Views/SaveLoadView.swift` | Save/load game list with thumbnails and metadata |
| `App/iconquer/Views/LeaderboardView.swift` | Game Center leaderboard presentation |
| `App/iconquer/Views/AchievementBannerView.swift` | In-game achievement unlock overlay |
| `App/iconquer/Views/MultiplayerLobbyView.swift` | Turn-based match browser and creation |

### Modified Files

| File | Change |
|------|--------|
| `App/iconquer/ViewModels/GameViewModel.swift` | Add `save()`, `autoSave()`, report achievements/leaderboards on game events, support `TurnBasedMatchManager` delegate callbacks |
| `App/iconquer/ViewModels/SetupViewModel.swift` | Add multiplayer game creation flow via `TurnBasedMatchManager` |
| `App/iconquer/IconquerApp.swift` | Add Game Center authentication on launch, save/load navigation, multiplayer entry point |
| `IconquerCore/.../MapDefinition.swift` | Add `Codable` conformance (required for `SaveGame` serialisation) |

### Module Placement

All new code lives in the `iconquer` app target. Persistence and Game Center code are organised into sub-directories but remain part of the single app module. No new SPM library targets are created -- these features are inherently platform-specific (GameKit, CloudKit) and do not belong in the platform-agnostic `IconquerCore`.

```
App/iconquer/
├── Persistence/
│   ├── SaveManager.swift
│   ├── CloudSaveManager.swift
│   └── SaveError.swift
├── GameCenter/
│   ├── GameCenterManager.swift
│   ├── LeaderboardDefinitions.swift
│   ├── AchievementDefinitions.swift
│   ├── TurnBasedMatchManager.swift
│   └── TurnBasedMatchData.swift
├── Model/
│   ├── SaveGame.swift          (new)
│   └── SaveGameMetadata.swift  (new)
└── Views/
    ├── SaveLoadView.swift      (new)
    ├── LeaderboardView.swift   (new)
    ├── AchievementBannerView.swift (new)
    └── MultiplayerLobbyView.swift  (new)
```

---

## 3. API Surface

### SaveGame (persistence unit)

```swift
/// The atomic unit of game persistence. Captures everything needed to
/// restore a game to its exact state, plus metadata for the save list UI.
///
/// All fields are Codable and Sendable. The struct is versioned so future
/// schema changes can migrate old saves forward.
public struct SaveGame: Codable, Sendable, Identifiable {
    /// Schema version for forward migration. Increment when fields change.
    public static let currentSchemaVersion: Int = 1

    public var id: UUID
    public var schemaVersion: Int
    public var snapshot: GameSnapshot
    public var settings: Settings
    public var mapDefinition: MapDefinition
    public var playerConfigs: [PlayerConfig]
    public var metadata: Metadata

    /// Lightweight metadata displayed in the save list without loading
    /// the full snapshot.
    public struct Metadata: Codable, Sendable {
        public var displayName: String
        public var createdAt: Date
        public var lastSavedAt: Date
        public var turnNumber: Int
        public var playerCount: Int
        public var currentPlayerName: String
        public var isCompleted: Bool
        public var winnerId: PlayerId?
        public var thumbnailData: Data?
    }

    /// Creates a SaveGame from the current game state.
    ///
    /// - Parameters:
    ///   - snapshot: The current engine snapshot.
    ///   - settings: The game's rule settings.
    ///   - mapDefinition: The map used for this game.
    ///   - playerConfigs: The player configurations from setup.
    ///   - displayName: A user-facing name for the save.
    ///   - thumbnailData: Optional PNG data of the board thumbnail.
    public init(
        snapshot: GameSnapshot,
        settings: Settings,
        mapDefinition: MapDefinition,
        playerConfigs: [PlayerConfig],
        displayName: String,
        thumbnailData: Data?
    )
}
```

### SaveManager (local persistence)

```swift
/// Thread-safe actor for reading and writing SaveGame files to the
/// App Group container. Each save is a JSON file named by its UUID.
///
/// The actor ensures serialised access to the file system, preventing
/// data races from concurrent auto-save and manual save operations.
public actor SaveManager {
    /// Configuration for save behaviour.
    public struct Config: Sendable {
        /// Auto-save interval in seconds. Zero disables auto-save.
        public var autoSaveIntervalSeconds: TimeInterval = 60
        /// Maximum number of auto-save slots before the oldest is pruned.
        public var maxAutoSaveSlots: Int = 5
        /// Maximum number of manual save slots.
        public var maxManualSaveSlots: Int = 20
        /// The App Group identifier for the save directory.
        public var appGroupIdentifier: String = "group.com.iconquer.saves"
    }

    private let config: Config
    private let saveDirectory: URL

    /// Creates a SaveManager with the given configuration.
    ///
    /// - Parameter config: Persistence configuration.
    /// - Throws: `SaveError.directoryCreationFailed` if the save directory
    ///   cannot be created.
    public init(config: Config = Config()) throws

    /// Saves a game to disk.
    ///
    /// - Parameter saveGame: The game state to persist.
    /// - Throws: `SaveError.encodingFailed` or `SaveError.writeFailed`.
    public func save(_ saveGame: SaveGame) throws

    /// Loads a saved game by its ID.
    ///
    /// - Parameter id: The save's UUID.
    /// - Returns: The decoded SaveGame.
    /// - Throws: `SaveError.notFound` or `SaveError.decodingFailed`.
    public func load(id: UUID) throws -> SaveGame

    /// Returns metadata for all saves, sorted by lastSavedAt descending.
    ///
    /// Reads only the metadata portion of each file for performance.
    ///
    /// - Returns: An array of save metadata.
    /// - Throws: `SaveError.directoryReadFailed`.
    public func listSaves() throws -> [SaveGame.Metadata]

    /// Deletes a saved game by its ID.
    ///
    /// - Parameter id: The save's UUID.
    /// - Throws: `SaveError.notFound` or `SaveError.deleteFailed`.
    public func delete(id: UUID) throws

    /// Prunes auto-saves beyond the configured maximum, keeping the
    /// most recent.
    public func pruneAutoSaves() throws
}
```

### CloudSaveManager (iCloud sync)

```swift
/// Syncs SaveGame records to and from the user's private CloudKit database.
///
/// Each SaveGame maps to a single CKRecord in a "SaveGame" record type.
/// The full JSON payload is stored as a CKAsset to avoid CloudKit's
/// per-field size limits. Metadata fields are stored as indexed CKRecord
/// fields for efficient queries without downloading the full payload.
///
/// Conflict resolution: when a local save and a server record have diverged,
/// the manager compares `lastSavedAt` timestamps. If the difference is under
/// the tolerance threshold, latest-writer-wins silently. If the difference
/// exceeds the threshold, the conflict is surfaced to the user via the
/// `conflictHandler`.
public actor CloudSaveManager {
    /// Configuration for cloud sync behaviour.
    public struct Config: Sendable {
        /// The CloudKit container identifier.
        public var containerIdentifier: String = "iCloud.com.iconquer"
        /// Maximum age difference (seconds) for silent latest-writer-wins.
        /// Beyond this, the user is prompted.
        public var silentConflictToleranceSeconds: TimeInterval = 300
        /// Whether cloud sync is enabled (user preference).
        public var isSyncEnabled: Bool = true
    }

    /// Describes a sync conflict that requires user resolution.
    public struct ConflictInfo: Sendable {
        public var localSave: SaveGame
        public var remoteSave: SaveGame
        public var localDate: Date
        public var remoteDate: Date
    }

    /// The resolution the user chose for a conflict.
    public enum ConflictResolution: Sendable {
        case keepLocal
        case keepRemote
        case keepBoth
    }

    /// Closure invoked when a conflict requires user input.
    /// Called on the main actor so it can present UI.
    public typealias ConflictHandler = @MainActor @Sendable (ConflictInfo) async -> ConflictResolution

    private let config: Config
    private let localManager: SaveManager
    private var conflictHandler: ConflictHandler?

    /// Creates a CloudSaveManager backed by the given local SaveManager.
    ///
    /// - Parameters:
    ///   - config: Cloud sync configuration.
    ///   - localManager: The local SaveManager for reading/writing files.
    public init(config: Config = Config(), localManager: SaveManager)

    /// Sets the conflict handler for user-facing conflict resolution.
    ///
    /// - Parameter handler: A closure called on the main actor when a
    ///   conflict exceeds the silent tolerance.
    public func setConflictHandler(_ handler: @escaping ConflictHandler)

    /// Uploads a local save to CloudKit.
    ///
    /// - Parameter saveGame: The game to upload.
    /// - Throws: `SaveError.cloudUploadFailed`.
    public func upload(_ saveGame: SaveGame) async throws

    /// Downloads all remote saves and reconciles with local storage.
    ///
    /// For each remote save:
    /// - If no local copy exists, downloads and saves locally.
    /// - If a local copy exists with an older `lastSavedAt`, overwrites local.
    /// - If timestamps diverge beyond tolerance, invokes `conflictHandler`.
    ///
    /// - Throws: `SaveError.cloudDownloadFailed`.
    public func syncAll() async throws

    /// Downloads a single remote save by ID.
    ///
    /// - Parameter id: The save's UUID.
    /// - Returns: The decoded SaveGame from CloudKit.
    /// - Throws: `SaveError.cloudDownloadFailed` or `SaveError.notFound`.
    public func download(id: UUID) async throws -> SaveGame

    /// Deletes a save from CloudKit.
    ///
    /// - Parameter id: The save's UUID.
    /// - Throws: `SaveError.cloudDeleteFailed`.
    public func deleteRemote(id: UUID) async throws

    /// Subscribes to CloudKit change notifications for the SaveGame
    /// record type. When a remote change arrives, triggers `syncAll()`.
    public func subscribeToChanges() async throws
}
```

### SaveError

```swift
/// Errors produced by SaveManager and CloudSaveManager.
public enum SaveError: Error, Sendable {
    case directoryCreationFailed(underlying: Error)
    case directoryReadFailed(underlying: Error)
    case encodingFailed(underlying: Error)
    case decodingFailed(underlying: Error)
    case writeFailed(underlying: Error)
    case deleteFailed(underlying: Error)
    case notFound(id: UUID)
    case cloudUploadFailed(underlying: Error)
    case cloudDownloadFailed(underlying: Error)
    case cloudDeleteFailed(underlying: Error)
    case cloudAccountUnavailable
    case schemaMigrationFailed(fromVersion: Int, toVersion: Int)
}
```

### GameCenterManager (auth + leaderboards + achievements)

```swift
/// Manages Game Center authentication, leaderboard score submission,
/// and achievement progress reporting.
///
/// Authentication is attempted once at app launch. If the player is not
/// signed into Game Center, all leaderboard and achievement calls become
/// no-ops (they do not throw).
public actor GameCenterManager {
    /// Whether the local player is authenticated with Game Center.
    public private(set) var isAuthenticated: Bool

    /// The authenticated local player's Game Center alias, if available.
    public private(set) var playerAlias: String?

    /// Authenticates the local player with Game Center.
    ///
    /// On iOS this presents the Game Center login sheet if needed.
    /// On macOS it opens the Game Center preferences.
    ///
    /// - Returns: `true` if authentication succeeded.
    @MainActor
    public func authenticate() async -> Bool

    // MARK: - Leaderboards

    /// Submits a score to a leaderboard.
    ///
    /// No-op if the player is not authenticated.
    ///
    /// - Parameters:
    ///   - score: The integer score value.
    ///   - leaderboardId: The leaderboard identifier from
    ///     `LeaderboardDefinitions`.
    public func submitScore(_ score: Int, to leaderboardId: String) async

    /// Presents the Game Center leaderboard UI.
    @MainActor
    public func showLeaderboard() async

    // MARK: - Achievements

    /// Reports progress toward an achievement.
    ///
    /// No-op if the player is not authenticated. Progress is cumulative;
    /// Game Center tracks the maximum reported value.
    ///
    /// - Parameters:
    ///   - achievementId: The achievement identifier from
    ///     `AchievementDefinitions`.
    ///   - percentComplete: Progress from 0.0 to 100.0.
    public func reportAchievement(
        _ achievementId: String,
        percentComplete: Double
    ) async

    /// Checks achievement progress and reports any newly completed
    /// achievements based on the current game state.
    ///
    /// Called by `GameViewModel` after each significant game event
    /// (country captured, continent controlled, game won).
    ///
    /// - Parameter snapshot: The current game snapshot.
    /// - Parameter playerId: The local human player's ID.
    public func evaluateAchievements(
        snapshot: GameSnapshot,
        playerId: PlayerId
    ) async
}
```

### LeaderboardDefinitions

```swift
/// Game Center leaderboard identifiers and configuration.
///
/// These IDs must match the values configured in App Store Connect.
public enum LeaderboardDefinitions: Sendable {
    /// Total games won across all modes.
    public static let gamesWon = "com.iconquer.leaderboard.gamesWon"

    /// Fastest victory measured in total turns to win.
    public static let fastestVictory = "com.iconquer.leaderboard.fastestVictory"

    /// Highest Elo rating from ranked multiplayer games.
    public static let highestElo = "com.iconquer.leaderboard.highestElo"

    /// Leaderboard display configuration.
    public struct DisplayConfig: Sendable {
        public var leaderboardId: String
        public var title: String
        public var formatSuffix: String
        public var sortAscending: Bool
    }

    /// All leaderboard display configs for the leaderboard list UI.
    public static let allLeaderboards: [DisplayConfig] = [
        DisplayConfig(
            leaderboardId: gamesWon,
            title: "Most Victories",
            formatSuffix: " wins",
            sortAscending: false
        ),
        DisplayConfig(
            leaderboardId: fastestVictory,
            title: "Speed Champion",
            formatSuffix: " turns",
            sortAscending: true
        ),
        DisplayConfig(
            leaderboardId: highestElo,
            title: "Highest Rating",
            formatSuffix: " Elo",
            sortAscending: false
        ),
    ]
}
```

### AchievementDefinitions

```swift
/// Game Center achievement identifiers and unlock conditions.
///
/// These IDs must match the values configured in App Store Connect.
public enum AchievementDefinitions: Sendable {
    // MARK: - Victory Achievements

    /// Win your first game.
    public static let firstVictory = "com.iconquer.achievement.firstVictory"

    /// Win 10 games.
    public static let veteranCommander = "com.iconquer.achievement.veteranCommander"

    /// Win 100 games.
    public static let legendaryConqueror = "com.iconquer.achievement.legendaryConqueror"

    // MARK: - Continent Achievements

    /// Control all of a single continent at the same time.
    public static let continentCollector = "com.iconquer.achievement.continentCollector"

    /// Control all 6 continents simultaneously (but not necessarily all countries).
    public static let globeStraddler = "com.iconquer.achievement.globeStraddler"

    // MARK: - Streak Achievements

    /// Win 3 games in a row.
    public static let dominationStreak3 = "com.iconquer.achievement.dominationStreak3"

    /// Win 5 games in a row.
    public static let dominationStreak5 = "com.iconquer.achievement.dominationStreak5"

    // MARK: - Speed Achievements

    /// Win a game in 20 turns or fewer.
    public static let blitzkrieg = "com.iconquer.achievement.blitzkrieg"

    // MARK: - Multiplayer Achievements

    /// Win your first turn-based multiplayer game.
    public static let multiplayerVictor = "com.iconquer.achievement.multiplayerVictor"

    /// An achievement definition with its unlock condition for evaluation.
    public struct Definition: Sendable {
        public var achievementId: String
        public var title: String
        public var description: String
        public var isIncremental: Bool
        public var maxProgress: Int
    }

    /// All achievement definitions for progress evaluation.
    public static let allAchievements: [Definition] = [
        Definition(
            achievementId: firstVictory,
            title: "First Blood",
            description: "Win your first game",
            isIncremental: false,
            maxProgress: 1
        ),
        Definition(
            achievementId: veteranCommander,
            title: "Veteran Commander",
            description: "Win 10 games",
            isIncremental: true,
            maxProgress: 10
        ),
        Definition(
            achievementId: legendaryConqueror,
            title: "Legendary Conqueror",
            description: "Win 100 games",
            isIncremental: true,
            maxProgress: 100
        ),
        Definition(
            achievementId: continentCollector,
            title: "Continent Collector",
            description: "Control an entire continent",
            isIncremental: false,
            maxProgress: 1
        ),
        Definition(
            achievementId: globeStraddler,
            title: "Globe Straddler",
            description: "Control all 6 continents simultaneously",
            isIncremental: false,
            maxProgress: 1
        ),
        Definition(
            achievementId: dominationStreak3,
            title: "Hat Trick",
            description: "Win 3 games in a row",
            isIncremental: false,
            maxProgress: 1
        ),
        Definition(
            achievementId: dominationStreak5,
            title: "World Domination Streak",
            description: "Win 5 games in a row",
            isIncremental: false,
            maxProgress: 1
        ),
        Definition(
            achievementId: blitzkrieg,
            title: "Blitzkrieg",
            description: "Win in 20 turns or fewer",
            isIncremental: false,
            maxProgress: 1
        ),
        Definition(
            achievementId: multiplayerVictor,
            title: "Online Champion",
            description: "Win a turn-based multiplayer game",
            isIncremental: false,
            maxProgress: 1
        ),
    ]
}
```

### TurnBasedMatchManager (async multiplayer)

```swift
/// Manages Game Center turn-based multiplayer match lifecycle.
///
/// Uses `GKTurnBasedMatch` for asynchronous multiplayer where players take
/// turns at their own pace. Match data is a `TurnBasedMatchData` struct
/// containing the full `SaveGame` state, exchanged as JSON via Game Center's
/// match data system.
///
/// The actor handles match creation, turn submission, match end, and
/// incoming turn notifications. It delegates game state changes to
/// `GameViewModel` via a callback.
public actor TurnBasedMatchManager {
    /// Configuration for turn-based multiplayer.
    public struct Config: Sendable {
        /// Minimum players per match (including local player).
        public var minPlayers: Int = 2
        /// Maximum players per match.
        public var maxPlayers: Int = 6
        /// Turn timeout in seconds. Zero means no timeout.
        public var turnTimeoutSeconds: TimeInterval = 86400 // 24 hours
        /// Match timeout in seconds for the entire match.
        public var matchTimeoutSeconds: TimeInterval = 604_800 // 7 days
    }

    /// Callback invoked when it becomes the local player's turn.
    /// Called on the main actor so it can update GameViewModel.
    public typealias TurnReceivedHandler = @MainActor @Sendable (
        _ matchData: TurnBasedMatchData
    ) async -> Void

    /// Callback invoked when a match ends (win, forfeit, timeout).
    public typealias MatchEndedHandler = @MainActor @Sendable (
        _ matchData: TurnBasedMatchData,
        _ outcome: MatchOutcome
    ) async -> Void

    /// The outcome of a completed match.
    public enum MatchOutcome: Sendable {
        case won(PlayerId)
        case forfeit(PlayerId)
        case timeout
    }

    private let config: Config
    private let gameCenterManager: GameCenterManager
    private var turnReceivedHandler: TurnReceivedHandler?
    private var matchEndedHandler: MatchEndedHandler?

    public init(
        config: Config = Config(),
        gameCenterManager: GameCenterManager
    )

    /// Sets handlers for incoming turn and match-end events.
    public func setHandlers(
        onTurnReceived: @escaping TurnReceivedHandler,
        onMatchEnded: @escaping MatchEndedHandler
    )

    /// Creates a new turn-based match and presents the Game Center
    /// matchmaker UI for player invitations.
    ///
    /// - Parameter playerCount: The desired number of players.
    /// - Returns: The initial match data after all players have joined.
    /// - Throws: `GameCenterError.matchCreationFailed`.
    @MainActor
    public func createMatch(playerCount: Int) async throws -> GKTurnBasedMatch

    /// Loads all active matches the local player is participating in.
    ///
    /// - Returns: An array of match summaries.
    public func loadActiveMatches() async throws -> [MatchSummary]

    /// Submits the current turn: encodes the SaveGame into match data
    /// and advances to the next participant.
    ///
    /// - Parameters:
    ///   - match: The active GKTurnBasedMatch.
    ///   - saveGame: The current game state after the local player's turn.
    ///   - nextPlayerId: The next participant to take a turn.
    /// - Throws: `GameCenterError.turnSubmissionFailed`.
    public func submitTurn(
        match: GKTurnBasedMatch,
        saveGame: SaveGame,
        nextPlayerId: PlayerId
    ) async throws

    /// Ends a match with a final outcome.
    ///
    /// - Parameters:
    ///   - match: The active GKTurnBasedMatch.
    ///   - saveGame: The final game state.
    ///   - outcome: The match outcome for each participant.
    /// - Throws: `GameCenterError.matchEndFailed`.
    public func endMatch(
        match: GKTurnBasedMatch,
        saveGame: SaveGame,
        outcomes: [GKTurnBasedMatch.Participant: GKTurnBasedMatch.Outcome]
    ) async throws

    /// Forfeits the current match (the local player quits).
    ///
    /// - Parameter match: The active GKTurnBasedMatch.
    /// - Throws: `GameCenterError.forfeitFailed`.
    public func forfeit(match: GKTurnBasedMatch) async throws

    /// A lightweight summary of an active match for the lobby UI.
    public struct MatchSummary: Sendable, Identifiable {
        public var id: String
        public var playerNames: [String]
        public var turnNumber: Int
        public var isLocalPlayerTurn: Bool
        public var lastActivityDate: Date
    }
}
```

### TurnBasedMatchData (match exchange payload)

```swift
/// The Codable payload exchanged between players in a turn-based match.
///
/// Wraps a full `SaveGame` plus multiplayer-specific metadata (player
/// mapping from Game Center participant IDs to engine player IDs).
public struct TurnBasedMatchData: Codable, Sendable {
    /// Schema version for match data migration.
    public static let currentSchemaVersion: Int = 1

    public var schemaVersion: Int
    public var saveGame: SaveGame
    public var participantMapping: [String: PlayerId] // GC participant ID -> engine PlayerId
    public var turnHistory: [TurnRecord]

    /// A record of a single turn for replay/audit.
    public struct TurnRecord: Codable, Sendable {
        public var playerId: PlayerId
        public var turnNumber: Int
        public var timestamp: Date
        public var moveSummary: String
    }

    /// Encodes this match data to `Data` for `GKTurnBasedMatch.endTurn()`.
    ///
    /// - Returns: JSON-encoded match data.
    /// - Throws: `SaveError.encodingFailed`.
    public func encode() throws -> Data

    /// Decodes match data from `GKTurnBasedMatch.matchData`.
    ///
    /// - Parameter data: The raw match data bytes.
    /// - Returns: The decoded match data.
    /// - Throws: `SaveError.decodingFailed`.
    public static func decode(from data: Data) throws -> TurnBasedMatchData
}
```

### GameViewModel Extensions

```swift
extension GameViewModel {
    // MARK: - Persistence

    /// Saves the current game state to local storage.
    ///
    /// - Parameter displayName: A user-facing name for the save.
    /// - Throws: `SaveError` if persistence fails.
    func save(displayName: String) async throws

    /// Triggers an auto-save if the interval has elapsed.
    /// Called by the match runner after each turn completes.
    func autoSaveIfNeeded() async

    /// Restores game state from a SaveGame.
    ///
    /// - Parameter saveGame: The saved state to restore.
    /// - Throws: If the engine cannot be reconstructed from the snapshot.
    func restore(from saveGame: SaveGame) throws

    // MARK: - Game Center Reporting

    /// Reports end-of-game results to leaderboards and achievements.
    /// Called when `snapshot.winnerId` transitions from nil to a value.
    func reportGameCompletion() async

    /// Evaluates mid-game achievements (continent control, army milestones).
    /// Called after each turn.
    func evaluateMidGameAchievements() async
}
```

---

## 4. MCP Schema

Not applicable for Phase 3. Game Center and iCloud are Apple platform services with no MCP tool surface.

**Future consideration:** The tournament server (Phase 4) may expose match results and leaderboards via MCP tools. That is out of scope for this proposal.

---

## 5. Constraints & Compliance

**Concurrency:**
- `SaveManager`, `CloudSaveManager`, `GameCenterManager`, and `TurnBasedMatchManager` are all actors, providing compile-time data race safety under Swift 6 strict concurrency.
- `SaveGame`, `SaveGameMetadata`, `TurnBasedMatchData`, `TurnRecord`, `ConflictInfo`, `ConflictResolution`, `MatchSummary`, `MatchOutcome`, `SaveError`, all `Definitions` types, and all `Config` types are `Sendable` value types.
- Game Center callbacks (authentication, turn received) hop to `@MainActor` for UI updates via explicitly typed `@MainActor @Sendable` closures.
- `SwiftUIHumanAgent` isolation justification from Phase 2 is unchanged.

**No force unwraps:** All CloudKit record field access uses optional binding. `GKTurnBasedMatch.matchData` is optional and guarded with `guard let`. File system operations use `try` with typed errors, never `try!`.

**No hardcoded constants:** All tunable values (auto-save interval, max save slots, conflict tolerance, turn timeout, match timeout, leaderboard IDs, achievement IDs) live in `Config` structs or static constants on definition types. No magic numbers in logic code.

**Guard clauses:** Every function that receives optional or potentially invalid input uses early `guard` returns. Examples: `guard isAuthenticated else { return }` in all Game Center reporting methods; `guard let data = match.matchData else { throw ... }` in turn-based match decoding.

**Division safety:** Not applicable -- no division operations in this feature.

**No String(format:):** Score formatting for leaderboards uses string interpolation with `formatted()`. Date formatting uses `Date.FormatStyle`.

**DocC:** All public types, methods, and properties have documentation comments.

**Swift 6 strict concurrency:** All new types compile under `-strict-concurrency=complete`. Actor isolation boundaries are explicit. No `@unchecked Sendable` is needed -- all persistence types are value types.

**Codable conformance prerequisite:** `MapDefinition` in `IconquerCore` currently conforms to `Sendable, Hashable` but not `Codable`. This proposal requires adding `Codable` conformance to `MapDefinition`, `MapDefinition.Country`, and `MapDefinition.Continent`. All stored properties are already `Codable` types (`CountryId`, `String`, `Int`, `[CountryId]`), so the compiler-synthesised conformance suffices.

---

## 6. Backend Abstraction (If Compute-Intensive)

Not applicable. Persistence I/O and Game Center network calls are not compute-intensive. CloudKit operations are handled by the system framework.

---

## 7. Dependencies

**Internal Dependencies:**
- `IconquerCore` -- `GameSnapshot`, `Settings`, `MapDefinition`, `PlayerId`, `CountryId`, `GamePhase`, `TurnPhase`
- `App/iconquer/ViewModels/GameViewModel.swift` -- extended with save/load and Game Center reporting
- `App/iconquer/ViewModels/SetupViewModel.swift` -- extended with multiplayer match creation
- `App/iconquer/Model/PlayerConfig.swift` -- included in `SaveGame`

**External Dependencies:**
- `GameKit` (Apple framework) -- `GKLocalPlayer`, `GKTurnBasedMatch`, `GKLeaderboard`, `GKAchievement`, `GKTurnBasedMatchmakerViewController`
- `CloudKit` (Apple framework) -- `CKContainer`, `CKDatabase`, `CKRecord`, `CKAsset`, `CKSubscription`, `CKQuery`
- No third-party SPM packages

**Entitlements Required:**
- `com.apple.developer.game-center` -- Game Center capability
- `com.apple.developer.icloud-container-identifiers` -- CloudKit container (`iCloud.com.iconquer`)
- `com.apple.developer.icloud-services` -- CloudKit service
- `com.apple.security.application-groups` -- App Group for shared save directory (`group.com.iconquer.saves`)

**Ordering dependency:** The SwiftUI Port (Phase 2) must be complete before Phase 3 begins. `GameViewModel`, `SetupViewModel`, and `PlayerConfig` must exist. `MapDefinition` must gain `Codable` conformance before `SaveGame` can be implemented.

---

## 8. Test Strategy

**Test Categories:**

| Category | Tests |
|----------|-------|
| **SaveGame encoding** | Round-trip: encode a SaveGame to JSON, decode it back, assert equality. Verify all fields survive the round-trip including optional thumbnailData. |
| **SaveGame schema versioning** | Encode with version 1, manually mutate the JSON to simulate a future version 2, verify the decoder either migrates or throws `schemaMigrationFailed`. |
| **SaveManager CRUD** | Save a game, load it by ID, verify content matches. List saves returns correct count. Delete a save, verify load throws `notFound`. |
| **SaveManager auto-save pruning** | Create `maxAutoSaveSlots + 2` auto-saves, call `pruneAutoSaves()`, verify only `maxAutoSaveSlots` remain and the newest are kept. |
| **CloudSaveManager conflict resolution** | Two saves with same ID, local `lastSavedAt` older than remote: verify local is overwritten. Two saves with divergent timestamps beyond tolerance: verify `conflictHandler` is invoked. |
| **CloudSaveManager silent merge** | Two saves with timestamps within tolerance: verify latest-writer-wins without invoking `conflictHandler`. |
| **GameCenterManager auth guard** | When `isAuthenticated` is false, `submitScore` and `reportAchievement` are no-ops (do not throw). |
| **Achievement evaluation** | Given a snapshot where the player controls all of South America, verify `continentCollector` is reported. Given a snapshot with `winnerId` set, verify `firstVictory` is reported. |
| **Leaderboard score formatting** | Verify `fastestVictory` scores are submitted as turn count integers. Verify `gamesWon` increments by 1 per win. |
| **TurnBasedMatchData round-trip** | Encode match data, decode it, assert all fields match including `participantMapping` and `turnHistory`. |
| **TurnBasedMatchManager turn flow** | Submit a turn, verify match data contains the updated SaveGame. Verify `nextParticipant` is set correctly. |
| **MapDefinition Codable** | Round-trip encode/decode of a MapDefinition with countries and continents, assert equality. |
| **Edge cases** | Empty save list returns `[]`. Save with nil `thumbnailData` round-trips correctly. Delete nonexistent save throws `notFound`. CloudKit unavailable (no iCloud account) produces `cloudAccountUnavailable`. |

**Reference Truth:**
- SaveGame round-trip: the source of truth is the in-memory `SaveGame` struct. Encoding and decoding must produce `==` equality.
- Achievement conditions: derived from the achievement definitions in `AchievementDefinitions`. A player controlling all countries in a continent (as defined by `MapDefinition.continents`) unlocks `continentCollector`.
- Leaderboard scores: `gamesWon` is a monotonically increasing integer (total wins). `fastestVictory` is the `snapshot.turnNumber` at the time `winnerId` is set (lower is better). `highestElo` is computed by a standard Elo formula with K-factor 32 (see validation trace).

**Validation Trace (REQUIRED):**

1. **SaveGame round-trip:**
   - Create a `SaveGame` with `turnNumber: 15`, `playerCount: 3`, `displayName: "Test Save"`, `isCompleted: false`.
   - Encode to JSON via `JSONEncoder()`.
   - Decode via `JSONDecoder()`.
   - Assert decoded `metadata.turnNumber == 15`, `metadata.playerCount == 3`, `metadata.displayName == "Test Save"`.

2. **Achievement evaluation -- continent control:**
   - Load the standard world map. South America has 4 countries: Venezuela, Peru, Brazil, Argentina.
   - Create a snapshot where player "p1" owns all 4 South American countries.
   - Call `evaluateAchievements(snapshot:playerId:)` with "p1".
   - Assert `continentCollector` is reported with `percentComplete == 100.0`.

3. **Elo calculation (for `highestElo` leaderboard):**
   - Player A (Elo 1200) beats Player B (Elo 1400).
   - Expected score for A: `1 / (1 + pow(10, (1400 - 1200) / 400))` = `1 / (1 + 10^0.5)` = `1 / 4.162` = 0.2402.
   - New Elo for A: `1200 + 32 * (1 - 0.2402)` = `1200 + 24.31` = **1224** (rounded to integer).
   - This value becomes the golden-path test assertion.

4. **Auto-save pruning:**
   - Config: `maxAutoSaveSlots = 3`.
   - Create 5 auto-saves with timestamps T1 < T2 < T3 < T4 < T5.
   - Call `pruneAutoSaves()`.
   - Assert exactly 3 saves remain: T3, T4, T5.

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [ ] Does this supersede an existing ADR? No
- [ ] Does this amend an existing ADR? No
- [x] New ADR required? Yes -- two drafts below

**New ADR Draft 1:**

```yaml
id: ADR-004
date: 2026-04-23
status: proposed
category: storage
title: "Actor-based SaveManager with App Group container for local persistence"
context: |
  The app needs to persist in-progress games to disk. Options considered:
  (a) SwiftData/Core Data for structured storage, (b) raw JSON files in
  the documents directory, (c) JSON files in an App Group container via
  an actor, (d) UserDefaults.
decision: |
  Use an actor (SaveManager) that reads/writes JSON files to the App Group
  container. Each SaveGame is a single JSON file named by its UUID. The actor
  serialises all file system access, preventing data races from concurrent
  auto-save and manual save operations.
rationale: |
  - JSON files are directly inspectable for debugging and migration
  - App Group container enables future sharing with widgets or extensions
  - Actor isolation provides compile-time thread safety under Swift 6
  - No ORM overhead for a simple key-value persistence pattern
  - SaveGame is already fully Codable, so JSON serialisation is zero-cost
consequences: |
  + Simple implementation with no framework dependencies beyond Foundation
  + Files are human-readable and version-controllable during development
  + Actor isolation prevents all data races at compile time
  - No query capability (must load all metadata to list saves)
  - No automatic migration framework (must hand-roll schema versioning)
  - File I/O is blocking within the actor; mitigated by small file sizes
alternatives_rejected:
  - "SwiftData/Core Data: over-engineered for a flat list of saves, adds framework coupling"
  - "UserDefaults: not designed for large data, no file-level management"
  - "Raw files without actor: data race risk from concurrent auto-save and manual save"
affected_files:
  - App/iconquer/Persistence/SaveManager.swift
  - App/iconquer/Model/SaveGame.swift
supersedes: null
amends: null
superseded_by: null
```

**New ADR Draft 2:**

```yaml
id: ADR-005
date: 2026-04-23
status: proposed
category: architecture
title: "GKTurnBasedMatch for async multiplayer with SaveGame as match data"
context: |
  The app needs async multiplayer where players take turns at their leisure.
  Options considered: (a) custom server with WebSockets, (b) Game Center
  turn-based matches, (c) CloudKit-based custom multiplayer, (d) third-party
  service (Firebase, PlayFab).
decision: |
  Use Game Center's GKTurnBasedMatch system. The full SaveGame is serialised
  as the match data payload, exchanged between participants when turns are
  submitted. A TurnBasedMatchManager actor manages the match lifecycle and
  delegates state changes to GameViewModel.
rationale: |
  - Zero server infrastructure cost -- Apple hosts the match relay
  - Native integration with the Apple ecosystem (notifications, invitations)
  - SaveGame is already Codable and contains the full game state
  - Turn-based matches are the natural fit for a Risk-style strategy game
  - GKTurnBasedMatch supports 2-16 participants, matching the game's 2-6 players
  - Push notifications for turn reminders are handled by the system
consequences: |
  + No server to build, deploy, or maintain
  + Players get push notifications when it is their turn
  + Match history and player stats are managed by Game Center
  + Cross-platform (iOS, iPadOS, macOS) multiplayer with no extra work
  - Limited to Apple platforms (no Android or web players)
  - Match data size limit of 256 KB per turn (SaveGame JSON is ~10-50 KB, well within)
  - Apple controls the matchmaking UX (GKTurnBasedMatchmakerViewController)
  - Requires Game Center entitlement and App Store Connect configuration
alternatives_rejected:
  - "Custom WebSocket server: significant infrastructure cost for a small indie game"
  - "CloudKit custom multiplayer: no built-in matchmaking, notifications, or player identity"
  - "Third-party (Firebase): adds external dependency, vendor lock-in, and recurring cost"
affected_files:
  - App/iconquer/GameCenter/TurnBasedMatchManager.swift
  - App/iconquer/GameCenter/TurnBasedMatchData.swift
  - App/iconquer/ViewModels/GameViewModel.swift
supersedes: null
amends: null
superseded_by: null
```

---

## 10. Open Questions

1. **Should Elo ratings be computed locally or server-side?** Local computation is simpler but vulnerable to tampering. Server-side requires a custom backend that contradicts the zero-infrastructure goal. **Proposed answer:** Compute locally and submit to the leaderboard. Accept that determined cheaters could submit fake scores -- Game Center has its own anti-fraud measures, and this is a casual game, not a competitive esport.

2. **Should completed games be synced to iCloud, or only in-progress games?** Completed games are needed for achievement progress and win streak tracking across devices. **Proposed answer:** Sync both. Completed saves are marked with `isCompleted: true` and can be filtered in the save list UI but remain in CloudKit for stats reconstruction.

3. **How should the app handle the 256 KB GKTurnBasedMatch data limit?** A typical SaveGame JSON with a 42-country world map is ~10-50 KB. With thumbnail data, it could approach the limit. **Proposed answer:** Exclude `thumbnailData` from the `TurnBasedMatchData` encoding. Thumbnails are regenerated locally when loading a match. Add a size check before turn submission that throws a descriptive error if the payload exceeds 200 KB.

4. **Should the app support resuming a match started on a different device mid-turn?** For example, a player starts their turn on iPhone and wants to finish it on iPad. **Proposed answer:** Not in Phase 3. Each turn is atomic -- the player completes their full turn on one device and submits it. Mid-turn handoff would require a separate real-time sync mechanism.

5. **What happens when a turn-based match player uninstalls the app?** **Proposed answer:** Game Center handles this via match timeouts. After `turnTimeoutSeconds` (24 hours), the absent player is skipped or the match can be forfeited. The `TurnBasedMatchManager` checks for timed-out participants when loading active matches.

6. **Should `MapDefinition` gain `Codable` in IconquerCore, or should SaveGame wrap it differently?** **Proposed answer:** Add `Codable` to `MapDefinition` directly. All its stored properties are already `Codable`. The synthesised conformance requires zero manual code. This is a non-breaking additive change.

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (SaveManager, CloudSaveManager, GameCenterManager, TurnBasedMatchManager, SaveGame, TurnBasedMatchData, LeaderboardDefinitions, AchievementDefinitions)
- Does explanation require 50+ lines? Yes (persistence lifecycle, cloud sync conflict resolution, Game Center auth flow, turn-based match lifecycle, achievement evaluation)
- Does it need theory/background context? Yes (CloudKit record design, GKTurnBasedMatch protocol, Elo rating formula, conflict resolution strategies)

**Article Name:** `GameCenterAndPersistenceGuide.md`
(Placed in a `.docc` catalog. Must NOT match any Swift symbol name.)

**Article Outline:**
1. Overview -- what Phase 3 adds and the dependency chain (local save -> iCloud sync -> Game Center)
2. Local persistence -- SaveManager actor, file layout, auto-save lifecycle, schema versioning
3. iCloud sync -- CloudSaveManager, CKRecord design, conflict resolution flow, change subscriptions
4. Game Center authentication -- GameCenterManager, auth flow, graceful degradation when unsigned
5. Leaderboards -- score submission, Elo calculation, leaderboard UI
6. Achievements -- definition structure, evaluation triggers, incremental vs one-shot progress
7. Turn-based multiplayer -- TurnBasedMatchManager, match lifecycle diagram, turn submission flow
8. Match data design -- TurnBasedMatchData, participant mapping, size budget
9. Testing -- mock strategies for GameKit and CloudKit, deterministic achievement evaluation
