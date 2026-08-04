# Design Proposal: Phase 3+ Online Multiplayer

**Date:** 2026-04-23
**Status:** Proposed
**Scope:** New `IconquerServer` package + `IconquerClient` library + modifications to `IconquerGameKit` and `IconquerCLI`
**Phase:** Phase 3+

---

## 1. Objective

Add real-time online multiplayer so 2-6 human players (and AI fill-ins) can play iConquer over the network. The server owns the authoritative `Game` engine instance; clients submit `GameMove` values and receive `GameSnapshot` broadcasts. No game logic runs on the client.

**Problems solved:**
1. **No remote human-vs-human play.** Hot-seat works in the TUI, but players must share a single device.
2. **No lobby/matchmaking.** There is no way to discover or join games.
3. **No spectator support.** Tournament matches and streamed games cannot be observed live.
4. **No reconnection.** A client that drops its connection loses all game context.

**Master Plan Reference:** Phase 3+ online multiplayer. The Phase 2 architecture (server-authoritative `GameSession` actor in `IconquerMCP`, per-player token auth in `PlayerIdentityStore`, `GameSnapshot` Codable+Sendable, deterministic `SnapshotHash`) was designed to enable this without engine changes.

---

## 2. Proposed Architecture

### Module Layout

```
~/Dropbox/.../Swift/
├── IconquerServer/                    # NEW — authoritative game server
│   ├── Package.swift
│   ├── Sources/IconquerServer/
│   │   ├── Lobby/
│   │   │   ├── LobbyManager.swift         # Actor: room CRUD, matchmaking
│   │   │   ├── GameRoom.swift             # Actor: one running game + its connections
│   │   │   ├── RoomConfiguration.swift    # Settings, map, player slots, timers
│   │   │   └── Matchmaker.swift           # Elo-band or random pairing
│   │   ├── Transport/
│   │   │   ├── WebSocketServer.swift      # NIO-based WS listener
│   │   │   ├── ClientConnection.swift     # Per-client WS wrapper
│   │   │   └── ServerMessage.swift        # Envelope types (see section 3)
│   │   ├── Auth/
│   │   │   ├── TokenAuthenticator.swift   # JWT or opaque-token validation
│   │   │   └── SessionToken.swift         # Token value type
│   │   ├── TurnTimer/
│   │   │   └── TurnTimer.swift            # Per-seat countdown actor
│   │   └── IconquerServer.swift           # Top-level entry, version constant
│   ├── Sources/iconquer-server/           # CLI executable
│   │   └── ServerCommand.swift
│   └── Tests/IconquerServerTests/
│
├── IconquerClient/                    # NEW — client networking library
│   ├── Package.swift
│   ├── Sources/IconquerClient/
│   │   ├── RemoteGameSession.swift        # Actor: WS connection + state sync
│   │   ├── ConnectionState.swift          # Enum: connecting/connected/reconnecting/disconnected
│   │   ├── ClientMessage.swift            # Outbound envelope types
│   │   └── IconquerClient.swift
│   └── Tests/IconquerClientTests/
│
├── IconquerGameKit/                   # MODIFIED — add remote game mode
│   └── Sources/IconquerGameKit/
│       └── GameViewModel.swift            # Modified: pluggable local vs remote session
│
├── IconquerCLI/                       # MODIFIED — add online play mode
│   └── Sources/IconquerCLILib/
│       ├── OnlinePlayRunner.swift         # Remote game event loop for TUI
│       └── IconquerCLICommand.swift       # New --online flag / connect subcommand
│
├── IconquerCore/                      # UNCHANGED — pure rules
├── IconquerMatch/                     # REUSED — MatchRunner drives server-side game
├── IconquerAI/                        # REUSED — AI agents fill empty seats server-side
└── IconquerMCP/                       # UNCHANGED — separate concern (LLM tool interface)
```

### Why a Separate Server (Not Extending IconquerMCP)

`IconquerMCP` speaks the Model Context Protocol — a tool-call/resource-read protocol designed for LLM consumption. Online multiplayer needs:
- Persistent WebSocket connections with push-based state broadcasts
- Lobby lifecycle (create, list, join, leave rooms)
- Spectator channels (read-only snapshot streams)
- Turn timers with server-enforced deadlines
- Reconnection with full state recovery

