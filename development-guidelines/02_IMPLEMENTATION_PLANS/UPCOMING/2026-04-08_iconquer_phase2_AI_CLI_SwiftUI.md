# Design Proposal: iConquer Phase 2 — IconquerAI, CLI, and SwiftUI shells

**Status:** REVISION 3 (2026-04-08) — adopting `SwiftMCPServer` (Justin's own reusable Swift MCP framework at `github.com/jpurnell/SwiftMCPServer`) instead of hand-rolling JSON-RPC. PlayerStrategy reverts to `async` (Justin: "don't know why things need to be sync when they can be async"). Tournament confirmed in v0.1.0. Round-3 questions resolved.

**Dependency reconciliation (resolved 2026-04-08):** Adopting `SwiftMCPServer` brings transitive dependencies on `modelcontextprotocol/swift-sdk`, `swift-nio`, `swift-nio-ssl`, `swift-crypto`, and a `CSQLite` system library (for OAuth state). It also enables HTTP transport, TLS, OAuth 2.0, and API key auth — much richer than the hand-rolled stdio-only design Revision 2 sketched.

The Revision-2 "no dependencies, no internet, blast radius of a fan" guidance is reconciled as follows, per Justin's confirmation:

- *"no internet"* = the server doesn't **initiate** outbound calls to LLM APIs from inside our code. ✅ Still true — the server is a listener, not a client. SwiftMCPServer never reaches out.
- *"blast radius of a fan"* = don't pull in **unnecessary** third-party stuff. ✅ Still true — SwiftMCPServer is Justin's own clean, bare-bones framework, intentionally adopted to dogfood it AND because it's the right shape for the multiplayer-networked future flagged in Q3. Justin: *"the SwiftMCPServer is very clean and bare bones, we should use it."*

**Note on terminology:** Justin wrote "MPC" in earlier feedback. Reading as "MCP" (Model Context Protocol — Anthropic's open standard for exposing tools to LLMs over JSON-RPC). Confirmed implicitly by the SwiftMCPServer reference, which is an MCP-protocol implementation.
**Date:** 2026-04-08
**Author:** Justin (with Claude)
**Predecessor:** Phase 1 (`IconquerCore` v0.1.0) — COMPLETE

---

## 1. Goal

Build the consumer layer on top of the now-shipped `IconquerCore` v0.1.0
rules engine. Phase 2 produces three distinct artifacts:

1. **`IconquerAI`** — a Swift package containing `PlayerStrategy`
   implementations (random, heuristic, and eventually LLM-driven). Stays
   strictly out of `IconquerCore`'s scope.
2. **`iconquer-cli`** — a pure-Swift command-line app that drives a game
   from the terminal. **No NCurses, no curses-style TUI.** Line-based
   REPL with optional ANSI colour, suitable for piping, scripting, and
   automated AI-vs-AI matches.
3. **`iConquer.app`** (SwiftUI) — the iOS/iPadOS/macOS/tvOS/visionOS app
   shell. Uses `IconquerCore` for state and `IconquerAI` for computer
   players.

The CLI is the **new addition** Justin requested — it wasn't in the
original Phase 2 conception. Its primary value: it lets us dogfood
`IconquerCore` and `IconquerAI` from a fast feedback loop *before* the
SwiftUI shell is ready, and provides a lasting deterministic harness for
AI-vs-AI tournament runs.

## 2. Non-Goals (Phase 2)

- No multiplayer networking. Single-process, single-machine. (Phase 3.)
- No save/load to disk in v0.2.0. (Phase 3 — straightforward via
  `GameSnapshot` Codable.)
- No full-screen curses TUI. The CLI is line-based, not a TUI.
- No Phase 2 changes to `IconquerCore`'s public API surface unless a
  consumer reveals a real gap. v0.1.0 is the contract.
- No App Store / TestFlight distribution. Local builds only.

## 3. Repo Layout

**Four** new sibling repos joining `IconquerCore` and `iconquer`:

```
~/Dropbox/Computer/Development/Swift/
├── iconquer/                       # this repo — TS reference + assets + dev docs
├── IconquerCore/                   # v0.1.0 sibling — pure rules engine
├── IconquerAI/                     # NEW — in-process AI strategies (Random, Greedy)
├── IconquerMCP/                    # NEW — MCP server exposing the engine to LLMs
├── IconquerCLI/                    # NEW — pure-Swift command-line app
└── IconquerApp/                    # NEW — SwiftUI app (hand-rolled .xcodeproj)
```

**Rationale for sibling repos** (per existing memory `feedback_repo_layout.md`):
each artifact has its own git history, can be tagged independently, and
the dependency graph is unidirectional:

```
                       IconquerCore
                       ╱  │  │  ╲
                      ╱   │  │   ╲
              IconquerAI  │  │  IconquerMCP
                      ╲   │  │   ╱
                       ╲  │  │  ╱
                       IconquerCLI ──> IconquerApp
                                       (independent, also depends on Core+AI)
```

`IconquerMCP` depends only on `IconquerCore` — it does NOT depend on
`IconquerAI`, because the MCP server doesn't run in-process strategies;
it only exposes engine state and actions as MCP tools that any external
LLM client can call. `IconquerCLI` depends on Core + AI + (optionally,
later) MCP. `IconquerApp` depends on Core + AI for its in-process AI
opponents and (optionally, later) connects to `IconquerMCP` for LLM
opponents. No circular references; no build-system entanglement.

**Resolved:** `IconquerApp` is a sibling repo (per Justin 2026-04-08).

## 4. `IconquerAI` Design

A pure-Swift package, Swift 6.2, OS 26 platforms, Swift 6 strict
concurrency. Mirrors `IconquerCore`'s setup exactly (and vendors the same
`development-guidelines/`).

### 4.1 Public API surface (REVISED — see §4.4 for the conceptual change)

```swift
import IconquerCore

/// A computer (or remote) player. Given an immutable snapshot of the
/// game, returns the sequence of moves to apply for one phase or turn.
///
/// Async-by-default in-process AI strategy contract. Random and Greedy
/// don't actually await anything, but the protocol stays async so future
/// strategies that *do* (e.g. a CoreML-backed heuristic, an HTTP-fetched
/// model, an on-device MLX call) can plug in without forcing a protocol
/// migration. Per Justin: "don't know why things need to be sync when
/// they can be async."
///
/// LLM-driven *remote* players are NOT this protocol — they connect via
/// `IconquerMCP` instead, see §4.4.
public protocol PlayerStrategy: Sendable {
    /// A short stable identifier (e.g. "random", "greedy").
    /// Used in CLI logs, replay transcripts, and tournament reports.
    var id: String { get }

    /// Choose moves for one PickCountries pick. Returns a single
    /// `.pickCountry(...)` move.
    func choosePick(for playerId: PlayerId, in game: Game) async -> [GameMove]

    /// Choose moves for one full Play turn. Returns the ordered list of
    /// moves the driver should apply: typically one or more
    /// `.placeArmies`, zero or more `.attack`, an optional fortify pair,
    /// and the closing `.finishTurn`.
    func chooseTurn(for playerId: PlayerId, in game: Game) async -> [GameMove]

    /// Choose which cards to surrender when ``Game/pendingInput`` is
    /// `.awaitingCardTurnIn(player:)`. Returns a single
    /// `.resolveCardTurnIn(...)` move.
    func chooseCardTurnIn(for playerId: PlayerId, in game: Game) async -> [GameMove]
}
```

`GameMove` is a new value type that lives in `IconquerCore` (this is the
`apply(_:GameAction)` enum we deferred from Phase 1 — now is the right
time, see §4.4). It's a faithful enum mirror of every public mutating
method on `Game`:

```swift
public enum GameMove: Sendable, Hashable, Codable {
    case pickCountry(CountryId)
    case placeArmies(CountryId, count: Int)
    case attack(from: CountryId, to: CountryId, mode: AttackMode)
    case finishAttackPhase
    case beginFortifyFrom(CountryId)
    case finishTurn
    case turnInCards([Card])
    case resolveCardTurnIn([Card])
}
```

The driver loop:

```swift
let moves = await strategy.chooseTurn(for: pid, in: game)
for move in moves {
    game.apply(move)
}
```

`Game.apply(_: GameMove)` is added to `IconquerCore` as a small thin
dispatcher to the existing mutating methods. **This requires a v0.2.0
release of `IconquerCore`** (not the same as Phase 2's overall v0.2.0
of the umbrella) — purely additive, no breaking changes, all 20 existing
parity fixtures continue to pass unchanged.

### 4.2 Initial concrete strategies

| Strategy | Behaviour | Use case |
| :--- | :--- | :--- |
| `RandomStrategy` | Random valid moves throughout. Picks countries at random; places income on a random owned country with at least one enemy neighbour; attacks a random valid target; never fortifies; auto-resolves card turn-in via `bestCardsToTurnIn`. | Baseline AI, fixture generation, early CLI demos. |
| `GreedyStrategy` | Places all income on the strongest border country, attacks the weakest enemy neighbour `untilWinOrLose` until no profitable attack remains, fortifies from the strongest interior country to the weakest border, turns in cards as soon as it has a set. | A tougher opponent for testing. |

**LLM-driven players are NOT in `IconquerAI`** — they live in `IconquerMCP`, which exposes the engine over the Model Context Protocol so any MCP-compatible client (Claude Desktop, custom apps, local-LLM bridges) can play as a real remote player. See §4.4.

### 4.3 Testing strategy

Same Design-First TDD discipline as `IconquerCore`. Each strategy gets:
- Unit tests asserting deterministic behaviour under fixed seeds
- A "round-trip" test that runs a full game with two strategies and
  asserts the game reaches `phase == .victory` within N turns
- No parity fixtures (TS reference doesn't have these strategies)

### 4.4 LLM Players via `IconquerMCP` (Model Context Protocol)

**Justin's correction (2026-04-08):** *"I am really not on board with the LLM structure. Since we expect to build alongside an LLM, it should include a way to get the current state of the board, and a way to submit a move. An MCP seems ideal for that."*

**Justin's scope guidance (2026-04-08, follow-up):** *"yes, let's offer an MCP, but built in, no dependencies, no internet, no problem. Let's keep the blast radius of a fan."*

This is right. The strategy-with-injected-provider design from Revision 1 is **removed entirely**. LLM players are not in-process Swift functions that we feed prompts to; they are real remote agents that connect to the engine over a standard protocol and call discrete tools to read state and submit moves — exactly the way a human player or another networked client would.

**Implementation: built on `SwiftMCPServer`** (`github.com/jpurnell/SwiftMCPServer` — Justin's own clean reusable Swift MCP framework). Not hand-rolled. Adopted as the foundation per Justin's confirmation: *"the SwiftMCPServer is very clean and bare bones, we should use it."*

**What `SwiftMCPServer` brings us for free:**

- **Builder API:** `MCPServer.builder().serverName(...).serverVersion(...).tools(...).run()`. Tool registration, request dispatch, and error handling are framework concerns.
- **Built on the official `modelcontextprotocol/swift-sdk`** — no protocol-shape risk, MCP spec compliance is the framework's responsibility, not ours.
- **Both stdio AND HTTP transports.** Stdio for Claude Desktop and any local MCP client. HTTP (opt-in via `--http <port>`) for networked play with TLS, OAuth 2.0, and API key auth.
- **API key generation/management commands** built into `MCPServer.parseArguments`: `--generate-key`, `--list-keys`, `--revoke-key`. Each key identifies a player session in networked games.
- **Built-in CLI argument parser.** No `swift-argument-parser` dependency on `IconquerMCP` itself.
- **Logging and session management** scaffolding already present.

**What `IconquerMCP` adds on top:**

- A `GameTools` namespace defining the engine-specific tool list (`get_game_state`, `place_armies`, `attack`, etc. — see the table below).
- A small `GameSession` actor wrapping a single `Game` instance and routing tool calls to it.
- Player-identity binding: the MCP session token (stdio peer or HTTP API key) maps to a `PlayerId`. Out-of-turn or out-of-player tool calls return JSON-RPC errors.
- A `MockMCPClient` test driver for tool-call parity tests (see §4.4.2).
- The thin executable wrapper that wires everything together.

**Estimated `IconquerMCP`-specific code:** under 1000 LOC of Swift (framework does the heavy lifting). The `SwiftMCPServer` dependency tree is large by Foundation-only standards but constant — it's the cost of getting a real MCP server with HTTP/TLS/auth instead of a stdio toy.

#### Architecture

```
                                            ┌────────────────────────┐
                                            │   MCP Client(s)         │
                                            │  • Claude Desktop       │
                                            │  • Claude API agent     │
                                            │  • Custom local-LLM     │
                                            │  • Ollama-MCP bridge    │
                                            │  • llama.cpp + MCP      │
                                            └───────────┬─────────────┘
                                                        │
                                                  JSON-RPC 2.0
                                              (stdio | SSE | HTTP)
                                                        │
                                            ┌───────────▼─────────────┐
                                            │   IconquerMCP           │
                                            │   ─ MCP server binary ─ │
                                            │                         │
                                            │   tools/list, tools/call│
                                            │   resources/list, etc.  │
                                            └───────────┬─────────────┘
                                                        │
                                                        │ direct in-process
                                                        │ Swift API calls
                                                        │
                                            ┌───────────▼─────────────┐
                                            │   IconquerCore          │
                                            │   (Game, GameMove, …)   │
                                            └─────────────────────────┘
```

`IconquerMCP` is a **standalone Swift binary** that:

1. Holds a single `Game` instance per server invocation (game-per-process for v0.1.0; multi-game lobby is post-v0.2.0).
2. Exposes `IconquerCore`'s public API as MCP tools (read-only and mutating).
3. Speaks JSON-RPC 2.0 over stdio (for Claude Desktop and CLI piping); optionally SSE/HTTP for networked clients (post-v0.1.0).
4. Validates that mutating tool calls come from the player whose turn it is — the engine is the source of truth, the LLM cannot cheat by playing out-of-turn.

The LLM is never a Swift type. It's a remote process (or human-driven Claude Desktop session) that talks to `iconquer-mcp` like any other MCP client.

#### MCP tools exposed in v0.1.0

**Read-only tools** (callable any time, by any player):

| Tool | Returns | Maps to |
| :--- | :--- | :--- |
| `get_game_state` | Full `GameSnapshot` JSON | `Game.snapshot()` |
| `get_map` | `MapDefinition` JSON | `Game.map` |
| `get_my_player` | The caller's `Player` record | `Game.players[callerId]` |
| `get_pending_input` | Current `PendingInput?` (so the LLM knows when to act) | `Game.pendingInput` |
| `get_legal_moves` | Array of `GameMove`s the caller may legally make right now | derived from `canAttack`, `currentPlayerId`, etc. |
| `get_best_cards_to_turn_in` | The TS-heuristic best set | `Game.bestCardsToTurnIn(for:)` |
| `get_income_for_countries` | Reinforcement preview | `Game.incomeForCountries(_:)` |

**Mutating tools** (only valid for the current player):

| Tool | Args | Maps to |
| :--- | :--- | :--- |
| `pick_country` | `country_id` | `Game.pickCountry` |
| `place_armies` | `country_id`, `count` | `Game.placeArmies` |
| `attack` | `from`, `to`, `mode` | `Game.attack` |
| `finish_attack_phase` | — | `Game.finishAttackPhase` |
| `begin_fortify_from` | `country_id` | `Game.beginFortifyFrom` |
| `finish_turn` | — | `Game.finishTurn` |
| `turn_in_cards` | `cards[]` | `Game.turnInCards` |
| `resolve_card_turn_in` | `cards[]` | `Game.resolveCardTurnIn` |

**MCP resources** (passive reads, not tool-call invocations):

| Resource URI | Content |
| :--- | :--- |
| `iconquer://game/state` | Always the latest `GameSnapshot` JSON |
| `iconquer://game/map` | Map JSON |
| `iconquer://game/history` | Newline-delimited `GameMove` log of every move played so far in this session |
| `iconquer://game/rules` | A canned text description of the rules + the deviations from RULES.md (the same content as `IconquerCore.docc/RulesMapping.md`) |

The system prompt the LLM uses is **its own concern**, not ours. Some clients will inline the rules; others will use the `iconquer://game/rules` resource. We don't ship a "blessed" prompt because that's an LLM-client decision.

#### Player identity & turn validation (designed for multiplayer-networked from day one)

Per Justin's Q3 guidance: *"yes, but this can be a multiplayer, networked game, so let's be careful."*

`iconquer-mcp` exposes two transports out of the box (via SwiftMCPServer):

**Stdio mode** (default — Claude Desktop integration, single local player):
```bash
iconquer-mcp serve --seed 42 --map duel --mcp-player P2
```
A single MCP client connects via stdin/stdout. The server pre-binds that session to the named player. No auth needed — physical access to the process is the auth boundary.

**HTTP mode** (multiplayer-networked):
```bash
# 1. Generate API keys (one per remote player), persist in SwiftMCPServer's keystore
iconquer-mcp --generate-key --name "P2"   # prints the key once
iconquer-mcp --generate-key --name "P3"

# 2. Start the server
iconquer-mcp serve --seed 42 --map world --http 7777 --tls-cert cert.pem --tls-key key.pem

# 3. Each remote MCP client connects with its API key in the Authorization header.
#    The server maps key → player on first request and locks the binding for the
#    duration of the game session.
```

**Key validation contract** (the same rules apply to both transports):

| Tool category | Validation |
| :--- | :--- |
| Read-only (`get_*`) | Always allowed. Observers can subscribe via any session, including unauthenticated stdio peers in spectate mode. |
| Mutating (`place_armies`, `attack`, …) | Caller's session-bound `PlayerId` must equal `game.currentPlayerId`. Otherwise: JSON-RPC error `-32000 "not your turn"`. |
| Mutating, but caller's player is not the current player | Same error as above. The engine is the source of truth; players cannot cheat by playing out-of-turn. |
| Pre-pickCountries phase | Each `pick_country` is allowed only when the calling session's player matches `game.currentPlayerId`. |

**v0.1.0 networked-multiplayer scope (per Justin's Q3 "be careful"):**

- Stdio mode is the *default* and the path everyone exercises first.
- HTTP mode is *available* in v0.1.0 because SwiftMCPServer offers it for free, but the v0.1.0 acceptance criterion is **stdio works end-to-end**, not networked HTTP.
- HTTP mode is *not* the focus of v0.1.0 testing. We add a single smoke test (server boots on HTTP, accepts a key, refuses a wrong key) but we don't try to verify multi-key tournaments or lobby behavior in v0.1.0.
- **What we explicitly design for** so future multi-player work is unblocked: per-session player binding, key-to-player mapping persistence (SwiftMCPServer's SQLite store), `GameSession` actor isolation, immutable game-config-at-startup vs. mutable per-turn state. These are baked into the architecture from day one even though only stdio is the certified path.
- **What we explicitly defer to v0.2.0+:** lobby/matchmaking, multi-game-per-process, in-game chat, spectator-only sessions, key revocation mid-game, reconnect-after-disconnect.

This is the "be careful" part: we don't ship a half-baked multiplayer experience in v0.1.0 just because the framework can. We ship a rock-solid stdio path with the HTTP scaffold *correctly designed* so v0.2.0 multiplayer is a fixture-driven extension, not a redesign.

#### Why MCP, not a custom protocol

- **It's a standard.** Claude Desktop, the Anthropic API agent loop, and a
  growing ecosystem of community clients all already speak it. No custom
  client work.
- **Tool-call discoverability.** `tools/list` is part of the spec. Any
  MCP client can introspect what `iconquer-mcp` offers without
  preconfiguration.
- **Provider-agnostic.** Justin's "people might prefer a local LLM"
  requirement is satisfied by the protocol itself: any MCP-compliant
  client works, regardless of which model is behind it.
- **Session boundaries are explicit.** JSON-RPC's request/response model
  matches our turn-by-turn engine flow naturally.
- **`SwiftMCPServer` already exists.** No protocol-shape risk, no hand-rolled JSON-RPC framing to test, no MCP spec implementation work. The framework handles the plumbing; we focus on the iConquer-specific tools.

#### 4.4.2 MockMCPClient for testing

`IconquerMCP` ships with a `MockMCPClient` test helper that drives the
server with hand-crafted JSON-RPC frames and asserts the responses.
Equivalent to Phase 1's parity-fixture pattern: each MCP test exercises
one tool call, asserts the response, asserts the resulting game state.
This locks down protocol parity without requiring any actual LLM in the
test target. **Tests run hermetically — no network, no LLM, no SwiftMCPServer
HTTP listener.** Stdio transport is exercised in-process via piped
`Pipe()` instances; HTTP transport gets one smoke test (boot, key
exchange, simple tool call) for the multiplayer scaffold.

#### What `IconquerAI` keeps (and doesn't)

`IconquerAI` keeps `RandomStrategy` and `GreedyStrategy` as **in-process,
synchronous, deterministic** strategies for `simulate` mode. These are
not remote players; they're pure Swift functions. They satisfy the
"baseline AI" and "tougher opponent" needs without any IPC.

`IconquerAI` does **NOT** contain `LLMStrategy`, `LLMProvider`,
`MockLLMProvider`, or any of the Revision-1 abstractions. Those are
deleted from the design. The protocol doesn't need a wrapper for LLMs
because LLMs aren't in-process callers — they're remote MCP clients.

#### `PlayerStrategy` stays async (Revision 3)

Justin: *"don't know why things need to be sync when they can be async."* The
async-by-default contract from Revision 1 is restored. `Random` and
`Greedy` simply don't await anything, but the protocol shape is open to
future strategies that need to (CoreML, MLX, HTTP heuristic, etc.).
The driver loop is one `await` per turn — negligible overhead.

#### How CLI integrates with MCP (deferred)

For Phase 2 v0.1.0, **the CLI does NOT bridge to MCP.** `iconquer-cli
simulate` runs in-process strategies only. Playing against an LLM is a
separate workflow:

```bash
# Terminal A: start the MCP server
iconquer-mcp serve --seed 42 --players "P1=human,P2=mcp:any"

# Terminal B (or Claude Desktop config): connect a client and play
```

A future v0.2.0 of `IconquerCLI` MAY add `iconquer-cli play
--player2 mcp` as a convenience that spawns `iconquer-mcp` as a
subprocess and pipes a configured client. That's NOT in v0.1.0 — it
would conflate three things (CLI rendering, MCP server lifecycle,
client subprocess management) and we'd rather ship each clean.

## 5. `IconquerCLI` Design — pure Swift, no NCurses

The interesting bit. A pure-Swift command-line app with **no NCurses
dependency**.

### 5.1 Why no NCurses

- NCurses is a C dependency that complicates Swift Package Manager
  builds, especially on Linux and across Apple platforms.
- It's a heavyweight full-screen TUI library when we don't need full-screen.
- Pure-Swift alternatives (line-based REPL + ANSI escape codes) cover
  every use case the CLI actually needs: interactive play, scriptable
  AI-vs-AI runs, and human-readable text output suitable for piping.
- Cross-platform: pure Swift runs identically on macOS, Linux, and via
  Docker without any system library wrangling.

### 5.2 Architecture

A line-based REPL with three modes, all driven by the same engine
state:

| Mode | What it does | When |
| :--- | :--- | :--- |
| **Interactive** | Print the board state, prompt the human for an action, parse it, apply it, repeat. ANSI colour for player ownership. Default mode. | `iconquer-cli play` |
| **AI vs AI** | Wire up two `PlayerStrategy` instances, drive turns until victory, print only the final result (or every turn if `--verbose`). Useful for tournament runs and regression-checking. | `iconquer-cli simulate --p1 random --p2 greedy --seed 42` |
| **Replay** | Read a sequence of actions from a file (or stdin), apply them to a game starting from a given seed, print state at each step. Useful for sharing games and bug reports. | `iconquer-cli replay game.txt --seed 42` |

### 5.3 Technology stack

Zero curses. Three small Swift dependencies, all pure-Swift:

| Dependency | Purpose | Why |
| :--- | :--- | :--- |
| `IconquerCore` | Rules engine | Phase 1 product (will be v0.2.0 by Phase 2 ship time, with `Game.apply(_:)`) |
| `IconquerAI` | Strategies for `simulate` mode | Phase 2 product |
| `swift-argument-parser` (Apple) | CLI command/flag parsing | Standard, pure Swift, well-maintained, used by Apple's own tools |

That's it. No `Rainbow`, no `swift-tui`, no NCurses, no third-party
curses wrappers. **ANSI colour codes are emitted directly from a small
internal `Style` namespace** when `isatty(STDOUT_FILENO) != 0` — same
pattern Apple's own command-line tools use.

### 5.3.1 Settings persistence

Per Justin's feedback: render width, colour scheme, ascii fallback, and
default RNG seed should be **persistently configurable** via a settings
file. Standard XDG location with macOS fallback:

```
$XDG_CONFIG_HOME/iconquer-cli/settings.json    (Linux + modern macOS)
~/.config/iconquer-cli/settings.json           (fallback)
```

A small `CLISettings: Codable` struct:

```swift
public struct CLISettings: Sendable, Codable {
    public var renderWidth: Int           // default 80, can be set up to 160+
    public var colorMode: ColorMode       // .auto / .always / .never
    public var asciiOnly: Bool            // default false (uses unicode bullets)
    public var defaultSimulateSeed: UInt32?
    public var playerColors: [PlayerId: ANSIColor]?  // override hex→ANSI mapping
}

public enum ColorMode: String, Sendable, Codable { case auto, always, never }
```

CLI commands to manage settings:

```
iconquer-cli config get [<key>]
iconquer-cli config set <key> <value>
iconquer-cli config reset
iconquer-cli config path                # prints the resolved settings file path
```

Every flag has a CLI equivalent that overrides the persisted value for
one invocation (`--width 160`, `--no-color`, `--ascii`, `--seed 42`).

Loading is fault-tolerant: a missing or malformed settings file falls
back to defaults and prints a one-line warning to stderr (never crashes).

### 5.3.2 Render width flexibility

Default 80 columns (works on every terminal, even narrow split panes),
**but the renderer is width-parameterised**. `--width 120` or
`--width 160` produces a wider board with longer country labels and
more horizontal spacing. The renderer also queries `TIOCGWINSZ` (via
Foundation's `winsize` ioctl wrapper) to auto-detect terminal width
when `renderWidth == 0` (which is interpreted as "auto").

Implementation plan: write the renderer with a single `Renderer.width:
Int` parameter from day one. No "wait until v0.3.0" excuses.

### 5.4 Rendering

Line-based, ASCII-art board with optional ANSI colour:

```
iConquer — Turn 4 — P1 (Player 1) — assignArmies
unallocated armies: 3   |   cards: 2

  Land continent (+0)
  ┌──────────┐
  │ A   [P1] │ ●●●●● ●●●●● ●●            (12 armies)
  │ B   [P1] │ ●                          (1 army)
  │ C   [P2] │ ●●●●● ●●●                  (8 armies)
  │ D   [P2] │ ●●                         (2 armies)
  └──────────┘

> place B 3
  +3 to B → 4 armies; 0 unallocated
  → entering attack phase

> attack B C
  attacker rolls: [6, 5, 3]    defender rolls: [4, 2]
  defender loses 2; attacker loses 0
  attacker rolls: [6, 4]       defender rolls: [3, 1]
  ...
  → captured C! P1 advances 3 armies; new owner P1
  → drew card: "B" (suit 0)

> finish-attack
> end-turn
  → P2's turn
```

The board rendering is intentionally simple. Continents are grouped;
each country shows owner colour and a unicode-bullet army count (with
a numeric fallback for non-utf8 terminals via `--ascii`).

For maps too large to render usefully (the world map's 42 countries),
the CLI offers `--list` to show countries grouped by continent without
the box drawing.

### 5.5 Command grammar (interactive mode)

| Command | What it does |
| :--- | :--- |
| `pick <country>` | PickCountries: claim a country |
| `place <country> <count>` | AssignArmies/Fortify: place armies |
| `attack <from> <to> [once\|until-lose\|until-end]` | Attack |
| `finish-attack` | Move from Attack → Fortify |
| `fortify <from>` | Begin fortify from a country |
| `end-turn` | finishTurn |
| `turn-in [auto\|<card1> <card2> <card3>]` | Turn in cards (auto = `bestCardsToTurnIn`) |
| `state` | Re-print the current board |
| `help` | Show command list |
| `quit` | Exit |

Parsed by hand (it's ~200 LOC of pattern matching) — `swift-argument-parser`
handles the top-level subcommands but not the in-REPL grammar.

### 5.6 Testing strategy

The CLI has its own test target. Three test classes:

1. **`CommandParserTests`** — pure parser, no engine. Asserts that every
   command grammar example parses correctly and reports good errors on
   garbage.
2. **`RendererTests`** — given a snapshot, the renderer produces a known
   string (with `--ascii` to keep tests stable across terminal capabilities).
3. **`SimulationTests`** — drives `simulate --p1 random --p2 random
   --seed 42` and asserts (a) the game reaches victory, (b) the
   transcript is byte-stable, and (c) the resulting `GameSnapshot`
   matches a vendored fixture.

The third class is essentially a "Phase 2 parity fixture" — same idea as
Phase 1's TS oracle parity, except the oracle is now `IconquerCore` +
`RandomStrategy` themselves (deterministic under seed 42).

### 5.7 Homebrew-readiness (provision now, ship later)

Justin's question: *"are there any things we should provision now for homebrew distribution?"*

**Yes — five small things land in `IconquerCLI@v0.1.0` so a future Homebrew formula is mechanical:**

1. **Stable executable product name** in `Package.swift`. The product name (`iconquer-cli`) is the binary name. Don't rename it later.

2. **Release-mode build cleanly with `swift build -c release`.** Verified as a CI/quality-gate step from day one. Add a `make release` (or `bin/release.sh`) wrapper that runs the canonical command and copies the artifact to `.build/release/iconquer-cli`. Trivial Bash, no system deps.

3. **Annotated semver tags on every release.** Same pattern as `IconquerCore@v0.1.0`. Homebrew formulas reference tags — `tag: "v0.1.0"`.

4. **`--version` flag** that prints `iconquer-cli 0.1.0 (IconquerCore 0.2.0, IconquerAI 0.1.0)`. Sourced from a single `Version.swift` constant that release-prep updates. Homebrew users expect this.

5. **A `Formula/iconquer-cli.rb` template** checked into the `IconquerCLI` repo (under `Formula/`, NOT auto-published). Documents the expected formula shape so a future maintainer can `cp Formula/iconquer-cli.rb /opt/homebrew/Library/Taps/.../Formula/` and tweak. Pure documentation; doesn't get installed by `swift run`.

**Explicitly NOT in v0.2.0:**
- A live Homebrew tap or PR to homebrew-core. Premature.
- A signed/notarised binary release. Phase 3.
- A GitHub Releases workflow. Phase 3 (it's just `gh release create` once we want it).
- Any non-pure-Swift dependency. Already a hard rule.

These five provisions are ~30 minutes of work spread across the v0.1.0 sub-steps and they save hours when we eventually do ship via brew.

## 6. `iConquer.app` (SwiftUI) Design

Smaller scope than the CLI in this proposal because it's the longest-tail
artifact and benefits from the CLI's earlier feedback. Phase 2 lands the
**minimum viable** SwiftUI shell: a single window/screen showing the
board, basic action buttons, and observation of `Game` via
`@Observable`. AI strategies plugged in via `IconquerAI`.

Key constraint: `Game` is a struct, so the SwiftUI layer wraps it in an
`@Observable` class (`GameStore`?) that holds the current `Game` value
and re-publishes on mutation. Standard Swift 6 + Observation pattern.

**Open question:** does the SwiftUI shell ship in v0.2.0 alongside the
CLI, or in v0.3.0 *after* the CLI is proven? **My recommendation:** ship
the CLI first as v0.2.0, then the SwiftUI shell as v0.3.0. This lets us
dogfood `IconquerAI` from the CLI while the SwiftUI work is still
green-field, and avoids cramming three large new artifacts into one
release.

## 7. Phase 2 Release Plan (REVISED)

| Tag | Artifact(s) | Acceptance |
| :--- | :--- | :--- |
| `IconquerCore@v0.2.0` | Adds `GameMove` enum + `Game.apply(_:)` dispatcher. Purely additive. All 20 existing parity fixtures continue to pass unchanged. | Unblocks IconquerAI; small enough to be one commit. |
| `IconquerAI@v0.1.0` | `PlayerStrategy` (sync) + `RandomStrategy` + `GreedyStrategy`. Full unit + round-trip tests, DocC. **No LLM/network code.** | Depends on `IconquerCore@v0.2.0`. |
| `IconquerMCP@v0.1.0` | MCP server built on `SwiftMCPServer` framework. Exposes the engine as MCP tools and resources. **Both stdio (default) and HTTP (opt-in) transports**, with HTTP designed-but-not-certified for v0.1.0 multiplayer use. API-key player identity for HTTP. Built-in `MockMCPClient` test harness drives every tool. | Depends on `IconquerCore@v0.2.0` and `SwiftMCPServer`. |
| `IconquerCLI@v0.1.0` | `play` + `simulate` + `replay` subcommands, persistent settings, `--width`/`--ascii`/`--no-color` flags, `config` subcommand, `--version`, Homebrew-ready binary product, full test suite, DocC, README quickstart. | Depends on `IconquerAI@v0.1.0`. **= Phase 2 v0.2.0 ship (alongside `IconquerMCP@v0.1.0`).** |
| `IconquerCLI@v0.2.0` | (Optional) `tournament` subcommand if it falls out cleanly from `simulate`. Otherwise punt to v0.3.0. | See §6.5 decision criteria. |
| `IconquerApp@v0.1.0` | Single-window SwiftUI shell, depends on Core + AI. | **= Phase 2 v0.3.0 ship.** Strictly after CLI is proven. |

## 8. Decisions & Open Questions

### Decisions (resolved 2026-04-08)

1. **Four sibling repos.** `IconquerAI`, `IconquerMCP`, `IconquerCLI`, `IconquerApp` — all siblings to `IconquerCore` and `iconquer`. ✅ (Updated in Revision 2 — added `IconquerMCP`.)
2. **CLI binary name: `iconquer-cli`.** ✅
3. **CLI distribution: `swift run` for v0.1.0**, with five Homebrew-readiness provisions in place (see §5.7) so we can ship a brew formula trivially later. ✅
4. **Default 80-column render width, parameterised renderer up to 160+**, persistently configurable via settings. Auto-detect via `TIOCGWINSZ` when set to 0. ✅
5. **ANSI colours derived from hex defaults**, persistently overridable in settings (`playerColors` map). `--no-color`/`--ascii` opt-outs. ✅
6. **Tournament: TBD by §6.5 decision criteria** below — include in v0.1.0 IF `simulate` falls out cleanly; otherwise v0.2.0. ✅
7. **LLM players connect over MCP via `IconquerMCP`, NOT a Swift `LLMStrategy`.** The MCP server is built on `SwiftMCPServer` (Justin's own clean reusable framework — `github.com/jpurnell/SwiftMCPServer`). Both stdio and HTTP transports out of the box. HTTP transport carries API-key player identity (designed for the multiplayer-networked future, not certified in v0.1.0). Any MCP-compliant client (Claude Desktop, custom apps, local-LLM bridges) can play. ✅
8. **CLI parity fixtures live inside `IconquerCLI/Tests/IconquerCLITests/Fixtures/`**, self-contained per repo. ✅

### Decisions (proposed defaults — overridable by Justin)

9. **No NCurses.** Pure-Swift CLI built on `swift-argument-parser` + ANSI codes.
10. **CLI ships before SwiftUI shell.** v0.2.0 = CLI; v0.3.0 = SwiftUI shell.
11. **`PlayerStrategy` is `async` and returns `[GameMove]`.** Revision 3 restored async (Justin: *"don't know why things need to be sync when they can be async"*). Random/Greedy don't await; future strategies that need I/O can. `GameMove` lands in `IconquerCore@v0.2.0` as an additive change (the action enum we deferred from Phase 1 design proposal §4).
12. **`RandomStrategy` + `GreedyStrategy` are the v0.1.0 IconquerAI minimum.** No LLM code in IconquerAI. LLM players come from `IconquerMCP@v0.1.0` which ships in the same release.
13. **Pure-Swift dependency footprint.** No system libraries. Just `swift-argument-parser` for the CLI and the Core/AI/Foundation chain.
14. **Same TDD discipline as Phase 1.** Each strategy and each CLI subcommand gets a focused failing test BEFORE implementation.

### Decisions resolved in Revisions 2 + 3

**MCP foundation (Revision 3 — resolved 2026-04-08):**

- **Built on `SwiftMCPServer`** (`github.com/jpurnell/SwiftMCPServer`) — Justin's own clean reusable Swift MCP framework. Not hand-rolled. Uses the official `modelcontextprotocol/swift-sdk`.
- **Both stdio and HTTP transports out of the box.** Stdio is the v0.1.0 certified path; HTTP is designed and scaffolded but not the focus of v0.1.0 acceptance.
- **Per-player API key identity for HTTP transport.** SwiftMCPServer's keystore (SQLite) persists keys across server invocations. Each key binds 1:1 to a player session.
- **`MockMCPClient` is the test driver.** Hermetic, no network, no LLM. CI-friendly.
- **Server is a listener, never a client.** Still no outbound HTTP, no LLM API calls, no third-party LLM SDKs in the dependency tree.
- **Multiplayer-networked is the long-term goal**, designed-for from day one but not certified until v0.2.0+.

### Round-3 questions — all resolved 2026-04-08

| # | Question | Resolution |
| :--- | :--- | :--- |
| Q1 | `GameMove` location | **`IconquerCore@v0.2.0`** ✅ (every consumer wants it) |
| Q2 | `PlayerStrategy` granularity | **Three methods** ✅ (`choosePick`, `chooseTurn`, `chooseCardTurnIn`) |
| Q3 | MCP player identity in v0.1.0 | **Single-client stdio default; HTTP+API-key scaffolding designed for the multiplayer future** ✅ (Justin: "be careful — this can be a multiplayer, networked game") |
| Q4 | MCP tool naming | **`snake_case`** ✅ (matches existing MCP servers) |
| Q5 | Tournament in v0.1.0 | **YES, included in v0.1.0** ✅ (Justin: "yes, let's include") — §6.5 criteria still apply as a sanity gate during implementation, but the default is "ship it" |

### §6.5 Tournament inclusion criteria (referenced from Q5)

`tournament` ships in `IconquerCLI@v0.1.0` (per Justin's explicit "yes, let's include"). The criteria below are now a **sanity gate during implementation** rather than a go/no-go decision: if any of these are violated during the work, raise the issue rather than silently punting.

1. The aggregation logic (win matrix, average turn count, tie handling) should be ≤ ~300 LOC of new code.
2. It needs zero new types in `IconquerCore` or `IconquerAI`.
3. It can be RED → GREEN tested with the same in-process strategies (`Random`, `Greedy`) we already use for `simulate`.
4. The `tournament` subcommand grammar is a thin wrapper over `simulate` (e.g. `tournament --strategies random,greedy --rounds 100 --seed-base 42`).

If a criterion is violated, **flag it in a session summary and re-confirm with Justin before deciding to ship or punt** — don't auto-decide.

## 9. Risks

- **`PlayerStrategy` protocol shape may need to change** once the CLI tries to use it. Mitigation: build `IconquerAI@v0.1.0` first, then `IconquerCLI@v0.1.0` on top, and revise `IconquerAI` if friction surfaces *before* tagging. Sequential, not parallel.

- **ANSI colour rendering on Windows.** Modern Windows Terminal handles ANSI codes natively, but older `cmd.exe` does not. Mitigation: detect via `isatty` + an environment check; default to no-colour on suspicious terminals. This is a compat detail, not a blocker.

- **CLI command grammar will probably want to grow** (multi-word country names, abbreviations, undo, save/load). Mitigation: write the parser to be extensible from day one (case-insensitive prefix matching, country name fuzzy match), document the grammar in DocC, and accept that v0.2.0 ships with a smaller grammar than v0.3.0.

- **`GameStore` `@Observable` wrapper for SwiftUI is non-trivial** because every `Game` mutation must re-publish, and `Game` is a struct. Standard pattern but requires care around `@MainActor`. Defer to the SwiftUI sub-step's RED→GREEN cycle.

## 10. Acceptance for Phase 2 (v0.2.0)

- `IconquerAI@v0.1.0` tagged: `RandomStrategy` + `GreedyStrategy`, all unit tests passing, DocC clean.
- `IconquerCLI@v0.1.0` tagged: `play` + `simulate` + `replay` subcommands working, full test suite (parser, renderer, simulation), DocC + README quickstart.
- AI-vs-AI parity-style fixture: `simulate --p1 random --p2 random --seed 42` produces a byte-stable transcript and a known final `GameSnapshot`, locked into `IconquerCLI`'s test suite.
- One Phase 2 completion summary in `iconquer/development-guidelines/05_SUMMARIES/`.
- `iConquer.app` (SwiftUI) is *not* an acceptance criterion for v0.2.0 — it's `v0.3.0`.

## 11. Open RED-GREEN Order if Approved (REVISED)

1. **`IconquerCore@v0.2.0`: add `GameMove` + `Game.apply(_:)`.** Land in the existing `IconquerCore` repo as a small additive PR. RED: write a focused test asserting `Game.apply(.placeArmies(...))` matches direct `Game.placeArmies(...)` for one of the existing parity fixtures. GREEN: implement the dispatcher. Re-run all 20 existing parity fixtures (must still pass). Tag `v0.2.0`.

2. **Bootstrap `IconquerAI` sibling repo.** Same skeleton as `IconquerCore` Step 1: `Package.swift` (multiple products: `IconquerAI` core, `IconquerAIClaude`/`IconquerAIOllama` placeholders), smoke test, vendored `development-guidelines/`.

3. **`PlayerStrategy` protocol (async) + `RandomStrategy`.** RED → GREEN; deterministic under seed 42.

4. **`GreedyStrategy`** (RED → GREEN).

5. **Round-trip integration test:** `RandomStrategy` vs `RandomStrategy` plays a full game to victory under fixed seed. Snapshot the final state into a fixture. Tag `IconquerAI@v0.1.0`.

6. **Bootstrap `IconquerMCP` sibling repo.** Skeleton + `Package.swift` declaring `SwiftMCPServer` as a dependency + vendored `development-guidelines/`.

7. **`GameSession` actor** (RED → GREEN). Wraps a single `Game` instance, provides actor-isolated read and mutating methods. Tested in isolation without any MCP framework involvement.

8. **`PlayerIdentityStore` actor** (RED → GREEN). Maps MCP session tokens (stdio peer ID or HTTP API key) to `PlayerId`. Tested with hand-crafted token/player pairs.

9. **`GameTools` namespace** — define the iConquer-specific tool registrations as `SwiftMCPServer` tool objects. Read-only tools first (one at a time, each with a `MockMCPClient` test): `get_game_state`, `get_map`, `get_my_player`, `get_pending_input`, `get_legal_moves`, `get_best_cards_to_turn_in`, `get_income_for_countries`.

10. **Mutating tools** (RED → GREEN one at a time): `pick_country`, `place_armies`, `attack`, `finish_attack_phase`, `begin_fortify_from`, `finish_turn`, `turn_in_cards`, `resolve_card_turn_in`. Each test asserts the resulting `Game` state.

11. **Out-of-turn validation** (RED → GREEN). A test that calls a mutating tool from the wrong player and asserts the JSON-RPC error.

12. **MCP resources** (RED → GREEN): `iconquer://game/state`, `iconquer://game/map`, `iconquer://game/history`, `iconquer://game/rules`.

13. **`iconquer-mcp` executable wrapper** (RED → GREEN). Wires `MCPServer.builder()` with the `GameTools`, `GameSession`, and `PlayerIdentityStore`. Calls `.run()`. Stdio transport is the default; `--http <port>` opts into HTTP via SwiftMCPServer's built-in arg parser.

14. **End-to-end MCP fixture (stdio):** scripted in-process MCP session driving a full short game via `MockMCPClient` (similar to Phase 1's fixture 12 but via MCP tool calls). Locks the protocol shape.

15. **HTTP transport smoke test:** boot the server on a random port, generate an API key, connect with it, call one read-only tool, refuse a wrong key. One test, ~50 LOC. Just verifies the multiplayer scaffold works end-to-end. Tag `IconquerMCP@v0.1.0`.

16. **Bootstrap `IconquerCLI` sibling repo.** Same skeleton + `swift-argument-parser` dep + Homebrew provisions §5.7.

17. **`CLISettings` + `config` subcommand** (RED → GREEN). Persistent settings file with set/get/reset/path.

18. **`Renderer` + `--width` flag** (RED → GREEN with a stable string fixture for one snapshot).

19. **Command grammar parser** (RED → GREEN, focused parser tests).

20. **`simulate` subcommand** (RED → GREEN, byte-stable transcript fixture).

21. **`play` subcommand** (RED → GREEN against scripted stdin via piped input).

22. **`replay` subcommand** (RED → GREEN against a known transcript file).

23. **`tournament` subcommand** (RED → GREEN; §6.5 criteria are a sanity gate during implementation, not a go/no-go).

24. **DocC + README + `--version`**, tag `IconquerCLI@v0.1.0` = **Phase 2 v0.2.0 ship** (alongside `IconquerCore@v0.2.0`, `IconquerAI@v0.1.0`, `IconquerMCP@v0.1.0`).

25. Phase 2 v0.2.0 completion summary in `iconquer/development-guidelines/05_SUMMARIES/`.

26. *(v0.3.0 work — `IconquerApp` SwiftUI shell + certified networked-multiplayer HTTP transport — begins separately.)*

---

**Awaiting Justin's review.** Move to `UPCOMING/` and mark APPROVED once §8 questions are resolved.