MCP's request/response model doesn't support server-push or connection-oriented sessions. The existing `GameSession` actor and `PlayerIdentityStore` actor from `IconquerMCP` will be **extracted into a shared `IconquerSession` module** (or copy-forked into `IconquerServer`) so both servers reuse the same authoritative game state wrapper without depending on MCP transport.

### Dependency Graph

```
IconquerServer  ──► IconquerMatch  ──► IconquerCore
      │                                     ▲
      ├──► IconquerAI  ────────────────────┘
      │
      └──► swift-nio, swift-nio-extras (WebSocket server)

IconquerClient  ──► IconquerCore  (for GameSnapshot, GameMove, PlayerId types)
      │
      └──► swift-nio (WebSocket client — single transport for all platforms)

IconquerGameKit ──► IconquerClient  (new dependency for remote mode)
      │
      └──► IconquerCore, IconquerMatch, IconquerAI  (existing)

IconquerCLI     ──► IconquerClient  (new dependency for online play)
      │
      └──► IconquerCore, IconquerMatch, IconquerAI  (existing)
```

### Transport Decision: SwiftNIO Everywhere

`IconquerClient` uses **swift-nio** for WebSocket transport on all platforms (macOS, iOS, Linux). This is preferred over `URLSessionWebSocketTask` because:

1. **Single codebase.** One WebSocket implementation to maintain, test, and debug — no `#if canImport` branching.
2. **Linux support.** The CLI runs on Linux (roseclub.org). `URLSessionWebSocketTask` is unavailable there.
3. **Apple-maintained.** SwiftNIO is an Apple open-source project with long-term support.
4. **Consistent behavior.** Avoids subtle differences between URLSession and NIO WebSocket handling (frame sizes, ping/pong, close handshake).
5. **Shared with server.** Both `IconquerServer` and `IconquerClient` use the same NIO dependency, reducing total dependency count.

The one trade-off is that SwiftNIO adds a dependency to the iOS app (via `IconquerClient` → `IconquerGameKit`). SwiftNIO supports iOS and has a small binary footprint (~2 MB), so this is acceptable.

---

## 3. API Surface

### 3.1 Wire Protocol (WebSocket JSON Messages)

All messages are JSON-encoded envelopes with a `type` discriminator. The client and server each have a closed set of message types.

#### Client-to-Server Messages

```swift
/// Messages the client sends to the server over WebSocket.
public enum ClientMessage: Sendable, Codable {
    /// Authenticate with a session token. Must be the first message after connect.
    case authenticate(token: String)

    /// Request list of available rooms.
    case listRooms

    /// Create a new game room.
    case createRoom(config: RoomConfiguration)

    /// Join an existing room.
    case joinRoom(roomId: String, seat: SeatPreference)

    /// Leave the current room (voluntarily).
    case leaveRoom

    /// Submit a move for the current turn.
    case submitMove(move: GameMove, stateHash: String)

    /// Request full state resync (after reconnection).
    case requestResync

    /// Chat message to the room.
    case chat(text: String)

    /// Heartbeat/ping (keepalive).
    case ping(timestamp: UInt64)
}

/// Seat preference when joining a room.
public enum SeatPreference: Sendable, Codable {
    /// Take any open seat.
    case any
    /// Request a specific seat (if available).
    case specific(PlayerId)
    /// Join as a spectator (read-only).
    case spectator
}
```

#### Server-to-Client Messages

```swift
/// Messages the server sends to connected clients.
public enum ServerMessage: Sendable, Codable {
    /// Authentication result.
    case authenticated(playerId: PlayerId, displayName: String)
    case authenticationFailed(reason: String)

    /// Room list response.
    case roomList(rooms: [RoomSummary])

    /// Room lifecycle events.
    case roomCreated(roomId: String)
    case joinedRoom(roomId: String, seat: PlayerId, snapshot: GameSnapshot)
    case playerJoined(seat: PlayerId, name: String)
    case playerLeft(seat: PlayerId, reason: LeaveReason)
    case roomClosed(reason: String)

    /// Game state updates (the core of online play).
    case gameStarted(snapshot: GameSnapshot, yourSeat: PlayerId)
    case stateUpdate(snapshot: GameSnapshot, lastMove: MoveRecord?, stateHash: String)
    case moveRejected(reason: String, currentStateHash: String)
    case gameOver(winnerId: PlayerId, finalSnapshot: GameSnapshot)

    /// Turn timer.
    case turnTimerStarted(seat: PlayerId, deadlineUnixMs: UInt64)
    case turnTimerExpired(seat: PlayerId, fallbackMove: GameMove)

    /// Reconnection.
    case resyncState(snapshot: GameSnapshot, stateHash: String, yourSeat: PlayerId)

    /// Chat relay.
    case chatMessage(from: PlayerId, text: String)

    /// Heartbeat response.
    case pong(timestamp: UInt64)

    /// Server-side error.
    case error(code: ErrorCode, message: String)
}
```

#### Supporting Types

```swift
/// Summary of a room visible in the lobby.
public struct RoomSummary: Sendable, Codable {
    public let roomId: String
    public let hostName: String
    public let mapName: String
    public let playerCount: Int
    public let maxPlayers: Int
    public let spectatorCount: Int
    public let status: RoomStatus    // .waiting, .inProgress, .finished
    public let variant: GameVariant
}

/// Why a player left.
public enum LeaveReason: Sendable, Codable {
    case voluntary
    case disconnected
    case kicked
    case turnTimerForfeited
}

/// Server error codes for programmatic handling.
public enum ErrorCode: String, Sendable, Codable {
    case notAuthenticated
    case roomNotFound
    case roomFull
    case notYourTurn
    case illegalMove
    case staleState
    case alreadyInRoom
    case serverError
}
```

### 3.2 RoomConfiguration

```swift
/// Configuration for creating a new game room.
public struct RoomConfiguration: Sendable, Codable {
    /// The map to play on. Encoded as a map identifier string; the server
    /// resolves it against its map library.
    public var mapId: String

    /// Game rules variant.
    public var variant: GameVariant

    /// Maximum number of human player seats.
    public var maxPlayers: Int

    /// Number of AI seats to fill (added by server after humans join).
    public var aiPlayerCount: Int

    /// AI difficulty for fill-in seats.
    public var aiDifficulty: AIDifficulty

    /// Per-turn time limit. `nil` means unlimited.
    public var turnTimerSeconds: UInt?

    /// What happens when a player's turn timer expires.
    public var turnTimerPolicy: TurnTimerPolicy

    /// Allow spectators to watch.
    public var allowSpectators: Bool

    /// Whether the room is listed publicly or join-by-code only.
    public var isPublic: Bool

    /// RNG seed. `nil` = server picks randomly.
    public var seed: UInt32?

    /// Game settings overrides (card mode, fortify mode, etc.).
    public var settings: Settings
}

public enum AIDifficulty: String, Sendable, Codable {
    case random
    case greedy
    case strategic
}

public enum TurnTimerPolicy: Sendable, Codable {
    /// Skip the player's turn (apply finishTurn or equivalent).
    case forfeitTurn
    /// Play a random legal move.
    case randomMove
    /// Disconnect the player and replace with AI.
    case replaceWithAI
}
```

### 3.3 Server-Side Actors

```swift
/// Manages all game rooms and matchmaking.
public actor LobbyManager {
    /// Create a new room. Returns the room ID.
    public func createRoom(
        config: RoomConfiguration,
        host: PlayerId
    ) throws -> String

    /// List rooms matching a filter.
    public func listRooms(
        filter: RoomFilter
    ) -> [RoomSummary]

    /// Join a room. Returns the assigned seat.
    public func joinRoom(
        roomId: String,
        player: PlayerId,
        preference: SeatPreference
    ) throws -> PlayerId

    /// Remove a player from their room.
    public func leaveRoom(player: PlayerId) throws

    /// Quick-match: find or create a room matching preferences.
    public func quickMatch(
        player: PlayerId,
        preferences: MatchPreferences
    ) async throws -> (roomId: String, seat: PlayerId)
}

/// One game room. Wraps a GameSession with connection management.
public actor GameRoom {
    /// The authoritative game session.
    private let session: GameSession

    /// Connected players and their WebSocket connections.
    private var connections: [PlayerId: ClientConnection]

    /// Spectator connections (read-only).
    private var spectators: [ClientConnection]

    /// Turn timer for the active player.
    private var turnTimer: TurnTimer?

    /// Submit a move from a connected player.
    public func submitMove(
        from seat: PlayerId,
        move: GameMove,
        expectedStateHash: String
    ) async throws

    /// Broadcast a snapshot to all connected clients and spectators.
    private func broadcastState(
        snapshot: GameSnapshot,
        lastMove: MoveRecord?
    ) async

    /// Handle a player reconnecting.
    public func reconnect(
        player: PlayerId,
        connection: ClientConnection
    ) async

    /// Replace a disconnected human with an AI agent.
    private func replaceWithAI(seat: PlayerId) async
}
```

### 3.4 Client-Side Actor

```swift
/// Client-side representation of a remote game session.
///
/// Manages the WebSocket connection lifecycle, sends moves, and
/// provides an observable state stream for the UI layer.
public actor RemoteGameSession {
    /// Current connection state.
    public private(set) var connectionState: ConnectionState

    /// The latest game snapshot from the server.
    public private(set) var latestSnapshot: GameSnapshot?

    /// The seat this client is playing as.
    public private(set) var assignedSeat: PlayerId?

    /// Connect to a game server.
    public func connect(
        url: URL,
        token: String
    ) async throws

    /// Submit a move to the server.
    public func submitMove(
        _ move: GameMove,
        stateHash: String
    ) async throws

    /// Request a full state resync.
    public func requestResync() async throws

    /// Disconnect cleanly.
    public func disconnect() async

    /// Stream of server messages for the UI to observe.
    public func messageStream() -> AsyncStream<ServerMessage>
}

public enum ConnectionState: Sendable {
    case disconnected
    case connecting
    case authenticating
    case connected
    case reconnecting(attempt: Int, maxAttempts: Int)
    case failed(reason: String)
}
```

### 3.5 GameViewModel Modifications

```swift
// In IconquerGameKit/GameViewModel.swift — new protocol + remote adapter

/// Abstraction over local and remote game sessions.
public protocol GameSessionProvider: Sendable {
    /// The current game snapshot.
    func snapshot() async -> GameSnapshot
    /// Legal moves for the given seat.
    func legalMoves(for seat: PlayerId) async -> [GameMove]
    /// Submit a move.
    func submitMove(_ move: GameMove, by seat: PlayerId) async throws
    /// Stream of state updates.
    func stateUpdates() -> AsyncStream<GameSnapshot>
}

/// Local session provider (existing behavior, wrapped).
public final class LocalGameSession: GameSessionProvider { ... }

/// Remote session provider (delegates to RemoteGameSession).
public final class RemoteGameSessionProvider: GameSessionProvider {
    private let remote: RemoteGameSession
    ...
}
```

`GameViewModel` will accept a `GameSessionProvider` instead of directly owning a `Game` value. The existing local-play path becomes `LocalGameSession`; online play uses `RemoteGameSessionProvider`. The UI code (SwiftUI views) does not change.

### 3.6 CLI Client Integration (IconquerCLI)

The TUI gets online play via the same `IconquerClient` library. The CLI event loop adapts from blocking `readKey()` to an async model that interleaves local keyboard input with remote server messages.

#### New subcommand: `play --online`

```
iconquer-cli play --online ws://play.roseclub.org:8765 --token my-api-key
iconquer-cli play --online ws://localhost:8765 --token dev-token-1
```

Or a dedicated `connect` subcommand with lobby features:

```
iconquer-cli connect ws://play.roseclub.org:8765 --token my-api-key
  > list                          # list available rooms
  > join abc123                   # join a room
  > create --map world --players 4 --timer 60
  > spectate abc123               # watch a game
```

#### OnlinePlayRunner

```swift
/// Drives an online game session in the TUI.
///
/// Bridges the `RemoteGameSession` (async server messages) with the
/// `GameApp` event loop (keyboard input + rendering). Replaces the local
/// `Game` engine with server-authoritative state.
public struct OnlinePlayRunner {
    private let remote: RemoteGameSession
    private let renderer: Renderer

    /// Connect to a server, join or create a room, and run the game loop.
    public func run(
        serverURL: URL,
        token: String,
        roomId: String?,
        backend: any TerminalBackend
    ) async throws -> PlayOutcome
}
```

#### Event Loop Adaptation

The existing `GameApp.run()` blocks on `io.readKey()`. For online play, the loop must handle two concurrent input sources:

1. **Keyboard** — local player's moves (when it's their turn)
2. **Server messages** — state updates, turn changes, timer events, chat

The online event loop uses a `TaskGroup` to race keyboard input against server messages:

```swift
// Simplified online event loop
while true {
    // Race: keyboard input vs server message
    let event = await withTaskGroup(of: OnlineEvent.self) { group in
        group.addTask { .key(backend.readKey()) }
        group.addTask { .server(await remote.nextMessage()) }
        return await group.next()!
    }

    switch event {
    case .key(let key):
        // Process keyboard input (only if it's our turn)
        guard remote.isMyTurn else {
            statusMessage = "Waiting for opponent..."
            continue
        }
        let move = mapKeyToMove(key, snapshot: remote.latestSnapshot)
        if let move {
            try await remote.submitMove(move, stateHash: currentHash)
        }

    case .server(let message):
        switch message {
        case .stateUpdate(let snapshot, _, let hash):
            currentSnapshot = snapshot
            currentHash = hash
            renderFrame()
        case .moveRejected(let reason, _):
            statusMessage = reason
        case .gameOver(let winner, _):
            showVictory(winner)
            break
        // ... other server messages
        }
    }
}
```

#### What Changes in IconquerCLI

| File | Change |
|------|--------|
| `Package.swift` | Add `IconquerClient` dependency |
| `OnlinePlayRunner.swift` | **New** — remote game event loop for TUI |
| `IconquerCLICommand.swift` | Add `--online <url>` flag to `play` and/or new `connect` subcommand |
| `GameApp.swift` | No change — `OnlinePlayRunner` is a parallel path, not a modification |

The existing local `GameApp.run()` is untouched. Online play is a separate code path that reuses the same `Renderer`, `GameTheme`, and `CellBuffer` infrastructure but drives the game from server state instead of a local `Game` instance.

#### CLI-Specific Features

- **Lobby browser** — `list` command shows available rooms in a formatted table
- **Room creation** — `create` with CLI flags maps to `RoomConfiguration`
- **Spectator mode** — read-only rendering of a remote game (no keyboard input for moves)
- **Chat** — optional inline chat displayed in the status bar or a dedicated panel
- **Connection status** — status bar shows connection state, latency, and reconnection attempts

---

## 4. MCP Schema

The online multiplayer server does **not** expose an MCP interface. MCP remains the protocol for LLM tool access via `IconquerMCP`. However, the server can host AI agents that internally use MCP to talk to LLMs, and the `GameRoom` actor can bind an `MCPMultiTurnAgent` to a seat just like `MatchRunner` does today.

If future LLM players need to join online games, a bridge adapter (`MCPOnlineAgent`) would translate between the MCP tool-call pattern and the WebSocket `submitMove` protocol. This is explicitly deferred to a later proposal.

---

## 5. Constraints & Compliance

**Concurrency:**
- All server-side state lives in actors (`LobbyManager`, `GameRoom`, `TurnTimer`). No shared mutable state.
- `ClientConnection` wraps a NIO `WebSocket` channel with actor isolation.
- All wire types (`ClientMessage`, `ServerMessage`, `RoomSummary`, etc.) are `Sendable` value types.

**Determinism:**
- The `Game` engine runs on the server with a seeded RNG. Clients never run game logic.
- State hashes (`SnapshotHash`) validate client-server agreement on every move.

**Safety:**
- No force unwraps. All WebSocket message parsing uses `try?` with error responses.
- Division safety: turn timer math guards against zero.
- Guard clauses for all validation (room exists, seat available, player authenticated).

**Linux deployment:**
- `IconquerServer` depends only on SwiftNIO (no Foundation networking, no Apple frameworks).
- CPU-only path; no Metal/Accelerate dependencies.
- Tested on Swift 6.0.x (roseclub.org toolchain) and Swift 6.3 (local).

**Existing patterns preserved:**
- `GameSession` actor pattern from `IconquerMCP` is reused directly.
- `PlayerAgent` protocol from `IconquerMatch` is used for AI fill-in seats.
- `SeatBinding` and `MatchRunner` drive server-side game progression for AI turns.

---

## 6. Backend Abstraction (If Compute-Intensive)

Not compute-intensive. The server runs `IconquerCore.Game` (pure value-type mutations) and broadcasts JSON snapshots. No GPU or Accelerate paths needed.

**Linux deployment note:** SwiftNIO is the only platform dependency. The server binary cross-compiles for Linux via `swift build --triple x86_64-unknown-linux-gnu` or builds natively on the target host.

---

## 7. Dependencies

**Internal Dependencies:**
- `IconquerCore` — `Game`, `GameSnapshot`, `GameMove`, `Settings`, `PlayerId`, `MapDefinition`
- `IconquerMatch` — `MatchRunner`, `PlayerAgent`, `SeatBinding`, `MoveRecord`
- `IconquerAI` — `RandomAgent`, `GreedyAgent`, `StrategicAgent` (for AI fill-in seats)

**New External Dependencies:**
- `swift-nio` (2.x) — WebSocket server and event loop
- `swift-nio-extras` — WebSocket frame handling
- `swift-nio-ssl` (optional) — TLS termination for production deployment

**Client-side (IconquerClient):**
- `swift-nio` WebSocket client on all platforms (macOS, iOS, Linux). See "Transport Decision: SwiftNIO Everywhere" in section 2.

**Explicitly NOT adding:**
- No Vapor or Hummingbird. The server is a thin WebSocket relay over game state; a full web framework is unnecessary overhead.
- No database. Room state is in-memory; persistence (if needed later) will use JSON files like `IconquerTournament`.
- No Game Center. See "Alternatives Rejected" in section 9.

---

## 8. Test Strategy

**Test Categories:**

| Category | What | Where |
|----------|------|-------|
| Unit: wire protocol | Encode/decode round-trip for every `ClientMessage` and `ServerMessage` variant | `IconquerServerTests`, `IconquerClientTests` |
| Unit: lobby | Create, join, leave, list rooms; capacity limits; duplicate join rejection | `IconquerServerTests` |
| Unit: game room | Move submission, validation, broadcast, turn timer expiry, AI replacement | `IconquerServerTests` |
| Unit: reconnection | Disconnect mid-turn, reconnect, receive full resync, resume play | `IconquerServerTests` |
| Unit: turn timer | Timer fires after configured duration; timer resets on valid move; timer cancels on game end | `IconquerServerTests` |
| Integration: local loopback | Full game played over in-process WebSocket (no network) using `EmbeddedChannel` | `IconquerServerTests` |
| Integration: client-server | Two `RemoteGameSession` clients play a full game against a real `IconquerServer` on localhost | `IconquerClientTests` |
| Integration: GameViewModel remote | `GameViewModel` with `RemoteGameSessionProvider` receives moves and updates snapshot | `IconquerGameKitTests` |
| Integration: CLI online | `OnlinePlayRunner` connects to localhost server, submits moves, receives state updates, renders frames | `IconquerCLITests` |
| Anti-cheat | Client submits illegal move; client submits out-of-turn; client submits with stale hash — all rejected with correct error code | `IconquerServerTests` |
| Stress | 6-player game with 1000+ moves; 50 concurrent rooms; rapid connect/disconnect cycles | `IconquerServerTests` (long-running, `@Tag(.performance)`) |

**Reference Truth:**
- Game logic correctness is verified by `IconquerCoreTests` parity fixtures (TypeScript oracle). The server never modifies game logic.
- Wire protocol correctness: round-trip encode/decode assertions. Each `ClientMessage` variant has a golden JSON fixture.
- State sync correctness: after every move, `snapshot.hash()` on client must equal `stateHash` from the server's `stateUpdate` message.

**Validation Trace:**
- Player A creates room, Player B joins. Server assigns seats P1 and P2.
- Server broadcasts `gameStarted` with initial snapshot. Both clients have identical `snapshot.hash()`.
- Player A (P1) submits `.pickCountry(CountryId("Alaska"))`. Server validates via `Game.isLegal`, applies, broadcasts `stateUpdate`.
- Player B submits the same move (out of turn). Server responds with `moveRejected(reason: "notYourTurn")`.
- Player B submits a legal move. Server applies, broadcasts. Both clients have matching hashes.
- This trace becomes the golden-path integration test.

---

## 9. Architecture Decision Review

**ADR Check:**
- [x] Reviewed `architecture_decisions.md` for related decisions
- [ ] Does this supersede an existing ADR? No
- [ ] Does this amend an existing ADR? No
- [x] New ADR required? Yes -- draft below

**New ADR Draft:**

```yaml
id: ADR-TBD
date: 2026-04-23
status: proposed
category: architecture
title: Server-authoritative WebSocket multiplayer over Game Center
context: |
  Online multiplayer requires choosing between (a) server-authoritative model with
  custom WebSocket protocol, (b) Apple Game Center turn-based matches, or
  (c) peer-to-peer with host migration. The game is turn-based with full state
  snapshots that are Codable and hashable. The server (roseclub.org) runs Linux.
decision: |
  Use server-authoritative architecture with WebSocket transport via SwiftNIO.
  The server owns the single Game instance, validates all moves, and broadcasts
  snapshots. Clients are thin input/display layers.
rationale: |
  - Server-authoritative is the only model that prevents cheating in a competitive game.
  - WebSocket provides real-time push without polling, unlike HTTP-based MCP.
  - SwiftNIO runs on Linux (roseclub.org deployment target); Game Center does not.
  - Game Center lock-in prevents Android/web clients in the future.
  - The existing GameSession actor is already server-authoritative; WebSocket is
    just a new transport for the same pattern.
  - Full snapshot broadcast (not deltas) keeps the protocol simple and makes
    reconnection trivial — just send the latest snapshot.
consequences: |
  Positive: Anti-cheat by construction. Linux-deployable. Protocol is cross-platform.
  Negative: Requires running and maintaining a server process. No App Store
  matchmaking integration. Snapshot broadcasts grow with map size (mitigated by
  gzip compression on the WebSocket frame level).
alternatives_rejected:
  - "Game Center turn-based: Apple-only, no Linux server, no spectators, no custom turn timers, limited to 16 players per match (fine for us but architecturally constraining), no control over matchmaking logic"
  - "Peer-to-peer with host migration: cheating is trivial (host runs the engine), host migration is complex, NAT traversal is unreliable"
  - "Extend IconquerMCP with WebSocket: MCP is a tool-call protocol for LLMs, not a real-time game protocol; adding push semantics would violate the MCP spec and confuse the LLM integration layer"
affected_files:
  - IconquerServer/ (new package)
  - IconquerClient/ (new package)
  - IconquerGameKit/Sources/IconquerGameKit/GameViewModel.swift
  - IconquerCLI/Sources/IconquerCLILib/OnlinePlayRunner.swift (new)
  - IconquerCLI/Sources/iconquer-cli/IconquerCLICommand.swift (new subcommand)
supersedes: null
amends: null
superseded_by: null
```

---

## 10. Open Questions

1. **Snapshot size.** A full world-map `GameSnapshot` is ~8-12 KB JSON. With 6 players and rapid moves, is full-snapshot broadcast acceptable, or should we implement delta compression? **Proposed answer:** start with full snapshots + gzip. Measure. Optimize only if bandwidth becomes a problem.

2. **Authentication system.** The proposal uses opaque tokens. Should we implement JWT with expiry, or simple API keys like `IconquerMCP`? **Proposed answer:** start with simple API keys (consistent with `PlayerIdentityStore`). Add JWT when user accounts exist.

3. **Spectator lag.** Should spectators receive real-time updates or a delayed feed (to prevent coaching)? **Proposed answer:** configurable per-room. Default: real-time for casual games, 2-turn delay for tournament games.

4. **Room persistence.** If the server restarts, are in-progress games lost? **Proposed answer:** yes, for v1. The `GameSnapshot` is fully serializable, so checkpointing to disk is a future enhancement, not a v1 requirement.

5. **Cross-platform client.** ~~`IconquerClient` uses `URLSessionWebSocketTask` on Apple. Should we also ship a SwiftNIO-based client for Linux CLI play?~~ **RESOLVED:** `IconquerClient` uses swift-nio exclusively on all platforms. Single transport, no platform branching. CLI integration is included in v1 scope.

6. **Shared `GameSession` extraction.** Should `GameSession` and `PlayerIdentityStore` be extracted from `IconquerMCP` into a shared `IconquerSession` module, or should `IconquerServer` copy-fork them? **Proposed answer:** extract into shared module to avoid drift. Both `IconquerMCP` and `IconquerServer` depend on `IconquerSession`.

---

## 11. Documentation Strategy

**Documentation Type:** Narrative Article Required

**Complexity Threshold Check:**
- Does it combine 3+ APIs? Yes (server, client, game view model)
- Does explanation require 50+ lines? Yes
- Does it need theory/background context? Yes (server-authoritative model, WebSocket lifecycle)

**Articles (in `.docc`):**
- `OnlineMultiplayerGuide.md` — End-to-end setup: running the server, connecting clients, playing a game
- `ServerDeploymentGuide.md` — Building for Linux, systemd unit, TLS, firewall

---

## Appendix A: State Sync Protocol Detail

### Full Snapshot Broadcast (v1)

After every `Game.apply(move)` on the server:

1. Server computes `snapshot = game.snapshot()` and `stateHash = snapshot.hash()`.
2. Server JSON-encodes `ServerMessage.stateUpdate(snapshot:lastMove:stateHash:)`.
3. Server sends the encoded message to all connected players and spectators.
4. Each client replaces its local `latestSnapshot` and verifies `stateHash` matches.

If a client's local hash diverges (should never happen with correct implementation), it sends `ClientMessage.requestResync` and the server responds with `ServerMessage.resyncState`.

### Why Not Deltas

Delta compression (sending only changed countries/players) saves bandwidth but adds significant complexity:
- The client must maintain a full snapshot and merge deltas.
- Missed deltas compound errors (requires sequence numbers, retransmission).
- Reconnection still needs a full snapshot anyway.
- `GameSnapshot` JSON is small enough (~8-12 KB) that gzip brings it under 2 KB per message.

Delta compression is a valid optimization for v2 if telemetry shows bandwidth is a bottleneck.

---

## Appendix B: Turn Timer Design

```swift
/// Server-side turn timer. One instance per active turn.
public actor TurnTimer {
    private let seat: PlayerId
    private let duration: Duration
    private var timerTask: Task<Void, Never>?

    public init(seat: PlayerId, duration: Duration) {
        self.seat = seat
        self.duration = duration
    }

    /// Start the countdown. Calls `onExpiry` if the timer fires
    /// before `cancel()` is called.
    public func start(onExpiry: @escaping @Sendable () async -> Void) {
        timerTask?.cancel()
        timerTask = Task {
            do {
                try await Task.sleep(for: duration)
                guard !Task.isCancelled else { return }
                await onExpiry()
            } catch {
                // Cancelled — no action needed.
            }
        }
    }

    /// Cancel the running timer (called when the player submits a move).
    public func cancel() {
        timerTask?.cancel()
        timerTask = nil
    }
}
```

The `GameRoom` creates a `TurnTimer` after every `stateUpdate` broadcast if the room configuration has a `turnTimerSeconds` value. On expiry, the room applies the configured `TurnTimerPolicy` (forfeit, random move, or replace with AI).

---

## Appendix C: Reconnection Flow

1. Client detects WebSocket close (network drop, app backgrounded).
2. Client enters `ConnectionState.reconnecting(attempt: 1, maxAttempts: 5)`.
3. Client reconnects with exponential backoff: 1s, 2s, 4s, 8s, 16s.
4. On successful WebSocket connect, client sends `ClientMessage.authenticate(token:)`.
5. Server validates token, finds the player's active room (if any).
6. If the player was mid-game, server sends `ServerMessage.resyncState(snapshot:stateHash:yourSeat:)`.
7. Client replaces its local snapshot and resumes normal play.
8. If the player's turn timer expired while disconnected, the server already applied the fallback policy. The resync snapshot reflects the post-fallback state.

The server keeps a disconnected player's seat reserved for a configurable grace period (default: 120 seconds). After the grace period, the seat is either replaced with AI or the player is eliminated (configurable via `RoomConfiguration`).

---

## Appendix D: Deployment on roseclub.org

```bash
# Build for Linux (on the server, Swift 6.0.x)
swift build -c release --product iconquer-server

# Run with systemd
# /etc/systemd/system/iconquer-server.service
[Unit]
Description=iConquer Online Multiplayer Server
After=network.target

[Service]
ExecStart=/opt/iconquer/iconquer-server --port 8765
Restart=always
User=iconquer
WorkingDirectory=/opt/iconquer
Environment=SWIFT_LOG_LEVEL=info

[Install]
WantedBy=multi-user.target

# Firewall
sudo ufw allow 8765/tcp

# TLS termination via nginx reverse proxy (recommended)
# nginx proxies wss://play.roseclub.org → ws://127.0.0.1:8765
```

**Swift version note:** Verify that all dependencies (SwiftNIO, IconquerCore) build cleanly on Swift 6.0.3 before deploying. Test with `swift build` on the server, not just locally on 6.3.
